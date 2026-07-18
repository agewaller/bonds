// SSRF 対策つきの外部取得 — ユーザー/ゲストが指定した URL (ICS 購読アドレス等) を
// サーバから取得するときの安全な fetch。純粋な検証部はユニットテスト対象。
//
// 守ること:
// 1. https のみ (スキーム前置チェック)。
// 2. リダイレクトを自動追従しない (redirect:"manual")。各ホップを同じ規則で再検証する
//    ため、追従は自前で行い、リダイレクト先が内部宛でも弾ける。
// 3. 解決した IP がプライベート/ループバック/リンクローカル/ULA/メタデータ宛なら拒否
//    (DNS リバインディング対策として、接続前にホスト名を解決して IP で判定する)。
// 4. レスポンスのバイト上限を設けて途中で打ち切る (巨大ファイルでのメモリ枯渇 DoS 防止)。
// 5. タイムアウト。
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const MAX_REDIRECTS = 3;
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5MB
export const DEFAULT_TIMEOUT_MS = 15_000;

/** IPv4/IPv6 文字列が「内部・特殊用途」帯かどうか。true なら取得を拒否する。 */
export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = p as [number, number, number, number];
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10/8 private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local (メタデータ含む)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
    if (a === 192 && b === 168) return true; // 192.168/16 private
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true; // loopback / unspecified
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
    if (lower.startsWith("ff")) return true; // multicast
    // IPv4-mapped (::ffff:a.b.c.d) は埋め込み IPv4 で判定
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]!);
    return false;
  }
  return true; // パースできない = 拒否
}

/** URL を検証し、ホスト名を解決して内部宛でないことを確かめる。問題があれば理由文字列を返す。 */
export async function assertPublicHttpsUrl(
  raw: string,
  resolver: (host: string) => Promise<string[]> = defaultResolve,
): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "not_https" };
  const host = url.hostname;
  // ホスト名がそのまま IP のこともある
  if (isIP(host)) {
    return isBlockedIp(host) ? { ok: false, reason: "blocked_ip" } : { ok: true, url };
  }
  let ips: string[];
  try {
    ips = await resolver(host);
  } catch {
    return { ok: false, reason: "dns_failed" };
  }
  if (ips.length === 0) return { ok: false, reason: "dns_empty" };
  // 一つでも内部宛に解決されるなら拒否 (リバインディング対策)
  if (ips.some(isBlockedIp)) return { ok: false, reason: "blocked_ip" };
  return { ok: true, url };
}

async function defaultResolve(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true });
  return records.map((r) => r.address);
}

export type SafeFetchOptions = {
  maxBytes?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  resolver?: (host: string) => Promise<string[]>;
};

/**
 * SSRF 対策つきで URL を取得し、本文をテキストで返す。
 * リダイレクトは手動で最大 MAX_REDIRECTS 回まで、各ホップを再検証する。
 * バイト上限を超えたら途中で打ち切って例外にする。
 */
export async function safeFetchText(raw: string, opts: SafeFetchOptions = {}): Promise<string> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = opts.fetchImpl ?? fetch;
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = await assertPublicHttpsUrl(current, opts.resolver);
    if (!checked.ok) throw new Error(`ics_fetch_blocked: ${checked.reason}`);
    const res = await doFetch(checked.url.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    // 3xx は自前で追従 (次ループで再検証)
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("ics_fetch_failed: redirect_no_location");
      current = new URL(loc, checked.url).toString();
      continue;
    }
    if (!res.ok) throw new Error(`ics_fetch_failed: ${res.status}`);
    return await readCapped(res, maxBytes);
  }
  throw new Error("ics_fetch_failed: too_many_redirects");
}

/** レスポンス本文を上限バイトまで読む。超えたら例外。 */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("ics_fetch_failed: too_large");
  }
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("ics_fetch_failed: too_large");
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks).toString("utf-8");
}
