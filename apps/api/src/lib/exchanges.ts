// やり取り台帳 (Gift を一般化) の中核ロジック — 純粋関数のみ (DB/ネット非依存 = ユニット対象)。
// 贈与だけでなく、貢献 (favor)・貸し借り (loan)・取引 (deal)・約束 (promise) を扱う。
// lib/gifts.ts の「収支・お返し」「行事リマインド」の考え方を、状態 (open/done) と期日つきに広げた。
import { createHash } from "node:crypto";

export type ExchangeRecord = {
  contactId: string;
  contactName?: string;
  kind: string; // gift / favor / loan / deal / promise / other
  direction: string; // outbound / inbound
  value?: number | null;
  status: string; // open / done / returned / canceled
  dueAt?: Date | null;
  occurredAt: Date;
};

// 相手ごとの収支 (渡した/受け取った件数・価値と、未完了・要返礼の有無)。
export type ExchangeLedger = {
  contactId: string;
  contactName?: string;
  outboundCount: number;
  inboundCount: number;
  outboundValue: number;
  inboundValue: number;
  balance: number; // outbound - inbound (プラス = こちらが多く渡している)
  openCount: number; // 未完了 (約束/貸し・進行中) の件数
  needsReturn: boolean; // 相手から受けた最後の一件に、その後こちらの返しがない
};

export function summarizeExchangeLedger(contactId: string, records: ExchangeRecord[]): ExchangeLedger {
  let outboundCount = 0;
  let inboundCount = 0;
  let outboundValue = 0;
  let inboundValue = 0;
  let openCount = 0;
  let lastInbound: ExchangeRecord | null = null;
  let lastOutbound: ExchangeRecord | null = null;
  let contactName: string | undefined;
  for (const r of records) {
    contactName = contactName ?? r.contactName;
    if (r.status === "canceled") continue;
    if (r.status === "open") openCount++;
    if (r.direction === "inbound") {
      inboundCount++;
      inboundValue += r.value ?? 0;
      if (!lastInbound || r.occurredAt.getTime() > lastInbound.occurredAt.getTime()) lastInbound = r;
    } else {
      outboundCount++;
      outboundValue += r.value ?? 0;
      if (!lastOutbound || r.occurredAt.getTime() > lastOutbound.occurredAt.getTime()) lastOutbound = r;
    }
  }
  const needsReturn =
    !!lastInbound && (!lastOutbound || lastOutbound.occurredAt.getTime() < lastInbound.occurredAt.getTime());
  return {
    contactId,
    contactName,
    outboundCount,
    inboundCount,
    outboundValue,
    inboundValue,
    balance: outboundValue - inboundValue,
    openCount,
    needsReturn,
  };
}

export type ExchangeReminder = {
  id: string;
  contactId: string;
  contactName?: string;
  kind: string;
  title: string;
  dueAt: string | null; // YYYY-MM-DD
  daysUntil: number | null; // マイナス = 期限超過
  overdue: boolean;
  note: string;
};

const KIND_LABEL: Record<string, string> = {
  gift: "贈り物",
  favor: "貢献",
  loan: "貸し借り",
  deal: "取引",
  promise: "約束",
  other: "やり取り",
};

function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

// 未完了 (open) のうち、期日が近い・過ぎたものを督促として返す。期日なしは対象外。
export function computeExchangeReminders(
  records: Array<ExchangeRecord & { id: string; title: string }>,
  today: Date,
  lookaheadDays = 14,
): ExchangeReminder[] {
  const out: ExchangeReminder[] = [];
  for (const r of records) {
    if (r.status !== "open" || !r.dueAt) continue;
    const daysUntil = daysBetween(today, r.dueAt);
    if (daysUntil > lookaheadDays) continue;
    const overdue = daysUntil < 0;
    const kindLabel = KIND_LABEL[r.kind] ?? "やり取り";
    out.push({
      id: r.id,
      contactId: r.contactId,
      contactName: r.contactName,
      kind: r.kind,
      title: r.title,
      dueAt: r.dueAt.toISOString().slice(0, 10),
      daysUntil,
      overdue,
      note: overdue
        ? `期日を${-daysUntil}日過ぎています。${kindLabel}の区切りをつけるとよい頃です`
        : daysUntil === 0
          ? `今日が期日です。${kindLabel}の区切りをつけましょう`
          : `あと${daysUntil}日で期日です`,
    });
  }
  // 期限超過を先頭に、あとは期日の近い順
  return out.sort((a, b) => (a.daysUntil ?? 0) - (b.daysUntil ?? 0));
}

// 改ざん検知の中核。書き換わらない事実 (誰と・種類・向き・内容・価値・発生日) だけをハッシュし、
// 直前レコードの hash と連ねる (ハッシュチェーン)。ブロックチェーンは使わない。
// status/dueAt/notes は後から変わるのでハッシュに含めない。
export type ExchangeCore = {
  ownerUid: string;
  contactId: string;
  kind: string;
  direction: string;
  title: string;
  value: number | null;
  occurredAt: string; // ISO
};

export function hashExchangeCore(prevHash: string | null, core: ExchangeCore): string {
  const canonical = [
    prevHash ?? "",
    core.ownerUid,
    core.contactId,
    core.kind,
    core.direction,
    core.title,
    core.value ?? "",
    core.occurredAt,
  ].join("");
  return createHash("sha256").update(canonical).digest("hex");
}

// チェーンの検証。createdAt はミリ秒精度で同着しうるため並び順に頼らず、
// prevHash のリンクをたどって本来の鎖順を復元し、各 hash が (prevHash, core) から
// 再計算した値と一致するかを見る。brokenAt は復元した鎖上での 0 始まりの位置。
export function verifyExchangeChain(
  records: Array<ExchangeCore & { hash: string | null; prevHash: string | null }>,
): { intact: boolean; brokenAt: number | null } {
  // hash 未設定 (旧データ) はチェーン対象外
  const chained = records.filter((r) => r.hash != null);
  if (chained.length === 0) return { intact: true, brokenAt: null };
  // prevHash → レコード の索引で次を手繰る (genesis は prevHash 未設定 = null)
  const byPrev = new Map<string, typeof chained[number]>();
  for (const r of chained) byPrev.set(r.prevHash ?? "", r);

  let prev: string | null = null;
  let index = 0;
  let node = byPrev.get("");
  while (node) {
    const expected = hashExchangeCore(prev, node);
    if (node.hash !== expected) return { intact: false, brokenAt: index };
    prev = node.hash;
    index++;
    node = byPrev.get(node.hash!);
  }
  // すべて手繰れずに残ったレコードがあれば鎖が途切れている
  if (index !== chained.length) return { intact: false, brokenAt: index };
  return { intact: true, brokenAt: null };
}
