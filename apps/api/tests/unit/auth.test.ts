import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { authorizeAdmin, authorizeUser, type VerifyIdTokenFn } from "../../src/lib/auth.js";

const savedEnv = { ...process.env };
beforeEach(() => {
  process.env.ADMIN_BREAKGLASS_TOKEN = "bg-token";
  process.env.OWNER_EMAIL = "agewaller@gmail.com";
});
afterEach(() => {
  process.env.ADMIN_BREAKGLASS_TOKEN = savedEnv.ADMIN_BREAKGLASS_TOKEN;
  process.env.OWNER_EMAIL = savedEnv.OWNER_EMAIL;
});

const verifierFor = (t: Awaited<ReturnType<VerifyIdTokenFn>>): VerifyIdTokenFn => async () => t;

describe("authorizeAdmin (三段フェイルセーフ)", () => {
  it("経路1: custom claim admin:true で許可", async () => {
    const r = await authorizeAdmin(
      { authorization: "Bearer x" },
      { verifyIdToken: verifierFor({ uid: "u1", admin: true }) },
    );
    expect(r).toEqual({ ok: true, actor: "firebase:u1" });
  });

  it("経路2: OWNER_EMAIL かつ password provider で許可 (大文字小文字/空白を吸収)", async () => {
    const r = await authorizeAdmin(
      { authorization: "Bearer x" },
      { verifyIdToken: verifierFor({ uid: "u2", email: " Agewaller@Gmail.com ", signInProvider: "password" }) },
    );
    expect(r).toEqual({ ok: true, actor: "owner:agewaller@gmail.com" });
  });

  it("OWNER は Google ログインでも管理者 (BFF 匿名フォールバック廃止に伴いオーナーはログインで管理画面に入る)", async () => {
    const r = await authorizeAdmin(
      { authorization: "Bearer x" },
      { verifyIdToken: verifierFor({ uid: "u3", email: "agewaller@gmail.com", signInProvider: "google.com" }) },
    );
    expect(r.ok).toBe(true);
  });

  it("経路3: break-glass トークンで許可 (Firebase 不在でも管理者をロックアウトしない)", async () => {
    const r = await authorizeAdmin({ adminToken: "bg-token" }, { verifyIdToken: null });
    expect(r).toEqual({ ok: true, actor: "breakglass" });
    const wrong = await authorizeAdmin({ adminToken: "wrong" }, { verifyIdToken: null });
    expect(wrong.ok).toBe(false);
  });

  it("トークン検証の例外は 401 (500 にしない)", async () => {
    const boom: VerifyIdTokenFn = async () => {
      throw new Error("expired");
    };
    const r = await authorizeAdmin({ authorization: "Bearer x" }, { verifyIdToken: boom });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it("一般ユーザーの有効トークンは 401 (admin でも owner でもない)", async () => {
    const r = await authorizeAdmin(
      { authorization: "Bearer x" },
      { verifyIdToken: verifierFor({ uid: "u4", email: "someone@example.com", signInProvider: "password" }) },
    );
    expect(r.ok).toBe(false);
  });

  it("完全未設定 (breakglass 無し・verifier 無し) は fail closed 503", async () => {
    delete process.env.ADMIN_BREAKGLASS_TOKEN;
    const r = await authorizeAdmin({}, { verifyIdToken: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(503);
  });
});

describe("authorizeUser (関係性ユーザー + isOwner)", () => {
  it("break-glass は owner スコープ・isOwner=true (単一オーナー時代の互換)", async () => {
    const r = await authorizeUser({ adminToken: "bg-token" }, { verifyIdToken: null });
    expect(r).toEqual({ ok: true, ownerUid: "owner", actor: "breakglass", isOwner: true });
  });

  it("OWNER_EMAIL 本人は owner スコープ + isOwner=true (既存の owner データに到達する)", async () => {
    const r = await authorizeUser(
      { authorization: "Bearer x" },
      { verifyIdToken: verifierFor({ uid: "owner-uid", email: "AGEWALLER@gmail.com" }) },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ownerUid).toBe("owner"); // uid ではなく "owner" バケツにマップ
      expect(r.isOwner).toBe(true);
    }
  });

  it("custom claim admin:true も isOwner=true", async () => {
    const r = await authorizeUser(
      { authorization: "Bearer x" },
      { verifyIdToken: verifierFor({ uid: "admin-uid", admin: true }) },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.isOwner).toBe(true);
  });

  it("一般ユーザーは自分の uid スコープ・isOwner=false (月次上限が効く側)", async () => {
    const r = await authorizeUser(
      { authorization: "Bearer x" },
      { verifyIdToken: verifierFor({ uid: "user-123", email: "someone@example.com" }) },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ownerUid).toBe("user-123");
      expect(r.isOwner).toBe(false);
    }
  });

  it("トークン検証の例外は 401", async () => {
    const boom: VerifyIdTokenFn = async () => {
      throw new Error("expired");
    };
    const r = await authorizeUser({ authorization: "Bearer x" }, { verifyIdToken: boom });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it("完全未設定は fail closed 503", async () => {
    delete process.env.ADMIN_BREAKGLASS_TOKEN;
    const r = await authorizeUser({}, { verifyIdToken: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(503);
  });

  it("ログイン済み (Bearer) なのに検証器が無ければ 503 で理由を返す (黙って 401 にしない)", async () => {
    const r = await authorizeUser({ authorization: "Bearer x" }, { verifyIdToken: null });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(503);
      expect(r.detail).toContain("FIREBASE_PROJECT_ID");
    }
  });

  it("トークン検証エラーの理由 (aud 不一致など) を detail に含める", async () => {
    const boom: VerifyIdTokenFn = async () => {
      throw Object.assign(new Error("Firebase ID token has incorrect \"aud\" (audience) claim."), {
        code: "auth/argument-error",
      });
    };
    const r = await authorizeUser({ authorization: "Bearer x" }, { verifyIdToken: boom });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.detail).toContain("auth/argument-error");
      expect(r.detail).toContain("aud");
    }
  });
});
