// 共有リンク日程調整の純粋関数 (パスワード・証明・入力検証) のユニットテスト。
import { describe, it, expect } from "vitest";
import {
  hashSharePassword,
  verifySharePassword,
  shareProof,
  verifyShareProof,
  parseShareInput,
  parseProposalInput,
  shareIsVisible,
} from "../../src/lib/schedule-share.js";

describe("パスワードと証明", () => {
  it("正しいパスワードだけ通り、証明はキーとハッシュから再現できる", () => {
    const hash = hashSharePassword("あいことば");
    expect(verifySharePassword("あいことば", hash)).toBe(true);
    expect(verifySharePassword("ちがう", hash)).toBe(false);
    const proof = shareProof("key-1", hash);
    expect(verifyShareProof("key-1", hash, proof)).toBe(true);
    expect(verifyShareProof("key-2", hash, proof)).toBe(false);
    expect(verifyShareProof("key-1", hash, "deadbeef")).toBe(false);
  });

  it("同じパスワードでも salt で毎回違うハッシュになる", () => {
    expect(hashSharePassword("x")).not.toBe(hashSharePassword("x"));
  });
});

describe("parseShareInput", () => {
  const now = new Date("2026-07-16T09:00:00Z");

  it("既定は 14 日間・60 分・期限 = 期間終了 + 1 か月", () => {
    const s = parseShareInput({}, now);
    expect(s.slotMinutes).toBe(60);
    expect(s.periodEnd.getTime() - s.periodStart.getTime()).toBe(14 * 24 * 60 * 60 * 1000);
    expect(s.expiresAt!.getTime() - s.periodEnd.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("期間は最長 90 日にクランプし、逆転した期間は直す", () => {
    const s = parseShareInput({ periodStart: "2026-07-16", periodEnd: "2027-07-16" }, now);
    expect(s.periodEnd.getTime() - s.periodStart.getTime()).toBe(90 * 24 * 60 * 60 * 1000);
    const r = parseShareInput({ periodStart: "2026-07-16", periodEnd: "2026-07-01" }, now);
    expect(r.periodEnd > r.periodStart).toBe(true);
  });

  it("公開ページに出る文字列は記号を除いて整える (BR-09)", () => {
    const s = parseShareInput({ title: "**打ち合わせ**", note: "# ぜひ\n- お願いします" }, now);
    expect(s.title).not.toContain("*");
    expect(s.note).not.toContain("#");
    expect(s.note).not.toMatch(/^- /m);
  });

  it("expiresAt: null で期限なし、日時指定はそのまま", () => {
    expect(parseShareInput({ expiresAt: null }, now).expiresAt).toBeNull();
    expect(parseShareInput({ expiresAt: "2026-12-31T00:00:00Z" }, now).expiresAt!.toISOString()).toBe(
      "2026-12-31T00:00:00.000Z",
    );
  });
});

describe("parseProposalInput", () => {
  const cand = [{ start: "2026-07-20T01:00:00Z", end: "2026-07-20T02:00:00Z" }];

  it("名乗りと候補が必須", () => {
    expect(parseProposalInput({ candidates: cand })).toHaveProperty("error", "name_required");
    expect(parseProposalInput({ guestName: "田中" })).toHaveProperty("error", "candidates_required");
  });

  it("候補は 5 件まで・壊れた候補は捨てる", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      start: `2026-07-2${i}T01:00:00Z`,
      end: `2026-07-2${i}T02:00:00Z`,
    }));
    const out = parseProposalInput({ guestName: "田中", candidates: [...many, { start: "x", end: "y" }] });
    expect("candidates" in out && out.candidates).toHaveLength(5);
  });
});

describe("shareIsVisible", () => {
  const now = new Date("2026-07-16T09:00:00Z");
  it("active かつ期限内だけ見える", () => {
    expect(shareIsVisible({ state: "active", expiresAt: null }, now)).toBe(true);
    expect(shareIsVisible({ state: "active", expiresAt: new Date("2026-08-01") }, now)).toBe(true);
    expect(shareIsVisible({ state: "active", expiresAt: new Date("2026-07-01") }, now)).toBe(false);
    expect(shareIsVisible({ state: "archived", expiresAt: null }, now)).toBe(false);
  });
});
