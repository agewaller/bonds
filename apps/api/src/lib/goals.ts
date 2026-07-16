// 関係の目標 — 「この方とはどこまで近づきたいか (または間合いを取りたいか)」を相手ごとに持ち、
// 現状との差から接触ペースと次の一手を出す純粋関数群。用途 (お仕事・友人・恋活婚活・家族・
// 地域) ごとに進め方の段階を変える。AI は使わない (毎回無料で決定的)。
// 尊厳の制約: どの用途でも、相手の気持ちとペースを尊重する言い方に固定し、
// 操作的な駆け引きは提案しない。最終判断は常にユーザー。

export type GoalPurpose = "business" | "friend" | "romance" | "family" | "community" | "other";

export type RelationshipGoal = {
  purpose: GoalPurpose;
  targetDistance: number; // 1 (毎日会う親しさ) 〜 5 (年に一度)
  note: string; // ねらいの自由メモ (無ければ空)
  setAt: string; // ISO 日時
  startDistance: number; // 設定時の距離 (進捗の基準)
};

export const GOAL_PURPOSES: GoalPurpose[] = ["business", "friend", "romance", "family", "community", "other"];

export const PURPOSE_LABEL: Record<GoalPurpose, string> = {
  business: "お仕事",
  friend: "友人・プライベート",
  romance: "恋活・婚活",
  family: "家族",
  community: "地域・コミュニティ",
  other: "その他",
};

// 距離感ごとの目安の接触間隔 (日)。近い関係ほどこまめに。
const PACE_DAYS: Record<number, number> = { 1: 3, 2: 7, 3: 30, 4: 90, 5: 300 };
const PACE_LABEL: Record<number, string> = {
  1: "数日おき",
  2: "週に一度ほど",
  3: "月に一度ほど",
  4: "季節に一度ほど",
  5: "年に一、二度",
};

// 用途別の「近づく一歩」。いまの距離 (5→2) ごとに、次の段階へ進む具体の一手。
// どれも押しつけない言い方で固定する (相手の気持ちとペースを尊重)。
const CLOSING_STEPS: Record<GoalPurpose, Record<number, string>> = {
  business: {
    5: "時候のご挨拶やお祝いを口実に、近況伺いの一報を送ってみては",
    4: "相手のお仕事の関心に合いそうな情報や記事をひとつ添えて、短いご連絡を",
    3: "小さな貢献 (人の紹介・困りごとの手伝い) と、お茶や短い面談のご提案を",
    2: "定例の場 (月一の情報交換など) をつくり、協業や相談の間柄へ",
  },
  friend: {
    5: "久しぶりの近況交換のひとことから",
    4: "共通の話題や趣味の話で、気軽なやりとりを増やしてみては",
    3: "食事や趣味の集まりに、負担の軽いかたちで誘ってみては",
    2: "月に一度など、定期的に会う約束をつくると自然に近づきます",
  },
  romance: {
    5: "軽い挨拶と、共通の話題での気軽な雑談から",
    4: "相手の好きなことや関心をゆっくり聞き、共通の体験の話題を増やしてみては",
    3: "お茶や散歩など、負担の小さい「二人で会う」お誘いを。お返事のペースは相手に合わせて",
    2: "気持ちは無理のないペースで。相手の意思を尊重しながら、少しずつ深めていくのがいちばんの近道です",
  },
  family: {
    5: "定期の声かけ (電話やメッセージ) から",
    4: "近況や思い出の共有を。写真を一枚送るだけでも会話が生まれます",
    3: "行事や記念日を一緒に過ごすご提案を",
    2: "日々の小さな困りごとの手伝いと、こまめな行き来を",
  },
  community: {
    5: "集まりへの顔出しとご挨拶から",
    4: "活動への小さな参加やお手伝いを",
    3: "役割をひとつ持って、一緒に動いてみては",
    2: "運営や企画を共にすると、自然と近い間柄になります",
  },
  other: {
    5: "近況伺いのひとことから",
    4: "相手の関心に合う話題を添えて、やりとりを増やしてみては",
    3: "短くお会いする機会をつくってみては",
    2: "定期的に連絡を取り合う間柄へ",
  },
};

export type GoalPlan = {
  direction: "closer" | "keep" | "further";
  gap: number; // 正 = まだ縮める余地 (further のときは広げる余地)
  paceDays: number;
  paceLabel: string;
  nextMove: string;
  overdue: boolean; // 目安の間隔より間が空いている
  achieved: boolean;
  progress: number; // 設定時からどれだけ目標へ動いたか (正 = 前進)
};

const clampDistance = (n: number): number => Math.min(Math.max(Math.round(n), 1), 5);

export function parseGoalField(raw: string | null | undefined): RelationshipGoal | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    const purpose = GOAL_PURPOSES.includes(p.purpose as GoalPurpose) ? (p.purpose as GoalPurpose) : "other";
    const target = typeof p.targetDistance === "number" ? clampDistance(p.targetDistance) : null;
    if (target === null) return null;
    return {
      purpose,
      targetDistance: target,
      note: typeof p.note === "string" ? p.note.slice(0, 500) : "",
      setAt: typeof p.setAt === "string" ? p.setAt : "",
      startDistance: typeof p.startDistance === "number" ? clampDistance(p.startDistance) : target,
    };
  } catch {
    return null;
  }
}

export function serializeGoal(goal: RelationshipGoal): string {
  return JSON.stringify(goal);
}

// 目標と現状から、接触ペースと次の一手を出す。
export function goalPlan(
  goal: RelationshipGoal,
  current: { distance: number; lastContactDays: number | null },
): GoalPlan {
  const cur = clampDistance(current.distance);
  const target = clampDistance(goal.targetDistance);
  const direction: GoalPlan["direction"] = cur > target ? "closer" : cur < target ? "further" : "keep";
  const gap = Math.abs(cur - target);
  // 近づくときは「いま向かっている次の段階」の間隔で。保つ/広げるときは目標の間隔で。
  const paceBasis = direction === "closer" ? Math.max(target, cur - 1) : target;
  const paceDays = PACE_DAYS[paceBasis] ?? 30;
  const overdue = current.lastContactDays !== null && current.lastContactDays > paceDays;
  let nextMove: string;
  if (direction === "closer") {
    nextMove = CLOSING_STEPS[goal.purpose][cur] ?? CLOSING_STEPS[goal.purpose][4]!;
    if (overdue) {
      nextMove = `間が空いてきています。まずは軽い一報から。そのうえで、${nextMove}`;
    }
  } else if (direction === "keep") {
    nextMove = `いまの間合いがちょうど目標どおりです。${PACE_LABEL[paceDays <= 3 ? 1 : paceBasis] ?? PACE_LABEL[target]}の連絡を保てば十分です`;
    if (overdue) nextMove = `目標の間合いより間が空いてきています。短い近況のひとことで、いまの関係を保ちましょう`;
  } else {
    nextMove =
      "少し間合いを取りたい目標です。角を立てず、返信のペースをゆるやかにし、お誘いは無理のない範囲で。それでも節目 (お祝いや年始) のご挨拶は保つと、関係は壊れません";
  }
  // 進捗: 設定時の距離から目標へ、どれだけ動いたか
  const start = clampDistance(goal.startDistance);
  const progress = target < start ? start - cur : target > start ? cur - start : 0;
  return {
    direction,
    gap,
    paceDays,
    paceLabel: PACE_LABEL[paceBasis] ?? "月に一度ほど",
    nextMove,
    overdue,
    achieved: direction === "keep",
    progress,
  };
}

// 目標設定の入力検証 (API 用)。
export function validateGoalInput(body: {
  purpose?: unknown;
  targetDistance?: unknown;
  note?: unknown;
}): { purpose: GoalPurpose; targetDistance: number; note: string } | null {
  const purpose = GOAL_PURPOSES.includes(body.purpose as GoalPurpose) ? (body.purpose as GoalPurpose) : null;
  const target =
    typeof body.targetDistance === "number" && body.targetDistance >= 1 && body.targetDistance <= 5
      ? Math.round(body.targetDistance)
      : null;
  if (!purpose || target === null) return null;
  return {
    purpose,
    targetDistance: target,
    note: typeof body.note === "string" ? body.note.trim().slice(0, 500) : "",
  };
}
