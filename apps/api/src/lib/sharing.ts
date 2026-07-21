// 時間・知恵・モノのシェア — 旧 gift (give/lend/teach/do/advise) を bonds に進化移植。
//
// gift は二者ともユーザーのマーケットプレイスだった。bonds の「相手」は非ユーザーの
// 第三者なので、二者間 handshake は取らない。代わりに:
//   - オーナー主導のシェア (offer=差し出す / request=頼む / inbound=相手から)
//   - 相手の応答は「公開トークン (マジックリンク)」経由でアカウント不要に受ける = 双方向
// で成立させる。DB / DOM 非依存の純粋関数 (ユニットテスト対象)。

// ── 種別: 何をシェアするか (時間・知恵・モノ) ──
export const SHARE_KINDS = ["time", "wisdom", "thing"] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

// 旧 gift の ACTION_STATUS (give/lend/teach/do/advise) をシェア種別へ写像。
export const GIFT_ACTION_TO_KIND: Record<string, ShareKind> = {
  give: "thing", // モノをあげる
  lend: "thing", // モノを貸す
  teach: "wisdom", // 教える
  advise: "wisdom", // 助言する
  do: "time", // してあげる (労力・時間)
};

export function normalizeKind(v: unknown): ShareKind {
  return (SHARE_KINDS as readonly string[]).includes(v as string) ? (v as ShareKind) : "thing";
}

// ── 方向 ──
// offer   : オーナーが相手に差し出す (時間・知恵・モノをあげる/貸す/教える)
// request : オーナーが相手に頼む (相手の時間・知恵・モノを借りたい)
// inbound : 相手からオーナーへ差し出された / 頼まれた (受け取りの記録)
export const SHARE_DIRECTIONS = ["offer", "request", "inbound"] as const;
export type ShareDirection = (typeof SHARE_DIRECTIONS)[number];

export function normalizeDirection(v: unknown): ShareDirection {
  return (SHARE_DIRECTIONS as readonly string[]).includes(v as string)
    ? (v as ShareDirection)
    : "offer";
}

// ── 状態機械 (gift の aasm_state を一方向に進化) ──
// proposed → sent → accepted → fulfilled
//                 ↘ declined
// (終端前はいつでも cancelled 可能)
export const SHARE_STATUSES = [
  "proposed",
  "sent",
  "accepted",
  "declined",
  "fulfilled",
  "cancelled",
] as const;
export type ShareStatus = (typeof SHARE_STATUSES)[number];

const TRANSITIONS: Record<ShareStatus, readonly ShareStatus[]> = {
  proposed: ["sent", "cancelled"],
  sent: ["accepted", "declined", "cancelled"],
  accepted: ["fulfilled", "cancelled"],
  declined: [],
  fulfilled: [],
  cancelled: [],
};

export function canTransition(from: ShareStatus, to: ShareStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

// inbound (相手から差し出された記録) は往復を伴わないので即 accepted で作る。
// offer / request はオーナーが送るまで proposed。
export function initialStatus(direction: ShareDirection): ShareStatus {
  return direction === "inbound" ? "accepted" : "proposed";
}

// ── 相手 (第三者) の公開応答 ──
// 安全上、トークン経由の第三者は accepted / declined 以外へは遷移させられない。
// かつ現状態が sent のときだけ有効 (オーナーが送る前・後日確定後は不可)。
export type CounterpartResponse = "accept" | "decline";

export function counterpartTargetStatus(resp: CounterpartResponse): ShareStatus {
  return resp === "accept" ? "accepted" : "declined";
}

export function canCounterpartRespond(current: ShareStatus, resp: CounterpartResponse): boolean {
  return current === "sent" && canTransition("sent", counterpartTargetStatus(resp));
}

// ── 適格性ゲート (gift negotiable? の進化) ──
// 「この相手にこのシェアを差し出すのは妥当か」を関係距離で判定する。
// 遠い相手 (distance 4-5) への request (頼みごと) は唐突なので既定で不適格にする。
export function shareEligibility(
  direction: ShareDirection,
  distance: number,
): { eligible: boolean; reason: string } {
  const d = clampDistanceLocal(distance);
  if (direction === "inbound") return { eligible: true, reason: "受け取りの記録" };
  if (direction === "request" && d >= 4) {
    return { eligible: false, reason: "距離が遠い相手への頼みごとは唐突です。まず関係を温めましょう" };
  }
  return { eligible: true, reason: "妥当" };
}

// 自動送信の可否 (CLAUDE.md「外に出る行動は既定=承認」の構造的ゲート)。
// 既定は false (= 承認必須)。近い相手 (distance <= 2) への offer だけを
// 「自動送信の候補」にする。実際の自動化はオーナーが channel×目的で明示許可した範囲と AND を取る。
export function canAutoSend(direction: ShareDirection, distance: number): boolean {
  return direction === "offer" && clampDistanceLocal(distance) <= 2;
}

function clampDistanceLocal(v: unknown): number {
  const n = typeof v === "string" ? parseInt(v, 10) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return 4;
  return Math.min(5, Math.max(1, Math.round(n)));
}
