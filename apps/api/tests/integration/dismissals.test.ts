// 提案の見送り (✖️) の結合テスト。記録 → 一覧 → すべて戻す、検証、ownerUid 分離。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient } from "@bonds/db";
import { createApp } from "../../src/app.js";
import type { VerifyIdTokenFn } from "../../src/lib/auth.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;
process.env.OWNER_EMAIL = "agewaller@gmail.com";
const H = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

let prisma: ExtendedPrismaClient;

const verifyIdToken: VerifyIdTokenFn = async (token) => ({ uid: token, email: "user@example.com" });

beforeAll(() => {
  prisma = createPrismaClient();
});
afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "suggestion_dismissals" CASCADE');
});

const makeApp = () => createApp({ prisma, generate: null, verifyIdToken });

describe("提案の見送り (/api/relationship/dismissals)", () => {
  it("記録すると一覧に載り、二重に押しても 1 件のまま", async () => {
    const app = makeApp();
    for (let i = 0; i < 2; i++) {
      const r = await app.request("/api/relationship/dismissals", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ kind: "first_move", key: "contact-1" }),
      });
      expect(r.status).toBe(200);
    }
    const list = await (await app.request("/api/relationship/dismissals", { headers: H })).json();
    expect(list.items).toEqual([{ kind: "first_move", key: "contact-1" }]);
  });

  it("kind / key が無ければ 400", async () => {
    const app = makeApp();
    const r = await app.request("/api/relationship/dismissals", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "first_move" }),
    });
    expect(r.status).toBe(400);
  });

  it("すべて戻す (DELETE) と一覧が空になる", async () => {
    const app = makeApp();
    await app.request("/api/relationship/dismissals", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "drift", key: "c1" }),
    });
    await app.request("/api/relationship/dismissals", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "goal_nudge", key: "c2" }),
    });
    const del = await (await app.request("/api/relationship/dismissals", { method: "DELETE", headers: H })).json();
    expect(del.restored).toBe(2);
    const list = await (await app.request("/api/relationship/dismissals", { headers: H })).json();
    expect(list.items).toEqual([]);
  });

  it("ownerUid をまたがない (他の利用者の見送りは見えず・消せない)", async () => {
    const app = makeApp();
    const U = { "Content-Type": "application/json", authorization: "Bearer user-1" };
    await app.request("/api/relationship/dismissals", {
      method: "POST",
      headers: U,
      body: JSON.stringify({ kind: "first_move", key: "their-contact" }),
    });
    // オーナー側の一覧には出ない
    const mine = await (await app.request("/api/relationship/dismissals", { headers: H })).json();
    expect(mine.items).toEqual([]);
    // オーナーが「すべて戻す」をしても、他の利用者の見送りは消えない
    await app.request("/api/relationship/dismissals", { method: "DELETE", headers: H });
    const theirs = await (await app.request("/api/relationship/dismissals", { headers: U })).json();
    expect(theirs.items).toEqual([{ kind: "first_move", key: "their-contact" }]);
  });
});
