// Google 連携の純粋ロジック (state 署名・アドレス解析・ノイズ除外・集約) のテスト。
import { describe, it, expect, beforeAll } from "vitest";
import {
  signState,
  verifyState,
  parseAddressList,
  isNoisePerson,
  collectGooglePeople,
  buildGoogleClient,
  MAX_EVENT_ATTENDEES,
} from "../../src/lib/google.js";

beforeAll(() => {
  process.env.DATA_ENCRYPTION_KEY =
    "4e107972818fcee63f3c91de6ed6f7143edab3f4169bcfe9abc95034c5e1996f";
});

describe("OAuth state (署名つき ownerUid)", () => {
  it("署名 → 検証で ownerUid が戻る。改ざん・期限切れは null", () => {
    const now = 1_800_000_000;
    const state = signState("user-123", now + 600)!;
    expect(verifyState(state, now)).toBe("user-123");
    // 期限切れ
    expect(verifyState(signState("user-123", now - 1)!, now)).toBeNull();
    // 改ざん (別ユーザーに書き換え)
    const [_, mac] = state.split(".");
    const forged = `${Buffer.from(`attacker.${now + 600}`).toString("base64url")}.${mac}`;
    expect(verifyState(forged, now)).toBeNull();
    expect(verifyState("garbage", now)).toBeNull();
    expect(verifyState(undefined, now)).toBeNull();
  });

  it("ownerUid にドットが含まれても正しく戻る", () => {
    const now = 1_800_000_000;
    const state = signState("firebase.uid.with.dots", now + 600)!;
    expect(verifyState(state, now)).toBe("firebase.uid.with.dots");
  });
});

describe("parseAddressList", () => {
  it("名前つき・クォート・複数アドレスを分解する", () => {
    const out = parseAddressList(
      '山田 太郎 <taro@example.com>, "Suzuki, Hanako" <hanako@example.co.jp>, plain@example.org',
    );
    expect(out).toEqual([
      { name: "山田 太郎", email: "taro@example.com" },
      { name: "Suzuki, Hanako", email: "hanako@example.co.jp" },
      { name: "plain", email: "plain@example.org" },
    ]);
    expect(parseAddressList(undefined)).toEqual([]);
  });
});

describe("isNoisePerson (通知・配信の除外)", () => {
  it("no-reply や配信ドメインは人として扱わない", () => {
    expect(isNoisePerson({ name: "x", email: "no-reply@example.com" })).toBe(true);
    expect(isNoisePerson({ name: "x", email: "noreply@github.com" })).toBe(true);
    expect(isNoisePerson({ name: "x", email: "newsletter@substack.com" })).toBe(true);
    expect(isNoisePerson({ name: "x", email: "room-a@resource.calendar.google.com" })).toBe(true);
    expect(isNoisePerson({ name: "山田", email: "taro.yamada@example.com" })).toBe(false);
  });
});

describe("collectGooglePeople (集約と採用判定)", () => {
  const today = "2026-07-08";

  it("カレンダー同席者は連絡先 + 過去イベントは meeting 記録。自分と会議室は除外", () => {
    const out = collectGooglePeople({
      selfEmails: ["me@example.com"],
      todayIso: today,
      calendarEvents: [
        {
          startDate: "2026-07-01",
          attendees: [
            { email: "me@example.com", self: true },
            { email: "taro@example.com", displayName: "山田 太郎" },
            { email: "room@resource.calendar.google.com", resource: true },
          ],
        },
        // 未来のイベント: 連絡先にはなるが接触記録はまだ付けない
        { startDate: "2026-08-01", attendees: [{ email: "taro@example.com" }] },
      ],
    });
    expect(out.contacts).toEqual([
      { name: "山田 太郎", email: "taro@example.com", source: "google_calendar" },
    ]);
    expect(out.interactions).toEqual([
      { name: "山田 太郎", occurredAt: "2026-07-01", type: "meeting" },
    ]);
  });

  it("大人数イベント (ウェビナー等) は取り込まない", () => {
    const attendees = Array.from({ length: MAX_EVENT_ATTENDEES + 1 }, (_, i) => ({
      email: `p${i}@example.com`,
    }));
    const out = collectGooglePeople({
      selfEmails: [],
      todayIso: today,
      calendarEvents: [{ startDate: "2026-07-01", attendees }],
    });
    expect(out.contacts).toEqual([]);
  });

  it("Gmail: 自分が送った相手は 1 通でも採用、受信のみの相手は 2 通以上で採用", () => {
    const out = collectGooglePeople({
      selfEmails: ["me@example.com"],
      todayIso: today,
      gmailMessages: [
        { sent: true, to: "山田 太郎 <taro@example.com>", dateMs: Date.UTC(2026, 6, 1) },
        { sent: false, from: "一回だけ <once@example.com>", dateMs: Date.UTC(2026, 6, 2) },
        { sent: false, from: "常連 <regular@example.com>", dateMs: Date.UTC(2026, 6, 2) },
        { sent: false, from: "常連 <regular@example.com>", dateMs: Date.UTC(2026, 6, 3) },
        { sent: false, from: "no-reply@shop.example.com", dateMs: Date.UTC(2026, 6, 3) },
      ],
    });
    const emails = out.contacts.map((c) => c.email).sort();
    expect(emails).toEqual(["regular@example.com", "taro@example.com"]);
    // 接触記録は採用された相手のぶんだけ・相手×日で 1 件
    expect(out.interactions).toEqual([
      { name: "山田 太郎", occurredAt: "2026-07-01", type: "email" },
      { name: "常連", occurredAt: "2026-07-02", type: "email" },
      { name: "常連", occurredAt: "2026-07-03", type: "email" },
    ]);
  });

  it("Drive: 共有相手は連絡先候補になる (自分は除外)。表示名が長い方を採用", () => {
    const out = collectGooglePeople({
      selfEmails: [],
      todayIso: today,
      gmailMessages: [
        { sent: true, to: "taro@example.com", dateMs: Date.UTC(2026, 6, 1) },
      ],
      driveFiles: [
        {
          owners: [{ displayName: "山田 太郎", emailAddress: "taro@example.com" }],
          lastModifyingUser: { displayName: "自分", emailAddress: "me@example.com", me: true },
        },
      ],
    });
    // 同一メールは 1 人にまとまり、名前は具体的な方 (表示名) が勝つ
    expect(out.contacts).toEqual([
      { name: "山田 太郎", email: "taro@example.com", source: "gmail" },
    ]);
  });
});

describe("buildGoogleClient", () => {
  it("env 未設定・番兵値 unset は null (準備中に縮退)", () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    expect(buildGoogleClient()).toBeNull();
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "unset";
    expect(buildGoogleClient()).toBeNull();
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "real-secret";
    const client = buildGoogleClient();
    expect(client).not.toBeNull();
    const url = client!.authUrl("STATE", "https://api.example.com/api/google/callback");
    expect(url).toContain("accounts.google.com");
    expect(url).toContain("access_type=offline");
    expect(url).toContain("gmail.metadata");
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  });
});
