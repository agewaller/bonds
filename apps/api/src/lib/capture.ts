// 相手の情報を「やりとりの副産物」として集めるための純粋関数群。
// 深い情報 (近況・悩み・目標) は web には無く、ユーザーの頭の中と日々のやりとりにしか
// 流れていない。摩擦を極限まで下げてそれを拾う: ①会った直後のひとこと伺い
// ②1日1問 (足りない論点をひとつだけ聞く)。どちらも AI を使わない (毎回無料)。

export type MetPerson = {
  id: string;
  name: string;
};

export type MetInteraction = {
  contactId: string;
  type: string;
  occurredAt: Date;
  hasNote: boolean; // notes が入っているか (本文は渡さない)
};

export type RecentMeeting = {
  contactId: string;
  name: string;
  metAt: string; // YYYY-MM-DD
};

const DAY_MS = 24 * 60 * 60 * 1000;

// 直近 (既定3日) に会った方のうち、まだその後のひとことメモが無い方を挙げる。
// 会った直後は記憶が新しく、ここで拾えなかった近況は二度と記録されない。
export function recentMeetings(
  people: MetPerson[],
  interactions: MetInteraction[],
  now: Date = new Date(),
  days = 3,
  maxItems = 6,
): RecentMeeting[] {
  const since = new Date(now.getTime() - days * DAY_MS);
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  // 相手ごとの最新の「会った」時刻
  const lastMet = new Map<string, Date>();
  for (const it of interactions) {
    if (it.type !== "meeting") continue;
    if (it.occurredAt < since || it.occurredAt > now) continue;
    if (!nameById.has(it.contactId)) continue;
    const cur = lastMet.get(it.contactId);
    if (!cur || it.occurredAt > cur) lastMet.set(it.contactId, it.occurredAt);
  }
  // 会ったあとにメモ付きの記録があれば「もう聞けている」ので出さない
  const out: RecentMeeting[] = [];
  for (const [contactId, metAt] of lastMet) {
    const debriefed = interactions.some(
      (it) => it.contactId === contactId && it.hasNote && it.occurredAt >= metAt,
    );
    if (debriefed) continue;
    out.push({ contactId, name: nameById.get(contactId)!, metAt: metAt.toISOString().slice(0, 10) });
  }
  return out.sort((a, b) => (a.metAt < b.metAt ? 1 : -1)).slice(0, maxItems);
}

// ------------------------------------------------------------
// 1日1問 — 毎日ひとりについて、まだ知らない論点をひとつだけ聞く。
// 1年続けば 365 個の事実が溜まる。質問は定型 (AI 不要・毎回無料) で、
// 日付でひと (と話題) が変わる。答えは接触メモとして還流する。
// ------------------------------------------------------------

export type DailyPerson = {
  id: string;
  name: string;
  distance: number; // 1 (親しい) 〜 5
  interactionCount: number;
  answeredToday: boolean; // 今日すでにメモを書いた相手は出さない
  facets: {
    status?: string;
    work?: string;
    family?: string;
    health?: string;
    goals?: string[];
    likes?: string[];
    concerns?: string[];
  } | null;
};

export type DailyQuestion = {
  contactId: string;
  name: string;
  topic: string;
  question: string;
};

const TOPIC_QUESTIONS: Array<{ topic: string; question: (name: string) => string }> = [
  { topic: "status", question: (n) => `最近の${n}さんは、どんなご様子ですか。聞いている近況があれば、ひとことだけ教えてください` },
  { topic: "work", question: (n) => `${n}さんのいまのお仕事や役割について、ご存じのことをひとことだけ教えてください` },
  { topic: "family", question: (n) => `${n}さんのご家族について、聞いていることがあれば、ひとことだけ教えてください` },
  { topic: "goals", question: (n) => `${n}さんが目指していることや、やりたがっていることに、心当たりはありますか` },
  { topic: "concerns", question: (n) => `${n}さんがいま気にかけていることや困りごとに、心当たりはありますか` },
  { topic: "likes", question: (n) => `${n}さんの好きなことや趣味で、思い浮かぶものをひとつだけ教えてください` },
  { topic: "health", question: (n) => `${n}さんの体調について、気にかけていることがあれば、ひとことだけ教えてください` },
];

// 決定的な軽いハッシュ (日替わりの seed 用)
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function missingTopics(p: DailyPerson): string[] {
  const f = p.facets;
  const empty = (v: unknown) =>
    v == null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && v.length === 0);
  return TOPIC_QUESTIONS.map((t) => t.topic).filter((topic) => empty(f?.[topic as keyof NonNullable<typeof f>]));
}

// dateKey (YYYY-MM-DD) で決定的に「今日のひとり・今日の話題」を選ぶ。
// よく知っているはずの近しい方を優先する (答えられない質問は出さない工夫)。
export function pickDailyQuestion(people: DailyPerson[], dateKey: string): DailyQuestion | null {
  const eligible = people
    .filter((p) => !p.answeredToday && p.name.trim() && missingTopics(p).length > 0)
    .map((p) => ({ p, score: (5 - Math.min(Math.max(p.distance, 1), 5)) * 10 + Math.min(p.interactionCount, 10) }))
    .sort((a, b) => b.score - a.score || (a.p.id < b.p.id ? -1 : 1))
    .slice(0, 12);
  if (eligible.length === 0) return null;
  const person = eligible[hashStr(dateKey) % eligible.length]!.p;
  const topics = missingTopics(person);
  const topic = topics[hashStr(dateKey + person.id) % topics.length]!;
  const def = TOPIC_QUESTIONS.find((t) => t.topic === topic)!;
  return { contactId: person.id, name: person.name, topic, question: def.question(person.name) };
}
