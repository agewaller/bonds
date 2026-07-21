"use client";
// 連絡先詳細のシェア欄 — 時間・知恵・モノを差し出す / お願いする / いただいた記録。
// 送ると相手用のリンクが発行され、相手はログインなしで受け取り/辞退と一言を返せる。
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/client-api";
import { t } from "../lib/i18n";

type Share = {
  id: string;
  kind: string;
  direction: string;
  title: string;
  status: string;
  createdAt: string;
};

const input = { width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 8 } as const;
const btn = (primary = true) =>
  ({
    padding: "8px 16px",
    background: primary ? "#2563eb" : "#fff",
    color: primary ? "#fff" : "#2563eb",
    border: "1px solid #2563eb",
    borderRadius: 8,
    cursor: "pointer",
  }) as const;

// 表示ラベルは辞書キーへの対応表にして、描画のたびに t() で引く (言語切替に追従)
const KIND_KEY: Record<string, string> = {
  time: "x_share_kind_time",
  wisdom: "x_share_kind_wisdom",
  thing: "x_share_kind_thing",
};
const DIRECTION_KEY: Record<string, string> = {
  offer: "x_share_dir_offer",
  request: "x_share_dir_request",
  inbound: "x_share_dir_inbound",
};
const STATUS_KEY: Record<string, string> = {
  proposed: "x_share_status_proposed",
  sent: "x_share_status_sent",
  accepted: "x_share_status_accepted",
  declined: "x_share_status_declined",
  fulfilled: "x_share_status_fulfilled",
  cancelled: "x_share_status_cancelled",
};
const label = (map: Record<string, string>, value: string) => (map[value] ? t(map[value]) : value);

export function SharesSection({ contactId }: { contactId: string }) {
  const [shares, setShares] = useState<Share[]>([]);
  const [kind, setKind] = useState("time");
  const [direction, setDirection] = useState("offer");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await apiFetch(`shares?contactId=${contactId}`);
    if (res.ok) setShares((await res.json()).shares ?? []);
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    setShareUrl("");
    try {
      const res = await apiFetch(`contacts/${contactId}/shares`, {
        method: "POST",
        body: JSON.stringify({ kind, direction, title: title.trim(), message: message.trim() || null }),
      });
      const rb = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(rb.detail ?? t("x_error_generic"));
        return;
      }
      setNotice(direction === "inbound" ? t("x_share_recorded_inbound") : t("x_share_prepared"));
      setTitle("");
      setMessage("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: string, path: string, body?: unknown) => {
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch(`shares/${id}/${path}`, {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      });
      const rb = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(rb.detail ?? t("x_error_generic"));
        return;
      }
      if (rb.shareUrl) {
        setShareUrl(rb.shareUrl);
        setNotice(rb.delivered ? t("x_share_notified_mail") : t("x_share_link_ready"));
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={{ marginTop: 32 }}>
      <h2 style={{ fontSize: 18 }}>{t("x_share_heading")}</h2>
      <p style={{ color: "#64748b", fontSize: 14 }}>{t("x_share_desc")}</p>
      {notice && <p style={{ color: "#166534", background: "#f0fdf4", padding: 8, borderRadius: 8 }}>{notice}</p>}
      {error && (
        <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>{error}</p>
      )}
      {shareUrl && (
        <p style={{ background: "#eff6ff", padding: 8, borderRadius: 8, wordBreak: "break-all" }}>
          {t("x_share_link_label")} <a href={shareUrl} style={{ color: "#2563eb" }}>{shareUrl}</a>
        </p>
      )}

      <div style={{ display: "flex", gap: 8, margin: "8px 0" }}>
        <select style={{ ...input, width: "auto" }} value={direction} onChange={(e) => setDirection(e.target.value)} aria-label={t("x_share_aria_direction")}>
          <option value="offer">{t("x_share_opt_offer")}</option>
          <option value="request">{t("x_share_opt_request")}</option>
          <option value="inbound">{t("x_share_opt_inbound")}</option>
        </select>
        <select style={{ ...input, width: "auto" }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t("x_share_aria_kind")}>
          <option value="time">{t("x_share_opt_time")}</option>
          <option value="wisdom">{t("x_share_opt_wisdom")}</option>
          <option value="thing">{t("x_share_opt_thing")}</option>
        </select>
      </div>
      <label style={{ display: "block", margin: "8px 0" }}>
        {t("x_share_title_label")}
        <input
          style={input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("x_share_title_ph")}
        />
      </label>
      <label style={{ display: "block", margin: "8px 0" }}>
        {t("x_share_message_label")}
        <textarea style={input} rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
      <button style={btn()} onClick={() => void create()} disabled={busy || !title.trim()}>
        {direction === "inbound" ? t("x_share_btn_record") : t("x_share_btn_prepare")}
      </button>

      {shares.length > 0 && (
        <ul style={{ marginTop: 16, paddingLeft: 0, listStyle: "none" }}>
          {shares.map((s) => (
            <li key={s.id} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", marginBottom: 8 }}>
              <div>
                <strong>{s.title}</strong>
                <span style={{ color: "#64748b", marginLeft: 8, fontSize: 13 }}>
                  {label(KIND_KEY, s.kind)} ・ {label(DIRECTION_KEY, s.direction)} ・ {label(STATUS_KEY, s.status)}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                {s.status === "proposed" && (
                  <button style={btn(false)} onClick={() => void act(s.id, "send")} disabled={busy}>
                    {t("x_share_btn_send")}
                  </button>
                )}
                {s.status === "accepted" && (
                  <button style={btn(false)} onClick={() => void act(s.id, "status", { status: "fulfilled" })} disabled={busy}>
                    {t("x_share_btn_fulfilled")}
                  </button>
                )}
                {(s.status === "proposed" || s.status === "sent" || s.status === "accepted") && (
                  <button style={btn(false)} onClick={() => void act(s.id, "status", { status: "cancelled" })} disabled={busy}>
                    {t("x_share_btn_cancel")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
