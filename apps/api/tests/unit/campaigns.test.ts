import { describe, it, expect } from "vitest";
import {
  renderTemplate,
  matchesSegment,
  emailHash,
  signUnsub,
  verifyUnsub,
  normalizeEmail,
  buildCampaignFooter,
  type CampaignContact,
} from "../../src/lib/campaigns.js";

const SECRET = "test-secret";
const c = (over: Partial<CampaignContact>): CampaignContact => ({
  id: "c1",
  name: "田中",
  company: null,
  email: "a@example.com",
  distance: 3,
  lastContactDays: null,
  focusPreference: null,
  ...over,
});

describe("renderTemplate", () => {
  it("お名前・会社を差し込む", () => {
    expect(renderTemplate("{{お名前}}様、{{会社}}の皆様へ", { name: "山田", company: "青空商事" })).toBe(
      "山田様、青空商事の皆様へ",
    );
    expect(renderTemplate("{{name}} / {{company}}", { name: "A", company: null })).toBe("A /");
  });
});

describe("matchesSegment", () => {
  it("メール無し・除外は必ず対象外", () => {
    expect(matchesSegment(c({ email: null }), { all: true })).toBe(false);
    expect(matchesSegment(c({ focusPreference: "excluded" }), { all: true })).toBe(false);
  });
  it("距離・会社・大切だけ・間が空いた で絞れる", () => {
    expect(matchesSegment(c({ distance: 4 }), { distanceMax: 3 })).toBe(false);
    expect(matchesSegment(c({ distance: 2 }), { distanceMax: 3 })).toBe(true);
    expect(matchesSegment(c({ company: "青空商事" }), { company: "商事" })).toBe(true);
    expect(matchesSegment(c({ company: "赤山" }), { company: "商事" })).toBe(false);
    expect(matchesSegment(c({ focusPreference: "pinned" }), { pinnedOnly: true })).toBe(true);
    expect(matchesSegment(c({ focusPreference: null }), { pinnedOnly: true })).toBe(false);
    // 最近接触した方は除く。未接触 (null) は「間が空いた」に含める
    expect(matchesSegment(c({ lastContactDays: 10 }), { lastContactDaysMin: 90 })).toBe(false);
    expect(matchesSegment(c({ lastContactDays: 200 }), { lastContactDaysMin: 90 })).toBe(true);
    expect(matchesSegment(c({ lastContactDays: null }), { lastContactDaysMin: 90 })).toBe(true);
  });
});

describe("emailHash / normalizeEmail", () => {
  it("大文字小文字・前後空白を無視して同じハッシュ", () => {
    expect(normalizeEmail("  A@Example.COM ")).toBe("a@example.com");
    expect(emailHash("A@Example.com", SECRET)).toBe(emailHash("a@example.com", SECRET));
    expect(emailHash("a@example.com", SECRET)).not.toBe(emailHash("b@example.com", SECRET));
  });
});

describe("signUnsub / verifyUnsub", () => {
  it("署名を検証して ownerUid とメールを取り出す。改ざんは弾く", () => {
    const token = signUnsub("owner-1", "A@Example.com", SECRET);
    expect(verifyUnsub(token, SECRET)).toEqual({ ownerUid: "owner-1", email: "a@example.com" });
    expect(verifyUnsub(token, "other-secret")).toBeNull();
    expect(verifyUnsub(`${token}x`, SECRET)).toBeNull();
    expect(verifyUnsub("not-a-token", SECRET)).toBeNull();
  });
});

describe("buildCampaignFooter", () => {
  it("送信者表示と配信停止リンクを含む", () => {
    const f = buildCampaignFooter("山田太郎", "https://ex/unsubscribe?t=abc");
    expect(f).toContain("山田太郎");
    expect(f).toContain("https://ex/unsubscribe?t=abc");
    expect(f).toContain("配信の停止");
  });
});
