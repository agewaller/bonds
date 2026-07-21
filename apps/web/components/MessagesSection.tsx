"use client";
// 連絡先詳細のメッセージ欄 — 往復のやりとり (スレッド) を読み、返事や新しい一言を送る。
// 文言は寄り添い基調・技術語なし・記号装飾なし (CLAUDE.md 共通プロダクト原則)。
// 送るときは常に本文を目で確かめてから (外に出る行動は承認前提)。
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/client-api";

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
  return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
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
        setError(rb.detail ?? "うまくいきませんでした。しばらくしてからお試しください");
        return;
      }
      if (reallySend && rb.message?.status === "sent") {
        setNotice("お送りしました。やりとりの記録にも残しています");
      } else if (reallySend && rb.message?.status === "failed") {
        setError("送信できませんでした。下書きとして残しています");
      } else {
        setNotice("下書きとして残しました");
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
      <h2 style={{ fontSize: 18 }}>やりとり (メッセージ)</h2>
      {notice && <p style={{ color: "#166534", background: "#f0fdf4", padding: 8, borderRadius: 8 }}>{notice}</p>}
      {error && (
        <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>{error}</p>
      )}
      {all.length === 0 ? (
        <p style={{ color: "#64748b" }}>まだやりとりはありません。最初のひとことを送ってみませんか。</p>
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
                {m.direction === "outbound" ? "あなた" : "この方"} ・ {fmtDate(m.createdAt)}
                {m.status === "draft" && " ・ 下書き"}
                {m.status === "failed" && " ・ 送れませんでした"}
              </div>
            </div>
          ))}
        </div>
      )}
      <label style={{ display: "block", margin: "8px 0" }}>
        題名 (任意)
        <input style={input} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label style={{ display: "block", margin: "8px 0" }}>
        メッセージ
        <textarea
          style={input}
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="お元気ですか。ふと思い出してご連絡しました。"
        />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={btn()} onClick={() => void send(true)} disabled={busy || !body.trim() || !contactEmail}>
          送る
        </button>
        <button style={btn(false)} onClick={() => void send(false)} disabled={busy || !body.trim()}>
          下書きとして残す
        </button>
      </div>
      {!contactEmail && (
        <p style={{ color: "#64748b", fontSize: 13, marginTop: 6 }}>
          メールアドレスを登録すると、ここからそのまま送れます。
        </p>
      )}
    </section>
  );
}
