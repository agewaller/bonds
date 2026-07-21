"use client";
// 設定 — 散らばっていた設定ごとを一箇所に集める入り口。
// アカウント / Google 連携 / 空き時間と日程調整 / ことば / データの書き出し /
// 見送った提案の戻し / 管理者向け / プライバシーポリシー。
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "../../lib/client-api";
import { AuthBar } from "../../components/AuthBar";
import { LanguageSelector } from "../../components/LanguageSelector";
import { t, currentLocale, type Locale } from "../../lib/i18n";

const card: React.CSSProperties = {
  margin: "16px 0",
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  padding: "14px 16px",
};
const h2: React.CSSProperties = { margin: 0, fontSize: 16, fontWeight: 600 };
const desc: React.CSSProperties = { color: "#64748b", fontSize: 13, lineHeight: 1.8, margin: "6px 0 10px" };
const btn: React.CSSProperties = {
  padding: "8px 16px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 14,
};
const btnGhost: React.CSSProperties = {
  padding: "8px 16px",
  background: "#fff",
  color: "#334155",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 14,
};

export default function SettingsPage() {
  // cookie はクライアントでしか読めないため、初回描画後に反映する
  const [locale, setLoc] = useState<Locale>("ja");
  useEffect(() => setLoc(currentLocale()), []);
  const T = (key: string) => t(key, locale);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [google, setGoogle] = useState<{
    available: boolean;
    connected: boolean;
    extended?: boolean;
    email?: string | null;
  } | null>(null);
  const [audit, setAudit] = useState<{ total: number; sample: string[] } | null>(null);
  const [purging, setPurging] = useState(false);
  const [devices, setDevices] = useState<Array<{
    provider: string;
    ready: boolean;
    connected: boolean;
    lastSyncAt: string | null;
    lastSyncNote: string | null;
  }> | null>(null);

  const loadDevices = async () => {
    const res = await apiFetch("devices/status");
    if (res.ok) setDevices((await res.json()).providers);
    else setDevices([]);
  };

  const loadAudit = async () => {
    const res = await apiFetch("admin/audit-data");
    if (res.ok) setAudit(await res.json());
  };

  useEffect(() => {
    void (async () => {
      const res = await apiFetch("google/status");
      setGoogle(res.ok ? await res.json() : { available: false, connected: false });
    })();
    void loadAudit();
    void loadDevices();
  }, []);

  const deviceConnect = async (provider: string) => {
    setError("");
    const res = await apiFetch(`devices/${provider}/auth-url`);
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.url) window.location.href = body.url;
    else setError(body.detail ?? t("m_set_connect_fail"));
  };

  const deviceSync = async (provider: string) => {
    setError("");
    const res = await apiFetch(`devices/${provider}/sync`, { method: "POST", body: "{}" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setNotice(`${t("m_set_dev_synced")} (${body.saved ?? 0})`);
      await loadDevices();
    } else setError(body.detail ?? t("m_set_connect_fail"));
  };

  const deviceDisconnect = async (provider: string) => {
    setError("");
    const res = await apiFetch(`devices/${provider}/disconnect`, { method: "POST", body: "{}" });
    if (res.ok) await loadDevices();
  };

  const purgeAudit = async () => {
    setError("");
    setPurging(true);
    const res = await apiFetch("admin/audit-data/purge", { method: "POST", body: "{}" });
    setPurging(false);
    if (res.ok) {
      setNotice(t("m_set_purged"));
      await loadAudit();
    } else {
      setError(t("m_set_purge_fail"));
    }
  };

  const googleConnect = async (scope?: "extended") => {
    setError("");
    const res = await apiFetch(`google/auth-url${scope ? "?scope=extended" : ""}`);
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.url) window.location.href = body.url;
    else setError(body.detail ?? t("m_set_connect_fail"));
  };

  const restoreDismissals = async () => {
    setError("");
    const res = await apiFetch("relationship/dismissals", { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) setNotice(`${t("m_set_restored_p1")}${body.restored ?? 0}${t("m_set_restored_p2")}`);
    else setError(t("m_set_restore_fail"));
  };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
      <AuthBar />
      <p><Link href="/contacts" style={{ color: "#2563eb" }}>{T("m_back_contacts")}</Link></p>
      <h1 style={{ fontSize: 24 }}>{T("m_set_title")}</h1>

      {notice && <p style={{ color: "#166534", background: "#f0fdf4", padding: 8, borderRadius: 8 }}>{notice}</p>}
      {error && <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>{error}</p>}

      <section style={card}>
        <h2 style={h2}>{T("m_set_google")}</h2>
        <p style={desc}>
          {T("m_set_google_desc")}
        </p>
        {google === null && <p style={{ color: "#64748b", fontSize: 14 }}>{T("m_set_checking")}</p>}
        {google?.available === false && (
          <p style={{ color: "#64748b", fontSize: 14 }}>{T("m_set_google_unavailable")}</p>
        )}
        {google?.available && !google.connected && (
          <button style={btn} onClick={() => void googleConnect()}>{T("m_set_google_connect")}</button>
        )}
        {google?.available && google.connected && (
          <div>
            <p style={{ color: "#166534", fontSize: 14, margin: "0 0 8px" }}>
              {T("m_set_google_connected")}{google.email ? ` (${google.email})` : ""}
            </p>
            {!google.extended && (
              <div>
                <p style={desc}>
                  {T("m_set_google_ext_desc")}
                </p>
                <button style={btnGhost} onClick={() => void googleConnect("extended")}>
                  {T("m_set_google_ext_btn")}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <section style={card}>
        <h2 style={h2}>{T("m_set_devices")}</h2>
        <p style={desc}>{T("m_set_devices_desc")}</p>
        {devices === null && <p style={{ color: "#64748b", fontSize: 14 }}>{T("m_set_checking")}</p>}
        {devices?.map((d) => (
          <div key={d.provider} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "8px 0" }}>
            <span style={{ fontSize: 14, minWidth: 180 }}>
              {T(d.provider === "oura" ? "m_set_dev_oura" : "m_set_dev_withings")}
            </span>
            {!d.ready && <span style={{ color: "#64748b", fontSize: 13 }}>{T("m_set_dev_unavailable")}</span>}
            {d.ready && !d.connected && (
              <button style={btn} onClick={() => void deviceConnect(d.provider)}>{T("m_set_dev_connect")}</button>
            )}
            {d.ready && d.connected && (
              <>
                <span style={{ color: "#166534", fontSize: 13 }}>
                  {T("m_set_dev_connected")}
                  {d.lastSyncAt ? ` (${T("m_set_dev_last")}: ${new Date(d.lastSyncAt).toLocaleDateString()})` : ""}
                </span>
                <button style={btnGhost} onClick={() => void deviceSync(d.provider)}>{T("m_set_dev_sync")}</button>
                <button style={btnGhost} onClick={() => void deviceDisconnect(d.provider)}>{T("m_set_dev_disconnect")}</button>
              </>
            )}
          </div>
        ))}
      </section>

      <section style={card}>
        <h2 style={h2}>{T("m_set_sched")}</h2>
        <p style={desc}>
          {T("m_set_sched_desc")}
        </p>
        <Link href="/schedule" style={{ color: "#2563eb", fontSize: 14 }}>{T("m_set_sched_link")}</Link>
      </section>

      <section style={card}>
        <h2 style={h2}>{T("m_set_market")}</h2>
        <p style={desc}>
          {T("m_set_market_desc")}
        </p>
        <a href="/market" target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", fontSize: 14 }}>
          {T("m_set_market_link")}
        </a>
      </section>

      <section style={card}>
        <h2 style={h2}>{T("m_set_lang")}</h2>
        <p style={desc}>{T("m_set_lang_desc")}</p>
        <LanguageSelector />
      </section>

      <section style={card}>
        <h2 style={h2}>{T("m_set_dismissals")}</h2>
        <p style={desc}>
          {T("m_set_dismissals_desc")}
        </p>
        <button style={btnGhost} onClick={() => void restoreDismissals()}>{T("m_set_dismissals_btn")}</button>
      </section>

      <section style={card}>
        <h2 style={h2}>{T("m_set_export")}</h2>
        <p style={desc}>
          {T("m_set_export_desc")}
        </p>
        <a href="/api/bff/contacts/export" style={{ color: "#2563eb", fontSize: 14 }}>{T("m_set_export_link")}</a>
      </section>

      {audit && audit.total > 0 && (
        <section style={{ ...card, border: "1px solid #fecaca", background: "#fef2f2" }}>
          <h2 style={h2}>{T("m_set_audit")}</h2>
          <p style={desc}>
            {T("m_set_audit_p1")}{audit.total}{T("m_set_audit_p2")}{audit.sample.slice(0, 5).join(T("m_list_sep"))}{T("m_set_audit_p3")}
          </p>
          <button style={{ ...btn, background: "#dc2626" }} disabled={purging} onClick={() => void purgeAudit()}>
            {purging ? T("m_set_purging") : `${T("m_set_purge_p1")}${audit.total}${T("m_set_purge_p2")}`}
          </button>
        </section>
      )}

      <section style={card}>
        <h2 style={h2}>{T("m_set_admin")}</h2>
        <p style={desc}>{T("m_set_admin_desc")}</p>
        <Link href="/admin" style={{ color: "#2563eb", fontSize: 14 }}>{T("m_set_admin_link")}</Link>
      </section>

      <p style={{ marginTop: 24 }}>
        <Link href="/privacy" style={{ color: "#64748b", fontSize: 13 }}>{T("m_privacy_link")}</Link>
      </p>
    </main>
  );
}
