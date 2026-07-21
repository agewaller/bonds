// 統合ハブ 純粋ロジックのユニットテスト。
import { describe, it, expect } from "vitest";
import {
  normalizeProduct,
  normalizeEmail,
  matchByEmail,
} from "../../src/lib/integration.js";

describe("normalizeProduct", () => {
  it("既知の製品のみ通す", () => {
    expect(normalizeProduct("cares")).toBe("cares");
    expect(normalizeProduct("vm")).toBe("vm");
    expect(normalizeProduct("unknown")).toBeNull();
    expect(normalizeProduct(undefined)).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("トリム・小文字化する", () => {
    expect(normalizeEmail("  Foo@Example.COM ")).toBe("foo@example.com");
  });
  it("表示名付きから抽出する", () => {
    expect(normalizeEmail("山田 花子 <Hanako@Example.com>")).toBe("hanako@example.com");
  });
  it("非文字列は空", () => {
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(123)).toBe("");
  });
});

describe("matchByEmail", () => {
  const contacts = [
    { id: "a", email: "hanako@example.com" },
    { id: "b", email: null },
    { id: "c", email: "Taro@Example.com" },
  ];
  it("送信元メールで連絡先を突合 (大小・表示名を吸収)", () => {
    expect(matchByEmail(contacts, "HANAKO@example.com")?.id).toBe("a");
    expect(matchByEmail(contacts, "太郎 <taro@example.com>")?.id).toBe("c");
  });
  it("一致なし・空は null", () => {
    expect(matchByEmail(contacts, "nobody@example.com")).toBeNull();
    expect(matchByEmail(contacts, "")).toBeNull();
    expect(matchByEmail(contacts, undefined)).toBeNull();
  });
});
