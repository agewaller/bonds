"use client";
// 日程調整と時間の出品の管理 — 空き時間の設定 / 共有リンク / 出品 / 予約を一箇所に。
// timeshare の概念 (共有リンク・提案の承認・スポット販売) を bonds の型で新規実装した画面。
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Fold from "../../components/Fold";
import { apiFetch } from "../../lib/client-api";
import { AuthBar } from "../../components/AuthBar";
import AvailabilityCalendar, { type AvailabilitySlotRow } from "../../components/AvailabilityCalendar";

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
  listed: boolean;
  availabilityWindow: { days: number[]; startMin: number; endMin: number } | null;
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
  const [slots, setSlots] = useState<AvailabilitySlotRow[]>([]);
  const [busy, setBusy2] = useState<{ start: string; end: string }[]>([]);
  const [myEvents, setMyEvents] = useState<{ start: string; end: string; title: string; source: string }[]>([]);
  const [calSources, setCalSources] = useState<{ google: boolean; ics: boolean }>({ google: false, ics: false });
  const [googleCals, setGoogleCals] = useState<{ id: string; name: string; primary: boolean }[]>([]);
  const [selectedCals, setSelectedCals] = useState<string[]>([]);
  const [outlookIcs, setOutlookIcs] = useState("");
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [detail, setDetail] = useState<ShareDetail | null>(null);
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [paymentsReady, setPaymentsReady] = useState(false);
  const [stripeMode, setStripeMode] = useState<string | null>(null);
  const [freeText, setFreeText] = useState<string | null>(null); // 空き時間のテキスト (コピー用)
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
  // 出品ごとの受付枠 (任意)。空 = 空き時間全体を使う (従来どおり)。
  const [oWinDays, setOWinDays] = useState<number[]>([]);
  const [oWinStart, setOWinStart] = useState(9);
  const [oWinEnd, setOWinEnd] = useState(18);
  const toggleWinDay = (d: number) =>
    setOWinDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b)));
  const [createdOfferUrl, setCreatedOfferUrl] = useState("");

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
    const [a, s, o, b, sl, mb, me] = await Promise.all([
      apiFetch("relationship/availability").then((r) => (r.ok ? r.json() : null)),
      apiFetch("schedule/shares").then((r) => (r.ok ? r.json() : null)),
      apiFetch("schedule/offers").then((r) => (r.ok ? r.json() : null)),
      apiFetch("schedule/bookings").then((r) => (r.ok ? r.json() : null)),
      apiFetch("relationship/availability-slots").then((r) => (r.ok ? r.json() : null)),
      apiFetch("relationship/my-busy").then((r) => (r.ok ? r.json() : null)),
      apiFetch("relationship/my-events").then((r) => (r.ok ? r.json() : null)),
    ]);
    if (a) setAvail(a as Availability);
    if (sl) setSlots((sl as { slots: AvailabilitySlotRow[] }).slots);
    if (mb) {
      const mbb = mb as { busy: { start: string; end: string }[]; google: boolean; ics: boolean };
      setBusy2(mbb.busy ?? []);
      setCalSources({ google: !!mbb.google, ics: !!mbb.ics });
    }
    if (me) setMyEvents((me as { events: { start: string; end: string; title: string; source: string }[] }).events ?? []);
    if (s) setShares((s as { shares: ShareRow[] }).shares);
    if (o) {
      setOffers((o as { offers: OfferRow[] }).offers);
      setPaymentsReady((o as { paymentsReady: boolean }).paymentsReady);
      setStripeMode((o as { stripeMode: string | null }).stripeMode ?? null);
    }
    if (b) setBookings((b as { bookings: BookingRow[] }).bookings);
  }, []);

  // 分けている Google カレンダーの一覧と、いま表示する選択を読む (つないでいるときだけ)。
  const loadGoogleCals = useCallback(async () => {
    const r = await apiFetch("relationship/google-calendars");
    if (!r.ok) return;
    const b = (await r.json()) as { connected?: boolean; calendars?: { id: string; name: string; primary: boolean }[]; selected?: string[] };
    if (b.connected) {
      setGoogleCals(b.calendars ?? []);
      setSelectedCals(b.selected ?? []);
    }
  }, []);

  const saveGoogleCals = async (ids: string[]) => {
    setSelectedCals(ids); // 楽観更新 (チェックが即反映)
    const r = await apiFetch("relationship/google-calendars", { method: "PUT", body: JSON.stringify({ ids }) });
    if (r.ok) {
      const b = (await r.json()) as { selected?: string[]; imported?: number };
      setSelectedCals(b.selected ?? ids);
      setNotice(`表示するカレンダーを更新しました（予定 ${b.imported ?? 0} 件）`);
      await load();
    } else {
      setError("いまは変更を保存できませんでした");
    }
  };
  const toggleCal = (id: string) => {
    const next = selectedCals.includes(id) ? selectedCals.filter((x) => x !== id) : [...selectedCals, id];
    void saveGoogleCals(next);
  };

  useEffect(() => {
    void load();
    void loadGoogleCals();
  }, [load, loadGoogleCals]);

  const createSlot = async (startIso: string, endIso: string) => {
    const body = await call(
      "relationship/availability-slots",
      { method: "POST", body: JSON.stringify({ start: startIso, end: endIso }) },
      "なぞった枠を空き時間にしました。この日はなぞった枠だけが相手に出ます",
    );
    if (body) setSlots((cur) => [...cur, (body as { slot: AvailabilitySlotRow }).slot]);
  };

  const deleteSlot = async (id: string) => {
    const body = await call(`relationship/availability-slots/${id}`, { method: "DELETE" }, "枠を消しました");
    if (body) setSlots((cur) => cur.filter((s) => s.id !== id));
  };

  const importGoogleCalendar = async () => {
    const body = await call(
      "relationship/import-google-calendar",
      { method: "POST", body: "{}" },
      "Google カレンダーの予定を取り込みました",
    );
    if (body) await load();
  };

  const saveOutlookIcs = async () => {
    if (!outlookIcs.trim()) return;
    const body = await call(
      "relationship/my-busy",
      { method: "PUT", body: JSON.stringify({ icsUrl: outlookIcs.trim() }) },
      "予定表を取り込みました。カレンダーに予定が重なります",
    );
    if (body) {
      setOutlookIcs("");
      await load();
    }
  };

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

  // 自分の空き時間をテキストで取り出す (timeshare 踏襲)。表示 → そのままコピーして LINE/メールへ。
  const loadFreeText = async () => {
    setError("");
    const res = await apiFetch("relationship/free-slots-text?days=14&max=12");
    const body = (await res.json().catch(() => ({}))) as { text?: string; count?: number };
    if (res.ok) {
      const t = (body.text ?? "").trim();
      setFreeText(t || "いまは空いている時間が見つかりませんでした。受付時間や空き枠を設定してみてください");
    } else {
      setError("いまは取り出せませんでした。時間をおいてお試しください");
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
    const availabilityWindow =
      oWinDays.length > 0 ? { days: oWinDays, startMin: oWinStart * 60, endMin: oWinEnd * 60 } : null;
    const body = await call("schedule/offers", {
      method: "POST",
      body: JSON.stringify({ title: oTitle, displayName: oName, minutes: oMinutes, priceJpy: oPrice, description: oDesc, availabilityWindow }),
    }, "出品を作りました。下の URL を相手に送ると、その方が時間を選んで申し込めます");
    if (body) {
      setCreatedOfferUrl((body as { url: string }).url);
      setOTitle("");
      setODesc("");
      setOWinDays([]);
      await load();
    }
  };

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "40px 16px" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 16, alignItems: "center" }}>
        <Link href="/settings" style={{ color: "#64748b", fontSize: 14 }}>設定</Link>
        <AuthBar />
      </div>
      <p><Link href="/contacts" style={{ color: "#2563eb" }}>連絡帳へ戻る</Link></p>
      <h1 style={{ fontSize: 24 }}>日程調整と時間の受け付け</h1>
      <p style={{ color: "#64748b", lineHeight: 1.8 }}>
        空いている時間を相手に選んでもらうページと、お時間の受け付け (無料・有料) をここで作れます。
        相手はアカウントなしで開けます。見えるのは空いている枠だけで、予定の中身は見えません。
      </p>

      {notice && <p style={{ color: "#166534", background: "#f0fdf4", padding: 8, borderRadius: 8 }}>{notice}</p>}
      {error && <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>{error}</p>}

      <Fold k="sc1" title={<>空き時間の設定 (カレンダーをなぞる・受け付ける曜日と時間)</>} style={{ marginTop: 20, border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px" }}>
        <p style={{ color: "#64748b", fontSize: 13, lineHeight: 1.7, margin: "4px 0 10px" }}>
          カレンダーの上をドラッグしてなぞると、その時間が空き枠になります (なぞった枠はタップで消せます)。
          なぞった日はその枠だけが相手に出ます。なぞっていない日は、下の曜日ごとの受付時間が使われます。
          お使いの予定表を取り込むと、あなたの予定が青いブロックで件名つきに重なり、空いている時間がひと目で分かります。
          予定の中身はあなたにだけ表示します (相手に選んでいただくページには空き枠だけが出て、予定の中身は見えません)。
        </p>

        {/* お使いのカレンダーを取り込む (Google / Outlook 等)。予定の中身は保存しません */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", margin: "0 0 12px" }}>
          <button style={btn(false)} onClick={() => void importGoogleCalendar()}>
            {calSources.google ? "Google カレンダーを取り込み直す" : "Google カレンダーの予定を取り込む"}
          </button>
          <span style={{ color: "#94a3b8", fontSize: 12 }}>
            (はじめてのときは設定から Google とつないでください)
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "0 0 12px" }}>
          <input
            style={{ ...input, flex: "1 1 260px" }}
            placeholder="Outlook など予定表のアドレス (https で始まる ICS)"
            aria-label="予定表のアドレス"
            value={outlookIcs}
            onChange={(e) => setOutlookIcs(e.target.value)}
          />
          <button style={btn(false)} onClick={() => void saveOutlookIcs()}>取り込む</button>
        </div>
        {googleCals.length > 1 && (
          <div style={{ margin: "0 0 12px", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", background: "#fff" }}>
            <p style={{ fontSize: 13, color: "#334155", margin: "0 0 6px", fontWeight: 600 }}>
              表示するカレンダーを選ぶ
            </p>
            <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 8px" }}>
              いくつかに分けている場合、重ねて表示するカレンダーを選べます。チェックするとすぐ反映されます。
            </p>
            <div style={{ display: "grid", gap: 6 }}>
              {googleCals.map((cal) => (
                <label key={cal.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
                  <input type="checkbox" checked={selectedCals.includes(cal.id)} onChange={() => toggleCal(cal.id)} />
                  <span>
                    {cal.name}
                    {cal.primary && <span style={{ color: "#94a3b8", fontSize: 12 }}> (メイン)</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
        {(calSources.google || calSources.ics) && (
          <p style={{ color: "#64748b", fontSize: 12, margin: "0 0 8px" }}>
            取り込み済み:{calSources.google ? " Google" : ""}{calSources.ics ? " 予定表アドレス" : ""}
            。灰色の帯が「予定あり」、青いブロックが件名つきの予定です。
          </p>
        )}

        <AvailabilityCalendar slots={slots} busy={busy} events={myEvents} onCreate={(s, e) => void createSlot(s, e)} onDelete={(id) => void deleteSlot(id)} />

        <div style={{ marginTop: 12, padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#f8fafc" }}>
          <p style={{ fontSize: 13, color: "#475569", margin: "0 0 8px" }}>
            空いている時間を、そのまま文章にしてメールや LINE に貼れます（相手のアカウントは不要）。
          </p>
          {freeText === null ? (
            <button style={{ ...btn(false), padding: "6px 14px", fontSize: 13 }} onClick={() => void loadFreeText()}>
              空き時間を文章にする
            </button>
          ) : (
            <div>
              <textarea
                readOnly
                value={freeText}
                rows={Math.min(10, Math.max(3, freeText.split("\n").length + 1))}
                style={{ ...input, width: "100%", fontFamily: "inherit" }}
                aria-label="空き時間の文章"
              />
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button style={{ ...btn(), padding: "6px 14px", fontSize: 13 }} onClick={() => void copy(freeText)}>この文章をコピー</button>
                <button style={{ ...btn(false), padding: "6px 14px", fontSize: 13 }} onClick={() => void loadFreeText()}>更新</button>
                <button style={{ ...btn(false), padding: "6px 14px", fontSize: 13 }} onClick={() => setFreeText(null)}>閉じる</button>
              </div>
            </div>
          )}
        </div>
        {!avail && <p>読み込んでいます…</p>}
        {avail && (
          <div style={{ marginTop: 14 }}>
            <p style={{ color: "#64748b", fontSize: 13, lineHeight: 1.7, margin: "4px 0 10px" }}>
              なぞっていない日の受付時間。ここで決めた時間の中から、予定の入っていない枠だけが相手に見えます。
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
                <a
                  href={`mailto:?subject=${encodeURIComponent((s.title || "日程のご相談") + "（ご都合のよい時間をお選びください）")}&body=${encodeURIComponent(`いつもお世話になっております。\n下のページから、ご都合のよいお時間をお選びいただけますでしょうか。\n\n${s.url}\n\nどうぞよろしくお願いいたします。`)}`}
                  style={{ ...btn(false), padding: "4px 10px", fontSize: 13, textDecoration: "none" }}
                >
                  メールで送る
                </a>
                <a
                  href={`https://line.me/R/msg/text/?${encodeURIComponent(`日程のご相談です。ご都合のよいお時間をお選びください。\n${s.url}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...btn(false), padding: "4px 10px", fontSize: 13, textDecoration: "none" }}
                >
                  LINEで送る
                </a>
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
        {paymentsReady && stripeMode === "test" && (
          <p style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: 8, borderRadius: 8, fontSize: 13, lineHeight: 1.7 }}>
            いまお支払いは「テストモード」です。実際のカードでは決済が通りません（テスト用カードのみ）。
            本番のお支払いを受け付けるには、本番用の鍵（sk_live_… で始まるもの）に差し替えてください（設定手順書のタスク5）。
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

        <div style={{ marginTop: 8, padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#f8fafc" }}>
          <p style={{ fontSize: 13, color: "#475569", margin: "0 0 6px" }}>
            この出品を受ける曜日・時間帯（任意）。選ばなければ、あなたの空き時間すべてで受け付けます。
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {["日", "月", "火", "水", "木", "金", "土"].map((label, d) => (
              <button
                key={d}
                type="button"
                aria-pressed={oWinDays.includes(d)}
                onClick={() => toggleWinDay(d)}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  border: "1px solid " + (oWinDays.includes(d) ? "#1d4ed8" : "#cbd5e1"),
                  background: oWinDays.includes(d) ? "#2563eb" : "#fff",
                  color: oWinDays.includes(d) ? "#fff" : "#334155",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                {label}
              </button>
            ))}
            <span style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 8, fontSize: 14 }}>
              <select aria-label="受付開始時刻" value={oWinStart} onChange={(e) => setOWinStart(Number(e.target.value))} style={{ ...input, width: 76 }}>
                {Array.from({ length: 25 }, (_, h) => (
                  <option key={h} value={h}>{h}:00</option>
                ))}
              </select>
              〜
              <select aria-label="受付終了時刻" value={oWinEnd} onChange={(e) => setOWinEnd(Number(e.target.value))} style={{ ...input, width: 76 }}>
                {Array.from({ length: 25 }, (_, h) => (
                  <option key={h} value={h}>{h}:00</option>
                ))}
              </select>
            </span>
          </div>
        </div>

        {createdOfferUrl && (
          <p style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: 10, borderRadius: 8, marginTop: 8, lineHeight: 1.8 }}>
            この URL を相手に送ってください。相手はアカウントなしで開いて、空いている時間を選んで申し込めます
            {oPrice > 0 ? "（有料はそのままカードでお支払いまで進めます）" : ""}。
            <br />
            <span style={{ wordBreak: "break-all", fontWeight: 600 }}>{createdOfferUrl}</span>{" "}
            <button style={{ ...btn(false), padding: "4px 10px", fontSize: 13 }} onClick={() => void copy(createdOfferUrl)}>リンクをコピー</button>
          </p>
        )}

        <p style={{ color: "#64748b", fontSize: 13, margin: "10px 0 0" }}>
          作った出品は下に並びます。それぞれの「リンクをコピー」で、いつでも申し込みページの URL を相手に送れます。
        </p>
        <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
          {offers.map((o) => (
            <li key={o.id} style={{ borderTop: "1px solid #f1f5f9", padding: "8px 0" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <span style={{ fontWeight: 600 }}>{o.title}</span>
              <span style={{ color: "#64748b", fontSize: 13 }}>
                {METHOD_LABEL[o.method] ?? o.method}・{o.minutes}分・{o.priceJpy > 0 ? `${o.priceJpy.toLocaleString()}円` : "無料"}
                {o.availabilityWindow
                  ? `・${o.availabilityWindow.days.map((d) => "日月火水木金土"[d]).join("")} ${Math.floor(o.availabilityWindow.startMin / 60)}〜${Math.floor(o.availabilityWindow.endMin / 60)}時`
                  : ""}
                {o.confirmedBookings > 0 ? `・確定 ${o.confirmedBookings} 件` : ""}
                {o.active ? "" : "・停止中"}
              </span>
              <span style={{ flex: 1 }} />
              <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, color: "#166534", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={o.listed}
                  onChange={async () => {
                    const body = await call(`schedule/offers/${o.id}`, { method: "PUT", body: JSON.stringify({ listed: !o.listed }) }, o.listed ? "掲示板から下ろしました" : "掲示板に載せました");
                    if (body) await load();
                  }}
                />
                掲示板に載せる
              </label>
              <a href={o.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#2563eb" }}>申し込みページを開く</a>
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
              </div>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#94a3b8", wordBreak: "break-all" }}>{o.url}</p>
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
