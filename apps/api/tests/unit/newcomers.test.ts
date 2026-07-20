// ニューカマー (パーティ・イベント) 取込の軽量パーサとイベント装飾のユニットテスト。
import { describe, it, expect } from "vitest";
import { parseNewcomerLines, normalizeEventDate, decorateWithEvent } from "../../src/lib/newcomers.js";

describe("parseNewcomerLines (1 行 1 人・名前と SNS/メール混在)", () => {
  it("名前 + SNS URL + メールの混在行を 1 人に組み立てる", () => {
    const [p] = parseNewcomerLines("田中太郎 https://x.com/tanaka_taro tanaka@example.com");
    expect(p).toBeDefined();
    expect(p!.name).toBe("田中太郎");
    expect(p!.email).toBe("tanaka@example.com");
    expect(JSON.parse(p!.sns!)).toEqual(["https://x.com/tanaka_taro"]);
    expect(p!.source).toBe("event");
  });

  it("会社・肩書き・電話も行から拾い、敬称は名前から外す", () => {
    const [p] = parseNewcomerLines("山田花子さん 株式会社青空 CEO 090-1234-5678");
    expect(p!.name).toBe("山田花子");
    expect(p!.company).toBe("株式会社青空");
    expect(p!.title).toBe("CEO");
    expect(p!.phone).toBe("090-1234-5678");
  });

  it("箇条書き記号・空行を捌き、名前の無い行 (URL だけ) は取り込まない", () => {
    const out = parseNewcomerLines("- 佐藤一郎 instagram.com/sato_ichiro\n\nhttps://x.com/nobody\n・鈴木次郎");
    expect(out.map((p) => p.name)).toEqual(["佐藤一郎", "鈴木次郎"]);
    expect(JSON.parse(out[0]!.sns!)).toEqual(["https://instagram.com/sato_ichiro"]);
  });

  it("platform 不明の @handle は名前に混ぜずメモへ逃がす", () => {
    const [p] = parseNewcomerLines("高橋三郎 @taka3");
    expect(p!.name).toBe("高橋三郎");
    expect(p!.notes).toBe("@taka3");
  });
});

describe("normalizeEventDate", () => {
  const today = new Date("2026-07-20T10:00:00");
  it("正しい過去日はそのまま、未来日・壊れた日付・未指定は今日に倒す", () => {
    expect(normalizeEventDate("2026-07-18", today)).toBe("2026-07-18");
    expect(normalizeEventDate("2027-01-01", today)).toBe("2026-07-20");
    expect(normalizeEventDate("18 July", today)).toBe("2026-07-20");
    expect(normalizeEventDate(undefined, today)).toBe("2026-07-20");
  });
});

describe("decorateWithEvent", () => {
  it("各人のメモに出会いを書き足し、出会った日の meeting 接触を作る", () => {
    const out = decorateWithEvent(
      { contacts: [{ name: "田中太郎", notes: "既存メモ" }, { name: "山田花子" }], interactions: [] },
      { name: "七夕交流会", date: "2026-07-07" },
    );
    expect(out.contacts[0]!.notes).toBe("既存メモ\n2026-07-07 七夕交流会で出会う");
    expect(out.contacts[1]!.notes).toBe("2026-07-07 七夕交流会で出会う");
    expect(out.interactions).toEqual([
      { name: "田中太郎", occurredAt: "2026-07-07", type: "meeting", note: "七夕交流会" },
      { name: "山田花子", occurredAt: "2026-07-07", type: "meeting", note: "七夕交流会" },
    ]);
  });

  it("同じ人の同日の接触が既にあれば足さない", () => {
    const out = decorateWithEvent(
      {
        contacts: [{ name: "田中太郎" }],
        interactions: [{ name: "田中太郎", occurredAt: "2026-07-07", type: "talk" }],
      },
      { name: "交流会", date: "2026-07-07" },
    );
    expect(out.interactions).toHaveLength(1);
  });
});
