import { describe, it, expect } from "vitest";
import { parseGoalField, serializeGoal, goalPlan, validateGoalInput, type RelationshipGoal } from "../../src/lib/goals.js";

function goal(over: Partial<RelationshipGoal>): RelationshipGoal {
  return { purpose: "business", targetDistance: 2, note: "", setAt: "2026-07-01T00:00:00Z", startDistance: 4, ...over };
}

describe("関係の目標 (goals)", () => {
  it("parse/serialize が往復し、壊れた JSON や目標なしは null", () => {
    const g = goal({ note: "来期の協業" });
    expect(parseGoalField(serializeGoal(g))).toEqual(g);
    expect(parseGoalField(null)).toBeNull();
    expect(parseGoalField("not json")).toBeNull();
    expect(parseGoalField(JSON.stringify({ purpose: "business" }))).toBeNull();
  });

  it("入力検証: 用途と 1〜5 の目標が必須", () => {
    expect(validateGoalInput({ purpose: "romance", targetDistance: 2, note: "  仲良くなりたい " })).toEqual({
      purpose: "romance",
      targetDistance: 2,
      note: "仲良くなりたい",
    });
    expect(validateGoalInput({ purpose: "business" })).toBeNull();
    expect(validateGoalInput({ purpose: "unknown", targetDistance: 2 })).toBeNull();
    expect(validateGoalInput({ purpose: "business", targetDistance: 9 })).toBeNull();
  });

  it("近づく方向: いまの距離に応じた用途別の一手と、次の段階のペースが出る", () => {
    const p = goalPlan(goal({ purpose: "business", targetDistance: 2 }), { distance: 4, lastContactDays: 5 });
    expect(p.direction).toBe("closer");
    expect(p.gap).toBe(2);
    expect(p.nextMove).toContain("情報や記事");
    expect(p.paceLabel).toBe("月に一度ほど"); // 4 → 次の段階 3 の間隔
    expect(p.overdue).toBe(false);
  });

  it("間が空いていると「まずは一報」を先に促す", () => {
    const p = goalPlan(goal({ purpose: "friend", targetDistance: 2 }), { distance: 3, lastContactDays: 45 });
    expect(p.overdue).toBe(true);
    expect(p.nextMove).toContain("まずは軽い一報");
  });

  it("恋活・婚活は相手の意思とペースを尊重する言い方に固定される", () => {
    const p = goalPlan(goal({ purpose: "romance", targetDistance: 1 }), { distance: 2, lastContactDays: 2 });
    expect(p.nextMove).toContain("相手の意思を尊重");
  });

  it("目標どおりなら保つ、広げたい目標なら角の立たない間合いの取り方を出す", () => {
    const keep = goalPlan(goal({ targetDistance: 3 }), { distance: 3, lastContactDays: 10 });
    expect(keep.direction).toBe("keep");
    expect(keep.achieved).toBe(true);
    const further = goalPlan(goal({ targetDistance: 5, startDistance: 2 }), { distance: 2, lastContactDays: 3 });
    expect(further.direction).toBe("further");
    expect(further.nextMove).toContain("節目");
  });

  it("進捗は設定時の距離を基準に測る", () => {
    const p = goalPlan(goal({ targetDistance: 2, startDistance: 4 }), { distance: 3, lastContactDays: 1 });
    expect(p.progress).toBe(1); // 4 → 3 へ 1 段階前進
  });
});
