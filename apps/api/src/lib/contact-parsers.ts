// 連絡先取込パーサ (CSV / vCard) — lms js/app.js の parseCSVContacts / parseVCardContacts を
// TS 純粋関数に移植・堅牢化。取込の各サンプルは tests/unit/contact-parsers.test.ts に
// 固定資産として置き、回帰させない (DESIGN-HANDOVER.md §7)。

export type ParsedContact = {
  name: string;
  furigana?: string;
  phone?: string;
  email?: string;
  address?: string;
  company?: string;
  title?: string;
  birthday?: string; // YYYY-MM-DD
  distance?: number;
  relationship?: string;
  notes?: string;
};

// CSV の 1 行をフィールドに分解する (ダブルクォート・埋め込みカンマ対応)。
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// ヘッダ名 → フィールドの対応 (lms の互換 + 日本語ヘッダ)。
const HEADER_MAP: Record<string, keyof ParsedContact> = {
  name: "name", 氏名: "name", 名前: "name",
  furigana: "furigana", ふりがな: "furigana", フリガナ: "furigana",
  phone: "phone", tel: "phone", 電話: "phone", 電話番号: "phone",
  email: "email", メール: "email", メールアドレス: "email",
  address: "address", 住所: "address",
  company: "company", organization: "company", 会社: "company", 会社名: "company", 所属: "company",
  title: "title", 役職: "title",
  birthday: "birthday", 誕生日: "birthday",
  distance: "distance", 距離: "distance",
  relationship: "relationship", 関係: "relationship",
  notes: "notes", メモ: "notes", 備考: "notes",
  // Eight (名刺アプリ) の CSV エクスポートヘッダ
  "e-mail": "email", 携帯電話: "phone", 役職名: "title",
  // 年賀状リスト系 (宛名 = 氏名。郵便番号は対応フィールドが無いため取り込まない)
  宛名: "name",
};

export function parseCsvContacts(csv: string): ParsedContact[] {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]!).map((h) => h.replace(/"/g, "").toLowerCase());
  const fields = headers.map((h) => HEADER_MAP[h] ?? null);
  const out: ParsedContact[] = [];
  for (const line of lines.slice(1)) {
    const values = splitCsvLine(line);
    const c: Partial<Record<keyof ParsedContact, string>> = {};
    fields.forEach((f, i) => {
      if (f && values[i]) c[f] = values[i];
    });
    if (!c.name) continue;
    out.push({
      ...c,
      name: c.name,
      distance: c.distance ? parseInt(c.distance, 10) || undefined : undefined,
    });
  }
  return out;
}

// vCard の 1 プロパティ行から値を取り出す (パラメータ ;TYPE=... を無視)。
function vcardValue(line: string): string {
  const idx = line.indexOf(":");
  return idx >= 0 ? line.slice(idx + 1).trim() : "";
}

export function parseVCardContacts(vcf: string): ParsedContact[] {
  const out: ParsedContact[] = [];
  // 折り返し行 (先頭が空白/タブ) を前の行に連結する (RFC 6350)
  const unfolded = vcf.replace(/\r?\n[ \t]/g, "");
  for (const card of unfolded.split(/BEGIN:VCARD/i).slice(1)) {
    const c: ParsedContact = { name: "" };
    for (const rawLine of card.split(/\r?\n/)) {
      const line = rawLine.trim();
      const upper = line.toUpperCase();
      if (upper.startsWith("FN")) c.name = vcardValue(line);
      else if (upper.startsWith("N;") || upper.startsWith("N:")) {
        // FN が無い場合のフォールバック: N の姓;名 を結合
        if (!c.name) c.name = vcardValue(line).split(";").filter(Boolean).join(" ");
      } else if (upper.startsWith("TEL")) c.phone ??= vcardValue(line);
      else if (upper.startsWith("EMAIL")) c.email ??= vcardValue(line);
      else if (upper.startsWith("ORG")) c.company = vcardValue(line).split(";")[0];
      else if (upper.startsWith("TITLE")) c.title = vcardValue(line);
      else if (upper.startsWith("ADR")) c.address ??= vcardValue(line).split(";").filter(Boolean).join(" ");
      else if (upper.startsWith("BDAY")) {
        const v = vcardValue(line).replace(/[^0-9]/g, "");
        if (v.length === 8) c.birthday = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
      }
    }
    if (c.name) out.push(c);
  }
  return out;
}

// 拡張子/内容からパーサを選ぶ。
export function parseContacts(content: string, format: "csv" | "vcard" | "auto" = "auto"): ParsedContact[] {
  if (format === "csv") return parseCsvContacts(content);
  if (format === "vcard") return parseVCardContacts(content);
  return /BEGIN:VCARD/i.test(content) ? parseVCardContacts(content) : parseCsvContacts(content);
}
