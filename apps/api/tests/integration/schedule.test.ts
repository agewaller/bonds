// 日程調整の共有リンクと時間の出品の結合テスト (実 Postgres bonds_test)。
// 作成 → 公開閲覧 → 提案 → 承認 → 接触記録への還流、あいことば、期限、ownerUid 分離、
// 無料/有料の予約 (偽 Stripe)、支払い再照合 (sweep) までを一気通貫で確かめる。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient, isEncrypted } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";
import type { StripeClient } from "../../src/lib/time-offers.js";
import type { VerifyIdTokenFn } from "../../src/lib/auth.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;
const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };
const PUB = { "Content-Type": "application/json" }; // 公開側は認証なし

let prisma: ExtendedPrismaClient;

beforeAll(() => {
  prisma = createPrismaClient();
});
afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});
beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "schedule_share_proposals", "schedule_shares", "time_bookings", "time_offers", "availability_settings", "calendar_links", "contact_interactions", "contacts", "prompts", "app_config" CASCADE',
  );
  await seedDdPrompts(prisma);
});

const makeApp = (extra: { stripe?: StripeClient | null; verifyIdToken?: VerifyIdTokenFn } = {}) =>
  createApp({ prisma, generate: null, stripe: extra.stripe ?? null, verifyIdToken: extra.verifyIdToken });

describe("空き時間の設定 (/api/relationship/availability)", () => {
  it("保存すると次の取得と空き計算に効く", async () => {
    const app = makeApp();
    const put = await app.request("/api/relationship/availability", {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ bufferMinutes: 30, minMinutes: 60, days: { sun: { enabled: false } } }),
    });
    expect(put.status).toBe(200);
    const got = await (await app.request("/api/relationship/availability", { headers: H })).json();
    expect(got.bufferMinutes).toBe(30);
    expect(got.minMinutes).toBe(60);
    expect(got.days.sun.enabled).toBe(false);
    expect(got.days.mon.enabled).toBe(true);
  });
});

describe("共有リンクの日程調整 (一気通貫)", () => {
  it("作成 → 公開で枠を見る → 提案 → 承認 → 接触記録へ還流し、枠は busy になる", async () => {
    const app = makeApp();
    const contact = await prisma.contact.create({ data: { ownerUid: "owner", name: "山田 花子", distance: 3 } });

    const created = await (
      await app.request("/api/schedule/shares", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ contactId: contact.id, title: "お打ち合わせ", displayName: "田中", slotMinutes: 60 }),
      })
    ).json();
    expect(created.shareKey).toBeTruthy();
    expect(created.url).toContain(`/s/${created.shareKey}`);

    // 公開側: 認証なしで骨格が見える (予定の中身は無い)
    const info = await (await app.request(`/api/public/schedule/${created.shareKey}`)).json();
    expect(info.locked).toBe(false);
    expect(info.displayName).toBe("田中");

    const slots = await (await app.request(`/api/public/schedule/${created.shareKey}/slots`)).json();
    expect(slots.options.length).toBeGreaterThan(0);

    // 相手が候補を 2 つ選んで提案する
    const cand = [slots.options[0], slots.options[1]];
    const proposed = await app.request(`/api/public/schedule/${created.shareKey}/proposals`, {
      method: "POST",
      headers: PUB,
      body: JSON.stringify({ guestName: "山田 花子", guestContact: "hanako@example.com", message: "楽しみにしています", candidates: cand }),
    });
    expect(proposed.status).toBe(201);

    // ゲストの情報は DB 上暗号化されている (第三者の PII)
    const raw = await prisma.$queryRawUnsafe<{ guest_name: string }[]>(
      "SELECT guest_name FROM schedule_share_proposals LIMIT 1",
    );
    expect(isEncrypted(raw[0]!.guest_name)).toBe(true);

    // オーナー側: 一覧に「お返事待ち」が出て、詳細で復号された提案が読める
    const list = await (await app.request("/api/schedule/shares", { headers: H })).json();
    expect(list.shares[0].pendingProposals).toBe(1);
    const detail = await (await app.request(`/api/schedule/shares/${created.id}`, { headers: H })).json();
    expect(detail.proposals[0].guestName).toBe("山田 花子");

    // 候補の 1 つ目で承認 → ics が返り、接触記録に還流される
    const accepted = await (
      await app.request(`/api/schedule/shares/${created.id}/proposals/${detail.proposals[0].id}/accept`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ start: cand[0].start }),
      })
    ).json();
    expect(accepted.accepted).toBe(true);
    expect(accepted.ics).toContain("BEGIN:VCALENDAR");
    const interactions = await prisma.contactInteraction.findMany({ where: { contactId: contact.id } });
    expect(interactions).toHaveLength(1);
    expect(interactions[0]!.type).toBe("meeting");

    // 確定した枠は以後の公開の選択肢から消える (二重の約束を防ぐ)
    const after = await (await app.request(`/api/public/schedule/${created.shareKey}/slots`)).json();
    expect((after.options as { start: string }[]).some((o) => o.start === cand[0].start)).toBe(false);

    // 二度目の承認は 409
    const again = await app.request(`/api/schedule/shares/${created.id}/proposals/${detail.proposals[0].id}/accept`, {
      method: "POST",
      headers: H,
      body: "{}",
    });
    expect(again.status).toBe(409);
  });

  it("あいことば: 未解錠では枠が見えず、正しいあいことばの proof で開く", async () => {
    const app = makeApp();
    const created = await (
      await app.request("/api/schedule/shares", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ password: "ひまわり" }),
      })
    ).json();

    const info = await (await app.request(`/api/public/schedule/${created.shareKey}`)).json();
    expect(info.locked).toBe(true);
    expect(info.periodStart).toBeUndefined();
    expect((await app.request(`/api/public/schedule/${created.shareKey}/slots`)).status).toBe(403);

    const wrong = await app.request(`/api/public/schedule/${created.shareKey}/unlock`, {
      method: "POST",
      headers: PUB,
      body: JSON.stringify({ password: "あさがお" }),
    });
    expect(wrong.status).toBe(403);

    const unlocked = await (
      await app.request(`/api/public/schedule/${created.shareKey}/unlock`, {
        method: "POST",
        headers: PUB,
        body: JSON.stringify({ password: "ひまわり" }),
      })
    ).json();
    const slots = await app.request(
      `/api/public/schedule/${created.shareKey}/slots?proof=${encodeURIComponent(unlocked.proof)}`,
    );
    expect(slots.status).toBe(200);
  });

  it("期限切れ・削除済みは公開側から見えない。他人の共有は読めない (ownerUid 分離)", async () => {
    const verifyIdToken: VerifyIdTokenFn = async (token) => ({ uid: token, email: `${token}@example.com` });
    const app = makeApp({ verifyIdToken });
    const created = await (
      await app.request("/api/schedule/shares", { method: "POST", headers: H, body: "{}" })
    ).json();

    // 他人 (Firebase ユーザー) からは 404
    const other = await app.request(`/api/schedule/shares/${created.id}`, {
      headers: { Authorization: "Bearer someone-else" },
    });
    expect(other.status).toBe(404);

    // 期限を過去にすると公開側は 404
    await prisma.scheduleShare.update({ where: { id: created.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await app.request(`/api/public/schedule/${created.shareKey}`)).status).toBe(404);

    // 削除すると提案ごと消える
    const del = await app.request(`/api/schedule/shares/${created.id}`, { method: "DELETE", headers: H });
    expect(del.status).toBe(200);
    expect(await prisma.scheduleShare.count()).toBe(0);
  });
});

describe("時間の出品と予約", () => {
  it("無料の出品は決済なしで即確定し、枠が公開の選択肢から消える", async () => {
    const app = makeApp();
    const created = await (
      await app.request("/api/schedule/offers", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ title: "30分のご相談", minutes: 30, priceJpy: 0 }),
      })
    ).json();

    const slots = await (await app.request(`/api/public/offers/${created.offerKey}/slots`)).json();
    const slot = slots.options[0];
    const booked = await (
      await app.request(`/api/public/offers/${created.offerKey}/book`, {
        method: "POST",
        headers: PUB,
        body: JSON.stringify({ guestName: "佐藤", guestContact: "sato@example.com", slot }),
      })
    ).json();
    expect(booked.confirmed).toBe(true);

    const after = await (await app.request(`/api/public/offers/${created.offerKey}/slots`)).json();
    expect((after.options as { start: string }[]).some((o) => o.start === slot.start)).toBe(false);

    // 予約者の情報は暗号化されている
    const raw = await prisma.$queryRawUnsafe<{ guest_name: string }[]>("SELECT guest_name FROM time_bookings LIMIT 1");
    expect(isEncrypted(raw[0]!.guest_name)).toBe(true);
  });

  it("有料の出品: Stripe 未設定なら 503、設定済みなら支払い → 照合で確定する", async () => {
    // 未設定 → 503
    const bare = makeApp({ stripe: null });
    const created = await (
      await bare.request("/api/schedule/offers", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ title: "60分のご相談", minutes: 60, priceJpy: 5000 }),
      })
    ).json();
    const pub = await (await bare.request(`/api/public/offers/${created.offerKey}`)).json();
    expect(pub.acceptingBookings).toBe(false);
    const slots = await (await bare.request(`/api/public/offers/${created.offerKey}/slots`)).json();
    const denied = await bare.request(`/api/public/offers/${created.offerKey}/book`, {
      method: "POST",
      headers: PUB,
      body: JSON.stringify({ guestName: "佐藤", slot: slots.options[0] }),
    });
    expect(denied.status).toBe(503);

    // 偽 Stripe: 作成は成功、照合は「支払い済み」を返す
    const paid = new Set<string>();
    const fakeStripe: StripeClient = {
      createCheckoutSession: async (args) => ({
        id: "cs_test_9",
        url: `https://checkout.stripe.com/pay/${args.bookingId}`,
        payment_status: "unpaid",
      }),
      getSession: async (id) => ({ id, url: null, payment_status: paid.has(id) ? "paid" : "unpaid" }),
    };
    const app = makeApp({ stripe: fakeStripe });
    const booked = await (
      await app.request(`/api/public/offers/${created.offerKey}/book`, {
        method: "POST",
        headers: PUB,
        body: JSON.stringify({ guestName: "佐藤", guestContact: "sato@example.com", slot: slots.options[0] }),
      })
    ).json();
    expect(booked.confirmed).toBe(false);
    expect(booked.checkoutUrl).toContain("checkout.stripe.com");

    // 未払いのうちは pending のまま
    const st1 = await (
      await app.request(`/api/public/offers/${created.offerKey}/booking-status?session_id=cs_test_9`)
    ).json();
    expect(st1.status).toBe("pending_payment");

    // 支払われた → confirmed に変わる
    paid.add("cs_test_9");
    const st2 = await (
      await app.request(`/api/public/offers/${created.offerKey}/booking-status?session_id=cs_test_9`)
    ).json();
    expect(st2.status).toBe("confirmed");
    const row = await prisma.timeBooking.findFirst({ where: { stripeSessionId: "cs_test_9" } });
    expect(row!.status).toBe("confirmed");
    expect(row!.paidAt).not.toBeNull();
  });

  it("毎時の再照合: 支払い済みの取りこぼしを確定し、期限切れは枠を開放する", async () => {
    const offer = await prisma.timeOffer.create({
      data: { ownerUid: "owner", offerKey: "k-1", title: "相談", priceJpy: 5000, minutes: 30 },
    });
    const slot = { start: "2026-08-01T01:00:00.000Z", end: "2026-08-01T01:30:00.000Z" };
    await prisma.timeBooking.create({
      data: { offerId: offer.id, ownerUid: "owner", guestName: "A", slot, status: "pending_payment", amountJpy: 5000, stripeSessionId: "cs_test_paid" },
    });
    const stale = await prisma.timeBooking.create({
      data: { offerId: offer.id, ownerUid: "owner", guestName: "B", slot, status: "pending_payment", amountJpy: 5000, stripeSessionId: "cs_test_old" },
    });
    await prisma.$executeRawUnsafe(
      "UPDATE time_bookings SET created_at = now() - interval '3 days' WHERE id = $1",
      stale.id,
    );
    const fakeStripe: StripeClient = {
      createCheckoutSession: async () => {
        throw new Error("unused");
      },
      getSession: async (id) => ({ id, url: null, payment_status: id === "cs_test_paid" ? "paid" : "unpaid" }),
    };
    const app = makeApp({ stripe: fakeStripe });
    const res = await (
      await app.request("/api/admin/schedule/reconcile-bookings", { method: "POST", headers: H })
    ).json();
    expect(res.confirmed).toBe(1);
    expect(res.expired).toBe(1);
    const rows = await prisma.timeBooking.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.status).sort()).toEqual(["confirmed", "expired"]);
  });
});
