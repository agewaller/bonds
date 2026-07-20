// 実行待ち (受け入れた提案の在庫) の並べ方。ホームで受け入れた提案 (サービスの提供・
// 時間調整・メール連絡・贈り物など) を、実際に動きやすい順で種類別に並べる純粋関数。
export const ACTION_KINDS = ["email", "meet", "gift", "offer", "other"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const ACTION_KIND_LABEL: Record<ActionKind, string> = {
  email: "連絡する",
  meet: "会う約束・時間調整",
  gift: "贈り物",
  offer: "力になれることの申し出",
  other: "そのほかにやること",
};

export function normalizeActionKind(v: unknown): ActionKind {
  return typeof v === "string" && (ACTION_KINDS as readonly string[]).includes(v) ? (v as ActionKind) : "other";
}

export type SortableAction = { kind: string; createdAt: Date };

// 連絡 → 会う → 贈り物 → 申し出 → そのほか の順に、それぞれ古いもの (待たせているもの) から。
export function sortActionItems<T extends SortableAction>(items: T[]): T[] {
  const order = new Map((ACTION_KINDS as readonly string[]).map((k, i) => [k, i]));
  return [...items].sort((a, b) => {
    const ka = order.get(a.kind) ?? ACTION_KINDS.length;
    const kb = order.get(b.kind) ?? ACTION_KINDS.length;
    if (ka !== kb) return ka - kb;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}
