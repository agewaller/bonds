// 贈り物 (Gift) の中核ロジック — 純粋関数のみ (DB/ネット非依存 = ユニットテスト対象)。
// 「いま贈るとよい方・行事」を、①誕生日・記念日 ②季節の贈答 (お中元/お歳暮/年賀/母の日等)
// ③いただいたのにまだお返ししていない相手 (未返礼) から算出する。旧 Gift の
// 「行事リマインド」「贈答の収支・お返し管理」に相当する部分をここで担う。

export type GiftContact = {
  id: string;
  name: string;
  birthday?: Date | null;
  anniversary?: Date | null;
  distance: number;
};

export type GiftRecord = {
  contactId: string;
  direction: string; // outbound / inbound
  occasion: string;
  givenAt: Date;
};

export type GiftOccasion = {
  kind: "birthday" | "anniversary" | "seasonal" | "return";
  contactId: string | null;
  contactName: string | null;
  label: string; // 画面に出す行事名
  date: string; // YYYY-MM-DD (その行事の当日)
  daysUntil: number; // 今日からの日数 (0=今日, マイナスは未返礼の経過日など)
  note: string; // ひとことの理由・すすめ
};

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function atUtc(year: number, month1: number, day: number): Date {
  return new Date(Date.UTC(year, month1 - 1, day, 12, 0, 0));
}

function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

// 今日を起点に、月日 (year 非依存) の次回到来日を返す (今日を含む)。
function nextAnnual(today: Date, month1: number, day: number): Date {
  const thisYear = atUtc(today.getUTCFullYear(), month1, day);
  return daysBetween(today, thisYear) >= 0 ? thisYear : atUtc(today.getUTCFullYear() + 1, month1, day);
}

// 指定月の n 番目の weekday (0=日) の日付。母の日・父の日・敬老の日に使う。
function nthWeekdayOfMonth(year: number, month1: number, weekday: number, n: number): Date {
  const first = new Date(Date.UTC(year, month1 - 1, 1, 12));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return atUtc(year, month1, 1 + offset + (n - 1) * 7);
}

// 季節の贈答の定義。fixed = 月日固定、nth = 第n weekday。
type Seasonal = { label: string; note: string; date: (year: number) => Date };
const SEASONALS: Seasonal[] = [
  { label: "年賀 (新年のご挨拶)", note: "年の初めのご挨拶に。年賀状や新年の贈り物を準備する頃です", date: (y) => atUtc(y, 1, 1) },
  { label: "バレンタイン", note: "日ごろの感謝を伝える贈り物に", date: (y) => atUtc(y, 2, 14) },
  { label: "ホワイトデー", note: "いただいた気持ちへのお返しに", date: (y) => atUtc(y, 3, 14) },
  { label: "母の日", note: "お母さまへ、日ごろの感謝を", date: (y) => nthWeekdayOfMonth(y, 5, 0, 2) },
  { label: "父の日", note: "お父さまへ、日ごろの感謝を", date: (y) => nthWeekdayOfMonth(y, 6, 0, 3) },
  { label: "お中元", note: "お世話になっている方へ、夏のご挨拶を", date: (y) => atUtc(y, 7, 5) },
  { label: "敬老の日", note: "年長の大切な方へ", date: (y) => nthWeekdayOfMonth(y, 9, 0, 3) },
  { label: "お歳暮", note: "一年の感謝を込めて、冬のご挨拶を", date: (y) => atUtc(y, 12, 5) },
  { label: "クリスマス", note: "親しい方へ、心のこもった贈り物を", date: (y) => atUtc(y, 12, 25) },
];

const RETURN_GRACE_DAYS = 30; // いただいてからこの日数を過ぎても未返礼なら督促する
const RETURN_WINDOW_DAYS = 400; // これより古い受領は督促しない (取りこぼしを溜め込まない)

// 「いま贈るとよい方・行事」を算出する。lookaheadDays 以内の行事と、未返礼を返す。
export function computeGiftOccasions(
  input: { contacts: GiftContact[]; gifts: GiftRecord[]; today: Date },
  lookaheadDays = 45,
): GiftOccasion[] {
  const { contacts, gifts, today } = input;
  const out: GiftOccasion[] = [];

  // ① 誕生日・記念日 (相手ごと、lookahead 以内)
  for (const c of contacts) {
    for (const [kind, d, label] of [
      ["birthday", c.birthday, "お誕生日"],
      ["anniversary", c.anniversary, "記念日"],
    ] as const) {
      if (!d) continue;
      const next = nextAnnual(today, d.getUTCMonth() + 1, d.getUTCDate());
      const daysUntil = daysBetween(today, next);
      if (daysUntil <= lookaheadDays) {
        out.push({
          kind,
          contactId: c.id,
          contactName: c.name,
          label: `${c.name} さんの${label}`,
          date: iso(next),
          daysUntil,
          note: daysUntil === 0 ? "今日です。ひとこと添えて贈り物はいかがでしょう" : `あと${daysUntil}日です`,
        });
      }
    }
  }

  // ② 季節の贈答 (今日〜lookahead に当日が入るもの)。贈答には「時期」の幅があるので、
  // 当日を少し過ぎても (SEASONAL_GRACE 日まで) まだ今の行事として扱う (お中元は中旬まで等)。
  const SEASONAL_GRACE = 14;
  for (const s of SEASONALS) {
    const thisYear = s.date(today.getUTCFullYear());
    let target = thisYear;
    let daysUntil = daysBetween(today, thisYear);
    if (daysUntil < -SEASONAL_GRACE) {
      target = s.date(today.getUTCFullYear() + 1);
      daysUntil = daysBetween(today, target);
    }
    if (daysUntil <= lookaheadDays && daysUntil >= -SEASONAL_GRACE) {
      out.push({
        kind: "seasonal",
        contactId: null,
        contactName: null,
        label: s.label,
        date: iso(target),
        daysUntil,
        note: daysUntil < 0 ? `${s.note} (時期に入っています)` : s.note,
      });
    }
  }

  // ③ 未返礼 (いただいたのに、その後お返しをしていない相手)
  const byContact = new Map<string, GiftRecord[]>();
  for (const g of gifts) {
    if (!byContact.has(g.contactId)) byContact.set(g.contactId, []);
    byContact.get(g.contactId)!.push(g);
  }
  for (const c of contacts) {
    const recs = (byContact.get(c.id) ?? []).slice().sort((a, b) => a.givenAt.getTime() - b.givenAt.getTime());
    const lastInbound = [...recs].reverse().find((r) => r.direction === "inbound");
    if (!lastInbound) continue;
    const returnedAfter = recs.some((r) => r.direction === "outbound" && r.givenAt.getTime() >= lastInbound.givenAt.getTime());
    if (returnedAfter) continue;
    const ageDays = daysBetween(lastInbound.givenAt, today);
    if (ageDays >= RETURN_GRACE_DAYS && ageDays <= RETURN_WINDOW_DAYS) {
      out.push({
        kind: "return",
        contactId: c.id,
        contactName: c.name,
        label: `${c.name} さんへのお返し`,
        date: iso(today),
        daysUntil: -ageDays,
        note: `${ageDays}日前にいただいたままです。お返しの品と、ひとことのお礼はいかがでしょう`,
      });
    }
  }

  // 未返礼を先頭に、あとは近い行事順
  return out.sort((a, b) => {
    if (a.kind === "return" && b.kind !== "return") return -1;
    if (b.kind === "return" && a.kind !== "return") return 1;
    return a.daysUntil - b.daysUntil;
  });
}

// 相手ごとの贈答の収支サマリ (贈った/いただいた件数・金額、未返礼か)。
export type GiftLedger = {
  outboundCount: number;
  inboundCount: number;
  outboundTotal: number;
  inboundTotal: number;
  needsReturn: boolean;
};
export function summarizeGiftLedger(gifts: GiftRecord[] & Array<{ amount?: number | null }>): GiftLedger {
  let outboundCount = 0, inboundCount = 0, outboundTotal = 0, inboundTotal = 0;
  let lastInbound: (GiftRecord & { amount?: number | null }) | null = null;
  let lastOutbound: (GiftRecord & { amount?: number | null }) | null = null;
  for (const g of gifts) {
    if (g.direction === "inbound") {
      inboundCount++;
      inboundTotal += g.amount ?? 0;
      if (!lastInbound || g.givenAt.getTime() > lastInbound.givenAt.getTime()) lastInbound = g;
    } else {
      outboundCount++;
      outboundTotal += g.amount ?? 0;
      if (!lastOutbound || g.givenAt.getTime() > lastOutbound.givenAt.getTime()) lastOutbound = g;
    }
  }
  const needsReturn =
    !!lastInbound && (!lastOutbound || lastOutbound.givenAt.getTime() < lastInbound.givenAt.getTime());
  return { outboundCount, inboundCount, outboundTotal, inboundTotal, needsReturn };
}
