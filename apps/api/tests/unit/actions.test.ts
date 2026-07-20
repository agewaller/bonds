// 実行待ち (受け入れた提案の在庫) の並べ方のユニットテスト。
import { describe, it, expect } from "vitest";
import { sortActionItems, normalizeActionKind, ACTION_KIND_LABEL } from "../../src/lib/actions.js";

describe("sortActionItems", () => {
  it("連絡 → 会う → 贈り物 → 申し出 → そのほか の順、同種は古い順", () => {
    const d = (n: number) => new Date(2026, 6, n);
    const items = [
      { kind: "other", createdAt: d(1) },
      { kind: "gift", createdAt: d(2) },
      { kind: "email", createdAt: d(3) },
      { kind: "email", createdAt: d(1) },
      { kind: "meet", createdAt: d(1) },
      { kind: "offer", createdAt: d(1) },
    ];
    const sorted = sortActionItems(items);
    expect(sorted.map((x) => x.kind)).toEqual(["email", "email", "meet", "gift", "offer", "other"]);
    expect(sorted[0]!.createdAt.getDate()).toBe(1); // 古い方 (待たせている方) が先
  });
});

describe("normalizeActionKind", () => {
  it("未知の種類は other に倒し、既知はそのまま。全種類に日本語ラベルがある", () => {
    expect(normalizeActionKind("gift")).toBe("gift");
    expect(normalizeActionKind("hack")).toBe("other");
    expect(normalizeActionKind(undefined)).toBe("other");
    for (const k of ["email", "meet", "gift", "offer", "other"] as const) {
      expect(ACTION_KIND_LABEL[k].length).toBeGreaterThan(0);
    }
  });
});
