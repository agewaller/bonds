"use client";
// 日程調整と時間の出品の管理 — 空き時間の設定 / 共有リンク / 出品 / 予約を一箇所に。
// timeshare の概念 (共有リンク・提案の承認・スポット販売) を bonds の型で新規実装した画面。
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Fold from "../../components/Fold";
import { apiFetch } from "../../lib/client-api";
import { AuthBar } from "../../components/AuthBar";
import AvailabilityCalendar, { type AvailabilitySlotRow } from "../../components/AvailabilityCalendar";
import { t, currentLocale, type Locale } from "../../lib/i18n";

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

const DAY7 = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const fmt = (iso: string, locale: Locale) => {
  const d = new Date(iso);
  const md = t("m_date_md", locale)
    .replace("{m}", String(d.getMonth() + 1))
    .replace("{d}", String(d.getDate()))
    .replace("{w}", t(`m_wd_${DAY7[d.getDay()]}`, locale));
  return `${md} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const METHOD_KEY: Record<string, string> = { meeting: "m_method_meeting", online: "m_method_online", phone: "m_method_phone" };
const BOOKING_KEY: Record<string, string> = {
  pending_payment: "m_booking_pending_payment",
  confirmed: "m_booking_confirmed",
  canceled: "m_booking_canceled",
  expired: "m_booking_expired",
};

export default function SchedulePage() {
  // cookie はクライアントでしか読めないため、初回描画後に反映する
  const [locale, setLoc] = useState<Locale>("ja");
  useEffect(() => setLoc(currentLocale()), []);
  const T = (key: string) => t(key, locale);
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
      setError((body as { detail?: string } | null)?.detail ?? t("m_err_generic"));
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
      setNotice(`${t("m_sch_cals_updated_prefix")}${b.imported ?? 0}${t("m_sch_cals_updated_suffix")}`);
      await load();
    } else {
      setError(t("m_sch_cals_save_fail"));
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
      t("m_sch_slot_created"),
    );
    if (body) setSlots((cur) => [...cur, (body as { slot: AvailabilitySlotRow }).slot]);
  };

  const deleteSlot = async (id: string) => {
    const body = await call(`relationship/availability-slots/${id}`, { method: "DELETE" }, t("m_sch_slot_deleted"));
    if (body) setSlots((cur) => cur.filter((s) => s.id !== id));
  };

  const importGoogleCalendar = async () => {
    const body = await call(
      "relationship/import-google-calendar",
      { method: "POST", body: "{}" },
      t("m_sch_gcal_imported"),
    );
    if (body) await load();
  };

  const saveOutlookIcs = async () => {
    if (!outlookIcs.trim()) return;
    const body = await call(
      "relationship/my-busy",
      { method: "PUT", body: JSON.stringify({ icsUrl: outlookIcs.trim() }) },
      t("m_sch_ics_imported"),
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
    }, t("m_sch_avail_saved"));
    if (body) setAvail(body as Availability);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(t("m_copied"));
    } catch {
      setError(t("m_copy_fail"));
    }
  };

  // 自分の空き時間をテキストで取り出す (timeshare 踏襲)。表示 → そのままコピーして LINE/メールへ。
  const loadFreeText = async () => {
    setError("");
    const res = await apiFetch("relationship/free-slots-text?days=14&max=12");
    const body = (await res.json().catch(() => ({}))) as { text?: string; count?: number };
    if (res.ok) {
      const txt = (body.text ?? "").trim();
      setFreeText(txt || t("m_sch_freetext_empty"));
    } else {
      setError(t("m_sch_freetext_fail"));
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
    }, t("m_sch_share_created"));
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
    }, t("m_sch_accepted"));
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
    }, t("m_sch_offer_created"));
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
        <Link href="/settings" style={{ color: "#64748b", fontSize: 14 }}>{T("m_settings_link")}</Link>
        <AuthBar />
      </div>
      <p><Link href="/contacts" style={{ color: "#2563eb" }}>{T("m_back_contacts")}</Link></p>
      <h1 style={{ fontSize: 24 }}>{T("m_sch_title")}</h1>
      <p style={{ color: "#64748b", lineHeight: 1.8 }}>{T("m_sch_intro")}</p>

      {notice && <p style={{ color: "#166534", background: "#f0fdf4", padding: 8, borderRadius: 8 }}>{notice}</p>}
      {error && <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>{error}</p>}

      <Fold k="sc1" title={<>{T("m_sch_sec_avail")}</>} style={{ marginTop: 20, border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px" }}>
        <p style={{ color: "#64748b", fontSize: 13, lineHeight: 1.7, margin: "4px 0 10px" }}>{T("m_sch_avail_desc")}</p>

        {/* お使いのカレンダーを取り込む (Google / Outlook 等)。予定の中身は保存しません */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", margin: "0 0 12px" }}>
          <button style={btn(false)} onClick={() => void importGoogleCalendar()}>
            {calSources.google ? T("m_sch_gcal_reimport") : T("m_sch_gcal_import")}
          </button>
          <span style={{ color: "#94a3b8", fontSize: 12 }}>
            {T("m_sch_gcal_hint")}
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "0 0 12px" }}>
          <input
            style={{ ...input, flex: "1 1 260px" }}
            placeholder={T("m_sch_ics_ph")}
            aria-label={T("m_ics_url_aria")}
            value={outlookIcs}
            onChange={(e) => setOutlookIcs(e.target.value)}
          />
          <button style={btn(false)} onClick={() => void saveOutlookIcs()}>{T("m_sch_ics_btn")}</button>
        </div>
        {googleCals.length > 1 && (
          <div style={{ margin: "0 0 12px", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", background: "#fff" }}>
            <p style={{ fontSize: 13, color: "#334155", margin: "0 0 6px", fontWeight: 600 }}>
              {T("m_sch_pick_cals")}
            </p>
            <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 8px" }}>
              {T("m_sch_pick_cals_desc")}
            </p>
            <div style={{ display: "grid", gap: 6 }}>
              {googleCals.map((cal) => (
                <label key={cal.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
                  <input type="checkbox" checked={selectedCals.includes(cal.id)} onChange={() => toggleCal(cal.id)} />
                  <span>
                    {cal.name}
                    {cal.primary && <span style={{ color: "#94a3b8", fontSize: 12 }}>{T("m_sch_cal_primary")}</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
        {(calSources.google || calSources.ics) && (
          <p style={{ color: "#64748b", fontSize: 12, margin: "0 0 8px" }}>
            {T("m_sch_imported_prefix")}{calSources.google ? " Google" : ""}{calSources.ics ? T("m_sch_imported_ics") : ""}{T("m_sch_imported_legend")}
          </p>
        )}

        <AvailabilityCalendar slots={slots} busy={busy} events={myEvents} onCreate={(s, e) => void createSlot(s, e)} onDelete={(id) => void deleteSlot(id)} />

        <div style={{ marginTop: 12, padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#f8fafc" }}>
          <p style={{ fontSize: 13, color: "#475569", margin: "0 0 8px" }}>
            {T("m_sch_freetext_desc")}
          </p>
          {freeText === null ? (
            <button style={{ ...btn(false), padding: "6px 14px", fontSize: 13 }} onClick={() => void loadFreeText()}>
              {T("m_sch_freetext_btn")}
            </button>
          ) : (
            <div>
              <textarea
                readOnly
                value={freeText}
                rows={Math.min(10, Math.max(3, freeText.split("\n").length + 1))}
                style={{ ...input, width: "100%", fontFamily: "inherit" }}
                aria-label={T("m_sch_freetext_aria")}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button style={{ ...btn(), padding: "6px 14px", fontSize: 13 }} onClick={() => void copy(freeText)}>{T("m_sch_copy_text")}</button>
                <button style={{ ...btn(false), padding: "6px 14px", fontSize: 13 }} onClick={() => void loadFreeText()}>{T("m_sch_refresh")}</button>
                <button style={{ ...btn(false), padding: "6px 14px", fontSize: 13 }} onClick={() => setFreeText(null)}>{T("m_close")}</button>
              </div>
            </div>
          )}
        </div>
        {!avail && <p>{T("m_loading")}</p>}
        {avail && (
          <div style={{ marginTop: 14 }}>
            <p style={{ color: "#64748b", fontSize: 13, lineHeight: 1.7, margin: "4px 0 10px" }}>
              {T("m_sch_weekly_desc")}
            </p>
            {DAY_KEYS.map((k) => {
              const d = avail.days[k]!;
              const set = (patch: Partial<typeof d>) =>
                setAvail({ ...avail, days: { ...avail.days, [k]: { ...d, ...patch } } });
              return (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0" }}>
                  <label style={{ width: 90, display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" checked={d.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
                    {T(`m_dayfull_${k}`)}
                  </label>
                  {d.enabled ? (
                    <>
                      <input type="number" min={0} max={23} style={{ ...input, width: 64 }} value={d.startHour}
                        onChange={(e) => set({ startHour: Number(e.target.value) })} aria-label={`${T(`m_dayfull_${k}`)}${T("m_sch_start_suffix")}`} />
                      <span>{T("m_sch_hour_from")}</span>
                      <input type="number" min={0} max={24} style={{ ...input, width: 64 }} value={d.endHour}
                        onChange={(e) => set({ endHour: Number(e.target.value) })} aria-label={`${T(`m_dayfull_${k}`)}${T("m_sch_end_suffix")}`} />
                      <span>{T("m_sch_hour_to")}</span>
                    </>
                  ) : (
                    <span style={{ color: "#94a3b8" }}>{T("m_sch_day_off")}</span>
                  )}
                </div>
              );
            })}
            <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
              <label>
                {T("m_sch_buffer_label")}
                <input type="number" min={0} max={120} style={{ ...input, width: 70, marginLeft: 6 }} value={avail.bufferMinutes}
                  onChange={(e) => setAvail({ ...avail, bufferMinutes: Number(e.target.value) })} aria-label={T("m_sch_buffer_aria")} />
                {T("m_min_short")}
              </label>
              <label>
                {T("m_sch_min_label")}
                <input type="number" min={15} max={480} style={{ ...input, width: 70, marginLeft: 6 }} value={avail.minMinutes}
                  onChange={(e) => setAvail({ ...avail, minMinutes: Number(e.target.value) })} aria-label={T("m_sch_min_aria")} />
                {T("m_min_short")}
              </label>
              <button style={btn()} onClick={() => void saveAvailability()}>{T("m_save")}</button>
            </div>
          </div>
        )}
      </Fold>

      <Fold k="sc2" title={<>{T("m_sch_sec_shares")} {shares.reduce((n, s) => n + s.pendingProposals, 0) > 0 ? `${T("m_sch_awaiting_prefix")}${shares.reduce((n, s) => n + s.pendingProposals, 0)}${T("m_sch_awaiting_suffix")}` : ""}</>} style={{ marginTop: 20, border: "1px solid #bae6fd", background: "#f0f9ff", borderRadius: 12, padding: "14px 16px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0" }}>
          <input style={{ ...input, flex: "1 1 180px" }} placeholder={T("m_sch_share_title_ph")} value={sTitle} onChange={(e) => setSTitle(e.target.value)} aria-label={T("m_sch_share_title_aria")} />
          <input style={{ ...input, width: 140 }} placeholder={T("m_sch_share_name_ph")} value={sName} onChange={(e) => setSName(e.target.value)} aria-label={T("m_sch_name_aria")} />
          <select style={{ ...input, width: "auto" }} value={sMethod} onChange={(e) => setSMethod(e.target.value)} aria-label={T("m_sch_method_aria")}>
            <option value="meeting">{T("m_method_meeting")}</option>
            <option value="online">{T("m_method_online")}</option>
            <option value="phone">{T("m_method_phone")}</option>
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {T("m_sch_from_now")}
            <input type="number" min={1} max={90} style={{ ...input, width: 64 }} value={sDays} onChange={(e) => setSDays(Number(e.target.value))} aria-label={T("m_sch_days_aria")} />
            {T("m_sch_days_suffix")}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input type="number" min={15} max={240} step={15} style={{ ...input, width: 64 }} value={sMinutes} onChange={(e) => setSMinutes(Number(e.target.value))} aria-label={T("m_sch_meet_min_aria")} />
            {T("m_sch_meet_min_suffix")}
          </label>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 8px" }}>
          <input style={{ ...input, flex: "1 1 260px" }} placeholder={T("m_sch_note_ph")} value={sNote} onChange={(e) => setSNote(e.target.value)} aria-label={T("m_sch_note_aria")} />
          <input style={{ ...input, width: 180 }} placeholder={T("m_sch_pw_ph")} value={sPassword} onChange={(e) => setSPassword(e.target.value)} aria-label={T("m_pw_aria")} />
          <button style={btn()} onClick={() => void createShare()}>{T("m_sch_create_share")}</button>
        </div>
        {createdUrl && (
          <p style={{ background: "#fff", padding: 8, borderRadius: 8 }}>
            {T("m_sch_created_prefix")}<span style={{ wordBreak: "break-all" }}>{createdUrl}</span>{" "}
            <button style={{ ...btn(false), padding: "4px 10px", fontSize: 13 }} onClick={() => void copy(createdUrl)}>{T("m_copy_link")}</button>
          </p>
        )}

        {shares.length === 0 && <p style={{ color: "#64748b" }}>{T("m_sch_no_shares")}</p>}
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {shares.map((s) => (
            <li key={s.id} style={{ borderTop: "1px solid #e0f2fe", padding: "8px 0" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <span style={{ fontWeight: 600 }}>{s.title || T("m_share_default_title")}</span>
                <span style={{ color: "#64748b", fontSize: 13 }}>
                  {METHOD_KEY[s.method] ? T(METHOD_KEY[s.method]!) : s.method}・{s.slotMinutes}{T("m_min_short")}・{fmt(s.periodStart, locale).split(" ")[0]}{T("m_sch_min_from")}{fmt(s.periodEnd, locale).split(" ")[0]}{T("m_sch_min_until")}
                  {s.hasPassword ? T("m_sch_with_pw") : ""}
                </span>
                {s.pendingProposals > 0 && (
                  <span style={{ background: "#dbeafe", color: "#1d4ed8", borderRadius: 999, padding: "2px 10px", fontSize: 13 }}>
                    {T("m_sch_awaiting2_prefix")}{s.pendingProposals}{T("m_sch_awaiting2_suffix")}
                  </span>
                )}
                <span style={{ flex: 1 }} />
                <button style={{ ...btn(false), padding: "4px 10px", fontSize: 13 }} onClick={() => void copy(s.url)}>{T("m_copy_link")}</button>
                <a
                  href={`mailto:?subject=${encodeURIComponent((s.title || T("m_sch_mail_subject_default")) + T("m_sch_mail_subject_suffix"))}&body=${encodeURIComponent(`${T("m_sch_mail_body_pre")}${s.url}${T("m_sch_mail_body_post")}`)}`}
                  style={{ ...btn(false), padding: "4px 10px", fontSize: 13, textDecoration: "none" }}
                >
                  {T("m_sch_send_mail")}
                </a>
                <a
                  href={`https://line.me/R/msg/text/?${encodeURIComponent(`${T("m_sch_line_text_pre")}${s.url}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...btn(false), padding: "4px 10px", fontSize: 13, textDecoration: "none" }}
                >
                  {T("m_sch_send_line")}
                </a>
                <button style={{ ...btn(false), padding: "4px 10px", fontSize: 13 }} onClick={() => void openDetail(s.id)}>{T("m_sch_view_proposals")}</button>
                <button
                  style={{ ...btn(false), padding: "4px 10px", fontSize: 13, color: "#b91c1c" }}
                  onClick={async () => {
                    const body = await call(`schedule/shares/${s.id}`, { method: "DELETE" }, t("m_sch_share_deleted"));
                    if (body) {
                      if (detail?.id === s.id) setDetail(null);
                      await load();
                    }
                  }}
                >
                  {T("m_delete")}
                </button>
              </div>
              {detail?.id === s.id && (
                <div style={{ marginTop: 8, background: "#fff", borderRadius: 8, padding: "8px 12px" }}>
                  {detail.participants.length > 0 && (
                    <p style={{ margin: "2px 0 6px", color: "#166534", fontSize: 13 }}>
                      {T("m_sch_participants_prefix")}{detail.participants.map((p) => p.name).join(T("m_san_sep"))}{T("m_sch_participants_note")}
                    </p>
                  )}
                  {detail.proposals.length === 0 && <p style={{ margin: 4, color: "#64748b" }}>{T("m_sch_no_proposals")}</p>}
                  {detail.proposals.map((p) => (
                    <div key={p.id} style={{ borderBottom: "1px solid #f1f5f9", padding: "6px 0" }}>
                      <p style={{ margin: "2px 0" }}>
                        <strong>{p.guestName}</strong>{T("m_san_lead")}
                        {p.guestContact ? ` (${p.guestContact})` : ""}
                        {p.status === "accepted" && p.decidedSlot ? ` — ${fmt(p.decidedSlot.start, locale)}${T("m_sch_decided_suffix")}` : ""}
                        {p.status === "declined" ? T("m_sch_declined_mark") : ""}
                      </p>
                      {p.message && <p style={{ margin: "2px 0", color: "#475569" }}>{p.message}</p>}
                      {p.status === "proposed" && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "4px 0" }}>
                          {p.candidates.map((cand) => (
                            <button key={cand.start} style={{ ...btn(false), fontSize: 13 }} onClick={() => void accept(s.id, p.id, cand.start)}>
                              {fmt(cand.start, locale)}{T("m_sch_pick_suffix")}
                            </button>
                          ))}
                          <button style={{ ...btn(false), fontSize: 13, color: "#b91c1c" }} onClick={() => void decline(s.id, p.id)}>
                            {T("m_sch_decline_btn")}
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

      <Fold k="sc3" title={<>{T("m_sch_sec_offers")}</>} style={{ marginTop: 20, border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px" }}>
        {!paymentsReady && (
          <p style={{ background: "#fef9c3", padding: 8, borderRadius: 8, fontSize: 13, lineHeight: 1.7 }}>
            {T("m_sch_payments_pending")}
          </p>
        )}
        {paymentsReady && stripeMode === "test" && (
          <p style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: 8, borderRadius: 8, fontSize: 13, lineHeight: 1.7 }}>
            {T("m_sch_stripe_test")}
          </p>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0" }}>
          <input style={{ ...input, flex: "1 1 200px" }} placeholder={T("m_sch_offer_title_ph")} value={oTitle} onChange={(e) => setOTitle(e.target.value)} aria-label={T("m_sch_offer_title_aria")} />
          <input style={{ ...input, width: 140 }} placeholder={T("m_sch_offer_name_ph")} value={oName} onChange={(e) => setOName(e.target.value)} aria-label={T("m_sch_offer_name_aria")} />
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input type="number" min={15} max={480} step={15} style={{ ...input, width: 64 }} value={oMinutes} onChange={(e) => setOMinutes(Number(e.target.value))} aria-label={T("m_sch_offer_min_aria")} />
            {T("m_min_short")}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input type="number" min={0} max={1000000} step={500} style={{ ...input, width: 90 }} value={oPrice} onChange={(e) => setOPrice(Number(e.target.value))} aria-label={T("m_sch_price_aria")} />
            {T("m_sch_yen_free")}
          </label>
          <button style={btn()} onClick={() => void createOffer()}>{T("m_sch_offer_btn")}</button>
        </div>
        <textarea style={{ ...input, width: "100%" }} rows={2} placeholder={T("m_sch_offer_desc_ph")} value={oDesc} onChange={(e) => setODesc(e.target.value)} aria-label={T("m_sch_offer_desc_aria")} />

        <div style={{ marginTop: 8, padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#f8fafc" }}>
          <p style={{ fontSize: 13, color: "#475569", margin: "0 0 6px" }}>
            {T("m_sch_window_desc")}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {DAY7.map((wk, d) => (
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
                {T(`m_wd_${wk}`)}
              </button>
            ))}
            <span style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 8, fontSize: 14 }}>
              <select aria-label={T("m_sch_win_start_aria")} value={oWinStart} onChange={(e) => setOWinStart(Number(e.target.value))} style={{ ...input, width: 76 }}>
                {Array.from({ length: 25 }, (_, h) => (
                  <option key={h} value={h}>{h}:00</option>
                ))}
              </select>
              〜
              <select aria-label={T("m_sch_win_end_aria")} value={oWinEnd} onChange={(e) => setOWinEnd(Number(e.target.value))} style={{ ...input, width: 76 }}>
                {Array.from({ length: 25 }, (_, h) => (
                  <option key={h} value={h}>{h}:00</option>
                ))}
              </select>
            </span>
          </div>
        </div>

        {createdOfferUrl && (
          <p style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: 10, borderRadius: 8, marginTop: 8, lineHeight: 1.8 }}>
            {T("m_sch_offer_url_pre")}{oPrice > 0 ? T("m_sch_offer_url_paid") : ""}{T("m_period")}
            <br />
            <span style={{ wordBreak: "break-all", fontWeight: 600 }}>{createdOfferUrl}</span>{" "}
            <button style={{ ...btn(false), padding: "4px 10px", fontSize: 13 }} onClick={() => void copy(createdOfferUrl)}>{T("m_copy_link")}</button>
          </p>
        )}

        <p style={{ color: "#64748b", fontSize: 13, margin: "10px 0 0" }}>
          {T("m_sch_offers_hint")}
        </p>
        <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
          {offers.map((o) => (
            <li key={o.id} style={{ borderTop: "1px solid #f1f5f9", padding: "8px 0" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <span style={{ fontWeight: 600 }}>{o.title}</span>
              <span style={{ color: "#64748b", fontSize: 13 }}>
                {METHOD_KEY[o.method] ? T(METHOD_KEY[o.method]!) : o.method}・{o.minutes}{T("m_min_short")}・{o.priceJpy > 0 ? `${o.priceJpy.toLocaleString()}${T("m_yen")}` : T("m_free")}
                {o.availabilityWindow
                  ? `・${o.availabilityWindow.days.map((d) => T(`m_wd_${DAY7[d]}`)).join(T("m_wd_join"))} ${Math.floor(o.availabilityWindow.startMin / 60)}〜${Math.floor(o.availabilityWindow.endMin / 60)}${T("m_sch_hour_suffix")}`
                  : ""}
                {o.confirmedBookings > 0 ? `${T("m_sch_confirmed_prefix")}${o.confirmedBookings}${T("m_sch_confirmed_suffix")}` : ""}
                {o.active ? "" : T("m_sch_paused")}
              </span>
              <span style={{ flex: 1 }} />
              <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, color: "#166534", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={o.listed}
                  onChange={async () => {
                    const body = await call(`schedule/offers/${o.id}`, { method: "PUT", body: JSON.stringify({ listed: !o.listed }) }, o.listed ? t("m_sch_unlisted") : t("m_sch_listed"));
                    if (body) await load();
                  }}
                />
                {T("m_sch_list_toggle")}
              </label>
              <a href={o.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#2563eb" }}>{T("m_sch_open_booking")}</a>
              <button style={{ ...btn(false), padding: "4px 10px", fontSize: 13 }} onClick={() => void copy(o.url)}>{T("m_copy_link")}</button>
              <button
                style={{ ...btn(false), padding: "4px 10px", fontSize: 13 }}
                onClick={async () => {
                  const body = await call(`schedule/offers/${o.id}`, { method: "PUT", body: JSON.stringify({ active: !o.active }) }, o.active ? t("m_sch_offer_stopped") : t("m_sch_offer_resumed"));
                  if (body) await load();
                }}
              >
                {o.active ? T("m_sch_stop") : T("m_sch_resume")}
              </button>
              <button
                style={{ ...btn(false), padding: "4px 10px", fontSize: 13, color: "#b91c1c" }}
                onClick={async () => {
                  const body = await call(`schedule/offers/${o.id}`, { method: "DELETE" }, t("m_sch_offer_deleted"));
                  if (body) await load();
                }}
              >
                {T("m_delete")}
              </button>
              </div>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#94a3b8", wordBreak: "break-all" }}>{o.url}</p>
            </li>
          ))}
        </ul>
      </Fold>

      <Fold k="sc4" title={<>{T("m_sch_sec_bookings_p1")}{bookings.filter((b) => b.status === "confirmed").length}{T("m_sch_sec_bookings_p2")}</>} style={{ marginTop: 20, border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px" }}>
        {bookings.length === 0 && <p style={{ color: "#64748b" }}>{T("m_sch_no_bookings")}</p>}
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {bookings.map((b) => (
            <li key={b.id} style={{ borderTop: "1px solid #f1f5f9", padding: "8px 0" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <span style={{ fontWeight: 600 }}>{b.guestName}</span>
                <span style={{ color: "#64748b", fontSize: 13 }}>
                  {b.offer.title}・{fmt(b.slot.start, locale)}・{b.amountJpy > 0 ? `${b.amountJpy.toLocaleString()}${T("m_yen")}` : T("m_free")}・
                  {BOOKING_KEY[b.status] ? T(BOOKING_KEY[b.status]!) : b.status}
                </span>
                <span style={{ flex: 1 }} />
                {(b.status === "confirmed" || b.status === "pending_payment") && (
                  <button
                    style={{ ...btn(false), padding: "4px 10px", fontSize: 13, color: "#b91c1c" }}
                    onClick={async () => {
                      const body = await call(`schedule/bookings/${b.id}/cancel`, { method: "POST", body: "{}" }, t("m_sch_booking_canceled_notice"));
                      if (body) await load();
                    }}
                  >
                    {T("m_sch_cancel_btn")}
                  </button>
                )}
              </div>
              {(b.guestContact || b.message) && (
                <p style={{ margin: "2px 0", color: "#475569", fontSize: 13 }}>
                  {b.guestContact ? `${T("m_contact_prefix")}${b.guestContact} ` : ""}
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
