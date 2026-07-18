// レートリミッタと定数時間比較のユニットテスト。
import { describe, it, expect } from "vitest";
import { RateLimiter, clientKey } from "../../src/lib/rate-limit.js";
import { secretEquals } from "../../src/lib/auth.js";

describe("RateLimiter", () => {
  it("窓内は上限まで許可し、超えると拒否。窓が明けると回復する", () => {
    let now = 1000;
    const rl = new RateLimiter(3, 100, () => now);
    expect(rl.take("a")).toBe(true);
    expect(rl.take("a")).toBe(true);
    expect(rl.take("a")).toBe(true);
    expect(rl.take("a")).toBe(false); // 4 回目は拒否
    // 別キーは独立
    expect(rl.take("b")).toBe(true);
    // 窓が明ければ回復
    now += 100;
    expect(rl.take("a")).toBe(true);
  });
});

describe("clientKey", () => {
  it("x-forwarded-for の先頭を使う", () => {
    const h = { get: (n: string) => (n === "x-forwarded-for" ? "1.2.3.4, 5.6.7.8" : null) };
    expect(clientKey(h)).toBe("1.2.3.4");
  });
  it("無ければ unknown", () => {
    expect(clientKey({ get: () => null })).toBe("unknown");
  });
});

describe("secretEquals (定数時間比較)", () => {
  it("一致で true、不一致・長さ違い・空で false", () => {
    expect(secretEquals("abc", "abc")).toBe(true);
    expect(secretEquals("abc", "abd")).toBe(false);
    expect(secretEquals("abc", "abcd")).toBe(false);
    expect(secretEquals("", "")).toBe(false);
    expect(secretEquals(undefined, "abc")).toBe(false);
    expect(secretEquals("abc", undefined)).toBe(false);
  });
});
