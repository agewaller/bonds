import { describe, it, expect } from "vitest";
import { searchByAxis, looksLikePublicFigure, type AxisInput } from "../../src/lib/axes.js";

const base: AxisInput = {
  id: "c1",
  name: "田中",
  company: null,
  title: null,
  distance: 3,
  sourceHits: 1,
  valuesProfile: null,
  notes: null,
  digest: null,
  facetsSkills: [],
  facetsValues: null,
  hasGoal: false,
  ddScore7d: null,
  ddScoreSvc: null,
};

describe("searchByAxis", () => {
  it("影響力: 社長などの立場と公人評価で上がる。手がかりの無い方は載らない", () => {
    const ceo: AxisInput = { ...base, id: "ceo", title: "代表取締役社長", company: "青空商事" };
    const nobody: AxisInput = { ...base, id: "nobody" };
    const items = searchByAxis("influence", [ceo, nobody]);
    expect(items.map((x) => x.contactId)).toEqual(["ceo"]);
    expect(items[0]!.reasons[0]).toContain("代表取締役社長");
  });

  it("専門性: 専門職の肩書きと得意なこと (facets) で上がる", () => {
    const doc: AxisInput = { ...base, id: "doc", title: "弁護士", facetsSkills: ["契約実務", "紛争解決"] };
    const [top] = searchByAxis("expertise", [doc, base]);
    expect(top!.contactId).toBe("doc");
    expect(top!.reasons.join(" ")).toContain("契約実務");
  });

  it("価値観: 価値観の記録が厚い方が、中身の手がかり付きで挙がる", () => {
    const v: AxisInput = { ...base, id: "v", valuesProfile: "家族との時間を最優先し、地域への恩返しを大切にしている" };
    const [top] = searchByAxis("values", [v, base]);
    expect(top!.contactId).toBe("v");
    expect(top!.reasons[0]).toContain("家族との時間");
  });

  it("誠実さ: 公人評価 (意識の七次元) と記録の手がかりで上がる", () => {
    const dd: AxisInput = { ...base, id: "dd", ddScore7d: 8 };
    const noted: AxisInput = { ...base, id: "noted", notes: "約束を守る誠実な方で、周囲の評判が高い" };
    const items = searchByAxis("integrity", [dd, noted, base]);
    expect(items.map((x) => x.contactId)).toEqual(["dd", "noted"]);
    expect(items[0]!.reasons[0]).toContain("意識の七次元");
  });
});

describe("looksLikePublicFigure", () => {
  it("公人らしい肩書きだけを拾う", () => {
    expect(looksLikePublicFigure({ title: "代表取締役社長", company: "青空商事" })).toBe(true);
    expect(looksLikePublicFigure({ title: "教授", company: null })).toBe(true);
    expect(looksLikePublicFigure({ title: "主任", company: "青空商事" })).toBe(false);
    expect(looksLikePublicFigure({ title: null, company: "青空商事" })).toBe(false);
  });
});
