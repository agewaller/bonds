// アーカイブまるごと取込 — SNS 各社の「データをダウンロード」で得た ZIP を
// 解凍せずそのまま受け取り、中の友だち/つながりファイルを自動で見つけて解析する。
// ユーザーに ZIP の中身を探させない (取り込みを圧倒的に楽にする) ための心臓部。
import { unzipSync } from "fflate";
import { extractFileText, MAX_EXTRACT_TEXT_CHARS } from "./file-text.js";
import {
  parseFacebookFriends,
  parseInstagramFollowing,
  parseTwitterFollowing,
  parseLinkedInConnections,
  parseGoogleContactsCsv,
  parseVCardContacts,
  parseImportText,
  looksLikeGoogleContactsCsv,
  type ParsedContact,
  type ParsedImport,
} from "./contact-parsers.js";

export const MAX_IMPORT_FILE_BYTES = 30 * 1024 * 1024; // 30MB (エクスポート時に対象を絞れば十分収まる)
const MAX_ZIP_ENTRY_BYTES = 20 * 1024 * 1024; // ZIP 内の 1 ファイル上限 (写真等の巨大ファイルは読まない)

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"

export function isZip(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((b, i) => bytes[i] === b);
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function basename(path: string): string {
  return path.split("/").pop()?.toLowerCase() ?? "";
}

// ZIP 内の 1 エントリを既知の形式に振り分ける。該当しなければ null。
function parseZipEntry(path: string, bytes: Uint8Array): ParsedImport | null {
  const base = basename(path);
  const lower = path.toLowerCase();
  if (!/\.(json|js|csv|vcf|txt)$/.test(base)) return null;
  if (bytes.length > MAX_ZIP_ENTRY_BYTES) return null;
  const asContacts = (contacts: ParsedContact[]): ParsedImport | null =>
    contacts.length > 0 ? { contacts, interactions: [] } : null;

  // Facebook: friends/friends.json (friends_v2)。your_friends.json の別名もある
  if (base === "friends.json" || base === "your_friends.json") {
    return asContacts(parseFacebookFriends(decode(bytes)));
  }
  // Instagram: followers_and_following/following.json
  if (base === "following.json" && /instagram|following/.test(lower)) {
    return asContacts(parseInstagramFollowing(decode(bytes)));
  }
  // X (Twitter): data/following.js
  if (base === "following.js") {
    return asContacts(parseTwitterFollowing(decode(bytes)));
  }
  // LinkedIn: Connections.csv
  if (base === "connections.csv") {
    return asContacts(parseLinkedInConnections(decode(bytes)));
  }
  // Google Takeout: contacts.csv / All Contacts.csv / .vcf
  if (base.endsWith(".csv") && /contact/.test(lower)) {
    const text = decode(bytes);
    if (looksLikeGoogleContactsCsv(text.slice(0, 2000))) return asContacts(parseGoogleContactsCsv(text));
  }
  if (base.endsWith(".vcf")) {
    return asContacts(parseVCardContacts(decode(bytes)));
  }
  // LINE トーク履歴などのテキストが ZIP に入っているケース
  if (base.endsWith(".txt")) {
    const r = parseImportText(decode(bytes), base);
    return r.contacts.length > 0 ? r : null;
  }
  return null;
}

export type ExtractedFileText = { file: string; kind: string; text: string };

export type FileImportResult = ParsedImport & {
  // どのファイル/形式から何名拾えたか (画面のフィードバック用)
  foundIn: Array<{ file: string; contacts: number }>;
  // 構造化パーサで拾えなかったが本文テキストは読めたもの — AI の人物抽出に回す
  texts: ExtractedFileText[];
};

const MAX_TEXT_FILES = 30; // 1 取込 (ZIP) から AI に回すファイル数の上限

// OOXML (docx/xlsx/pptx) も ZIP 容器のため、SNS アーカイブ ZIP と取り違えない。
// [Content_Types].xml は OOXML に必ずある。
function looksLikeOoxml(entries: Record<string, Uint8Array>): boolean {
  return "[Content_Types].xml" in entries;
}

// 生バイト列 (ZIP・Office 文書・PDF・メール・テキスト全般) を解析する入口。
// まず既知の構造化形式 (SNS/CSV/vCard/トーク履歴) を試し、拾えないファイルは
// 本文テキストとして返して呼び出し側の AI 人物抽出へつなぐ。
export function parseImportFile(bytes: Uint8Array, filename?: string): FileImportResult {
  const name = filename ?? "file";
  if (isZip(bytes)) {
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(bytes, {
        filter: (f) => f.originalSize <= MAX_ZIP_ENTRY_BYTES && !/(^|\/)(__MACOSX|\.)/.test(f.name),
      });
    } catch {
      return { contacts: [], interactions: [], foundIn: [], texts: [] };
    }
    // docx/xlsx/pptx がそのまま置かれたケース: ZIP としてではなく 1 文書として読む
    if (looksLikeOoxml(entries)) {
      const t = extractFileText(bytes, name);
      return { contacts: [], interactions: [], foundIn: [], texts: t ? [{ file: name, kind: t.kind, text: t.text }] : [] };
    }
    const contacts: ParsedContact[] = [];
    const interactions: ParsedImport["interactions"] = [];
    const foundIn: FileImportResult["foundIn"] = [];
    const texts: ExtractedFileText[] = [];
    let textChars = 0;
    for (const [path, data] of Object.entries(entries)) {
      const r = parseZipEntry(path, data);
      if (r && r.contacts.length > 0) {
        contacts.push(...r.contacts);
        interactions.push(...r.interactions);
        foundIn.push({ file: path, contacts: r.contacts.length });
        continue;
      }
      // 既知形式でなくても本文が読めれば AI 抽出へ (ファイル数と総量に上限)
      if (texts.length >= MAX_TEXT_FILES || textChars >= MAX_EXTRACT_TEXT_CHARS) continue;
      const t = extractFileText(data, path);
      if (t) {
        texts.push({ file: path, kind: t.kind, text: t.text });
        textChars += t.text.length;
      }
    }
    return { contacts, interactions, foundIn, texts };
  }
  const t = extractFileText(bytes, name);
  // Office 文書・PDF・メールなど「テキスト化してから判定」する形式は抽出後の本文でも構造化を試す
  const structured = t && (t.kind === "excel" || t.kind === "text") ? parseImportText(t.text, filename) : null;
  const r = structured && structured.contacts.length > 0 ? structured : parseImportText(decode(bytes), filename);
  if (r.contacts.length > 0) {
    return { ...r, foundIn: [{ file: name, contacts: r.contacts.length }], texts: [] };
  }
  return { contacts: [], interactions: [], foundIn: [], texts: t ? [{ file: name, kind: t.kind, text: t.text }] : [] };
}
