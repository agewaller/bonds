// 時間の出品と Stripe 決済 — timeshare スポットコンサルの概念を新規実装。
// 決済は BMP-LP (y-kishida-lgtm/BMP-LP) と同じ方針: Stripe SDK を入れず REST を直接叩き、
// 鍵は Secret Manager の STRIPE_SECRET_KEY のみ (ブラウザ・リポジトリに置かない)。
// webhook は使わず「決済からの戻りで検証 + 毎時 sweep で取りこぼし再照合」の二段構え
// (オーナー設定を鍵 1 本で済ませる。BMP-LP verify-session と同じ検証 = payment_status === "paid")。
import { sanitizeProse } from "./plain-text.js";

export const OFFER_METHODS = ["meeting", "online", "phone"] as const;
export type OfferMethod = (typeof OFFER_METHODS)[number];

const clean = (v: unknown, max: number): string => sanitizeProse(typeof v === "string" ? v : "").trim().slice(0, max);

export type OfferInput = {
  title: string;
  description: string;
  displayName: string;
  method: OfferMethod;
  minutes: number;
  priceJpy: number;
  active: boolean;
};

/** 出品の入力を検証・整形する。金額は円の整数 (JPY は最小単位 = 円) で 0〜100 万円。 */
export function parseOfferInput(raw: unknown): OfferInput | { error: string; detail: string } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const title = clean(o.title, 80);
  if (!title) return { error: "title_required", detail: "出品の名前を入れてください" };
  const priceJpy = Math.round(Number(o.priceJpy));
  if (!Number.isFinite(priceJpy) || priceJpy < 0 || priceJpy > 1_000_000) {
    return { error: "invalid_price", detail: "金額は 0 円から 100 万円までで入れてください" };
  }
  // Stripe の JPY 最低決済額 (¥50)。それ未満の有料は決済が通らないため弾く
  if (priceJpy > 0 && priceJpy < 50) {
    return { error: "invalid_price", detail: "有料にする場合は 50 円以上にしてください" };
  }
  return {
    title,
    description: clean(o.description, 1000),
    displayName: clean(o.displayName, 60),
    method: OFFER_METHODS.includes(o.method as OfferMethod) ? (o.method as OfferMethod) : "online",
    minutes: Math.min(480, Math.max(15, Math.round(Number(o.minutes)) || 60)),
    priceJpy,
    active: o.active !== false && o.active !== "false",
  };
}

// ------------------------------------------------------------
// Stripe REST クライアント (依存ゼロ・注入可能 = テストは偽 fetch で検証)
// ------------------------------------------------------------

export type StripeCheckoutSession = {
  id: string;
  url: string | null;
  payment_status: string;
  metadata?: Record<string, string>;
};

export type StripeClient = {
  createCheckoutSession(args: {
    amountJpy: number;
    productName: string;
    successUrl: string;
    cancelUrl: string;
    bookingId: string;
  }): Promise<StripeCheckoutSession>;
  getSession(sessionId: string): Promise<StripeCheckoutSession | null>;
};

/** Stripe の form エンコード (ネストは bracket 記法)。 */
export function stripeForm(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * env の STRIPE_SECRET_KEY から Stripe クライアントを作る。鍵が無ければ null
 * (有料の出品は「準備中」503 に縮退。無料の出品は決済なしで動く)。
 */
export function buildStripeClient(fetchImpl?: FetchLike): StripeClient | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  const fetchFn: FetchLike = fetchImpl ?? ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20000) }));
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  return {
    async createCheckoutSession(args) {
      const body = stripeForm({
        mode: "payment",
        "line_items[0][quantity]": 1,
        "line_items[0][price_data][currency]": "jpy",
        "line_items[0][price_data][unit_amount]": args.amountJpy,
        "line_items[0][price_data][product_data][name]": args.productName,
        success_url: args.successUrl,
        cancel_url: args.cancelUrl,
        "metadata[bookingId]": args.bookingId,
      });
      const r = await fetchFn("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers, body });
      if (!r.ok) {
        const detail = await r.text().catch(() => "");
        throw new Error(`stripe_checkout_failed: ${r.status} ${detail.slice(0, 300)}`);
      }
      return (await r.json()) as StripeCheckoutSession;
    },
    async getSession(sessionId) {
      if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(sessionId)) return null;
      const r = await fetchFn(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
        headers: { Authorization: headers.Authorization },
      });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`stripe_session_fetch_failed: ${r.status}`);
      return (await r.json()) as StripeCheckoutSession;
    },
  };
}

/** 支払い待ちの予約をいつまで有効とみなすか (これを過ぎたら expired にして枠を開放)。 */
export const PENDING_BOOKING_TTL_MS = 48 * 60 * 60 * 1000;

/** 枠の確保として busy 扱いにする予約か (確定済み + 直近の支払い待ち = 二重予約を防ぐ)。 */
export function bookingHoldsSlot(
  b: { status: string; createdAt: Date },
  now = new Date(),
): boolean {
  if (b.status === "confirmed") return true;
  if (b.status === "pending_payment") return now.getTime() - b.createdAt.getTime() < PENDING_BOOKING_TTL_MS;
  return false;
}
