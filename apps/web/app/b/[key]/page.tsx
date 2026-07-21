"use client";
// 時間の出品の公開ページ (予約リンクの飛び先)。空いている枠をひとつ選び、
// お名前と連絡先を入れて申し込む。有料はそのままお支払いページ (Stripe) へ進む。
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { t, currentLocale, type Locale } from "../../../lib/i18n";

type OfferInfo = {
  title: string;
  description: string;
  displayName: string;
  methodLabel: string;
  minutes: number;
  priceJpy: number;
  acceptingBookings: boolean;
};
type IsoSlot = { start: string; end: string };

const input: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  fontSize: 15,
  boxSizing: "border-box",
};

const DAY7 = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const dayLabel = (d: Date, locale: Locale) =>
  t("m_date_md", locale)
    .replace("{m}", String(d.getMonth() + 1))
    .replace("{d}", String(d.getDate()))
    .replace("{w}", t(`m_wd_${DAY7[d.getDay()]}`, locale));
const timeLabel = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;

export default function PublicOfferPage() {
  // cookie はクライアントでしか読めないため、初回描画後に反映する
  const [locale, setLoc] = useState<Locale>("ja");
  useEffect(() => setLoc(currentLocale()), []);
  const T = (key: string) => t(key, locale);
  const { key } = useParams<{ key: string }>();
  const [info, setInfo] = useState<OfferInfo | null>(null);
  const [gone, setGone] = useState(false);
  const [options, setOptions] = useState<IsoSlot[] | null>(null);
  const [chosen, setChosen] = useState<IsoSlot | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestContact, setGuestContact] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/bff/public/offers/${key}`);
    if (!res.ok) {
      setGone(true);
      return;
    }
    setInfo((await res.json()) as OfferInfo);
    const r2 = await fetch(`/api/bff/public/offers/${key}/slots`);
    if (r2.ok) setOptions(((await r2.json()) as { options: IsoSlot[] }).options);
  }, [key]);

  useEffect(() => {
    void load();
  }, [load]);

  const book = async () => {
    if (!chosen) return;
    setError("");
    setBusy(true);
    const res = await fetch(`/api/bff/public/offers/${key}/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestName, guestContact, message, slot: chosen }),
    });
    const body = (await res.json().catch(() => ({}))) as { detail?: string; confirmed?: boolean; checkoutUrl?: string };
    setBusy(false);
    if (!res.ok) {
      setError(body.detail ?? t("m_b_book_fail"));
      if (res.status === 409) {
        setChosen(null);
        await load();
      }
      return;
    }
    if (body.confirmed) {
      setConfirmed(true);
      return;
    }
    if (body.checkoutUrl) window.location.href = body.checkoutUrl; // お支払いへ (戻ると /thanks で確定を確認)
  };

  if (gone) {
    return (
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 16px" }}>
        <p>{T("m_b_gone")}</p>
      </main>
    );
  }
  if (!info) {
    return (
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 16px" }}>
        <p>{T("m_loading")}</p>
      </main>
    );
  }

  if (confirmed) {
    return (
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 16px" }}>
        <h1 style={{ fontSize: 22 }}>{info.title}</h1>
        <div style={{ marginTop: 24, padding: "20px 16px", background: "#f0fdf4", borderRadius: 12 }}>
          <p style={{ margin: 0, lineHeight: 1.9 }}>
            {T("m_b_confirmed")}
          </p>
        </div>
      </main>
    );
  }

  const byDate = new Map<string, IsoSlot[]>();
  for (const o of options ?? []) {
    const d = new Date(o.start);
    const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    byDate.set(k, [...(byDate.get(k) ?? []), o]);
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 16px" }}>
      <p style={{ color: "#94a3b8", fontSize: 13, letterSpacing: 1 }}>
        {info.displayName ? `${info.displayName}${T("m_b_owner_suffix")}` : ""}{T("m_b_header")}
      </p>
      <h1 style={{ fontSize: 22 }}>{info.title}</h1>
      {info.description && <p style={{ lineHeight: 1.9, color: "#334155", whiteSpace: "pre-wrap" }}>{info.description}</p>}
      <p style={{ color: "#334155" }}>
        {info.methodLabel}、{info.minutes}{T("m_b_min_period")}
        {info.priceJpy > 0 ? ` ${info.priceJpy.toLocaleString()}${T("m_b_paid_suffix")}` : T("m_b_free")}
      </p>

      {!info.acceptingBookings && (
        <p style={{ padding: "12px 16px", background: "#fef9c3", borderRadius: 8 }}>
          {T("m_b_not_accepting")}
        </p>
      )}

      {info.acceptingBookings && options && options.length === 0 && (
        <p style={{ padding: "12px 16px", background: "#fef9c3", borderRadius: 8 }}>
          {T("m_b_no_slots")}
        </p>
      )}

      {info.acceptingBookings &&
        [...byDate.entries()].map(([k, slots]) => (
          <section key={k} style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 15, color: "#334155", margin: "0 0 8px" }}>{dayLabel(new Date(slots[0]!.start), locale)}</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {slots.map((o) => {
                const on = chosen?.start === o.start;
                return (
                  <button
                    key={o.start}
                    onClick={() => setChosen(on ? null : o)}
                    aria-pressed={on}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 8,
                      border: on ? "2px solid #2563eb" : "1px solid #cbd5e1",
                      background: on ? "#eff6ff" : "#fff",
                      color: "#1e293b",
                      fontSize: 14,
                      cursor: "pointer",
                    }}
                  >
                    {timeLabel(new Date(o.start))}{T("m_time_from")}
                  </button>
                );
              })}
            </div>
          </section>
        ))}

      {chosen && (
        <section style={{ marginTop: 24, padding: "16px", border: "1px solid #e2e8f0", borderRadius: 12 }}>
          <p style={{ margin: "0 0 8px", color: "#334155" }}>
            {T("m_b_chosen_prefix")}{dayLabel(new Date(chosen.start), locale)} {timeLabel(new Date(chosen.start))}{T("m_b_chosen_mid")}{info.minutes}{T("m_b_chosen_suffix")}
          </p>
          <label style={{ display: "block", margin: "8px 0" }}>
            {T("m_guest_name_label")}
            <input style={input} value={guestName} onChange={(e) => setGuestName(e.target.value)} aria-label={T("name_placeholder")} />
          </label>
          <label style={{ display: "block", margin: "8px 0" }}>
            {T("m_b_contact_label")}
            <input style={input} value={guestContact} onChange={(e) => setGuestContact(e.target.value)} aria-label={T("m_guest_contact_aria")} />
          </label>
          <label style={{ display: "block", margin: "8px 0" }}>
            {T("m_b_topic_label")}
            <textarea style={input} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} aria-label={T("m_b_topic_aria")} />
          </label>
          {error && <p role="alert" style={{ color: "#b91c1c" }}>{error}</p>}
          <button
            style={{ padding: "12px 24px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}
            disabled={busy || !guestName.trim()}
            onClick={() => void book()}
          >
            {busy ? T("m_b_booking_busy") : info.priceJpy > 0 ? T("m_b_pay_btn") : T("m_b_book_btn")}
          </button>
        </section>
      )}
    </main>
  );
}
