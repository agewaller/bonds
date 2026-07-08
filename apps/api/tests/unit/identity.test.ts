import { describe, it, expect } from "vitest";
import { normalizeEmail, normalizePhone, normalizeName, identityKeys, strongMatch } from "../../src/lib/identity.js";

describe("名寄せの正規化", () => {
  it("メールは小文字・トリム", () => {
    expect(normalizeEmail("  Taro@Example.COM ")).toBe("taro@example.com");
    expect(normalizeEmail(null)).toBe("");
  });
  it("電話は数字化・+81 は 0 に寄せる", () => {
    expect(normalizePhone("090-1234-5678")).toBe("09012345678");
    expect(normalizePhone("+81 90 1234 5678")).toBe("09012345678");
    expect(normalizePhone("(03) 1111-2222")).toBe("0311112222");
  });
  it("名前は敬称除去・空白詰め・小文字", () => {
    expect(normalizeName("田中 一郎 さん")).toBe("田中一郎");
    expect(normalizeName("田中一郎")).toBe("田中一郎");
    expect(normalizeName("John  Smith")).toBe("johnsmith");
  });
});

describe("identityKeys / strongMatch", () => {
  it("短すぎる電話番号はキーにしない (内線などの誤結合防止)", () => {
    expect(identityKeys({ phone: "123" }).phone).toBeUndefined();
    expect(identityKeys({ phone: "0312345678" }).phone).toBe("0312345678");
  });
  it("メール一致・電話一致は同一人物 (名前が違っても)", () => {
    expect(strongMatch({ name: "田中", email: "a@x.com" }, { name: "田中一郎", email: "A@X.com" })).toBe(true);
    expect(strongMatch({ name: "田中", phone: "090-1111-2222" }, { name: "違う名前", phone: "09011112222" })).toBe(true);
  });
  it("名前だけの一致は strongMatch では同一人物にしない (同姓同名の別人がいる)", () => {
    expect(strongMatch({ name: "田中一郎" }, { name: "田中一郎" })).toBe(false);
  });
});
