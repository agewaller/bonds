// 優先度に基づく自動ケアの計画 — 純粋関数 (AI 不要・毎回無料・決定的)。
// 優先リスト上位の方について「次の一手」を提案として組み立てる。実行するかは常に
// ユーザーが選ぶ (最終判断はユーザー)。文言は BR-09 (記号なし・平易) で書く。
//
// 提案の種類:
//   import_talk  — LINE/WhatsApp のトーク履歴を入れると近況とやりとりがまとまる (収集の促し)
//   set_goal     — 関係の目標 (用途と目標の距離感) を決めると打ち手が目標に沿う
//   reach_out    — 間が空いている方への一報 (お便りの下書きへ誘導)
//   meet         — 会う約束へ進める (日程調整の共有リンクへ誘導)
//   capture_note — 情報が薄い方の近況メモをひとこと残す (記憶の還流)

export type CarePlanInput = {
  contactId: string;
  name: string;
  distance: number;
  hasGoal: boolean;
  interactionCount: number;
  lastContactDays: number | null; // null = やりとりの記録なし
  hasEmailOrPhone: boolean;
  hasDigest: boolean;
  hasFacets: boolean;
};

export type CareAction = {
  contactId: string;
  kind: "import_talk" | "set_goal" | "reach_out" | "meet" | "capture_note";
  body: string; // ユーザー向けのひとこと (平易・記号なし)
};

/**
 * ひとりについて、いま出す価値のある提案を最大 2 件 (多すぎる提案は全部無視される)。
 * 優先順: 関係を動かす一手 (reach_out / meet) > 材料を厚くする一手 (import_talk / capture_note / set_goal)。
 */
export function planCareActions(p: CarePlanInput): CareAction[] {
  const out: CareAction[] = [];
  const quiet = p.lastContactDays === null || p.lastContactDays > 60;

  // 関係を動かす一手
  if (quiet && p.hasEmailOrPhone) {
    out.push({
      contactId: p.contactId,
      kind: "reach_out",
      body:
        p.lastContactDays === null
          ? `${p.name}さんとは、まだやりとりの記録がありません。近況伺いのひとことから始めてみませんか。`
          : `${p.name}さんと、しばらく間が空いています。近況伺いのお便りを考えてみませんか。`,
    });
  } else if (!quiet && p.hasGoal && p.distance >= 3) {
    out.push({
      contactId: p.contactId,
      kind: "meet",
      body: `${p.name}さんとはやりとりが続いています。日程を選んでいただくページを送って、お会いする約束まで進めてみませんか。`,
    });
  }

  // 材料を厚くする一手 (どれかひとつ)
  if (p.interactionCount < 3) {
    out.push({
      contactId: p.contactId,
      kind: "import_talk",
      body: `${p.name}さんとの LINE などのトーク履歴を取り込むと、これまでのやりとりと近況がまとまり、打ち手が的確になります。`,
    });
  } else if (!p.hasGoal) {
    out.push({
      contactId: p.contactId,
      kind: "set_goal",
      body: `${p.name}さんとの関係の目標 (仕事・友人・家族などの用途と、目指す距離感) を決めると、提案が目標に沿って出るようになります。`,
    });
  } else if (!p.hasDigest && !p.hasFacets) {
    out.push({
      contactId: p.contactId,
      kind: "capture_note",
      body: `${p.name}さんについて、覚えていることをひとことメモに残しませんか。近況や仕事の話がひとつあるだけで、次の一手が変わります。`,
    });
  }

  return out.slice(0, 2);
}

/** 同じ提案を出し直してよいか。見送り/済みから一定期間はそっとしておく (しつこくしない)。 */
export const CARE_SUGGESTION_COOLDOWN_DAYS = 30;

export function shouldSuggestAgain(
  previous: { status: string; updatedAt: Date } | null,
  now = new Date(),
): boolean {
  if (!previous) return true;
  if (previous.status === "proposed") return false; // まだ出ている
  const days = (now.getTime() - previous.updatedAt.getTime()) / 86_400_000;
  return days >= CARE_SUGGESTION_COOLDOWN_DAYS;
}
