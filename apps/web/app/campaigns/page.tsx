"use client";
// 一斉配信 (メールのお便り)。1 通の文面を、選んだ相手にまとめて送る。
// テンプレ + お名前差し込み (AI 費用ゼロ)。少しずつ送る + 配信停止 + 送信者表示つき。
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "../../lib/client-api";
import { t, currentLocale, type Locale } from "../../lib/i18n";

type Campaign = {
  id: string;
  subject: string;
  body: string;
  segment: Record<string, unknown>;
  fromName: string | null;
  status: string;
  dailyLimit: number;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
};

const STATUS_KEY: Record<string, string> = {
  draft: "m_cmp_status_draft",
  approved: "m_cmp_status_approved",
  sending: "m_cmp_status_sending",
  sent: "m_cmp_status_sent",
  canceled: "m_cmp_status_canceled",
};

const input: React.CSSProperties = { width: "100%", padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, fontFamily: "inherit" };
const btn = (primary = true): React.CSSProperties => ({
  padding: "8px 16px",
  background: primary ? "#2563eb" : "#fff",
  color: primary ? "#fff" : "#334155",
  border: primary ? "none" : "1px solid #cbd5e1",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 14,
});

export default function CampaignsPage() {
  // cookie はクライアントでしか読めないため、初回描画後に反映する
  const [locale, setLoc] = useState<Locale>("ja");
  useEffect(() => setLoc(currentLocale()), []);
  const T = (key: string) => t(key, locale);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [mailerReady, setMailerReady] = useState(true);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  // 作成フォーム
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("いつもお世話になっております。{{お名前}}様\n\n");
  const [fromName, setFromName] = useState("");
  const [dailyLimit, setDailyLimit] = useState("200");
  const [segAll, setSegAll] = useState(true);
  const [segDistanceMax, setSegDistanceMax] = useState("");
  const [segLastDaysMin, setSegLastDaysMin] = useState("");
  const [segCompany, setSegCompany] = useState("");
  const [segPinned, setSegPinned] = useState(false);

  // 作成後の1件の操作用
  const [current, setCurrent] = useState<Campaign | null>(null);
  const [audience, setAudience] = useState<number | null>(null);
  const [samples, setSamples] = useState<{ name: string; subject: string; body: string }[]>([]);
  const [testTo, setTestTo] = useState("");
  const [tested, setTested] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch("campaigns");
    if (r.ok) {
      const b = await r.json();
      setCampaigns(b.campaigns ?? []);
      setMailerReady(!!b.mailerReady);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const buildSegment = () => {
    const seg: Record<string, unknown> = {};
    if (segAll) seg.all = true;
    if (segDistanceMax) seg.distanceMax = Number(segDistanceMax);
    if (segLastDaysMin) seg.lastContactDaysMin = Number(segLastDaysMin);
    if (segCompany.trim()) seg.company = segCompany.trim();
    if (segPinned) seg.pinnedOnly = true;
    return seg;
  };

  const createDraft = async () => {
    setError("");
    if (!subject.trim() || !body.trim()) {
      setError(t("m_cmp_need_subject_body"));
      return;
    }
    const r = await apiFetch("campaigns", {
      method: "POST",
      body: JSON.stringify({ subject, body, fromName: fromName.trim() || undefined, dailyLimit: Number(dailyLimit) || 200, segment: buildSegment() }),
    });
    const bd = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(bd.detail ?? t("m_cmp_create_fail"));
      return;
    }
    setCurrent(bd.campaign);
    setTested(false);
    setAudience(null);
    setSamples([]);
    setNotice(t("m_cmp_draft_created"));
    await load();
    void preview(bd.campaign.id);
  };

  const preview = async (id: string) => {
    const r = await apiFetch(`campaigns/${id}/preview`, { method: "POST", body: "{}" });
    if (r.ok) {
      const b = await r.json();
      setAudience(b.audience ?? 0);
      setSamples(b.samples ?? []);
    }
  };

  const sendTest = async () => {
    if (!current) return;
    setError("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testTo.trim())) {
      setError(t("m_cmp_test_addr_invalid"));
      return;
    }
    const r = await apiFetch(`campaigns/${current.id}/send-test`, { method: "POST", body: JSON.stringify({ to: testTo.trim() }) });
    const b = await r.json().catch(() => ({}));
    if (r.ok) {
      setTested(true);
      setNotice(t("m_cmp_test_sent"));
    } else {
      setError(b.detail ?? t("m_cmp_test_fail"));
    }
  };

  const approve = async () => {
    if (!current) return;
    setError("");
    const r = await apiFetch(`campaigns/${current.id}/approve`, { method: "POST", body: "{}" });
    const b = await r.json().catch(() => ({}));
    if (r.ok) {
      setNotice(`${t("m_cmp_approved_p1")}${b.audience}${t("m_cmp_approved_p2")}${current.dailyLimit}${t("m_cmp_approved_p3")}`);
      setCurrent(null);
      await load();
    } else {
      setError(b.detail ?? t("m_cmp_approve_fail"));
    }
  };

  const cancel = async (id: string) => {
    await apiFetch(`campaigns/${id}/cancel`, { method: "POST", body: "{}" });
    await load();
  };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
      <p>
        <Link href="/contacts" style={{ color: "#2563eb" }}>{T("m_back_contacts")}</Link>
      </p>
      <h1 style={{ fontSize: 24 }}>{T("m_cmp_title")}</h1>
      <p style={{ color: "#64748b", fontSize: 14, lineHeight: 1.8 }}>
        {T("m_cmp_intro1")}<code>{"{{お名前}}"}</code>{T("m_cmp_intro2")}<code>{"{{会社}}"}</code>{T("m_cmp_intro3")}
      </p>

      {!mailerReady && (
        <p style={{ color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", padding: 10, borderRadius: 8, fontSize: 13 }}>
          {T("m_cmp_mailer_pending")}
        </p>
      )}
      {notice && <p style={{ color: "#166534", background: "#f0fdf4", padding: 8, borderRadius: 8 }}>{notice}</p>}
      {error && <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>{error}</p>}

      <section style={{ marginTop: 20, border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 }}>
        <h2 style={{ fontSize: 17 }}>{T("m_cmp_sec_compose")}</h2>
        <label style={{ display: "block", margin: "10px 0 4px", fontSize: 14 }}>{T("m_cmp_subject")}</label>
        <input style={input} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={T("m_cmp_subject_ph")} aria-label={T("m_cmp_subject")} />
        <label style={{ display: "block", margin: "10px 0 4px", fontSize: 14 }}>{T("m_cmp_body_label1")}{"{{お名前}}"} / {"{{会社}}"}{T("m_cmp_body_label2")}</label>
        <textarea style={{ ...input, minHeight: 160 }} value={body} onChange={(e) => setBody(e.target.value)} aria-label={T("m_cmp_body_aria")} />
        <label style={{ display: "block", margin: "10px 0 4px", fontSize: 14 }}>{T("m_cmp_from_label")}</label>
        <input style={input} value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder={T("m_cmp_from_ph")} aria-label={T("m_cmp_from_aria")} />

        <h3 style={{ fontSize: 15, margin: "16px 0 6px" }}>{T("m_cmp_sec_audience")}</h3>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, margin: "4px 0" }}>
          <input type="checkbox" checked={segAll} onChange={(e) => setSegAll(e.target.checked)} />
          {T("m_cmp_seg_all")}
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, margin: "4px 0" }}>
          <input type="checkbox" checked={segPinned} onChange={(e) => setSegPinned(e.target.checked)} />
          {T("m_cmp_seg_pinned")}
        </label>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "6px 0" }}>
          <label style={{ fontSize: 14 }}>
            {T("m_cmp_seg_distance")}{" "}
            <select value={segDistanceMax} onChange={(e) => setSegDistanceMax(e.target.value)} style={{ padding: 6, borderRadius: 6, border: "1px solid #e2e8f0" }}>
              <option value="">{T("m_cmp_no_limit")}</option>
              <option value="2">{T("m_cmp_d2")}</option>
              <option value="3">{T("m_cmp_d3")}</option>
              <option value="4">{T("m_cmp_d4")}</option>
            </select>
          </label>
          <label style={{ fontSize: 14 }}>
            {T("m_cmp_seg_last")}{" "}
            <select value={segLastDaysMin} onChange={(e) => setSegLastDaysMin(e.target.value)} style={{ padding: 6, borderRadius: 6, border: "1px solid #e2e8f0" }}>
              <option value="">{T("m_cmp_no_limit")}</option>
              <option value="90">{T("m_cmp_last90")}</option>
              <option value="180">{T("m_cmp_last180")}</option>
              <option value="365">{T("m_cmp_last365")}</option>
            </select>
          </label>
        </div>
        <label style={{ display: "block", margin: "6px 0 4px", fontSize: 14 }}>{T("m_cmp_company_label")}</label>
        <input style={input} value={segCompany} onChange={(e) => setSegCompany(e.target.value)} placeholder={T("m_cmp_company_ph")} aria-label={T("m_cmp_company_aria")} />
        <label style={{ display: "block", margin: "10px 0 4px", fontSize: 14 }}>{T("m_cmp_daily_label")}</label>
        <input style={{ ...input, width: 120 }} value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value.replace(/[^0-9]/g, ""))} aria-label={T("m_cmp_daily_aria")} />

        <div style={{ marginTop: 14 }}>
          <button style={btn()} onClick={() => void createDraft()}>{T("m_cmp_create_btn")}</button>
        </div>
      </section>

      {current && (
        <section style={{ marginTop: 20, border: "2px solid #93c5fd", borderRadius: 12, padding: 16, background: "#eff6ff" }}>
          <h2 style={{ fontSize: 17 }}>{T("m_cmp_sec_confirm")}</h2>
          <p style={{ fontSize: 14, color: "#1e3a8a" }}>
            {T("m_cmp_audience_pre")}<strong>{audience ?? "…"}</strong>{T("m_cmp_audience_post")}
          </p>
          {samples.length > 0 && (
            <div style={{ margin: "8px 0" }}>
              <p style={{ fontSize: 13, color: "#475569", margin: "0 0 4px" }}>{T("m_cmp_samples")}</p>
              {samples.slice(0, 2).map((s, i) => (
                <div key={i} style={{ border: "1px solid #dbeafe", borderRadius: 8, padding: "8px 10px", background: "#fff", margin: "4px 0" }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{s.subject}</div>
                  <div style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "#334155" }}>{s.body}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "8px 0" }}>
            <input style={{ ...input, flex: "1 1 220px" }} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={T("m_cmp_test_ph")} aria-label={T("m_cmp_test_aria")} />
            <button style={btn(false)} onClick={() => void sendTest()}>{T("m_cmp_test_btn")}</button>
          </div>
          <button style={{ ...btn(), opacity: tested ? 1 : 0.5 }} disabled={!tested} onClick={() => void approve()}>
            {tested ? T("m_cmp_start_btn") : T("m_cmp_test_first")}
          </button>
        </section>
      )}

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 17 }}>{T("m_cmp_sec_history")}</h2>
        {campaigns.length === 0 ? (
          <p style={{ color: "#64748b" }}>{T("m_none_yet")}</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
            {campaigns.map((cm) => (
              <li key={cm.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600 }}>{cm.subject}</span>
                  <span style={{ color: "#64748b", fontSize: 13 }}>{STATUS_KEY[cm.status] ? T(STATUS_KEY[cm.status]!) : cm.status}</span>
                </div>
                <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>
                  {T("m_cmp_st1")}{cm.total}{T("m_cmp_st2")}{cm.sent}{T("m_cmp_st3")}{cm.failed}{T("m_cmp_st4")}{cm.skipped}
                </div>
                {(cm.status === "approved" || cm.status === "sending") && (
                  <button style={{ ...btn(false), marginTop: 6, fontSize: 13, padding: "4px 12px" }} onClick={() => void cancel(cm.id)}>
                    {T("m_cmp_cancel_btn")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
