"use client";
// 提携先アウトリーチの管理画面 (cares ADR-0022 移植)。管理者 (オーナー) 専用。
// 発見 → 下書き → 承認 → 送信 → 返信 → 掲載のファネルをここで回す。
// 送信は既定で承認制。自動送信はサーバ側 PARTNER_AUTO_SEND=1 のときだけ。
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "../../../lib/client-api";

type Target = {
  id: string;
  kind: string;
  name: string;
  url: string | null;
  contactEmail: string | null;
  source: string | null;
  status: string;
  notes: string | null;
  isPublic: boolean;
  blurb: string | null;
  latestMessage: { id: string; direction: string; status: string } | null;
};
type Message = {
  id: string;
  direction: string;
  subject: string | null;
  body: string;
  status: string;
  errorDetail: string | null;
  createdAt: string;
};

const STATUS_LABEL: Record<string, string> = {
  candidate: "候補",
  queued: "下書きあり",
  contacted: "連絡済み",
  replied: "返信あり",
  partner: "提携中",
  declined: "見送り",
  suppressed: "送信除外",
};
const KIND_LABEL: Record<string, string> = {
  site: "サイト",
  sns: "SNS",
  association: "協会",
  community: "コミュニティ",
  service: "サービス",
  corp: "企業",
  other: "その他",
};

const input = { width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 8 } as const;
const btn = {
  padding: "6px 12px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
} as const;
const btnGhost = {
  padding: "6px 12px",
  background: "none",
  color: "#334155",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  cursor: "pointer",
} as const;

export default function AdminPartnersPage() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [denied, setDenied] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // 追加フォーム
  const [name, setName] = useState("");
  const [kind, setKind] = useState("site");
  const [email, setEmail] = useState("");
  // 発見フォーム
  const [theme, setTheme] = useState("");
  // 開いている提携先
  const [openId, setOpenId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editMsgId, setEditMsgId] = useState("");
  const [inboundText, setInboundText] = useState("");

  const load = useCallback(async () => {
    const res = await apiFetch("admin/partners/targets");
    if (res.status === 401 || res.status === 503) {
      setDenied(true);
      return;
    }
    if (res.ok) setTargets((await res.json()).targets);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openTarget = async (id: string) => {
    if (openId === id) {
      setOpenId("");
      return;
    }
    const res = await apiFetch(`admin/partners/targets/${id}`);
    if (res.ok) {
      setMessages((await res.json()).messages);
      setOpenId(id);
      setEditMsgId("");
      setInboundText("");
    }
  };

  const run = async (fn: () => Promise<Response>, okNotice: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fn();
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.detail ?? "うまくいきませんでした");
        return;
      }
      setNotice(body.autoSend?.detail ?? body.detail ?? okNotice);
      await load();
      if (openId) {
        const r2 = await apiFetch(`admin/partners/targets/${openId}`);
        if (r2.ok) setMessages((await r2.json()).messages);
      }
    } finally {
      setBusy(false);
    }
  };

  const addTarget = () =>
    run(
      () =>
        apiFetch("admin/partners/targets", {
          method: "POST",
          body: JSON.stringify({ name, kind, contactEmail: email || undefined }),
        }),
      "提携先の候補を追加しました",
    ).then(() => {
      setName("");
      setEmail("");
    });

  const discover = () =>
    run(
      () => apiFetch("admin/partners/discover", { method: "POST", body: JSON.stringify({ theme }) }),
      "候補をさがして追加しました",
    );

  const draft = (id: string) =>
    run(
      () => apiFetch(`admin/partners/targets/${id}/draft`, { method: "POST", body: JSON.stringify({}) }),
      "連絡文の下書きを作りました。内容を確認して送信してください",
    );

  const replyDraft = (id: string) =>
    run(
      () => apiFetch(`admin/partners/targets/${id}/reply-draft`, { method: "POST", body: JSON.stringify({}) }),
      "返事の下書きを作りました。内容を確認して送信してください",
    );

  const approveAndSend = (msgId: string) =>
    run(async () => {
      const a = await apiFetch(`admin/partners/messages/${msgId}/approve`, {
        method: "POST",
        body: JSON.stringify(editMsgId === msgId ? { subject: editSubject, body: editBody } : {}),
      });
      if (!a.ok) return a;
      return apiFetch(`admin/partners/messages/${msgId}/send`, { method: "POST", body: "{}" });
    }, "送信しました").then(() => setEditMsgId(""));

  const recordInbound = (id: string) =>
    run(
      () =>
        apiFetch(`admin/partners/targets/${id}/inbound`, {
          method: "POST",
          body: JSON.stringify({ body: inboundText }),
        }),
      "返信を記録しました",
    ).then(() => setInboundText(""));

  const patchTarget = (id: string, data: Record<string, unknown>, msg: string) =>
    run(() => apiFetch(`admin/partners/targets/${id}`, { method: "PATCH", body: JSON.stringify(data) }), msg);

  if (denied) {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
        <p>このページは管理者だけが使えます。</p>
        <p>
          <Link href="/" style={{ color: "#2563eb" }}>
            ホームへ戻る
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "40px 16px" }}>
      <p>
        <Link href="/admin" style={{ color: "#2563eb" }}>
          管理へ戻る
        </Link>
      </p>
      <h1 style={{ fontSize: 24 }}>提携先への連絡</h1>
      <p style={{ color: "#64748b" }}>
        候補をさがし、一件ずつの連絡文を下書きし、確認してから送ります。送信メールには署名と配信停止のご案内が自動で付きます。
      </p>
      {notice && <p style={{ color: "#166534", background: "#f0fdf4", padding: 8, borderRadius: 8 }}>{notice}</p>}
      {error && (
        <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>
          {error}
        </p>
      )}

      <section style={{ margin: "24px 0" }}>
        <h2 style={{ fontSize: 18 }}>候補をさがす</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="例: シニアの孤立予防に取り組む団体"
            aria-label="さがすテーマ"
            style={{ ...input, flex: 1 }}
          />
          <button onClick={() => void discover()} disabled={busy || !theme.trim()} style={btn}>
            さがす
          </button>
        </div>
      </section>

      <section style={{ margin: "24px 0" }}>
        <h2 style={{ fontSize: 18 }}>候補を手で追加</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="名称"
            aria-label="提携先の名称"
            style={{ ...input, flex: 2, minWidth: 160 }}
          />
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="種別" style={{ ...input, width: "auto" }}>
            {Object.entries(KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="連絡先メール (任意)"
            aria-label="連絡先メール"
            style={{ ...input, flex: 2, minWidth: 160 }}
          />
          <button onClick={() => void addTarget()} disabled={busy || !name.trim()} style={btn}>
            追加
          </button>
        </div>
      </section>

      <section style={{ margin: "24px 0" }}>
        <h2 style={{ fontSize: 18 }}>提携先の一覧</h2>
        {targets.length === 0 && <p style={{ color: "#64748b" }}>まだ候補がありません。</p>}
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
          {targets.map((t) => (
            <li key={t.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <span>
                  <strong>{t.name}</strong>
                  <small style={{ color: "#64748b", marginLeft: 8 }}>
                    {KIND_LABEL[t.kind] ?? t.kind} ・ {STATUS_LABEL[t.status] ?? t.status}
                    {t.contactEmail ? "" : " ・ メール未設定"}
                  </small>
                </span>
                <button onClick={() => void openTarget(t.id)} style={btnGhost}>
                  {openId === t.id ? "閉じる" : "開く"}
                </button>
              </div>
              {t.notes && <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 14 }}>{t.notes}</p>}

              {openId === t.id && (
                <div style={{ marginTop: 12, borderTop: "1px solid #e2e8f0", paddingTop: 12 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                    <input
                      defaultValue={t.contactEmail ?? ""}
                      placeholder="連絡先メール"
                      aria-label={`${t.name} の連絡先メール`}
                      onBlur={(e) => {
                        if ((e.target.value.trim() || null) !== (t.contactEmail ?? null)) {
                          void patchTarget(t.id, { contactEmail: e.target.value }, "連絡先を保存しました");
                        }
                      }}
                      style={{ ...input, flex: 1, minWidth: 200 }}
                    />
                    <button onClick={() => void draft(t.id)} disabled={busy} style={btn}>
                      連絡文を下書き
                    </button>
                    <button onClick={() => void replyDraft(t.id)} disabled={busy} style={btnGhost}>
                      返事を下書き
                    </button>
                    <button
                      onClick={() => void patchTarget(t.id, { status: "suppressed" }, "送信除外にしました")}
                      disabled={busy || t.status === "suppressed"}
                      style={btnGhost}
                    >
                      送信除外
                    </button>
                    <button
                      onClick={() =>
                        void patchTarget(
                          t.id,
                          { status: "partner", isPublic: !t.isPublic },
                          t.isPublic ? "掲載をやめました" : "提携中として掲載しました",
                        )
                      }
                      disabled={busy}
                      style={btnGhost}
                    >
                      {t.isPublic ? "掲載をやめる" : "提携先として掲載"}
                    </button>
                  </div>

                  <div style={{ display: "grid", gap: 8 }}>
                    {messages.map((m) => (
                      <div
                        key={m.id}
                        style={{
                          border: "1px solid #e2e8f0",
                          borderRadius: 8,
                          padding: "8px 12px",
                          background: m.direction === "inbound" ? "#f8fafc" : "#fff",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <small style={{ color: "#64748b" }}>
                            {m.direction === "inbound" ? "相手から" : "こちらから"} ・ {m.status}
                            {m.errorDetail ? ` ・ ${m.errorDetail}` : ""}
                          </small>
                          {m.direction === "outbound" && m.status !== "sent" && (
                            <span style={{ display: "flex", gap: 8 }}>
                              <button
                                onClick={() => {
                                  setEditMsgId(m.id);
                                  setEditSubject(m.subject ?? "");
                                  setEditBody(m.body);
                                }}
                                style={btnGhost}
                              >
                                手直し
                              </button>
                              <button onClick={() => void approveAndSend(m.id)} disabled={busy} style={btn}>
                                確認して送信
                              </button>
                            </span>
                          )}
                        </div>
                        {editMsgId === m.id ? (
                          <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                            <input
                              value={editSubject}
                              onChange={(e) => setEditSubject(e.target.value)}
                              aria-label="件名の手直し"
                              style={input}
                            />
                            <textarea
                              value={editBody}
                              onChange={(e) => setEditBody(e.target.value)}
                              rows={8}
                              aria-label="本文の手直し"
                              style={{ ...input, fontFamily: "inherit" }}
                            />
                          </div>
                        ) : (
                          <>
                            {m.subject && <p style={{ margin: "6px 0 0", fontWeight: 600 }}>{m.subject}</p>}
                            <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap", fontSize: 14 }}>{m.body}</p>
                          </>
                        )}
                      </div>
                    ))}
                    {messages.length === 0 && <p style={{ color: "#64748b" }}>まだやりとりがありません。</p>}
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <input
                      value={inboundText}
                      onChange={(e) => setInboundText(e.target.value)}
                      placeholder="相手からの返信を貼り付けて記録"
                      aria-label="返信の記録"
                      style={{ ...input, flex: 1 }}
                    />
                    <button onClick={() => void recordInbound(t.id)} disabled={busy || !inboundText.trim()} style={btnGhost}>
                      返信を記録
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <p style={{ color: "#94a3b8", fontSize: 13 }}>
        送信は一日の上限の範囲で行われ、送信除外にした相手には送られません。公開の一覧は
        <Link href="/partners" style={{ color: "#2563eb" }}>
          提携先のご紹介
        </Link>
        で確認できます。
      </p>
    </main>
  );
}
