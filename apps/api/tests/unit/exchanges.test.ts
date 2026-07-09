// やり取り台帳 (Gift 一般化) の収支・督促・ハッシュチェーンのユニットテスト。
import { describe, it, expect } from "vitest";
import {
  summarizeExchangeLedger,
  computeExchangeReminders,
  hashExchangeCore,
  verifyExchangeChain,
  type ExchangeRecord,
  type ExchangeCore,
} from "../../src/lib/exchanges.js";

const today = new Date("2026-07-08T12:00:00Z");

function rec(p: Partial<ExchangeRecord>): ExchangeRecord {
  return {
    contactId: "a",
    kind: "gift",
    direction: "outbound",
    value: null,
    status: "done",
    dueAt: null,
    occurredAt: new Date("2026-05-01T00:00:00Z"),
    ...p,
  };
}

describe("summarizeExchangeLedger", () => {
  it("渡した/受け取ったの件数・価値と balance を集計する", () => {
    const l = summarizeExchangeLedger("a", [
      rec({ direction: "outbound", value: 5000, occurredAt: new Date("2026-03-01T00:00:00Z") }),
      rec({ direction: "inbound", value: 3000, occurredAt: new Date("2026-05-01T00:00:00Z") }),
    ]);
    expect(l.outboundCount).toBe(1);
    expect(l.inboundCount).toBe(1);
    expect(l.outboundValue).toBe(5000);
    expect(l.inboundValue).toBe(3000);
    expect(l.balance).toBe(2000);
    // 最後にいただいた (5/1) 方が最後に渡した (3/1) より新しい → 要返し
    expect(l.needsReturn).toBe(true);
  });

  it("canceled は集計から除外し、open は openCount に数える", () => {
    const l = summarizeExchangeLedger("a", [
      rec({ direction: "outbound", value: 1000, status: "canceled" }),
      rec({ direction: "outbound", value: 2000, status: "open" }),
    ]);
    expect(l.outboundCount).toBe(1); // canceled は除外
    expect(l.outboundValue).toBe(2000);
    expect(l.openCount).toBe(1);
  });

  it("受けた後に返していれば needsReturn は false", () => {
    const l = summarizeExchangeLedger("a", [
      rec({ direction: "inbound", occurredAt: new Date("2026-05-01T00:00:00Z") }),
      rec({ direction: "outbound", occurredAt: new Date("2026-05-20T00:00:00Z") }),
    ]);
    expect(l.needsReturn).toBe(false);
  });
});

describe("computeExchangeReminders", () => {
  it("open で期日が lookahead 以内のものを、期限超過を先頭に返す", () => {
    const recs = [
      { ...rec({ status: "open", dueAt: new Date("2026-07-05T00:00:00Z") }), id: "1", title: "本を返す" }, // 3日超過
      { ...rec({ status: "open", dueAt: new Date("2026-07-15T00:00:00Z") }), id: "2", title: "紹介する" }, // あと7日
      { ...rec({ status: "open", dueAt: new Date("2026-09-01T00:00:00Z") }), id: "3", title: "遠い先" }, // lookahead 外
      { ...rec({ status: "done", dueAt: new Date("2026-07-06T00:00:00Z") }), id: "4", title: "完了済み" }, // open でない
    ];
    const out = computeExchangeReminders(recs, today);
    expect(out.map((r) => r.id)).toEqual(["1", "2"]);
    expect(out[0]!.overdue).toBe(true);
    expect(out[1]!.overdue).toBe(false);
    expect(out[1]!.daysUntil).toBe(7);
  });

  it("期日なしの open は督促に出さない", () => {
    const out = computeExchangeReminders(
      [{ ...rec({ status: "open", dueAt: null }), id: "1", title: "期日なし" }],
      today,
    );
    expect(out.length).toBe(0);
  });
});

describe("hashExchangeCore / verifyExchangeChain", () => {
  const core = (p: Partial<ExchangeCore>): ExchangeCore => ({
    ownerUid: "owner1",
    contactId: "a",
    kind: "loan",
    direction: "outbound",
    title: "1万円貸した",
    value: 10000,
    occurredAt: "2026-05-01T00:00:00.000Z",
    ...p,
  });

  it("同じ入力は同じハッシュ、prevHash が違えば別ハッシュ", () => {
    const c = core({});
    expect(hashExchangeCore(null, c)).toBe(hashExchangeCore(null, c));
    expect(hashExchangeCore(null, c)).not.toBe(hashExchangeCore("x", c));
  });

  it("正しく連ねた鎖は intact", () => {
    const c1 = core({ title: "一件目" });
    const h1 = hashExchangeCore(null, c1);
    const c2 = core({ title: "二件目" });
    const h2 = hashExchangeCore(h1, c2);
    const result = verifyExchangeChain([
      { ...c1, hash: h1, prevHash: null },
      { ...c2, hash: h2, prevHash: h1 },
    ]);
    expect(result.intact).toBe(true);
    expect(result.brokenAt).toBeNull();
  });

  it("中核が改ざんされると検出する", () => {
    const c1 = core({ title: "一件目" });
    const h1 = hashExchangeCore(null, c1);
    const c2 = core({ title: "二件目", value: 10000 });
    const h2 = hashExchangeCore(h1, c2);
    // 二件目の value を後から書き換え (hash は据え置き) → 不一致
    const result = verifyExchangeChain([
      { ...c1, hash: h1, prevHash: null },
      { ...c2, value: 999999, hash: h2, prevHash: h1 },
    ]);
    expect(result.intact).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it("hash 未設定 (旧データ) はチェーン対象外として飛ばす", () => {
    const c1 = core({ title: "旧" });
    const c2 = core({ title: "新" });
    const h2 = hashExchangeCore(null, c2);
    const result = verifyExchangeChain([
      { ...c1, hash: null, prevHash: null },
      { ...c2, hash: h2, prevHash: null },
    ]);
    expect(result.intact).toBe(true);
  });
});
