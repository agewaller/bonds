// 宛先の事前検証 (プロバイダ応答の三値分類) の純粋関数テスト
import { describe, it, expect } from "vitest";
import { classifyZeroBounce, classifyNeverBounce, buildEmailVerifier } from "../../src/lib/email-verify.js";

describe("classifyZeroBounce", () => {
  it("valid / invalid 系 / それ以外を三値に分ける", () => {
    expect(classifyZeroBounce("valid")).toBe("valid");
    expect(classifyZeroBounce("invalid")).toBe("invalid");
    expect(classifyZeroBounce("spamtrap")).toBe("invalid");
    expect(classifyZeroBounce("abuse")).toBe("invalid");
    expect(classifyZeroBounce("do_not_mail")).toBe("invalid");
    expect(classifyZeroBounce("catch-all")).toBe("unknown");
    expect(classifyZeroBounce("unknown")).toBe("unknown");
    expect(classifyZeroBounce(undefined)).toBe("unknown");
  });
});

describe("classifyNeverBounce", () => {
  it("valid / invalid 系 / それ以外を三値に分ける", () => {
    expect(classifyNeverBounce("valid")).toBe("valid");
    expect(classifyNeverBounce("invalid")).toBe("invalid");
    expect(classifyNeverBounce("disposable")).toBe("invalid");
    expect(classifyNeverBounce("catchall")).toBe("unknown");
    expect(classifyNeverBounce(123)).toBe("unknown");
  });
});

describe("buildEmailVerifier", () => {
  it("鍵が未設定・番兵値なら null (検証なしで従来どおり)", () => {
    delete process.env.EMAIL_VERIFY_API_KEY;
    expect(buildEmailVerifier()).toBeNull();
    process.env.EMAIL_VERIFY_API_KEY = "unset";
    expect(buildEmailVerifier()).toBeNull();
    delete process.env.EMAIL_VERIFY_API_KEY;
  });
});
