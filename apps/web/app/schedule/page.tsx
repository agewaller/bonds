"use client";
// 日程調整と時間の出品の管理 — 空き時間の設定 / 共有リンク / 出品 / 予約を一箇所に。
// timeshare の概念 (共有リンク・提案の承認・スポット販売) を bonds の型で新規実装した画面。
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Fold from "../../components/Fold";
import { apiFetch } from "../../lib/client-api";
import { AuthBar } from "../../components/AuthBar";

type Availability = {
  days: Record<string, { enabled: boolean; startHour: number; startMinute: number; endHour: number; endMinute: number }>;
  bufferMinutes: number;
  minMinutes: number;
};
type ShareRow = {
  id: string;
  url: string;
  title: string;
  method: string;
  periodStart: string;
  periodEnd: string;
  slotMinutes: number;
  hasPassword: boolean;
  pendingProposals: number;
  acceptedProposals: number;
};
type Proposal = {
  id: string;
  guestName: string;
  guestContact: string | null;
  message: string | null;
  candidates: { start: string; end: string }[];
  status: string;
  decidedSlot: { start: string; end: string } | null;
  createdAt: string;
};
type ShareDetail = ShareRow & {
  proposals: Proposal[];
  participants: { id: string; name: string; updatedAt: string }[];
};
type OfferRow = {
  id: string;
  url: string;
  title: string;
  description: string;
  method: string;
  minutes: number;
  priceJpy: number;
  active: boolean;
  confirmedBookings: number;
};
type BookingRow = {
  id: string;
  guestName: string;
  guestContact: string | null;
  message: string | null;
  slot: { start: string; end: string };
  status: string;
  amountJpy: number;
  createdAt: string;
  offer: { title: string };
};

const input: React.CSSProperties = {
  padding: "8px 10px",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  fontSize: 14,
  boxSizing: "border-box",
};
const btn = (primary = true): React.CSSProperties => ({
  padding: "8px 16px",
  borderRadius: 8,
  border: primary ? "none" : "1px solid #cbd5e1",
  background: primary ? "#2563eb" : "#fff",
  color: primary ? "#fff" : "#334155",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
});

const WD = ["日", "月", "火", "水", "木", "金", "土"];
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_LABEL: Record<string, string> = { mon: "月", tue: "火", wed: "水", thu: "木", fri: "金", sat: "土", sun: "日" };
const fmt = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]}) ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const METHOD_LABEL: Record<string, string> = { meeting: "お会いして", online: "オンラインで", phone: "お電話で" };
const BOOKING_LABEL: Record<string, string> = {
  pending_payment: "お支払い待ち",
  confirmed: "確定",
  canceled: "取り消し",
  expired: "期限切れ",
};

export default function SchedulePage() {
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [avail, setAvail] = useState<Availability | null>(null);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [detail, setDetail] = useState<ShareDetail | null>(null);
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [paymentsReady, setPaymentsReady] = useState(false);
  const [bookings, setBookings] = useState<BookingRow[]>([]);

  // 共有リンクの作成フォーム
  const [sTitle, setSTitle] = useState("");
  const [sName, setSName] = useState("");
  const [sMethod, setSMethod] = useState("meeting");
  const [sDays, setSDays] = useState(14);
  const [sMinutes, setSMinutes] = useState(60);
  const [sNote, setSNote] = useState("");
  const [sPassword, setSPassword] = useState("");
  const [createdUrl, setCreatedUrl] = useState("");

  // 出品の作成フォーム
  const [oTitle, setOTitle] = useState("");
  const [oName, setOName] = useState("");
  const [oMinutes, setOMinutes] = useState(60);
  const [oPrice, setOPrice] = useState(0);
  const [oDesc, setODesc] = useState("");

  const call = useCallback(async (path: string, init?: RequestInit, okNotice?: string) => {
    setError("");
    const res = await apiFetch(path, init);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError((body as { detail?: string } | null)?.detail ?? "うまくいきませんでした。時間をおいてお試しください");
      return null;
    }
    if (okNotice) setNotice(okNotice);
    return body;
  }, []);

  const load = useCallback(async () => {
    const [a, s, o, b] = await Promise.all([
      apiFetch("relationship/availability").then((r) => (r.ok ? r.json() : null)),
      apiFetch("schedule/shares").then((r) => (r.ok ? r.json() : null)),
      apiFetch("schedule/offers").then((r) => (r.ok ? r.json() : null)),
      apiFetch("schedule/bookings").then((r) => (r.ok ? r.json() : null)),
    ]);
    if (a) setAvail(a as Availability);
    if (s) setShares((s as { shares: ShareRow[] }).shares);
    if (o) {
      setOffers((o as { offers: OfferRow[] }).offers);
      setPaymentsReady((o as { paymentsReady: boolean }).paymentsReady);
    }
    if (b) setBookings((b as { bookings: BookingRow[] }).bookings);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveAvailability = async () => {
    if (!avail) return;
    const body = await call("relationship/availability", {
      method: "PUT",
      body: JSON.stringify(avail),
    }, "空き時間の設定を保存しました");
    if (body) setAvail(body as Availability);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("コピーしました。メールなどに貼ってお使いください");
    } catch {
      setError("コピーできませんでした。リンクを長押し・右クリックでコピーしてください");
    }
  };

  const createShare = async () => {
    const body = await call("schedule/shares", {
      method: "POST",
      body: JSON.stringify({
        title: sTitle,
        displayName: sName,
        method: sMethod,
        periodDays: sDays,
        slotMinutes: sMinutes,
        note: sNote,
        password: sPassword || undefined,
      }),
    }, "日程調整のページを作りました");
    if (body) {
      setCreatedUrl((body as { url: string }).url);
      await load();
    }
  };

  const openDetail = async (id: string) => {
    const body = await call(`schedule/shares/${id}`);
    if (body) setDetail(body as ShareDetail);
  };

  const downloadIcs = (ics: string) => {
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "meeting.ics";
    a.click();
    URL.revokeObjectURL(url);
  };

  const accept = async (shareId: string, pid: string, start: string) => {
    const body = await call(`schedule/shares/${shareId}/proposals/${pid}/accept`, {
      method: "POST",
      body: JSON.stringify({ start }),
    }, "日程が決まりました。カレンダーの予定も保存できます");
    if (body) {
      if ((body as { ics?: string }).ics) downloadIcs((body as { ics: string }).ics);
      await openDetail(shareId);
      await load();
    }
  };

  const decline = async (shareId: string, pid: string) => {
    const body = await call(`schedule/shares/${shareId}/proposals/${pid}/decline`, { method: "POST", body: "{}" });
    if (body) {
      await openDetail(shareId);
      await load();
    }
  };

  const createOffer = async () => {
    const body = await call("schedule/offers", {
      method: "POST",
      body: JSON.stringify({ title: oTitle, displayName: oName, minutes: oMinutes, priceJpy: oPrice, description: oDesc }),
    }, "出品を作りました");
    if (body) {
      setOTitle("");
      setODesc("");
      await load();
    }
  };

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "40px 16px" }}>
      <AuthBar />
      <p><Link href="/contacts" style={{ color: "#2563eb" }}>連絡帳へ戻る</Link></p>
      <h1 style={{ fontSize: 24 }}>日程調整と時間の受け付け</h1>
      <p style={{ color: "#64748b", lineHeight: 1.8 }}>
        空いている時間を相手に選んでもらうページと、お時間の受け付け (無料・有料) をここで作れます。
        相手はアカウントなしで開けます。見えるのは空いている枠だけで、予定の中身は見えません。
      </p>

      {notice && <p style={{ color: "#166534", background: "#f0fdf4", padding: 8, borderRadius: 8 }}>{notice}</p>}
      {error && <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>{error}</p>}

      <Fold k="sc1" title={<>空き時間の設定 (受け付ける曜日と時間)</>} style={{ marginTop: 20, border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px" }}>
        {!avail && <p>読み込んでいます…</p>}
        {avail && (
          <div>
            <p style={{ color: "#64748b", fontSize: 13, lineHeight: 1.7, margin: "4px 0 10px" }}>
              ここで決めた時間の中から、予定の入っていない枠だけが相手に見えます。予定表の連携は各連絡先の
              「お会いする日を探す」か、この設定と同じように使われます。
            </p>
            {DAY_KEYS.map((k) => {
              const d = avail.days[k]!;
              const set = (patch: Partial<typeof d>) =>
                setAvail({ ...avail, days: { ...avail.days, [k]: { ...d, ...patch } } });
              return (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0" }}>
                  <label style={{ width: 90, display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" checked={d.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
                    {DAY_LABEL[k]}曜日
                  </label>
                  {d.enabled ? (
                    <>
                      <input type="number" min={0} max={23} style={{ ...input, width: 64 }} value={d.startHour}
                        onChange={(e) => set({ startHour: Number(e.target.value) })} aria-label={`${DAY_LABEL[k]}曜日の開始`} />
                      <span>時から</span>
                      <input type="number" min={0} max={24} style={{ ...input, width: 64 }} value={d.endHour}
                        onChange={(e) => set({ endHour: Number(e.target.value) })} aria-label={`${DAY_LABEL[k]}曜日の終了`} />
                      <span>時まで</span>
                    </>
                  ) : (
                    <span style={{ color: "#94a3b8" }}>受け付けない</span>
                  )}
                </div>
              );
            })}
            <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
              <label>
                予定の前後にあける余白
                <input type="number" min={0} max={120} style={{ ...input, width: 70, marginLeft: 6 }} value={avail.bufferMinutes}
                  onChange={(e) => setAvail({ ...avail, bufferMinutes: Number(e.target.value) })} aria-label="余白の分数" />
                分
              </label>
              <label>
                これより短い空きは出さない
                <input type="number" min={15} max={480} style={{ ...input, width: 70, marginLeft: 6 }} value={avail.minMinutes}
                  onChange={(e) => setAvail({ ...avail, minMinutes: Number(e.target.value) })} aria-label="最低の分数" />
                分
              </label>
              <button style={btn()} onClick={() => void saveAvailability()}>保存する</button>
            </div>
          </div>
        )}
      </Fold>

      <Fold k="sc2" title={<>日程を選んでもらうページ {shares.reduce((n, s) => n + s.pendingProposals, 0) > 0 ? `(お返事待ち ${shares.reduce((n, s) => n + s.pendingProposals, 0)} 件)` : ""}</>} style={{ marginTop: 20, border: "1px solid #bae6fd", background: "#f0f9ff", borderRadius: 12, padding: "14px 16px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0" }}>
          <input style={{ ...input, flex: "1 1 180px" }} placeholder="見出し (例: お打ち合わせの候補)" value={sTitle} onChange={(e) => setSTitle(e.target.value)} aria-label="見出し" />
          <input style={{ ...input, width: 140 }} placeholder="名乗り (例: 山田)" value={sName} onChange={(e) => setSName(e.target.value)} aria-label="名乗り" />
          <select style={{ ...input, width: "auto" }} value={sMethod} onChange={(e) => setSMethod(e.target.value)} aria-label="会い方">
            <option value="meeting">お会いして</option>
            <option value="online">オンラインで</option>
            <option value="phone">お電話で</option>
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            これから
            <input type="number" min={1} max={90} style={{ ...input, width: 64 }} value={sDays} onChange={(e) => setSDays(Number(e.target.value))} aria-label="期間の日数" />
            日ぶん
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input type="number" min={15} max={240} step={15} style={{ ...input, width: 64 }} value={sMinutes} onChange={(e) => setSMinutes(Number(e.target.value))} aria-label="面談の分数" />
            分の面談
          </label>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 8px" }}>
          <input style={{ ...input, flex: "1 1 260px" }} placeholder="相手へのひとこと (任意)" value={sNote} onChange={(e) => setSNote(e.target.value)} aria-label="相手へのひとこと" />
          <input style={{ ...input, width: 180 }} placeholder="あいことば (任意)" value={sPassword} onChange={(e) => setSPassword(e.target.value)} aria-label="あいことば" />
          <button style={btn()} onClick={() => void createShare()}>ページを作る</button>
        </div>
        {createdUrl && (
          <p style={{ background: "#fff", padding: 8, borderRadius: 8 }}>
            できました: <span style={{ wordBreak: "break-all" }}>{createdUrl}</span>{" "}
            <button style={{ ...btn(false), padding: "4px 10px", fontSize: 13 }} onClick={() => void copy(createdUrl)}>リンクをコピー</button>
          </p>
        )}

        {shares.length === 0 && <p style={{ color: "#64748b" }}>まだありません。上から作って、リンクを相手に送ってください。</p>}
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {shares.map((s) => (
            <li key={s.id} style={{ borderTop: "1px solid #e0f2fe", padding: "8px 0" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <span style={{ fontWeight: 600 }}>{s.title || "お会いする日時のご相談"}</span>
                <span style={{ color: "#64748b", fontSize: 13 }}>
                  {METHOD_LABEL[s.method] ?? s.method}・{s.slotMinutes}分・{fmt(s.periodStart).split(" ")[0]}から{fmt(s.periodEnd).split(" ")[0]}まで
                  {s.hasPassword ? "・あいことばつき" : ""}
                </span>
                {s.pendingProposals > 0 && (
                  <span style={{ background: "#dbeafe", color: "#1d4ed8", borderRadius: 999, padding: "2px 10px", fontSize: 13 }}>
                    お返事待ち {s.pendingProposals} 件
                  </span>
                )}
                <span style={{ flex: 1 }} />
                <button style={{ ...btn(false), padding: "4px 10px", fontSize: 13 }} onClick={() => void copy(s.url)}>リンクをコピー</button>
                <button style={{ ...btn(false), padding: "4px 10px", fontSize: 13 }} onClick={() => void openDetail(s.id)}>提案を見る</button>
                <button
                  style={{ ...btn(false), padding: "4px 10px", fontSize: 13, color: "#b91c1c" }}
                  onClick={async () => {
                    const body = await call(`schedule/shares/${s.id}`, { method: "DELETE" }, "このページを削除しました");
                    if (body) {
                      if (detail?.id === s.id) setDetail(null);
                      await load();
                    }
                  }}
                >
                  削除
                </button>
              </div>
              {detail?.id === s.id && (
                <div style={{ marginTop: 8, background: "#fff", borderRadius: 8, padding: "8px 12px" }}>
                  {detail.participants.length > 0 && (
                    <p style={{ margin: "2px 0 6px", color: "#166534", fontSize: 13 }}>
                      予定表を重ねている方: {detail.participants.map((p) => p.name).join("さん、")}さん
                      (このページはみんなの共通の空きだけを表示しています)
                    </p>
                  )}
                  {detail.proposals.length === 0 && <p style={{ margin: 4, color: "#64748b" }}>まだ提案は届いていません。</p>}
                  {detail.proposals.map((p) => (
                    <div key={p.id} style={{ borderBottom: "1px solid #f1f5f9", padding: "6px 0" }}>
                      <p style={{ margin: "2px 0" }}>
                        <strong>{p.guestName}</strong> さん
                        {p.guestContact ? ` (${p.guestContact})` : ""}
                        {p.status === "accepted" && p.decidedSlot ? ` — ${fmt(p.decidedSlot.start)} で確定` : ""}
                        {p.status === "declined" ? " — 見送り" : ""}
                      </p>
                      {p.message && <p style={{ margin: "2px 0", color: "#475569" }}>{p.message}</p>}
                      {p.status === "proposed" && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "4px 0" }}>
                          {p.candidates.map((cand) => (
                            <button key={cand.start} style={{ ...btn(false), fontSize: 13 }} onClick={() => void accept(s.id, p.id, cand.start)}>
                              {fmt(cand.start)} で決める
                            </button>
                          ))}
                          <button style={{ ...btn(false), fontSize: 13, color: "#b91c1c" }} onClick={() => void decline(s.id, p.id)}>
                            見送る
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Fold>

      <Fold k="sc3" title={<>お時間の受け付け (無料・有料の出品)</>} style={{ marginTop: 20, border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px" }}>
        {!paymentsReady && (
          <p style={{ background: "#fef9c3", padding: 8, borderRadius: 8, fontSize: 13, lineHeight: 1.7 }}>
            有料の受け付けは、お支払いの設定 (設定手順書にあります) が済むまで準備中です。無料の受け付けはいまも使えます。
          </p>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0" }}>
          <input style={{ ...input, flex: "1 1 200px" }} placeholder="名前 (例: 30分のご相談)" value={oTitle} onChange={(e) => setOTitle(e.target.value)} aria-label="出品の名前" />
          <input style={{ ...input, width: 140 }} placeholder="名乗り" value={oName} onChange={(e) => setOName(e.target.value)} aria-label="出品の名乗り" />
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input type="number" min={15} max={480} step={15} style={{ ...input, width: 64 }} value={oMinutes} onChange={(e) => setOMinutes(Number(e.target.value))} aria-label="出品の分数" />
            分
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input type="number" min={0} max={1000000} step={500} style={{ ...input, width: 90 }} value={oPrice} onChange={(e) => setOPrice(Number(e.target.value))} aria-label="金額" />
            円 (0 = 無料)
          </label>
          <button style={btn()} onClick={() => void createOffer()}>出品する</button>
        </div>
        <textarea style={{ ...input, width: "100%" }} rows={2} placeholder="説明 (任意。どんな相談にのれるか等)" value={oDesc} onChange={(e) => setODesc(e.target.value)} aria-label="出品の説明" />

        <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
          {offers.map((o) => (
            <li key={o.id} style={{ borderTop: "1px solid #f1f5f9", padding: "8px 0", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <span style={{ fontWeight: 600 }}>{o.title}</span>
              <span style={{ color: "#64748b", fontSize: 13 }}>
                {METHOD_LABEL[o.method] ?? o.method}・{o.minutes}分・{o.priceJpy > 0 ? `${o.priceJpy.toLocaleString()}円` : "無料"}
                {o.confirmedBookings > 0 ? `・確定 ${o.confirmedBookings} 件` : ""}
                {o.active ? "" : "・停止中"}
              </span>
              <span style={{ flex: 1 }} />
              <button style={{ ...btn(false), padding: "4px 10px", fontSize: 13 }} onClick={() => void copy(o.url)}>リンクをコピー</button>
              <button
                style={{ ...btn(false), padding: "4px 10px", fontSize: 13 }}
                onClick={async () => {
                  const body = await call(`schedule/offers/${o.id}`, { method: "PUT", body: JSON.stringify({ active: !o.active }) }, o.active ? "受け付けを止めました" : "受け付けを再開しました");
                  if (body) await load();
                }}
              >
                {o.active ? "止める" : "再開する"}
              </button>
              <button
                style={{ ...btn(false), padding: "4px 10px", fontSize: 13, color: "#b91c1c" }}
                onClick={async () => {
                  const body = await call(`schedule/offers/${o.id}`, { method: "DELETE" }, "出品を削除しました");
                  if (body) await load();
                }}
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      </Fold>

      <Fold k="sc4" title={<>予約 ({bookings.filter((b) => b.status === "confirmed").length} 件確定)</>} style={{ marginTop: 20, border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px" }}>
        {bookings.length === 0 && <p style={{ color: "#64748b" }}>まだ予約はありません。</p>}
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {bookings.map((b) => (
            <li key={b.id} style={{ borderTop: "1px solid #f1f5f9", padding: "8px 0" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <span style={{ fontWeight: 600 }}>{b.guestName}</span>
                <span style={{ color: "#64748b", fontSize: 13 }}>
                  {b.offer.title}・{fmt(b.slot.start)}・{b.amountJpy > 0 ? `${b.amountJpy.toLocaleString()}円` : "無料"}・
                  {BOOKING_LABEL[b.status] ?? b.status}
                </span>
                <span style={{ flex: 1 }} />
                {(b.status === "confirmed" || b.status === "pending_payment") && (
                  <button
                    style={{ ...btn(false), padding: "4px 10px", fontSize: 13, color: "#b91c1c" }}
                    onClick={async () => {
                      const body = await call(`schedule/bookings/${b.id}/cancel`, { method: "POST", body: "{}" }, "予約を取り消しました。返金が必要な場合は設定手順書をご覧ください");
                      if (body) await load();
                    }}
                  >
                    取り消す
                  </button>
                )}
              </div>
              {(b.guestContact || b.message) && (
                <p style={{ margin: "2px 0", color: "#475569", fontSize: 13 }}>
                  {b.guestContact ? `連絡先: ${b.guestContact} ` : ""}
                  {b.message ? `／ ${b.message}` : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Fold>
    </main>
  );
}
