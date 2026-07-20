import { describe, it, expect } from "vitest";
import { pickGrowthContacts, planGrowthMoves, type GrowthInput } from "../../src/lib/growth.js";

const base: GrowthInput = {
  id: "c1",
  name: "田中",
  company: null,
  title: null,
  distance: 3,
  hasEmail: false,
  hasPhone: false,
  interactionCount: 0,
  lastContactDays: null,
  hasFacets: false,
  hasDigest: false,
  hasGoal: false,
  goalTargetDistance: null,
  sourceHits: 0,
  focusPreference: null,
  offeringTitle: null,
};

describe("pickGrowthContacts", () => {
  it("近づけたい目標・申し出の一致・仕事の接点がある方は高く出る", () => {
    const p: GrowthInput = { ...base, hasGoal: true, goalTargetDistance: 2, distance: 4, company: "青空商事", offeringTitle: "英語のレッスン", hasEmail: true };
    const [top] = pickGrowthContacts([p]);
    expect(top!.contactId).toBe("c1");
    expect(top!.reason).toContain("もっと近づきたい目標");
    expect(top!.moves.some((m) => m.kind === "offer" && m.label.includes("英語のレッスン"))).toBe(true);
  });

  it("外した方 (excluded) は選ばない", () => {
    const p: GrowthInput = { ...base, focusPreference: "excluded", hasGoal: true, goalTargetDistance: 1, company: "X" };
    expect(pickGrowthContacts([p])).toHaveLength(0);
  });

  it("手がかりも接点も無い薄い方は閾値に届かず出さない", () => {
    // 距離3 (+15) + ご挨拶これから (+8) = 23 < 30
    expect(pickGrowthContacts([{ ...base }])).toHaveLength(0);
  });

  it("既に十分近い方 (距離1) は伸びしろ加点が無く後ろになる", () => {
    const close: GrowthInput = { ...base, id: "close", distance: 1, company: "A", hasEmail: true, interactionCount: 2 };
    const room: GrowthInput = { ...base, id: "room", distance: 4, company: "A", hasEmail: true, interactionCount: 2 };
    const picks = pickGrowthContacts([close, room]);
    expect(picks[0]!.contactId).toBe("room"); // 距離を縮める余地のある方が前
  });
});

describe("planGrowthMoves", () => {
  it("連絡先があればキャッチアップ、申し出が刺されば提示、会う一手は常に出す", () => {
    const moves = planGrowthMoves({ ...base, hasEmail: true, offeringTitle: "工具を貸せます", lastContactDays: 90 });
    expect(moves.find((m) => m.kind === "catchup")!.label).toContain("ご無沙汰");
    expect(moves.some((m) => m.kind === "offer")).toBe(true);
    expect(moves.some((m) => m.kind === "meet")).toBe(true);
  });

  it("連絡手段も手がかりも無ければ、情報を足す一手を出す", () => {
    const moves = planGrowthMoves({ ...base });
    expect(moves.some((m) => m.kind === "catchup")).toBe(false);
    expect(moves.some((m) => m.kind === "enrich")).toBe(true);
  });
});
