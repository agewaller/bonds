import { describe, it, expect, beforeAll } from "vitest";
import {
  encryptField,
  decryptField,
  isEncrypted,
} from "../src/encryption.js";

// テスト用の固定鍵 (64 hex = 32 byte)
const TEST_KEY =
  "4e107972818fcee63f3c91de6ed6f7143edab3f4169bcfe9abc95034c5e1996f";

beforeAll(() => {
  process.env.DATA_ENCRYPTION_KEY = TEST_KEY;
});

describe("field encryption (AES-256-GCM)", () => {
  it("encrypt → decrypt で元の平文に戻る (日本語含む)", () => {
    const plain = "今朝の血圧は135/85でした。頭痛もある。";
    const enc = encryptField(plain);
    expect(isEncrypted(enc)).toBe(true);
    expect(enc.startsWith("enc:v1:")).toBe(true);
    expect(enc).not.toContain(plain);
    expect(decryptField(enc)).toBe(plain);
  });

  it("空文字も round-trip できる", () => {
    const enc = encryptField("");
    expect(isEncrypted(enc)).toBe(true);
    expect(decryptField(enc)).toBe("");
  });

  it("毎回 nonce が変わるため同じ平文でも暗号文が異なる", () => {
    const a = encryptField("same");
    const b = encryptField("same");
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe("same");
    expect(decryptField(b)).toBe("same");
  });

  it("二重暗号化しない (既に enc: なら素通し)", () => {
    const once = encryptField("x");
    const twice = encryptField(once);
    expect(twice).toBe(once);
  });

  it("旧平文 (プレフィックス無し) は decrypt で素通しする (移行安全)", () => {
    expect(decryptField("legacy plaintext memo")).toBe("legacy plaintext memo");
    expect(isEncrypted("legacy plaintext memo")).toBe(false);
  });

  it("改竄された暗号文は復号で例外を投げる (GCM 認証タグ)", () => {
    const enc = encryptField("secret");
    // base64 本体の末尾 1 文字を別の文字に差し替えて改竄
    const body = enc.slice("enc:v1:".length);
    const tampered =
      "enc:v1:" + body.slice(0, -2) + (body.slice(-2, -1) === "A" ? "B" : "A") + body.slice(-1);
    expect(() => decryptField(tampered)).toThrow();
  });

  it("エンベロープが短すぎる (nonce+tag に満たない) は復号で例外を投げる", () => {
    // enc:v1: だが blob が 12+16=28 byte 未満 → tag 長不正で例外
    const shortBlob = Buffer.from([1, 2, 3, 4, 5]).toString("base64");
    expect(isEncrypted("enc:v1:" + shortBlob)).toBe(true);
    expect(() => decryptField("enc:v1:" + shortBlob)).toThrow();
  });

  it("鍵が未設定だと暗号化で例外を投げる", () => {
    const saved = process.env.DATA_ENCRYPTION_KEY;
    delete process.env.DATA_ENCRYPTION_KEY;
    try {
      expect(() => encryptField("x")).toThrow(/DATA_ENCRYPTION_KEY/);
    } finally {
      process.env.DATA_ENCRYPTION_KEY = saved;
    }
  });

  it("鍵長が不正だと例外を投げる", () => {
    const saved = process.env.DATA_ENCRYPTION_KEY;
    process.env.DATA_ENCRYPTION_KEY = "abcd"; // 2 byte
    try {
      expect(() => encryptField("x")).toThrow(/32 bytes/);
    } finally {
      process.env.DATA_ENCRYPTION_KEY = saved;
    }
  });
});
