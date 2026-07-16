// 自動ケアの計画 (planCareActions) と出し直しの抑制 (shouldSuggestAgain) のユニットテスト。
import { describe, it, expect } from "vitest";
import { planCareActions, shouldSuggestAgain, type CarePlanInput } from "../../src/lib/care.js";

function person(over: Partial<CarePlanInput>): CarePlanInput {
  return {
    contactId: "x",
    name: "山田",
    distance: 3,
    hasGoal: false,
    interactionCount: 5,
    lastContactDays: 10,
    hasEmailOrPhone: true,
    hasDigest: true,
    hasFacets: true,
    ...over,
  };
}

describe("planCareActions", () => {
  it("間が空いた方には一報を、記録ゼロの方には始めの一言を促す", () => {
    const quiet = planCareActions(person({ lastContactDays: 120 }));
    expect(quiet.some((a) => a.kind === "reach_out")).toBe(true);
    const never = planCareActions(person({ lastContactDays: null, interactionCount: 0, hasDigest: false, hasFacets: false }));
    const reach = never.find((a) => a.kind === "reach_out");
    expect(reach?.body).toContain("まだやりとりの記録がありません");
  });

  it("やりとりが少ない方にはトーク履歴の取り込みを促す", () => {
    const acts = planCareActions(person({ interactionCount: 1, lastContactDays: 120 }));
    expect(acts.some((a) => a.kind === "import_talk")).toBe(true);
  });

  it("続いている関係で目標があり距離が遠めなら、会う約束 (日程調整) を勧める", () => {
    const acts = planCareActions(person({ hasGoal: true, distance: 3, lastContactDays: 10 }));
    expect(acts.some((a) => a.kind === "meet")).toBe(true);
  });

  it("目標が無ければ目標決めを、材料が薄ければひとことメモを勧める。提案は最大 2 件", () => {
    const noGoal = planCareActions(person({ hasGoal: false, lastContactDays: 10, distance: 2 }));
    expect(noGoal.some((a) => a.kind === "set_goal")).toBe(true);
    const thin = planCareActions(person({ hasGoal: true, hasDigest: false, hasFacets: false, lastContactDays: 10, distance: 2 }));
    expect(thin.some((a) => a.kind === "capture_note")).toBe(true);
    const many = planCareActions(person({ interactionCount: 0, lastContactDays: null }));
    expect(many.length).toBeLessThanOrEqual(2);
  });

  it("連絡手段が無い方に一報は勧めない (実行できない打ち手を出さない)", () => {
    const acts = planCareActions(person({ hasEmailOrPhone: false, lastContactDays: 200 }));
    expect(acts.some((a) => a.kind === "reach_out")).toBe(false);
  });

  it("文言は BR-09 (記号なし) の散文", () => {
    for (const a of planCareActions(person({ interactionCount: 0, lastContactDays: null }))) {
      expect(a.body).not.toMatch(/[*#|※]/);
    }
  });
});

describe("shouldSuggestAgain", () => {
  const now = new Date("2026-07-16T00:00:00Z");
  it("初回は出す。出したままなら重ねない。見送りから 30 日はそっとしておく", () => {
    expect(shouldSuggestAgain(null, now)).toBe(true);
    expect(shouldSuggestAgain({ status: "proposed", updatedAt: now }, now)).toBe(false);
    expect(shouldSuggestAgain({ status: "dismissed", updatedAt: new Date("2026-07-01") }, now)).toBe(false);
    expect(shouldSuggestAgain({ status: "dismissed", updatedAt: new Date("2026-06-01") }, now)).toBe(true);
    expect(shouldSuggestAgain({ status: "done", updatedAt: new Date("2026-06-01") }, now)).toBe(true);
  });
});
