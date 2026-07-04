// DB フィールド暗号化 (アプリ層 AES-256-GCM) — DESIGN-HANDOVER.md §4.1 / cares 封筒形式を踏襲
//
// 対象 (段階適用、実テーブルが landing 次第 index.ts の ENCRYPTED_FIELDS に追記):
// contacts.{email,phone,address,personal_profile,social_position,values_profile,notes,sns},
// contact_interactions.notes, contact_gifts.notes, outreach_messages.body。
// 鍵は Secret Manager の DATA_ENCRYPTION_KEY (256bit / 64 hex)。
//
// 格納形式: 既存の String 列をそのまま使い、暗号文を **バージョン付きエンベロープ**
//   "enc:v1:" + base64(nonce(12) | tag(16) | ciphertext)
// で格納する。列型変更 (Bytes) を避けることで migration リスクを最小化し、
// 既存の平文行 (enc: プレフィックス無し) はそのまま読めるため移行が安全 (idempotent backfill 可)。
//
// 注: where 句での検索・並び替えは暗号文に対して機能しないため、暗号化対象カラムは
//     フィルタ/ソートに使わない (text_entries.content は read/write のみ。確認済み)。
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ENVELOPE_PREFIX = "enc:v1:";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

let cachedHex: string | null = null;
let cachedKey: Buffer | null = null;

/**
 * Secret Manager / env から 256bit マスター鍵を取得 (64 hex 文字 = 32 byte)。
 * env 値が変わったら再計算する (テストで鍵を差し替え可能)。
 */
function getMasterKey(): Buffer {
  const hex = process.env.DATA_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "DATA_ENCRYPTION_KEY is not set. Generate with `openssl rand -hex 32` and put it in env / Secret Manager.",
    );
  }
  if (hex === cachedHex && cachedKey) return cachedKey;
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error(
      `DATA_ENCRYPTION_KEY must be 32 bytes (64 hex chars), got ${key.length} bytes.`,
    );
  }
  cachedHex = hex;
  cachedKey = key;
  return key;
}

/** 値が暗号化済みエンベロープか判定する。 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENVELOPE_PREFIX);
}

/**
 * 平文を AES-256-GCM で暗号化し "enc:v1:<base64>" を返す。
 * 既に暗号化済みなら二重暗号化を避けてそのまま返す。
 */
export function encryptField(plaintext: string): string {
  if (isEncrypted(plaintext)) return plaintext;
  const key = getMasterKey();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const blob = Buffer.concat([nonce, tag, enc]); // 12 + 16 + N
  return ENVELOPE_PREFIX + blob.toString("base64");
}

/**
 * エンベロープを復号して平文を返す。
 * プレフィックスが無い (= 旧平文 / 未移行データ) 場合はそのまま返す (移行安全)。
 * 認証タグ不一致 (改竄 / 鍵違い) の場合は例外を投げる。
 */
export function decryptField(stored: string): string {
  if (!isEncrypted(stored)) return stored; // legacy plaintext passthrough
  const key = getMasterKey();
  const blob = Buffer.from(stored.slice(ENVELOPE_PREFIX.length), "base64");
  const nonce = blob.subarray(0, NONCE_BYTES);
  const tag = blob.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
  const enc = blob.subarray(NONCE_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
    "utf-8",
  );
}
