import { describe, it, expect } from "vitest";
import { detectDrift } from "../../src/lib/drift.js";
import type { ContactLike, InteractionLike } from "../../src/lib/relationship.js";

const NOW = new Date("2026-07-10T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const contact = (id: string, distance: number): ContactLike => ({ id, name: `p-${id}`, distance, birthday: null });
const touch = (contactId: string, days: number): InteractionLike => ({ contactId, occurredAt: daysAgo(days), type: "message" });

describe("detectDrift", () => {
  it("近しい相手 (距離2) の連絡が適正間隔を大きく過ぎて途絶えていれば faded", () => {
    // 距離2の適正は7日。7*4=28日を超える 60日途絶え
    const items = detectDrift([contact("a", 2)], [touch("a", 60)], NOW);
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("faded");
    expect(items[0]!.daysSince).toBe(60);
  });

  it("規則正しくやりとりしていた相手が急に途絶えたら sudden_gap", () => {
    // 7日おきに5回 → 最後から70日 (いつもの10倍) 途絶え
    const its = [touch("b", 70 + 0), touch("b", 70 + 7), touch("b", 70 + 14), touch("b", 70 + 21), touch("b", 70 + 28)];
    // 上は最後の接触が70日前。最近は無い → daysSince=70, median gap=7
    const items = detectDrift([contact("b", 3)], its, NOW);
    expect(items[0]!.kind).toBe("sudden_gap");
    expect(items[0]!.reason).toContain("間があいています");
  });

  it("適正間隔の内側なら気にかけ対象にしない", () => {
    // 距離3の適正は14日。14*4=56日以内の 20日前なら出さない
    expect(detectDrift([contact("c", 3)], [touch("c", 20)], NOW)).toEqual([]);
  });

  it("一度も記録が無い人はここでは扱わない (別途 今日連絡 で拾う)", () => {
    expect(detectDrift([contact("d", 1)], [], NOW)).toEqual([]);
  });

  it("遠い相手 (距離5) は faded の対象外", () => {
    expect(detectDrift([contact("e", 5)], [touch("e", 400)], NOW)).toEqual([]);
  });

  it("気にかけたい度の高い順に並ぶ", () => {
    const items = detectDrift(
      [contact("near", 1), contact("mid", 3)],
      [touch("near", 30), touch("mid", 80)],
      NOW,
    );
    // 距離1(近い)の途絶えは severity が高く先頭
    expect(items[0]!.contactId).toBe("near");
  });
});
