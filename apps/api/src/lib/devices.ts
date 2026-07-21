// デバイス連携 (Oura リング / Withings マット等) — 共通取り込み基盤 (LMS 構想)。
//
// 設計 (google.ts と同じ型):
// - 読み取り専用。refresh token は暗号化して bonds (接続ハブ) に保存し、
//   健康データは health_metrics に日次で冪等 upsert する。読み手は cares / LMS。
// - env (OURA_CLIENT_ID 等) が無いプロバイダは「準備中」に縮退 (アプリは壊れない)。
// - ネットワークは buildDeviceClient に隔離し、テストでは注入で差し替える。
// - コールバックは未認証で叩かれるため、state に ownerUid+provider を HMAC 署名して埋める。

import { createHmac, timingSafeEqual } from "node:crypto";

export const DEVICE_PROVIDERS = ["oura", "withings"] as const;
export type DeviceProvider = (typeof DEVICE_PROVIDERS)[number];

export function isDeviceProvider(v: string): v is DeviceProvider {
  return (DEVICE_PROVIDERS as readonly string[]).includes(v);
}

export type DailyMetric = { kind: string; day: string; payload: unknown }; // day = YYYY-MM-DD

export type DeviceTokens = {
  refreshToken: string;
  accessToken: string;
  externalUserId?: string | null;
  scopes?: string | null;
};

export type DeviceClient = {
  ready: (provider: DeviceProvider) => boolean;
  authUrl: (provider: DeviceProvider, state: string) => string;
  exchangeCode: (provider: DeviceProvider, code: string) => Promise<DeviceTokens>;
  refreshAccessToken: (provider: DeviceProvider, refreshToken: string) => Promise<DeviceTokens>;
  fetchDaily: (
    provider: DeviceProvider,
    tokens: DeviceTokens,
    startDay: string,
    endDay: string,
  ) => Promise<DailyMetric[]>;
};

// ---------------- OAuth state 署名 (google.ts と同じ考え方・塩だけ変える) ----------------

function stateKey(): Buffer | null {
  const hex = process.env.DATA_ENCRYPTION_KEY;
  if (!hex) return null;
  return createHmac("sha256", "bonds-device-oauth-state").update(hex).digest();
}

export function signDeviceState(subject: string, nowSec: number): string | null {
  const key = stateKey();
  if (!key) return null;
  const body = `${subject}|${nowSec}`;
  const mac = createHmac("sha256", key).update(body).digest("base64url");
  return `${Buffer.from(body).toString("base64url")}.${mac}`;
}

export function verifyDeviceState(state: string | undefined, nowSec: number): string | null {
  if (!state) return null;
  const key = stateKey();
  if (!key) return null;
  const [b64, mac] = state.split(".");
  if (!b64 || !mac) return null;
  const body = Buffer.from(b64, "base64url").toString();
  const expect = createHmac("sha256", key).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const sep = body.lastIndexOf("|");
  if (sep < 0) return null;
  const ts = Number(body.slice(sep + 1));
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > 3600) return null; // 1 時間で失効
  return body.slice(0, sep);
}

// ---------------- 実クライアント ----------------

const redirectUri = () =>
  process.env.DEVICE_OAUTH_REDIRECT_URL ?? "http://localhost:8080/api/devices/callback";

const OURA_SCOPES = "email personal daily heartrate";
const WITHINGS_SCOPES = "user.metrics,user.activity,user.sleepevents";

async function postForm(url: string, form: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${url}: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

/** env の揃ったプロバイダだけ生きるクライアント。テストでは丸ごと注入で差し替える。 */
export function buildDeviceClient(): DeviceClient | null {
  if (!process.env.DATA_ENCRYPTION_KEY) return null; // state 署名の鍵が無ければ全体を閉じる

  const env = (p: DeviceProvider) =>
    p === "oura"
      ? { id: process.env.OURA_CLIENT_ID, secret: process.env.OURA_CLIENT_SECRET }
      : { id: process.env.WITHINGS_CLIENT_ID, secret: process.env.WITHINGS_CLIENT_SECRET };

  const ready = (p: DeviceProvider) => Boolean(env(p).id && env(p).secret);

  return {
    ready,
    authUrl: (p, state) => {
      const { id } = env(p);
      if (p === "oura") {
        const q = new URLSearchParams({
          response_type: "code",
          client_id: id ?? "",
          redirect_uri: redirectUri(),
          scope: OURA_SCOPES,
          state,
        });
        return `https://cloud.ouraring.com/oauth/authorize?${q}`;
      }
      const q = new URLSearchParams({
        response_type: "code",
        client_id: id ?? "",
        redirect_uri: redirectUri(),
        scope: WITHINGS_SCOPES,
        state,
      });
      return `https://account.withings.com/oauth2_user/authorize2?${q}`;
    },

    exchangeCode: async (p, code) => {
      const { id, secret } = env(p);
      if (p === "oura") {
        const t = (await postForm("https://api.ouraring.com/oauth/token", {
          grant_type: "authorization_code",
          code,
          client_id: id ?? "",
          client_secret: secret ?? "",
          redirect_uri: redirectUri(),
        })) as { access_token?: string; refresh_token?: string };
        if (!t.access_token || !t.refresh_token) throw new Error("oura: token missing");
        return { accessToken: t.access_token, refreshToken: t.refresh_token, scopes: OURA_SCOPES };
      }
      // Withings は成功応答も {status:0, body:{...}} に包まれる
      const r = (await postForm("https://wbsapi.withings.net/v2/oauth2", {
        action: "requesttoken",
        grant_type: "authorization_code",
        client_id: id ?? "",
        client_secret: secret ?? "",
        code,
        redirect_uri: redirectUri(),
      })) as { status?: number; body?: { access_token?: string; refresh_token?: string; userid?: string | number } };
      const b = r.body ?? {};
      if (r.status !== 0 || !b.access_token || !b.refresh_token) throw new Error("withings: token missing");
      return {
        accessToken: b.access_token,
        refreshToken: b.refresh_token,
        externalUserId: b.userid != null ? String(b.userid) : null,
        scopes: WITHINGS_SCOPES,
      };
    },

    refreshAccessToken: async (p, refreshToken) => {
      const { id, secret } = env(p);
      if (p === "oura") {
        const t = (await postForm("https://api.ouraring.com/oauth/token", {
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: id ?? "",
          client_secret: secret ?? "",
        })) as { access_token?: string; refresh_token?: string };
        if (!t.access_token) throw new Error("oura: refresh failed");
        return { accessToken: t.access_token, refreshToken: t.refresh_token ?? refreshToken, scopes: OURA_SCOPES };
      }
      const r = (await postForm("https://wbsapi.withings.net/v2/oauth2", {
        action: "requesttoken",
        grant_type: "refresh_token",
        client_id: id ?? "",
        client_secret: secret ?? "",
        refresh_token: refreshToken,
      })) as { status?: number; body?: { access_token?: string; refresh_token?: string; userid?: string | number } };
      const b = r.body ?? {};
      if (r.status !== 0 || !b.access_token) throw new Error("withings: refresh failed");
      return {
        accessToken: b.access_token,
        refreshToken: b.refresh_token ?? refreshToken,
        externalUserId: b.userid != null ? String(b.userid) : null,
        scopes: WITHINGS_SCOPES,
      };
    },

    fetchDaily: async (p, tokens, startDay, endDay) => {
      const out: DailyMetric[] = [];
      if (p === "oura") {
        // Oura v2: 日次サマリー 3 種 (睡眠・整い・活動)。day キーで冪等
        const kinds: Array<[string, string]> = [
          ["sleep", "daily_sleep"],
          ["readiness", "daily_readiness"],
          ["activity", "daily_activity"],
        ];
        for (const [kind, path] of kinds) {
          const res = await fetch(
            `https://api.ouraring.com/v2/usercollection/${path}?start_date=${startDay}&end_date=${endDay}`,
            { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
          );
          if (!res.ok) continue; // 1 種の失敗で全体を落とさない
          const body = (await res.json().catch(() => ({}))) as { data?: Array<{ day?: string }> };
          for (const item of body.data ?? []) {
            if (item.day) out.push({ kind, day: item.day, payload: item });
          }
        }
        return out;
      }
      // Withings: 睡眠サマリー (マット)。date キーで冪等
      const r = (await postForm("https://wbsapi.withings.net/v2/sleep", {
        action: "getsummary",
        startdateymd: startDay,
        enddateymd: endDay,
        access_token: tokens.accessToken,
      }).catch(() => null)) as { status?: number; body?: { series?: Array<{ date?: string }> } } | null;
      for (const item of r?.body?.series ?? []) {
        if (item.date) out.push({ kind: "sleep", day: item.date, payload: item });
      }
      return out;
    },
  };
}
