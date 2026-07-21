// デバイス連携 (Oura/Withings 共通取り込み基盤) の結合テスト:
// 準備中の縮退 → OAuth callback (署名 state) で接続保存 (暗号化) → 同期で health_metrics に
// 冪等 upsert → 読み出し API。手動の録音メモ追加 (Plaud 以外の取り込み口) も検証する。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient, isEncrypted } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";
import { signDeviceState, type DeviceClient } from "../../src/lib/devices.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;
const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

let prisma: ExtendedPrismaClient;

const fakeDevices: DeviceClient = {
  ready: (p) => p === "oura", // withings は未設定 (準備中) の想定
  authUrl: (p, state) => `https://example.com/${p}/auth?state=${state}`,
  exchangeCode: async () => ({ refreshToken: "rt-1", accessToken: "at-1", scopes: "daily" }),
  refreshAccessToken: async () => ({ refreshToken: "rt-2", accessToken: "at-2", scopes: "daily" }),
  fetchDaily: async () => [
    { kind: "sleep", day: "2026-07-20", payload: { score: 82 } },
    { kind: "readiness", day: "2026-07-20", payload: { score: 76 } },
  ],
};

beforeAll(() => {
  prisma = createPrismaClient();
});
afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});
beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "device_connections", "health_metrics", "voice_memos", "prompts", "ai_usage_logs", "app_config" CASCADE',
  );
  await seedDdPrompts(prisma);
});

describe("デバイス連携の共通取り込み基盤", () => {
  it("未設定プロバイダは準備中 (503)・不明プロバイダは 404", async () => {
    const app = createApp({ prisma, devices: fakeDevices });
    expect((await app.request("/api/devices/withings/auth-url", { headers: H })).status).toBe(503);
    expect((await app.request("/api/devices/fitbit/auth-url", { headers: H })).status).toBe(404);
    const status = await (await app.request("/api/devices/status", { headers: H })).json();
    const oura = status.providers.find((p: { provider: string }) => p.provider === "oura");
    const withings = status.providers.find((p: { provider: string }) => p.provider === "withings");
    expect(oura.ready).toBe(true);
    expect(withings.ready).toBe(false);
  });

  it("callback で接続を保存 (暗号化) → 同期で health_metrics に冪等 upsert → 読み出せる", async () => {
    const app = createApp({ prisma, devices: fakeDevices });
    const state = signDeviceState("owner|oura", Math.floor(Date.now() / 1000));
    const cb = await app.request(`/api/devices/callback?state=${state}&code=c1`);
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toContain("device=connected");

    // トークンは DB 上で暗号化されている
    const raw = await prisma.$queryRawUnsafe<{ refresh_token: string }[]>(
      "SELECT refresh_token FROM device_connections LIMIT 1",
    );
    expect(isEncrypted(raw[0]!.refresh_token)).toBe(true);

    // 同期 → 2 kind が入る。もう一度同期しても増えない (upsert)
    const sync = await (await app.request("/api/devices/oura/sync", { method: "POST", headers: H, body: "{}" })).json();
    expect(sync.saved).toBe(2);
    await app.request("/api/devices/oura/sync", { method: "POST", headers: H, body: "{}" });
    expect(await prisma.healthMetric.count()).toBe(2);

    // payload は暗号化 at-rest・API では復号して返る
    const rawM = await prisma.$queryRawUnsafe<{ payload: string }[]>("SELECT payload FROM health_metrics LIMIT 1");
    expect(isEncrypted(rawM[0]!.payload)).toBe(true);
    const metrics = await (
      await app.request("/api/health/metrics?provider=oura&from=2026-07-01&to=2026-07-31", { headers: H })
    ).json();
    expect(metrics.metrics).toHaveLength(2);
    expect(metrics.metrics.find((m: { kind: string }) => m.kind === "sleep").payload.score).toBe(82);

    // 外す → 接続は消えるが蓄積データは残る (データ主権: 消すのは本人の明示操作)
    await app.request("/api/devices/oura/disconnect", { method: "POST", headers: H, body: "{}" });
    expect(await prisma.deviceConnection.count()).toBe(0);
    expect(await prisma.healthMetric.count()).toBe(2);
  });

  it("壊れた state の callback は保存しない・sweep の sync-all が回る", async () => {
    const app = createApp({ prisma, devices: fakeDevices });
    const bad = await app.request("/api/devices/callback?state=xxx.yyy&code=c1");
    expect(bad.headers.get("location")).toContain("device=error");
    expect(await prisma.deviceConnection.count()).toBe(0);

    const state = signDeviceState("owner|oura", Math.floor(Date.now() / 1000));
    await app.request(`/api/devices/callback?state=${state}&code=c1`);
    const sweep = await (
      await app.request("/api/admin/devices/sync-all", { method: "POST", headers: H, body: "{}" })
    ).json();
    expect(sweep.synced).toBe(1);
  });

  it("録音メモの手動追加 (Plaud 以外の取り込み口): AI 無しでもメモは残る・認証必須", async () => {
    const app = createApp({ prisma });
    const anon = await app.request("/api/relationship/voice-memos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "打ち合わせの文字起こし" }),
    });
    expect(anon.status).toBe(401);

    const res = await app.request("/api/relationship/voice-memos", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ subject: "散歩の録音", text: "きょうは川沿いを歩いた。田中さんに電話する。" }),
    });
    expect(res.status).toBe(200);
    const memo = await prisma.voiceMemo.findFirst();
    expect(memo?.subject).toBe("散歩の録音");
    expect(memo?.gmailMessageId.startsWith("manual:")).toBe(true);

    const list = await (await app.request("/api/relationship/voice-memos", { headers: H })).json();
    expect(list.memos).toHaveLength(1);

    expect((await app.request("/api/relationship/voice-memos", { method: "POST", headers: H, body: "{}" })).status).toBe(400);
  });
});
