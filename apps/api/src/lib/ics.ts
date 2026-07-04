// ICS (iCalendar) から busy 区間を取り出すパーサ (純粋関数 / ユニットテスト対象)。
// Google カレンダー・Outlook の「秘密のアドレス (ICS)」を貼るだけでライブ同期になる
// (URL の中身は先方サービスが常に最新化するため、refresh のたびに最新の busy が入る)。
// 対応: DTSTART/DTEND の UTC (Z 付き)・ローカル naive・終日 (VALUE=DATE)。
// TZID は naive として扱う (分単位の厳密さより「その日の busy」が分かれば面談候補には足りる)。
import type { IsoInterval } from "./timeslots.js";

function unfold(ics: string): string[] {
  // 折返し行 (次行頭が空白/タブ) を連結してから行に分解する (RFC 5545)
  return ics.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

// ICS 日時 → Date。解釈できなければ null。
export function parseIcsDate(v: string): Date | null {
  const s = v.trim();
  // 終日: YYYYMMDD
  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // 日時: YYYYMMDDTHHMMSS(Z?)
  m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const [y, mo, d, h, mi, se] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number);
  return m[7] === "Z"
    ? new Date(Date.UTC(y!, mo! - 1, d!, h!, mi!, se!))
    : new Date(y!, mo! - 1, d!, h!, mi!, se!);
}

/** VEVENT の DTSTART/DTEND を busy 区間として取り出す。不正なイベントは黙って捨てる。 */
export function parseIcsBusy(ics: string): IsoInterval[] {
  const out: IsoInterval[] = [];
  let inEvent = false;
  let start: Date | null = null;
  let end: Date | null = null;
  for (const line of unfold(ics)) {
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      inEvent = true;
      start = end = null;
    } else if (upper === "END:VEVENT") {
      if (inEvent && start && end && end > start) {
        out.push({ start: start.toISOString(), end: end.toISOString() });
      }
      inEvent = false;
    } else if (inEvent) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const prop = line.slice(0, idx).toUpperCase(); // 例: DTSTART;TZID=Asia/Tokyo
      const value = line.slice(idx + 1);
      if (prop.startsWith("DTSTART")) start = parseIcsDate(value);
      else if (prop.startsWith("DTEND")) end = parseIcsDate(value);
    }
  }
  return out;
}

export function looksLikeIcs(content: string): boolean {
  return /BEGIN:VCALENDAR/i.test(content);
}
