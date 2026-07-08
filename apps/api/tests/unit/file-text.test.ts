// あらゆるファイル形式からの本文抽出の回帰テスト。fixture はライブラリ (fflate/zlib) で
// その場で組み立て、実物のバイナリ構造 (OOXML/PDF/RTF/MIME) を最小構成で再現する。
import { describe, it, expect } from "vitest";
import { zipSync, strToU8, zlibSync } from "fflate";
import {
  decodeTextSmart,
  htmlToText,
  docxToText,
  xlsxToText,
  pptxToText,
  pdfToText,
  rtfToText,
  emlToText,
  decodeMimeWord,
  extractFileText,
  detectImageMediaType,
} from "../../src/lib/file-text.js";
import { parseImportFile } from "../../src/lib/import-file.js";

function buildDocx(paragraphs: string[]): Uint8Array {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("");
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(`<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>`),
  });
}

function buildXlsx(rows: string[][]): Uint8Array {
  const all = rows.flat();
  const shared = all.map((s) => `<si><t>${s}</t></si>`).join("");
  let i = 0;
  const sheetRows = rows
    .map((r) => `<row>${r.map(() => `<c t="s"><v>${i++}</v></c>`).join("")}</row>`)
    .join("");
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/sharedStrings.xml": strToU8(`<sst>${shared}</sst>`),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`),
  });
}

function buildPdf(texts: string[]): Uint8Array {
  const content = `BT /F1 12 Tf ${texts.map((t) => `(${t}) Tj`).join(" ")} ET`;
  const deflated = zlibSync(strToU8(content));
  const head = strToU8("%PDF-1.4\n1 0 obj << /Filter /FlateDecode >>\nstream\n");
  const tail = strToU8("\nendstream\nendobj\n%%EOF");
  const out = new Uint8Array(head.length + deflated.length + tail.length);
  out.set(head, 0);
  out.set(deflated, head.length);
  out.set(tail, head.length + deflated.length);
  return out;
}

describe("decodeTextSmart", () => {
  it("Shift_JIS の名簿も文字化けせず読む", () => {
    // "山田太郎,営業部" の Shift_JIS バイト列
    const sjis = new Uint8Array([
      0x8e, 0x52, 0x93, 0x63, 0x91, 0xbe, 0x98, 0x59, 0x2c, 0x89, 0x63, 0x8b, 0xc6, 0x95, 0x94,
    ]);
    expect(decodeTextSmart(sjis)).toBe("山田太郎,営業部");
  });
  it("UTF-8 はそのまま", () => {
    expect(decodeTextSmart(strToU8("こんにちは"))).toBe("こんにちは");
  });
});

describe("htmlToText", () => {
  it("タグと script を除き、ブロックを改行にする", () => {
    const t = htmlToText("<html><script>var x=1;</script><body><p>山田さん</p><p>鈴木さん &amp; 佐藤さん</p></body></html>");
    expect(t).toContain("山田さん");
    expect(t).toContain("鈴木さん & 佐藤さん");
    expect(t).not.toContain("var x");
  });
});

describe("Office 文書", () => {
  it("docx の段落テキストを取り出す", () => {
    const t = docxToText(buildDocx(["田中一郎さんと面談", "連絡先は tanaka@example.com"]));
    expect(t).toContain("田中一郎さんと面談");
    expect(t).toContain("tanaka@example.com");
  });
  it("xlsx をカンマ区切りの行テキストに復元する (名簿が CSV 経路に乗る)", () => {
    const t = xlsxToText(buildXlsx([["氏名", "会社"], ["山田 太郎", "ヤマダ商事"]]));
    expect(t).toBe("氏名,会社\n山田 太郎,ヤマダ商事");
  });
  it("pptx のスライドテキストを取り出す", () => {
    const bytes = zipSync({
      "[Content_Types].xml": strToU8("<Types/>"),
      "ppt/slides/slide1.xml": strToU8("<p:sld><a:t>発表者は高橋さん</a:t></p:sld>"),
    });
    expect(pptxToText(bytes)).toContain("発表者は高橋さん");
  });
});

describe("pdfToText", () => {
  it("FlateDecode ストリームの Tj テキストを取り出す", () => {
    const t = pdfToText(buildPdf(["Meeting with John Smith", "john@example.com"]));
    expect(t).toContain("Meeting with John Smith");
    expect(t).toContain("john@example.com");
  });
  it("テキストの取れない PDF は null (正直に諦める)", () => {
    expect(pdfToText(strToU8("%PDF-1.4\nガラクタ"))).toBeNull();
  });
});

describe("rtfToText", () => {
  it("制御語を除いて本文を取り出す", () => {
    const rtf = strToU8("{\\rtf1\\ansi Hello \\par Bob Tanaka}");
    const t = rtfToText(rtf);
    expect(t).toContain("Hello");
    expect(t).toContain("Bob Tanaka");
  });
});

describe("emlToText", () => {
  it("ヘッダの MIME 語復号と quoted-printable 本文を読む", () => {
    const raw = [
      "From: =?utf-8?B?5bGx55Sw?= <yamada@example.com>",
      "To: me@example.com",
      "Subject: =?utf-8?B?44GU5oyo5ou2?=",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "=E3=81=8A=E4=B8=96=E8=A9=B1=E3=81=AB=E3=81=AA=E3=81=A3=E3=81=A6=E3=81=84=E3=81=BE=E3=81=99",
    ].join("\r\n");
    const t = emlToText(raw)!;
    expect(t).toContain("From: 山田 <yamada@example.com>");
    expect(t).toContain("Subject: ご挨拶");
    expect(t).toContain("お世話になっています");
  });
  it("multipart は text/plain パートを選ぶ", () => {
    const raw = [
      "From: a@example.com",
      'Content-Type: multipart/alternative; boundary="BB"',
      "",
      "--BB",
      "Content-Type: text/html",
      "",
      "<p>html側</p>",
      "--BB",
      "Content-Type: text/plain",
      "",
      "テキスト側の本文です",
      "--BB--",
    ].join("\r\n");
    expect(emlToText(raw)).toContain("テキスト側の本文です");
  });
  it("decodeMimeWord は Q エンコードも読む", () => {
    expect(decodeMimeWord("=?utf-8?Q?Taro_Yamada?=")).toBe("Taro Yamada");
  });
});

describe("extractFileText (入口の振り分け)", () => {
  it("拡張子で docx/xlsx/pdf を見分ける", () => {
    expect(extractFileText(buildDocx(["本文"]), "letter.docx")?.kind).toBe("word");
    expect(extractFileText(buildXlsx([["a"]]), "list.xlsx")?.kind).toBe("excel");
    expect(extractFileText(buildPdf(["hello world text content"]), "doc.pdf")?.kind).toBe("pdf");
  });
  it("拡張子がなくても中身 (マジックバイト) で判定する", () => {
    expect(extractFileText(buildDocx(["本文"]), "添付データ")?.kind).toBe("word");
    expect(extractFileText(strToU8("{\\rtf1 body}"), "unknown")?.kind).toBe("rtf");
  });
  it("画像・動画は対象外 (null)", () => {
    expect(extractFileText(strToU8("fake"), "photo.jpg")).toBeNull();
    expect(extractFileText(strToU8("fake"), "movie.mp4")).toBeNull();
  });
  it("ただのメモは text として読む", () => {
    const t = extractFileText(strToU8("昨日は佐藤さんと会食。"), "memo.txt");
    expect(t?.kind).toBe("text");
    expect(t?.text).toContain("佐藤さん");
  });
});

describe("detectImageMediaType (名刺・名簿の写真を Vision へ回す判定)", () => {
  it("マジックバイトで JPEG/PNG/GIF/WEBP を見分ける", () => {
    expect(detectImageMediaType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "card")).toBe("image/jpeg");
    expect(detectImageMediaType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "card")).toBe("image/png");
    expect(detectImageMediaType(new Uint8Array([0x47, 0x49, 0x46, 0x38]), "card")).toBe("image/gif");
    const webp = new Uint8Array(12);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(detectImageMediaType(webp, "card")).toBe("image/webp");
  });
  it("拡張子が画像ならマジックバイトが無くても JPEG 扱い (HEIC 変換等)", () => {
    expect(detectImageMediaType(new Uint8Array([0x00, 0x01]), "meishi.jpg")).toBe("image/jpeg");
  });
  it("画像でないものは null", () => {
    expect(detectImageMediaType(new TextEncoder().encode("name,email"), "list.csv")).toBeNull();
  });
});

describe("parseImportFile と AI 経路の橋渡し", () => {
  it("画像ファイル (名刺の写真) は images に base64 で入る (Vision へ)", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const r = parseImportFile(jpeg, "meishi.jpg");
    expect(r.contacts).toHaveLength(0);
    expect(r.images).toHaveLength(1);
    expect(r.images[0]!.mediaType).toBe("image/jpeg");
    expect(r.images[0]!.base64.length).toBeGreaterThan(0);
  });

  it("既知形式 (CSV) は従来どおり構造化で拾い、texts は空", () => {
    const csv = strToU8("name,email\n山田 太郎,taro@example.com\n");
    const r = parseImportFile(csv, "contacts.csv");
    expect(r.contacts).toHaveLength(1);
    expect(r.texts).toHaveLength(0);
  });
  it("Word 文書は texts に本文が入る (AI 抽出へ)", () => {
    const r = parseImportFile(buildDocx(["田中さんと打ち合わせ"]), "memo.docx");
    expect(r.contacts).toHaveLength(0);
    expect(r.texts).toHaveLength(1);
    expect(r.texts[0]!.text).toContain("田中さんと打ち合わせ");
  });
  it("Shift_JIS の CSV も構造化で拾える (decodeTextSmart 経由)", () => {
    // "氏名\n山田太郎" 相当の Shift_JIS CSV
    const sjis = new Uint8Array([
      0x8e, 0x81, 0x96, 0xbc, 0x0a, 0x8e, 0x52, 0x93, 0x63, 0x91, 0xbe, 0x98, 0x59,
    ]);
    const r = parseImportFile(sjis, "nenga.csv");
    expect(r.contacts.map((c) => c.name)).toContain("山田太郎");
  });
  it("ZIP の中の未知ファイル (Word/メモ) も texts に集める", () => {
    const zip = zipSync({
      "folder/friends.json": strToU8('{"friends_v2":[{"name":"Alice"}]}'),
      "folder/メモ.txt": strToU8("鈴木さんの近況: 引っ越したとのこと"),
    });
    const r = parseImportFile(zip, "archive.zip");
    expect(r.contacts.map((c) => c.name)).toContain("Alice");
    expect(r.texts.some((t) => t.text.includes("鈴木さん"))).toBe(true);
  });
});
