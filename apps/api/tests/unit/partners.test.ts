// 提携先アウトリーチ (ADR-0022 移植) の純粋ロジックのテスト。
import { describe, it, expect, afterEach } from "vitest";
import {
  BONDS_PITCH,
  BONDS_PRODUCT_URL,
  partnerDailyLimit,
  partnerAutoSendEnabled,
  buildPartnerFooter,
  isValidEmail,
  parseDiscoveredTargets,
  validatePartnerDraft,
  PARTNER_DISCOVER_MAX,
} from "../../src/lib/partners.js";

afterEach(() => {
  delete process.env.PARTNER_DAILY_LIMIT;
  delete process.env.PARTNER_AUTO_SEND;
  delete process.env.OUTREACH_SENDER_IDENTITY;
});

describe("安全装置の既定値", () => {
  it("自動送信は既定 OFF (PARTNER_AUTO_SEND=1 の明示許可時のみ)", () => {
    expect(partnerAutoSendEnabled()).toBe(false);
    process.env.PARTNER_AUTO_SEND = "1";
    expect(partnerAutoSendEnabled()).toBe(true);
    process.env.PARTNER_AUTO_SEND = "true"; // "1" 以外は許可しない
    expect(partnerAutoSendEnabled()).toBe(false);
  });

  it("日次上限は既定 20、env で上書き可・最大 500・不正値は既定", () => {
    expect(partnerDailyLimit()).toBe(20);
    process.env.PARTNER_DAILY_LIMIT = "50";
    expect(partnerDailyLimit()).toBe(50);
    process.env.PARTNER_DAILY_LIMIT = "99999";
    expect(partnerDailyLimit()).toBe(500);
    process.env.PARTNER_DAILY_LIMIT = "abc";
    expect(partnerDailyLimit()).toBe(20);
  });
});

describe("法的フッタ (特定電子メール法)", () => {
  it("送信者の明示・プロダクト URL・配信停止の案内を必ず含む", () => {
    const footer = buildPartnerFooter();
    expect(footer).toContain("bonds 運営チーム");
    expect(footer).toContain(BONDS_PRODUCT_URL);
    expect(footer).toContain("配信をご希望されない場合");
  });

  it("送信者名は OUTREACH_SENDER_IDENTITY で差し替えられる", () => {
    process.env.OUTREACH_SENDER_IDENTITY = "山田太郎（bonds 運営）";
    expect(buildPartnerFooter()).toContain("山田太郎（bonds 運営）");
  });
});

describe("isValidEmail", () => {
  it("形式チェック", () => {
    expect(isValidEmail("a@example.com")).toBe(true);
    expect(isValidEmail(" a@example.com ")).toBe(true);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail(null)).toBe(false);
  });
});

describe("parseDiscoveredTargets", () => {
  it("JSON から候補を取り出し、不正な kind/url は丸める", () => {
    const text = JSON.stringify({
      targets: [
        { kind: "association", name: "全国つながり協会", url: "https://example.org", reason: "会員向けに相性がよい" },
        { kind: "変な種別", name: "何とかサービス", url: "not-a-url", reason: "※理由" },
      ],
    });
    const out = parseDiscoveredTargets(text);
    expect(out).toHaveLength(2);
    expect(out[0]!.kind).toBe("association");
    expect(out[1]!.kind).toBe("other");
    expect(out[1]!.url).toBeNull();
    expect(out[1]!.reason).toBe("理由"); // 記号はサニタイズ
  });

  it("最大件数で打ち切り、壊れた出力は空配列", () => {
    const many = JSON.stringify({
      targets: Array.from({ length: 20 }, (_, i) => ({ kind: "site", name: `候補${i}`, url: null, reason: "r" })),
    });
    expect(parseDiscoveredTargets(many)).toHaveLength(PARTNER_DISCOVER_MAX);
    expect(parseDiscoveredTargets("JSON ではない")).toEqual([]);
    expect(parseDiscoveredTargets('{"targets":[{"kind":"site"}]}')).toEqual([]); // name 必須
  });
});

describe("validatePartnerDraft", () => {
  it("subject/body を検証し、記号をサニタイズする", () => {
    const r = validatePartnerDraft({
      subject: "**連携のご相談**",
      body: `はじめまして。${"bonds のご紹介です。".repeat(10)}`,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.draft.subject).toBe("連携のご相談");
      expect(r.draft.body).not.toContain("**");
    }
  });

  it("欠け・短すぎる本文は不合格", () => {
    expect(validatePartnerDraft({ subject: "件名" }).ok).toBe(false);
    expect(validatePartnerDraft({ subject: "件名", body: "短い" }).ok).toBe(false);
    expect(validatePartnerDraft("文字列").ok).toBe(false);
  });
});

describe("ピッチ", () => {
  it("bonds の一言ピッチは AI リテラルを含まない (BR-09)", () => {
    expect(BONDS_PITCH).not.toMatch(/AI|人工知能/);
  });
});
