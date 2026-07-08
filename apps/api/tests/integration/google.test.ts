// Google 連携の結合テスト。実テスト DB + 偽 GoogleClient (実 API は呼ばない)。
// refresh token の暗号化・callback の state 検証・同期の冪等取込を必ず検証する。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient, isEncrypted } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { signState, type GoogleClient } from "../../src/lib/google.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;

let prisma: ExtendedPrismaClient;
const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

// 偽 Google: カレンダー 1 イベント + Gmail 送信 1 通 + Drive 1 ファイルぶんの応答を返す
const fakeGoogle: GoogleClient = {
  authUrl: (state, redirectUri) =>
    `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
  exchangeCode: async (code) => {
    if (code === "bad") throw new Error("google_token_error: 400");
    return { refreshToken: "refresh-token-1", accessToken: "at", email: "me@example.com" };
  },
  refreshAccessToken: async () => "at",
  apiGet: async (url) => {
    if (url.includes("calendar/v3")) {
      return {
        items: [
          {
            start: { dateTime: "2026-07-01T10:00:00+09:00" },
            attendees: [
              { email: "me@example.com", self: true },
              { email: "taro@example.com", displayName: "山田 太郎" },
            ],
          },
        ],
      };
    }
    if (url.includes("/messages?")) {
      return url.includes("SENT") ? { messages: [{ id: "m1" }] } : { messages: [] };
    }
    if (url.includes("/messages/m1")) {
      return {
        internalDate: String(Date.UTC(2026, 6, 2)),
        payload: {
          headers: [
            { name: "To", value: "鈴木 花子 <hanako@example.com>" },
            { name: "From", value: "me@example.com" },
          ],
        },
      };
    }
    if (url.includes("drive/v3")) {
      return {
        files: [
          { owners: [{ displayName: "山田 太郎", emailAddress: "taro@example.com" }] },
        ],
      };
    }
    if (url.includes("people.googleapis.com")) {
      return {
        connections: [
          {
            names: [{ displayName: "田中 一郎" }],
            emailAddresses: [{ value: "ichiro@example.com" }],
            organizations: [{ name: "タナカ工業" }],
          },
        ],
      };
    }
    return {};
  },
};

beforeAll(() => {
  prisma = createPrismaClient();
});

afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "google_connections", "contact_interactions", "contacts" CASCADE',
  );
});

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

describe("接続 (status / auth-url / callback)", () => {
  it("client 未設定は available:false / auth-url 503 に縮退", async () => {
    const app = createApp({ prisma, generate: null, google: null });
    const st = await (await app.request("/api/google/status", { headers: H })).json();
    expect(st.available).toBe(false);
    const au = await app.request("/api/google/auth-url", { headers: H });
    expect(au.status).toBe(503);
  });

  it("auth-url は署名つき state を含み、callback で暗号化保存 → connected になる", async () => {
    const app = createApp({ prisma, generate: null, google: fakeGoogle });
    const au = await (await app.request("/api/google/auth-url", { headers: H })).json();
    expect(au.url).toContain("accounts.google.com");
    const state = new URL(au.url).searchParams.get("state")!;

    const cb = await app.request(`/api/google/callback?code=ok&state=${encodeURIComponent(state)}`);
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toContain("google=connected");

    // DB 上は暗号文 (合鍵を平文で置かない)
    const rows = await prisma.$queryRawUnsafe<Array<{ refresh_token: string }>>(
      `SELECT refresh_token FROM google_connections`,
    );
    expect(rows).toHaveLength(1);
    expect(isEncrypted(rows[0]!.refresh_token)).toBe(true);

    const st = await (await app.request("/api/google/status", { headers: H })).json();
    expect(st.connected).toBe(true);
    expect(st.email).toBe("me@example.com");
  });

  it("state が無い・改ざん・期限切れの callback は保存せずエラー戻し", async () => {
    const app = createApp({ prisma, generate: null, google: fakeGoogle });
    const bad = await app.request("/api/google/callback?code=ok&state=garbage");
    expect(bad.status).toBe(302);
    expect(bad.headers.get("location")).toContain("google=error");
    const expired = signState("owner", nowSec() - 10)!;
    const bad2 = await app.request(
      `/api/google/callback?code=ok&state=${encodeURIComponent(expired)}`,
    );
    expect(bad2.headers.get("location")).toContain("google=error");
    expect(await prisma.googleConnection.count()).toBe(0);
  });
});

describe("同期 (人物データの取込)", () => {
  async function connect(app: ReturnType<typeof createApp>) {
    const state = signState("owner", nowSec() + 600)!;
    await app.request(`/api/google/callback?code=ok&state=${encodeURIComponent(state)}`);
  }

  it("カレンダー同席者・メールの相手・共有相手が連絡先とやりとりに入り、再同期は冪等", async () => {
    const app = createApp({ prisma, generate: null, google: fakeGoogle });
    await connect(app);

    const res = await app.request("/api/google/sync", { method: "POST", headers: H, body: "{}" });
    expect(res.status).toBe(200);
    const body = await res.json();
    // 田中 一郎 (アドレス帳) + 山田 太郎 (calendar+drive で 1 人) + 鈴木 花子
    expect(body.imported).toBe(3);
    expect(body.interactionsAdded).toBe(2); // meeting 7/1 + email 7/2

    const list = await (await app.request("/api/contacts", { headers: H })).json();
    const names = list.contacts.map((c: { name: string }) => c.name).sort();
    expect(names).toEqual(["山田 太郎", "田中 一郎", "鈴木 花子"].sort());
    // メールアドレスも保存されている (暗号化列 → API は復号済み)
    const taro = list.contacts.find((c: { name: string }) => c.name === "山田 太郎");
    expect(taro.email).toBe("taro@example.com");
    // アドレス帳から所属も取り込まれる
    const ichiro = list.contacts.find((c: { name: string }) => c.name === "田中 一郎");
    expect(ichiro.company).toBe("タナカ工業");

    // 再同期しても増えない (同名スキップ + 同日重複なし)
    const again = await (
      await app.request("/api/google/sync", { method: "POST", headers: H, body: "{}" })
    ).json();
    expect(again.imported).toBe(0);
    expect(again.interactionsAdded).toBe(0);

    // 同期の記録が残る
    const st = await (await app.request("/api/google/status", { headers: H })).json();
    expect(st.lastSyncAt).not.toBeNull();
    expect(st.lastSyncNote).toContain("取り込み");
  });

  it("既存の連絡先とメールアドレスが一致したら、既存のお名前に寄せて二重登録しない", async () => {
    const app = createApp({ prisma, generate: null, google: fakeGoogle });
    await connect(app);
    // ユーザーが手で登録済みの「山田さん (太郎)」— 表示名が Google と違う
    await app.request("/api/contacts", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ name: "山田さん (太郎)", email: "taro@example.com" }),
    });

    const body = await (
      await app.request("/api/google/sync", { method: "POST", headers: H, body: "{}" })
    ).json();
    expect(body.imported).toBe(2); // 鈴木 花子 + 田中 一郎 (アドレス帳)。山田さんは寄せて二重登録しない

    const list = await (await app.request("/api/contacts", { headers: H })).json();
    const names = list.contacts.map((c: { name: string }) => c.name).sort();
    expect(names).toEqual(["山田さん (太郎)", "田中 一郎", "鈴木 花子"].sort()); // 二重登録なし
    // meeting の記録は既存の山田さんに付く
    const yamada = list.contacts.find((c: { name: string }) => c.name === "山田さん (太郎)");
    const detail = await (await app.request(`/api/contacts/${yamada.id}`, { headers: H })).json();
    expect(detail.interactions.some((i: { type: string }) => i.type === "meeting")).toBe(true);
  });

  it("未接続の同期は 503、admin sync-all は接続ぶんだけ回す", async () => {
    const app = createApp({ prisma, generate: null, google: fakeGoogle });
    const res = await app.request("/api/google/sync", { method: "POST", headers: H, body: "{}" });
    expect(res.status).toBe(503);

    await connect(app);
    const all = await (
      await app.request("/api/admin/google/sync-all?batch=5", { method: "POST", headers: H, body: "{}" })
    ).json();
    expect(all.picked).toBe(1);
    expect(all.synced).toBe(1);
  });
});
