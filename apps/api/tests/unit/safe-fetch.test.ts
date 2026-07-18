// SSRF 対策つき取得の検証。内部IP拒否・スキーム・リダイレクト再検証・サイズ上限。
import { describe, it, expect } from "vitest";
import { isBlockedIp, assertPublicHttpsUrl, safeFetchText } from "../../src/lib/safe-fetch.js";

describe("isBlockedIp", () => {
  it("内部・特殊用途の IPv4 を拒否する", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "172.31.255.255", "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });
  it("グローバル IPv4 は許可する", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "142.250.72.14", "172.15.0.1", "172.32.0.1"]) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });
  it("内部 IPv6 を拒否する", () => {
    for (const ip of ["::1", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
  });
});

describe("assertPublicHttpsUrl", () => {
  const resolveTo = (addr: string) => async () => [addr];

  it("https 以外は拒否", async () => {
    const r = await assertPublicHttpsUrl("http://example.com/x.ics", resolveTo("8.8.8.8"));
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toBe("not_https");
  });
  it("内部IPに解決されるホストを拒否 (DNSリバインディング対策)", async () => {
    const r = await assertPublicHttpsUrl("https://evil.example/x.ics", resolveTo("169.254.169.254"));
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toBe("blocked_ip");
  });
  it("ホスト名がそのまま内部IPでも拒否", async () => {
    const r = await assertPublicHttpsUrl("https://127.0.0.1/x.ics", resolveTo("8.8.8.8"));
    expect(r.ok).toBe(false);
  });
  it("グローバルに解決されれば許可", async () => {
    const r = await assertPublicHttpsUrl("https://calendar.example/basic.ics", resolveTo("142.250.72.14"));
    expect(r.ok).toBe(true);
  });
});

describe("safeFetchText", () => {
  const global142 = async () => ["142.250.72.14"];

  it("内部IPへ向く URL は取得前に弾く", async () => {
    await expect(
      safeFetchText("https://attacker.example/x.ics", {
        resolver: async () => ["10.0.0.1"],
        fetchImpl: (async () => new Response("BEGIN:VCALENDAR")) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/ics_fetch_blocked/);
  });

  it("リダイレクト先が内部IPなら追従せず弾く", async () => {
    let call = 0;
    const fetchImpl = (async (url: string) => {
      call++;
      if (call === 1) return new Response(null, { status: 302, headers: { location: "https://internal.example/x" } });
      throw new Error("should not fetch second hop through normal path");
    }) as unknown as typeof fetch;
    const resolver = async (host: string) => (host === "internal.example" ? ["169.254.169.254"] : ["142.250.72.14"]);
    await expect(
      safeFetchText("https://start.example/x.ics", { resolver, fetchImpl }),
    ).rejects.toThrow(/ics_fetch_blocked/);
  });

  it("サイズ上限を超える本文は打ち切って例外", async () => {
    const big = "B".repeat(10);
    const fetchImpl = (async () =>
      new Response(big, { status: 200, headers: { "content-length": "10" } })) as unknown as typeof fetch;
    await expect(
      safeFetchText("https://calendar.example/basic.ics", { resolver: global142, fetchImpl, maxBytes: 5 }),
    ).rejects.toThrow(/too_large/);
  });

  it("正常な https + グローバルIP + 小さい本文は取得できる", async () => {
    const fetchImpl = (async () =>
      new Response("BEGIN:VCALENDAR\nEND:VCALENDAR", { status: 200 })) as unknown as typeof fetch;
    const text = await safeFetchText("https://calendar.example/basic.ics", { resolver: global142, fetchImpl });
    expect(text).toContain("VCALENDAR");
  });
});
