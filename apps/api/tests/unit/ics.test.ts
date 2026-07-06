import { describe, it, expect } from "vitest";
import { parseIcsBusy, parseIcsDate, looksLikeIcs } from "../../src/lib/ics.js";

const SAMPLE = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar//EN
BEGIN:VEVENT
DTSTART:20260706T010000Z
DTEND:20260706T020000Z
SUMMARY:定例
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=Asia/Tokyo:20260707T140000
DTEND;TZID=Asia/Tokyo:20260707T150000
SUMMARY:打合せ
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260708
DTEND;VALUE=DATE:20260709
SUMMARY:終日予定
END:VEVENT
BEGIN:VEVENT
DTSTART:20260709T100000Z
SUMMARY:DTEND 無し (捨てる)
END:VEVENT
END:VCALENDAR`;

describe("parseIcsDate", () => {
  it("UTC / naive / 終日を解釈し、不正は null", () => {
    expect(parseIcsDate("20260706T010000Z")?.toISOString()).toBe("2026-07-06T01:00:00.000Z");
    expect(parseIcsDate("20260708")).toEqual(new Date(2026, 6, 8));
    expect(parseIcsDate("not-a-date")).toBeNull();
  });
});

describe("parseIcsBusy", () => {
  it("VEVENT 3 件を busy として取り出し、DTEND 無しは捨てる", () => {
    const busy = parseIcsBusy(SAMPLE);
    expect(busy).toHaveLength(3);
    expect(busy[0]).toEqual({ start: "2026-07-06T01:00:00.000Z", end: "2026-07-06T02:00:00.000Z" });
    // TZID 付きは naive 扱い (ローカル時刻)
    expect(new Date(busy[1]!.start).getHours()).toBe(14);
    // 終日は日付境界
    expect(new Date(busy[2]!.end).getTime() - new Date(busy[2]!.start).getTime()).toBe(24 * 3600 * 1000);
  });

  it("折返し行 (RFC 5545) を連結して解釈する", () => {
    const folded = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20260706T0\n 10000Z\nDTEND:20260706T020000Z\nEND:VEVENT\nEND:VCALENDAR";
    expect(parseIcsBusy(folded)).toHaveLength(1);
  });

  it("VCALENDAR で無い/空の入力は空配列", () => {
    expect(parseIcsBusy("")).toEqual([]);
    expect(looksLikeIcs(SAMPLE)).toBe(true);
    expect(looksLikeIcs("氏名,電話")).toBe(false);
  });
});

describe("buildMeetingInviteIcs (面談招待)", () => {
  it("開始/終了/題名の入った有効な VCALENDAR を生成し、round-trip で読める", async () => {
    const { buildMeetingInviteIcs } = await import("../../src/lib/ics.js");
    const ics = buildMeetingInviteIcs({
      title: "山田様と面談; 打合せ",
      start: new Date("2026-08-01T05:00:00Z"),
      end: new Date("2026-08-01T06:00:00Z"),
      description: "bonds の面談候補から",
    });
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("DTSTART:20260801T050000Z");
    expect(ics).toContain("SUMMARY:山田様と面談\\; 打合せ"); // セミコロンは RFC5545 エスケープ
    // 自前パーサで読み戻せる
    const busy = parseIcsBusy(ics);
    expect(busy).toHaveLength(1);
  });
});
