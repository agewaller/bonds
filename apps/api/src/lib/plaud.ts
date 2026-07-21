// 録音メモ (Plaud) のメール添付テキストの読み取り — 純粋関数。
// Gmail API の message payload (MIME ツリー) から「添付のテキストファイル」を見つけ、
// attachments.get で取った base64url データを本文テキストに落とす。
// 本文 (メールの body) ではなく添付ファイルを正とする (オーナー指示 2026-07-20)。
import { createHash } from "node:crypto";
import { sanitizeProse } from "./plain-text.js";

/** 文字起こし本文の正規化ハッシュ。Gmail 経由と ZenTrack 経由で同じ内容が届いても
 *  一度だけ取り込むための同一性キー (空白のゆらぎを吸収してから sha256)。 */
export function transcriptHash(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  body?: { attachmentId?: string; data?: string; size?: number };
  parts?: GmailPart[];
};

export type TextAttachment = { filename: string; attachmentId: string | null; inlineData: string | null };

const TEXT_EXT = /\.(txt|text|md|markdown|srt|vtt)$/i;

/** MIME ツリーを歩いて、テキストの添付ファイルを列挙する (小さい添付は data が直に入る)。 */
export function findTextAttachments(payload: GmailPart | undefined): TextAttachment[] {
  const out: TextAttachment[] = [];
  const walk = (p: GmailPart | undefined) => {
    if (!p) return;
    const filename = (p.filename ?? "").trim();
    if (filename && (TEXT_EXT.test(filename) || (p.mimeType ?? "").startsWith("text/"))) {
      out.push({
        filename,
        attachmentId: p.body?.attachmentId ?? null,
        inlineData: p.body?.data ?? null,
      });
    }
    for (const child of p.parts ?? []) walk(child);
  };
  walk(payload);
  return out;
}

/** Gmail の base64url データを UTF-8 テキストに落とす。壊れていれば null。 */
export function decodeGmailData(data: unknown): string | null {
  if (typeof data !== "string" || !data) return null;
  try {
    const text = Buffer.from(data, "base64url").toString("utf-8");
    return text.replace(/\r\n/g, "\n").trim() || null;
  } catch {
    return null;
  }
}

/** ヘッダ配列から名前で値を引く (大文字小文字を無視)。 */
export function headerValue(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string {
  const h = (headers ?? []).find((x) => (x.name ?? "").toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

// ------- タスクと課題の検証 (AI 出力を申告のまま入れない) -------

export type PlaudTask = { text: string; kind: "task" | "issue"; done: boolean };
export type PlaudDigest = { summary: string; tasks: PlaudTask[] };

export function validatePlaudDigest(raw: unknown): PlaudDigest {
  const o = (raw ?? {}) as Record<string, unknown>;
  const summary = sanitizeProse(typeof o.summary === "string" ? o.summary : "").trim().slice(0, 600);
  const tasks: PlaudTask[] = [];
  if (Array.isArray(o.tasks)) {
    for (const t of o.tasks.slice(0, 20)) {
      if (!t || typeof t !== "object") continue;
      const rec = t as Record<string, unknown>;
      const text = sanitizeProse(typeof rec.text === "string" ? rec.text : "").trim().slice(0, 200);
      if (!text) continue;
      tasks.push({ text, kind: rec.kind === "issue" ? "issue" : "task", done: false });
    }
  }
  return { summary, tasks };
}
