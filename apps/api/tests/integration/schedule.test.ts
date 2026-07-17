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
    'TRUNCATE "schedule_share_participants", "schedule_share_proposals", "schedule_shares", "time_bookings", "time_offers", "availability_settings", "availability_slots", "calendar_links", "contact_interactions", "contacts", "prompts", "app_config" CASCADE',
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

describe("カレンダーをなぞった空き枠 (availability_slots・timeshare の free_times)", () => {
  it("なぞった日はその枠だけが共有ページの選択肢になり、なぞっていない日は曜日窓", async () => {
    const app = makeApp();
    const d = new Date();
    d.setDate(d.getDate() + 1); // 明日 19:00-21:00 をなぞる
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 19, 0);
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 21, 0);
    const created = await app.request("/api/relationship/availability-slots", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ start: start.toISOString(), end: end.toISOString() }),
    });
    expect(created.status).toBe(200);

    const share = await (
      await app.request("/api/schedule/shares", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ periodDays: 3, slotMinutes: 60 }),
      })
    ).json();
    const slots = await (await app.request(`/api/public/schedule/${share.shareKey}/slots`)).json();
    const opts = slots.options as { start: string }[];
    const traced = opts.filter((o) => new Date(o.start).getDate() === d.getDate());
    // なぞった日は 19:00-21:00 に収まる開始 (19:00/19:30/20:00) だけ。既定の 9-18 窓は使われない
    expect(
      traced
        .map((o) => `${new Date(o.start).getHours()}:${new Date(o.start).getMinutes()}`)
        .sort(),
    ).toEqual(["19:0", "19:30", "20:0"]);
    // なぞっていない日 (あさって) は従来どおり午前から出る
    const dayAfter = new Date(d);
    dayAfter.setDate(dayAfter.getDate() + 1);
    const untouched = opts.filter((o) => new Date(o.start).getDate() === dayAfter.getDate());
    expect(untouched.some((o) => new Date(o.start).getHours() === 9)).toBe(true);
  });

  it("一覧・削除ができ、過去の枠や逆さの時間は 400", async () => {
    const app = makeApp();
    const d = new Date();
    d.setDate(d.getDate() + 2);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10, 0);
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0);
    await app.request("/api/relationship/availability-slots", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ start: start.toISOString(), end: end.toISOString() }),
    });
    const list = await (await app.request("/api/relationship/availability-slots", { headers: H })).json();
    expect(list.slots).toHaveLength(1);
    const del = await app.request(`/api/relationship/availability-slots/${list.slots[0].id}`, {
      method: "DELETE",
      headers: H,
    });
    expect(del.status).toBe(200);
    expect(
      ((await (await app.request("/api/relationship/availability-slots", { headers: H })).json()) as {
        slots: unknown[];
      }).slots,
    ).toHaveLength(0);

    const past = await app.request("/api/relationship/availability-slots", {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        start: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        end: new Date(Date.now() - 86_400_000).toISOString(),
      }),
    });
    expect(past.status).toBe(400);
    const upside = await app.request("/api/relationship/availability-slots", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ start: end.toISOString(), end: start.toISOString() }),
    });
    expect(upside.status).toBe(400);
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

describe("予定表の重ね合わせ (timeshare の共通空き時間の踏襲)", () => {
  // 期間中の 1 日について ICS の busy を組み立てる (ローカル時刻)
  const icsFor = (day: Date, ranges: Array<[number, number]>) => {
    const d = `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, "0")}${String(day.getDate()).padStart(2, "0")}`;
    const events = ranges
      .map(
        ([s, e]) =>
          `BEGIN:VEVENT\nDTSTART:${d}T${String(s).padStart(2, "0")}0000\nDTEND:${d}T${String(e).padStart(2, "0")}0000\nEND:VEVENT`,
      )
      .join("\n");
    return `BEGIN:VCALENDAR\n${events}\nEND:VCALENDAR`;
  };

  it("参加者が予定表を重ねると共通の空きだけになり、二人目でさらに絞られ、取り消すと戻る", async () => {
    const app = makeApp();
    // 期間 5 日 = 選択肢が上限 (200 件) に届かない長さにし、上限の窓ずれを排除して
    // 「共通の空きは元の選択肢の部分集合」を厳密に確かめる
    const created = await (
      await app.request("/api/schedule/shares", { method: "POST", headers: H, body: JSON.stringify({ periodDays: 5 }) })
    ).json();
    const base = await (await app.request(`/api/public/schedule/${created.shareKey}/slots`)).json();
    expect(base.basis).toBe("owner");
    const ownerStarts = new Set((base.options as { start: string }[]).map((o) => o.start));

    // 参加者A: 明後日の 9-12 時が埋まっている予定表を重ねる
    const day = new Date();
    day.setDate(day.getDate() + 2);
    const joinA = await (
      await app.request(`/api/public/schedule/${created.shareKey}/participants`, {
        method: "POST",
        headers: PUB,
        body: JSON.stringify({ name: "参加 一郎", ics: icsFor(day, [[9, 12]]) }),
      })
    ).json();
    expect(joinA.participantKey).toBeTruthy();

    const afterA = await (await app.request(`/api/public/schedule/${created.shareKey}/slots`)).json();
    expect(afterA.basis).toBe("common");
    expect(afterA.participants).toEqual(["参加 一郎"]);
    const startsA = (afterA.options as { start: string }[]).map((o) => o.start);
    // 元の選択肢の部分集合で、明後日の午前 (9-12時) は消えている
    for (const s of startsA) expect(ownerStarts.has(s)).toBe(true);
    const morningGone = startsA.filter((s) => {
      const d = new Date(s);
      return d.getDate() === day.getDate() && d.getHours() >= 9 && d.getHours() < 12;
    });
    expect(morningGone).toHaveLength(0);
    expect(startsA.length).toBeGreaterThan(0);
    expect(startsA.length).toBeLessThan(ownerStarts.size);

    // 名乗りは DB 上暗号化 (第三者の PII)
    const raw = await prisma.$queryRawUnsafe<{ name: string }[]>("SELECT name FROM schedule_share_participants LIMIT 1");
    expect(isEncrypted(raw[0]!.name)).toBe(true);

    // 参加者B: 同じ日の 13-18 時も埋まっている → その日はさらに絞られる
    await app.request(`/api/public/schedule/${created.shareKey}/participants`, {
      method: "POST",
      headers: PUB,
      body: JSON.stringify({ name: "参加 二子", ics: icsFor(day, [[13, 18]]) }),
    });
    const afterB = await (await app.request(`/api/public/schedule/${created.shareKey}/slots`)).json();
    expect(afterB.participants).toEqual(["参加 一郎", "参加 二子"]);
    const dayStartsB = (afterB.options as { start: string }[]).filter((o) => new Date(o.start).getDate() === day.getDate());
    // その日は 12-13 時に収まる開始時刻だけが残る (60 分面談なので実質 12:00 のみ)
    for (const o of dayStartsB) {
      const d = new Date(o.start);
      expect(d.getHours()).toBe(12);
    }

    // 提案の検証も共通の空きに従う: 消えた時間 (9時台) は 409 で弾かれる
    const gone = (base.options as { start: string; end: string }[]).find((o) => {
      const d = new Date(o.start);
      return d.getDate() === day.getDate() && d.getHours() === 9;
    });
    if (gone) {
      const denied = await app.request(`/api/public/schedule/${created.shareKey}/proposals`, {
        method: "POST",
        headers: PUB,
        body: JSON.stringify({ guestName: "参加 一郎", candidates: [gone] }),
      });
      expect(denied.status).toBe(409);
    }

    // 入れ直し (PUT): 空の予定表 → その参加者の制約が消える
    await app.request(`/api/public/schedule/${created.shareKey}/participants/${joinA.participantKey}`, {
      method: "PUT",
      headers: PUB,
      body: JSON.stringify({ ics: "BEGIN:VCALENDAR\nEND:VCALENDAR" }),
    });
    // 取り消し (DELETE): B も外すと元の選択肢に戻る
    const afterUpdate = await (await app.request(`/api/public/schedule/${created.shareKey}`)).json();
    expect(afterUpdate.participants).toHaveLength(2);
    const keyB = (await prisma.scheduleShareParticipant.findMany()).find((p) => p.name === "参加 二子")!.participantKey;
    await app.request(`/api/public/schedule/${created.shareKey}/participants/${keyB}`, { method: "DELETE" });
    await app.request(`/api/public/schedule/${created.shareKey}/participants/${joinA.participantKey}`, {
      method: "DELETE",
    });
    const restored = await (await app.request(`/api/public/schedule/${created.shareKey}/slots`)).json();
    expect(restored.basis).toBe("owner");
    expect((restored.options as unknown[]).length).toBe(ownerStarts.size);

    // オーナーの詳細にも参加者が載る (この時点では 0 名)
    const detail = await (await app.request(`/api/schedule/shares/${created.id}`, { headers: H })).json();
    expect(detail.participants).toHaveLength(0);
  });

  it("名乗りは必須・予定表の形式が読めなければ 400・人数に上限がある", async () => {
    const app = makeApp();
    const created = await (
      await app.request("/api/schedule/shares", { method: "POST", headers: H, body: "{}" })
    ).json();
    const noName = await app.request(`/api/public/schedule/${created.shareKey}/participants`, {
      method: "POST",
      headers: PUB,
      body: JSON.stringify({ ics: "BEGIN:VCALENDAR\nEND:VCALENDAR" }),
    });
    expect(noName.status).toBe(400);
    const badIcs = await app.request(`/api/public/schedule/${created.shareKey}/participants`, {
      method: "POST",
      headers: PUB,
      body: JSON.stringify({ name: "参加 三郎", ics: "こんにちは" }),
    });
    expect(badIcs.status).toBe(400);
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
