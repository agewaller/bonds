"use client";
// 連絡先詳細のメッセージ欄 — 往復のやりとり (スレッド) を読み、返事や新しい一言を送る。
// 文言は寄り添い基調・技術語なし・記号装飾なし (CLAUDE.md 共通プロダクト原則)。
// 送るときは常に本文を目で確かめてから (外に出る行動は承認前提)。
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/client-api";
import { t, currentLocale } from "../lib/i18n";

type Message = {
  id: string;
  direction: string;
  body: string;
  status: string;
  createdAt: string;
};
type Thread = { id: string; channel: string; subject: string | null; messages: Message[] };

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

function fmtDate(iso: string) {
  const d = new Date(iso);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (currentLocale() === "en") return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

export function MessagesSection({ contactId, contactEmail }: { contactId: string; contactEmail: string | null }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await apiFetch(`contacts/${contactId}/messages`);
    if (res.ok) {
      const b = await res.json();
      setThreads(b.threads ?? []);
    }
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async (reallySend: boolean) => {
    if (!body.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await apiFetch(`contacts/${contactId}/messages`, {
        method: "POST",
        body: JSON.stringify({ subject: subject.trim() || null, body: body.trim(), send: reallySend }),
      });
      const rb = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(rb.detail ?? t("x_error_retry_later"));
        return;
      }
      if (reallySend && rb.message?.status === "sent") {
        setNotice(t("x_msg_sent_recorded"));
      } else if (reallySend && rb.message?.status === "failed") {
        setError(t("x_msg_send_failed_draft"));
      } else {
        setNotice(t("x_msg_saved_draft"));
      }
      setSubject("");
      setBody("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const all = threads.flatMap((t) => t.messages);

  return (
    <section style={{ marginTop: 32 }}>
      <h2 style={{ fontSize: 18 }}>{t("x_msg_heading")}</h2>
      {notice && <p style={{ color: "#166534", background: "#f0fdf4", padding: 8, borderRadius: 8 }}>{notice}</p>}
      {error && (
        <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>{error}</p>
      )}
      {all.length === 0 ? (
        <p style={{ color: "#64748b" }}>{t("x_msg_empty")}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {all.map((m) => (
            <div
              key={m.id}
              style={{
                alignSelf: m.direction === "outbound" ? "flex-end" : "flex-start",
                maxWidth: "85%",
                background: m.direction === "outbound" ? "#eff6ff" : "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                padding: "8px 12px",
              }}
            >
              <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                {m.direction === "outbound" ? t("x_msg_you") : t("x_msg_them")} ・ {fmtDate(m.createdAt)}
                {m.status === "draft" && t("x_msg_status_draft")}
                {m.status === "failed" && t("x_msg_status_failed")}
              </div>
            </div>
          ))}
        </div>
      )}
      <label style={{ display: "block", margin: "8px 0" }}>
        {t("x_msg_subject_label")}
        <input style={input} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label style={{ display: "block", margin: "8px 0" }}>
        {t("x_msg_body_label")}
        <textarea
          style={input}
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("x_msg_placeholder")}
        />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={btn()} onClick={() => void send(true)} disabled={busy || !body.trim() || !contactEmail}>
          {t("x_msg_send")}
        </button>
        <button style={btn(false)} onClick={() => void send(false)} disabled={busy || !body.trim()}>
          {t("x_msg_save_draft")}
        </button>
      </div>
      {!contactEmail && (
        <p style={{ color: "#64748b", fontSize: 13, marginTop: 6 }}>
          {t("x_msg_need_email")}
        </p>
      )}
    </section>
  );
}
