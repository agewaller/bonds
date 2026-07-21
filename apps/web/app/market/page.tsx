"use client";
// 公開掲示板 — オーナーが公開に載せた「時間の受け付け」と「力になれること」を、
// アカウント不要の訪問者が見て、問い合わせ・予約できる。新しいつながりの入口。
import { useEffect, useState } from "react";
import Link from "next/link";
import { t, currentLocale, type Locale } from "../../lib/i18n";

type TimeOffer = {
  offerKey: string;
  title: string;
  description: string;
  displayName: string;
  methodLabel: string;
  minutes: number;
  priceJpy: number;
  acceptingBookings: boolean;
};
type Offering = { id: string; kind: string; kindLabel: string; title: string; description: string | null; category: string | null };

const card: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px" };
const btn: React.CSSProperties = {
  padding: "8px 16px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14,
};

export default function MarketPage() {
  // cookie はクライアントでしか読めないため、初回描画後に反映する
  const [locale, setLoc] = useState<Locale>("ja");
  useEffect(() => setLoc(currentLocale()), []);
  const T = (key: string) => t(key, locale);
  const [timeOffers, setTimeOffers] = useState<TimeOffer[] | null>(null);
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/bff/public/market");
      if (res.ok) {
        const b = await res.json();
        setTimeOffers(b.timeOffers ?? []);
        setOfferings(b.offerings ?? []);
      } else {
        setTimeOffers([]);
      }
    })();
  }, []);

  const submitInterest = async (id: string) => {
    setError("");
    if (!name.trim() || !message.trim()) {
      setError(t("m_mkt_need_name_msg"));
      return;
    }
    const res = await fetch(`/api/bff/public/market/offerings/${id}/interest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestName: name.trim(), guestContact: contact.trim() || undefined, message: message.trim() }),
    });
    if (res.ok) {
      setSentIds((s) => new Set(s).add(id));
      setOpenId(null);
      setName("");
      setContact("");
      setMessage("");
    } else {
      setError(t("m_mkt_send_fail"));
    }
  };

  const empty = timeOffers !== null && timeOffers.length === 0 && offerings.length === 0;

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
      <p><Link href="/" style={{ color: "#2563eb" }}>{T("back_home")}</Link></p>
      <h1 style={{ fontSize: 24 }}>{T("m_mkt_title")}</h1>
      <p style={{ color: "#64748b", lineHeight: 1.8 }}>
        {T("m_mkt_intro")}
      </p>
      {error && <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>{error}</p>}
      {timeOffers === null && <p style={{ color: "#64748b" }}>{T("m_loading")}</p>}
      {empty && <p style={{ color: "#64748b" }}>{T("m_mkt_empty")}</p>}

      {offerings.length > 0 && (
        <section style={{ margin: "20px 0" }}>
          <h2 style={{ fontSize: 18 }}>{T("m_mkt_offerings")}</h2>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
            {offerings.map((o) => (
              <li key={o.id} style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                  <span style={{ fontWeight: 600 }}>{o.title}</span>
                  <small style={{ color: "#16a34a", whiteSpace: "nowrap" }}>{o.kindLabel}</small>
                </div>
                {o.description && <p style={{ margin: "6px 0 0", color: "#334155", fontSize: 14 }}>{o.description}</p>}
                {sentIds.has(o.id) ? (
                  <p style={{ color: "#047857", fontSize: 14, margin: "10px 0 0" }}>{T("m_mkt_thanks")}</p>
                ) : openId === o.id ? (
                  <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder={T("name_placeholder")}
                      style={{ padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14 }} />
                    <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder={T("m_mkt_contact_ph")}
                      style={{ padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14 }} />
                    <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder={T("m_mkt_msg_ph")} rows={3}
                      style={{ padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14 }} />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button style={btn} onClick={() => void submitInterest(o.id)}>{T("m_mkt_send")}</button>
                      <button onClick={() => setOpenId(null)}
                        style={{ padding: "8px 16px", background: "#fff", color: "#334155", border: "1px solid #cbd5e1", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>
                        {T("m_mkt_cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button style={{ ...btn, marginTop: 10 }} onClick={() => { setOpenId(o.id); setError(""); }}>
                    {T("m_mkt_interest_btn")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {timeOffers && timeOffers.length > 0 && (
        <section style={{ margin: "20px 0" }}>
          <h2 style={{ fontSize: 18 }}>{T("m_mkt_time")}</h2>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
            {timeOffers.map((o) => (
              <li key={o.offerKey} style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                  <span style={{ fontWeight: 600 }}>{o.title}</span>
                  <small style={{ color: "#64748b", whiteSpace: "nowrap" }}>
                    {o.minutes}{T("m_min_short")}・{o.priceJpy === 0 ? T("m_free") : `${o.priceJpy.toLocaleString()}${T("m_yen")}`}
                  </small>
                </div>
                {o.description && <p style={{ margin: "6px 0 0", color: "#334155", fontSize: 14 }}>{o.description}</p>}
                <p style={{ margin: "8px 0 0" }}>
                  <Link href={`/b/${o.offerKey}`} style={{ color: "#2563eb", fontSize: 14 }}>
                    {o.acceptingBookings ? T("m_mkt_book_link") : T("m_mkt_details_link")}
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
