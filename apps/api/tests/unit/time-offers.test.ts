// 時間の出品と Stripe クライアント (REST 直・依存ゼロ) のユニットテスト。
import { describe, it, expect, afterEach } from "vitest";
import {
  parseOfferInput,
  stripeForm,
  buildStripeClient,
  bookingHoldsSlot,
  PENDING_BOOKING_TTL_MS,
} from "../../src/lib/time-offers.js";

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
});

describe("parseOfferInput", () => {
  it("名前必須・金額は 0 か 50 円以上 100 万円まで", () => {
    expect(parseOfferInput({})).toHaveProperty("error", "title_required");
    expect(parseOfferInput({ title: "相談", priceJpy: 10 })).toHaveProperty("error", "invalid_price");
    expect(parseOfferInput({ title: "相談", priceJpy: 2_000_000 })).toHaveProperty("error", "invalid_price");
    const ok = parseOfferInput({ title: "相談", priceJpy: 0, minutes: 30 });
    expect("priceJpy" in ok && ok.priceJpy).toBe(0);
    expect("minutes" in ok && ok.minutes).toBe(30);
  });

  it("分数は 15〜480 にクランプする", () => {
    const o = parseOfferInput({ title: "相談", priceJpy: 5000, minutes: 5 });
    expect("minutes" in o && o.minutes).toBe(15);
  });
});

describe("buildStripeClient", () => {
  it("鍵が無ければ null (有料は準備中に縮退)", () => {
    expect(buildStripeClient()).toBeNull();
  });

  it("Checkout セッションを form エンコードで作り、鍵は Authorization にだけ入る", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc";
    const calls: { url: string; init?: RequestInit }[] = [];
    const fake = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "cs_test_1", url: "https://checkout.stripe.com/x", payment_status: "unpaid" }));
    };
    const client = buildStripeClient(fake)!;
    const session = await client.createCheckoutSession({
      amountJpy: 5000,
      productName: "30分のご相談",
      successUrl: "https://web/b/k/thanks?session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://web/b/k",
      bookingId: "b-1",
    });
    expect(session.id).toBe("cs_test_1");
    const body = String(calls[0]!.init!.body);
    expect(body).toContain("line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=5000");
    expect(body).toContain("currency%5D=jpy");
    expect(body).toContain("metadata%5BbookingId%5D=b-1");
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer sk_test_abc");
  });

  it("セッション照会は不正な id を Stripe に投げず null を返す", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc";
    let called = 0;
    const client = buildStripeClient(async () => {
      called++;
      return new Response(JSON.stringify({ id: "cs_test_1", url: null, payment_status: "paid" }));
    })!;
    expect(await client.getSession("../etc/passwd")).toBeNull();
    expect(called).toBe(0);
    const s = await client.getSession("cs_test_1");
    expect(s?.payment_status).toBe("paid");
  });
});

describe("stripeForm", () => {
  it("bracket 記法をエンコードする", () => {
    expect(stripeForm({ "a[b]": "x y" })).toBe("a%5Bb%5D=x%20y");
  });
});

describe("bookingHoldsSlot", () => {
  const now = new Date("2026-07-16T09:00:00Z");
  it("確定は常に・支払い待ちは期限内だけ枠を確保する", () => {
    expect(bookingHoldsSlot({ status: "confirmed", createdAt: new Date(0) }, now)).toBe(true);
    expect(bookingHoldsSlot({ status: "pending_payment", createdAt: now }, now)).toBe(true);
    expect(
      bookingHoldsSlot({ status: "pending_payment", createdAt: new Date(now.getTime() - PENDING_BOOKING_TTL_MS - 1) }, now),
    ).toBe(false);
    expect(bookingHoldsSlot({ status: "canceled", createdAt: now }, now)).toBe(false);
  });
});
