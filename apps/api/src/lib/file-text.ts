// あらゆるファイルからの本文テキスト抽出 — 取込の「読めない形式」をなくすための共通層。
// 構造化パーサ (CSV/vCard/SNS) で拾えないファイルはここで散文テキストに落とし、
// AI の人物抽出 (import_extract) に渡して連絡帳へ整理する。外部ライブラリは
// 既存依存の fflate だけで済ませ、失敗時は null (= 読めない) に静かに縮退する。
import { unzipSync, unzlibSync } from "fflate";

// AI に渡すテキストの上限 (1 取込あたり)。これを超える分は先頭優先で切る。
export const MAX_EXTRACT_TEXT_CHARS = 40_000;

const decoderUtf8 = new TextDecoder("utf-8", { fatal: false });

// UTF-8 で読んで文字化け (U+FFFD) が多ければ Shift_JIS を試す。
// 年賀状ソフトや古い名簿 CSV は Shift_JIS が多い (日本の 65 歳ペルソナの現実)。
export function decodeTextSmart(bytes: Uint8Array): string {
  const utf8 = decoderUtf8.decode(bytes);
  const bad = (utf8.match(/�/g) ?? []).length;
  if (bad === 0 || bad / Math.max(utf8.length, 1) < 0.002) return utf8;
  try {
    const sjis = new TextDecoder("shift_jis", { fatal: false }).decode(bytes);
    const sjisBad = (sjis.match(/�/g) ?? []).length;
    return sjisBad < bad ? sjis : utf8;
  } catch {
    return utf8;
  }
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function collapseBlank(s: string): string {
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// HTML → 本文テキスト (script/style を捨て、ブロック要素を改行に)。
export function htmlToText(html: string): string {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/table)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return collapseBlank(decodeXmlEntities(body));
}

// ---------------- Office Open XML (docx / xlsx / pptx) ----------------

const MAX_ZIP_ENTRY_BYTES = 20 * 1024 * 1024; // 1 エントリの展開後上限
const MAX_ZIP_TOTAL_BYTES = 100 * 1024 * 1024; // 全エントリ合計の展開後上限 (zip 爆弾対策)
const MAX_ZIP_ENTRIES = 2000; // エントリ数上限 (大量小ファイル攻撃対策)

function safeUnzip(bytes: Uint8Array, filter: (name: string) => boolean): Record<string, Uint8Array> | null {
  try {
    let total = 0;
    let count = 0;
    return unzipSync(bytes, {
      filter: (f) => {
        // originalSize は zip メタデータ由来 (攻撃者が小さく詐称し得る) だが、
        // 1 エントリ・エントリ数・申告合計サイズの三段で上限を掛けて肥大化を抑える。
        if (!filter(f.name)) return false;
        if (f.originalSize > MAX_ZIP_ENTRY_BYTES) return false;
        if (++count > MAX_ZIP_ENTRIES) return false;
        total += f.originalSize;
        if (total > MAX_ZIP_TOTAL_BYTES) return false;
        return true;
      },
    });
  } catch {
    return null;
  }
}

// Word: word/document.xml の <w:t> テキストを段落単位で復元する。
export function docxToText(bytes: Uint8Array): string | null {
  const entries = safeUnzip(bytes, (n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n));
  if (!entries || Object.keys(entries).length === 0) return null;
  const parts: string[] = [];
  for (const name of Object.keys(entries).sort()) {
    const xml = decoderUtf8.decode(entries[name]!);
    const text = xml
      .replace(/<w:tab[^>]*\/>/g, "\t")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g, (_, t: string) => decodeXmlEntities(t))
      .replace(/<[^>]+>/g, "");
    parts.push(text);
  }
  const joined = collapseBlank(parts.join("\n"));
  return joined || null;
}

// Excel: sharedStrings + 各シートの行を「カンマ区切りの行テキスト」に復元する。
// 名簿の Excel が CSV と同じ経路 (ヘッダ対応 → 構造化取込) に乗れるようにする。
export function xlsxToText(bytes: Uint8Array): string | null {
  const entries = safeUnzip(bytes, (n) => n === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  if (!entries) return null;
  const shared: string[] = [];
  const sharedXml = entries["xl/sharedStrings.xml"];
  if (sharedXml) {
    const xml = decoderUtf8.decode(sharedXml);
    for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      const texts = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXmlEntities(m[1]!));
      shared.push(texts.join(""));
    }
  }
  const lines: string[] = [];
  const sheetNames = Object.keys(entries).filter((n) => n.startsWith("xl/worksheets/")).sort();
  for (const name of sheetNames) {
    const xml = decoderUtf8.decode(entries[name]!);
    for (const row of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? []) {
      const cells: string[] = [];
      for (const cm of row.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cm[1]!;
        const inner = cm[2]!;
        const typeMatch = attrs.match(/t="([^"]+)"/);
        const t = typeMatch?.[1];
        let value = "";
        if (t === "s") {
          const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
          value = shared[parseInt(v, 10)] ?? "";
        } else if (t === "inlineStr") {
          value = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXmlEntities(m[1]!)).join("");
        } else {
          value = decodeXmlEntities(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
        }
        cells.push(value.includes(",") ? `"${value.replace(/"/g, '""')}"` : value);
      }
      if (cells.some((c) => c.trim())) lines.push(cells.join(","));
    }
  }
  const joined = lines.join("\n").trim();
  return joined || null;
}

// PowerPoint: 各スライドの <a:t> テキスト。
export function pptxToText(bytes: Uint8Array): string | null {
  const entries = safeUnzip(bytes, (n) => /^ppt\/(slides|notesSlides)\/[^/]+\.xml$/.test(n));
  if (!entries || Object.keys(entries).length === 0) return null;
  const parts: string[] = [];
  for (const name of Object.keys(entries).sort()) {
    const xml = decoderUtf8.decode(entries[name]!);
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1]!));
    if (texts.length > 0) parts.push(texts.join("\n"));
  }
  const joined = collapseBlank(parts.join("\n\n"));
  return joined || null;
}

// ---------------- PDF ----------------

// PDF のテキスト描画演算子 (Tj / TJ / ') から文字列を集める。FlateDecode の
// ストリームは fflate で伸長する。CID フォント (多くの日本語 PDF) はマップ表なしに
// 復元できないため、可読文字が乏しければ null (= 読めない) を返して正直に諦める。
export function pdfToText(bytes: Uint8Array): string | null {
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) return null; // %PDF
  const latin = new TextDecoder("latin1").decode(bytes);
  const chunks: string[] = [];
  const streamRe = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(latin)) !== null) {
    const start = m.index + m[0].length;
    const end = latin.indexOf("endstream", start);
    if (end < 0) break;
    const raw = bytes.subarray(start, end);
    let content: string | null = null;
    try {
      content = decoderUtf8.decode(unzlibSync(raw));
    } catch {
      const asText = latin.slice(start, end);
      if (/\b(Tj|TJ)\b/.test(asText)) content = asText;
    }
    if (content && /\b(Tj|TJ)\b/.test(content)) chunks.push(content);
    streamRe.lastIndex = end;
  }
  if (chunks.length === 0) return null;
  const out: string[] = [];
  const pushLiteral = (lit: string) => {
    const s = lit
      .replace(/\\([nrtbf()\\])/g, (_, ch: string) =>
        ch === "n" ? "\n" : ch === "r" ? "" : ch === "t" ? "\t" : "()\\".includes(ch) ? ch : " ",
      )
      .replace(/\\(\d{1,3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));
    if (s.trim()) out.push(s);
  };
  for (const content of chunks) {
    for (const op of content.matchAll(/\(((?:\\.|[^\\()])*)\)\s*(?:Tj|')/g)) pushLiteral(op[1]!);
    for (const arr of content.matchAll(/\[((?:\\.|[^\]])*)\]\s*TJ/g)) {
      const parts = [...arr[1]!.matchAll(/\(((?:\\.|[^\\()])*)\)/g)].map((p) => p[1]!);
      if (parts.length > 0) pushLiteral(parts.join(""));
    }
    out.push("\n");
  }
  const text = collapseBlank(out.join(" "));
  // 可読文字 (英数かな漢字) が乏しいならフォント埋め込みで復元不能とみなす
  const readable = (text.match(/[A-Za-z0-9぀-ヿ㐀-鿿]/g) ?? []).length;
  return readable >= 20 ? text : null;
}

// ---------------- RTF ----------------

export function rtfToText(bytes: Uint8Array): string | null {
  const raw = new TextDecoder("latin1").decode(bytes);
  if (!raw.startsWith("{\\rtf")) return null;
  // \'xx は元エンコーディング (日本語 RTF は Shift_JIS が多い) のバイト。バイト列に戻してから復号する。
  const byteList: number[] = [];
  const body = raw
    .replace(/\\par[d]?\b/g, "\n")
    .replace(/\\tab\b/g, "\t")
    .replace(/\{\\\*[^{}]*\}/g, "")
    .replace(/\\fonttbl[^{}]*/g, "")
    .replace(/\\u(-?\d+)\??/g, (_, code: string) => String.fromCodePoint(((parseInt(code, 10) % 65536) + 65536) % 65536));
  let text = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === "\\" && body[i + 1] === "'") {
      byteList.push(parseInt(body.slice(i + 2, i + 4), 16));
      i += 3;
      continue;
    }
    if (byteList.length > 0) {
      text += decodeTextSmart(new Uint8Array(byteList));
      byteList.length = 0;
    }
    if (ch === "\\") {
      const cw = body.slice(i).match(/^\\[a-z]+-?\d* ?/i);
      if (cw) {
        i += cw[0].length - 1;
        continue;
      }
      i++; // \{ \} などのエスケープ
      text += body[i] ?? "";
      continue;
    }
    if (ch === "{" || ch === "}") continue;
    text += ch;
  }
  if (byteList.length > 0) text += decodeTextSmart(new Uint8Array(byteList));
  const cleaned = collapseBlank(text);
  return cleaned || null;
}

// ---------------- メール (.eml / mbox 断片) ----------------

function decodeQuotedPrintable(s: string): string {
  const bytes: number[] = [];
  const src = s.replace(/=\r?\n/g, "");
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) {
      bytes.push(parseInt(src.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(src.charCodeAt(i));
    }
  }
  return decodeTextSmart(new Uint8Array(bytes));
}

// RFC 2047 エンコード語 (=?utf-8?B?...?=) をヘッダから復号する。
export function decodeMimeWord(s: string): string {
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset: string, enc: string, data: string) => {
    try {
      const bytes =
        enc.toUpperCase() === "B"
          ? Uint8Array.from(Buffer.from(data, "base64"))
          : (() => {
              const qp = data.replace(/_/g, " ");
              const out: number[] = [];
              for (let i = 0; i < qp.length; i++) {
                if (qp[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(qp.slice(i + 1, i + 3))) {
                  out.push(parseInt(qp.slice(i + 1, i + 3), 16));
                  i += 2;
                } else out.push(qp.charCodeAt(i));
              }
              return new Uint8Array(out);
            })();
      return new TextDecoder(charset.toLowerCase(), { fatal: false }).decode(bytes);
    } catch {
      return data;
    }
  });
}

export function emlToText(raw: string): string | null {
  const headerEnd = raw.search(/\r?\n\r?\n/);
  if (headerEnd < 0) return null;
  const headerBlock = raw.slice(0, headerEnd).replace(/\r?\n[ \t]/g, " "); // 折り返し行を連結
  const headers = new Map<string, string>();
  for (const line of headerBlock.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx > 0) headers.set(line.slice(0, idx).trim().toLowerCase(), decodeMimeWord(line.slice(idx + 1).trim()));
  }
  if (!headers.has("from") && !headers.has("to") && !headers.has("subject")) return null;
  let body = raw.slice(headerEnd).trim();
  const contentType = headers.get("content-type") ?? "";
  const boundary = contentType.match(/boundary="?([^";]+)"?/)?.[1];
  let bodyEncoding = (headers.get("content-transfer-encoding") ?? "").toLowerCase();
  let bodyType = contentType;
  if (boundary) {
    // multipart: text/plain パートを優先、無ければ text/html
    const parts = body.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?`));
    let chosen: { headers: string; body: string } | null = null;
    for (const part of parts) {
      const pEnd = part.search(/\r?\n\r?\n/);
      if (pEnd < 0) continue;
      const ph = part.slice(0, pEnd).toLowerCase();
      if (/content-type:\s*text\/plain/.test(ph)) {
        chosen = { headers: ph, body: part.slice(pEnd).trim() };
        break;
      }
      if (!chosen && /content-type:\s*text\/html/.test(ph)) chosen = { headers: ph, body: part.slice(pEnd).trim() };
    }
    if (chosen) {
      body = chosen.body;
      bodyEncoding = chosen.headers.match(/content-transfer-encoding:\s*(\S+)/)?.[1] ?? "";
      bodyType = chosen.headers.match(/content-type:\s*([^\s;]+)/)?.[1] ?? "text/plain";
    }
  }
  if (/base64/.test(bodyEncoding)) {
    try {
      body = decodeTextSmart(Uint8Array.from(Buffer.from(body.replace(/\s+/g, ""), "base64")));
    } catch {
      /* 復号できなければそのまま */
    }
  } else if (/quoted-printable/.test(bodyEncoding)) {
    body = decodeQuotedPrintable(body);
  }
  if (/html/.test(bodyType)) body = htmlToText(body);
  const meta = ["from", "to", "cc", "date", "subject"]
    .filter((k) => headers.has(k))
    .map((k) => `${k[0]!.toUpperCase()}${k.slice(1)}: ${headers.get(k)}`)
    .join("\n");
  return collapseBlank(`${meta}\n\n${body}`);
}

// ---------------- 入口: ファイル → テキスト ----------------

const TEXTUAL_EXT =
  /\.(txt|text|md|markdown|log|csv|tsv|json|js|vcf|ics|yaml|yml|xml|ini|conf|nfo)$/i;
const MEDIA_EXT =
  /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?|svg|mp4|mov|avi|mkv|webm|mp3|m4a|wav|aac|flac|ogg|zip|rar|7z|gz|exe|dll|dmg|apk|iso|woff2?|ttf|otf)$/i;

export type ExtractedText = { text: string; kind: string };

// Vision で読み取れる画像か (名刺・名簿・スクショ)。拡張子とマジックバイトで判定する。
const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Anthropic の画像上限に合わせる (5MB)

export function detectImageMediaType(bytes: Uint8Array, filename: string): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  )
    return "image/webp";
  // HEIC/HEIF などブラウザで JPEG に変換されて届くことも多いので拡張子でも拾う
  if (IMAGE_EXT.test(filename)) return "image/jpeg";
  return null;
}

// 拡張子とマジックバイトから本文テキストを取り出す。読めない形式は null。
// (画像・音声・動画は対象外 — 名刺写真などは今後の拡張。ZIP は呼び出し側が展開する)
export function extractFileText(bytes: Uint8Array, filename: string): ExtractedText | null {
  const lower = filename.toLowerCase();
  if (MEDIA_EXT.test(lower)) return null;
  const isZipContainer = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZipContainer) {
    // OOXML (docx/xlsx/pptx) は ZIP 容器。拡張子を優先しつつ、無くても中身で順に試す
    const tries: Array<[RegExp, (b: Uint8Array) => string | null, string]> = [
      [/\.docx$/, docxToText, "word"],
      [/\.(xlsx|xlsm)$/, xlsxToText, "excel"],
      [/\.pptx$/, pptxToText, "powerpoint"],
    ];
    tries.sort((a, b) => Number(b[0].test(lower)) - Number(a[0].test(lower)));
    for (const [, fn, kind] of tries) {
      const t = fn(bytes);
      if (t) return { text: t, kind };
    }
    return null;
  }
  if (lower.endsWith(".pdf") || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    const t = pdfToText(bytes);
    return t ? { text: t, kind: "pdf" } : null;
  }
  const head = decoderUtf8.decode(bytes.subarray(0, 8));
  if (lower.endsWith(".rtf") || head.startsWith("{\\rtf")) {
    const t = rtfToText(bytes);
    return t ? { text: t, kind: "rtf" } : null;
  }
  const asText = decodeTextSmart(bytes);
  if (lower.endsWith(".eml") || /^(from|to|subject|received|return-path|delivered-to):/im.test(asText.slice(0, 400))) {
    const t = emlToText(asText);
    if (t) return { text: t, kind: "mail" };
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm") || /^\s*<(!doctype\s+html|html)/i.test(asText.slice(0, 200))) {
    const t = htmlToText(asText);
    return t ? { text: t, kind: "html" } : null;
  }
  if (TEXTUAL_EXT.test(lower)) {
    const t = asText.trim();
    return t ? { text: t, kind: "text" } : null;
  }
  // 拡張子不明: 制御文字が少なければテキストとして扱う
  const sample = asText.slice(0, 2000);
  const controls = (sample.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) ?? []).length;
  if (sample.trim() && controls / Math.max(sample.length, 1) < 0.02) {
    return { text: asText.trim(), kind: "text" };
  }
  return null;
}
