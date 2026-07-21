"use client";
// 提携先アウトリーチの管理画面 (cares ADR-0022 移植)。管理者 (オーナー) 専用。
// 発見 → 下書き → 承認 → 送信 → 返信 → 掲載のファネルをここで回す。
// 送信は既定で承認制。自動送信はサーバ側 PARTNER_AUTO_SEND=1 のときだけ。
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "../../../lib/client-api";
import { t } from "../../../lib/i18n";

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

// status / kind → 辞書キー (表示時に t() で引く)
const STATUS_LABEL_KEY: Record<string, string> = {
  candidate: "s_pstatus_candidate",
  queued: "s_pstatus_queued",
  contacted: "s_pstatus_contacted",
  replied: "s_pstatus_replied",
  partner: "s_pstatus_partner",
  declined: "s_pstatus_declined",
  suppressed: "s_pstatus_suppressed",
};
const KIND_LABEL_KEY: Record<string, string> = {
  site: "s_pkind_site",
  sns: "s_pkind_sns",
  association: "s_pkind_association",
  community: "s_pkind_community",
  service: "s_pkind_service",
  corp: "s_pkind_corp",
  other: "s_pkind_other",
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
        setError(body.detail ?? t("s_padmin_failed"));
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
      t("s_padd_ok"),
    ).then(() => {
      setName("");
      setEmail("");
    });

  const discover = () =>
    run(
      () => apiFetch("admin/partners/discover", { method: "POST", body: JSON.stringify({ theme }) }),
      t("s_pdiscover_ok"),
    );

  const draft = (id: string) =>
    run(
      () => apiFetch(`admin/partners/targets/${id}/draft`, { method: "POST", body: JSON.stringify({}) }),
      t("s_pdraft_ok"),
    );

  const replyDraft = (id: string) =>
    run(
      () => apiFetch(`admin/partners/targets/${id}/reply-draft`, { method: "POST", body: JSON.stringify({}) }),
      t("s_preply_ok"),
    );

  const approveAndSend = (msgId: string) =>
    run(async () => {
      const a = await apiFetch(`admin/partners/messages/${msgId}/approve`, {
        method: "POST",
        body: JSON.stringify(editMsgId === msgId ? { subject: editSubject, body: editBody } : {}),
      });
      if (!a.ok) return a;
      return apiFetch(`admin/partners/messages/${msgId}/send`, { method: "POST", body: "{}" });
    }, t("s_psent_ok")).then(() => setEditMsgId(""));

  const recordInbound = (id: string) =>
    run(
      () =>
        apiFetch(`admin/partners/targets/${id}/inbound`, {
          method: "POST",
          body: JSON.stringify({ body: inboundText }),
        }),
      t("s_pinbound_ok"),
    ).then(() => setInboundText(""));

  const patchTarget = (id: string, data: Record<string, unknown>, msg: string) =>
    run(() => apiFetch(`admin/partners/targets/${id}`, { method: "PATCH", body: JSON.stringify(data) }), msg);

  if (denied) {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
        <p>{t("s_admin_denied")}</p>
        <p>
          <Link href="/" style={{ color: "#2563eb" }}>
            {t("back_home")}
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "40px 16px" }}>
      <p>
        <Link href="/admin" style={{ color: "#2563eb" }}>
          {t("s_back_to_admin")}
        </Link>
      </p>
      <h1 style={{ fontSize: 24 }}>{t("s_padmin_title")}</h1>
      <p style={{ color: "#64748b" }}>
        {t("s_padmin_lead")}
      </p>
      {notice && <p style={{ color: "#166534", background: "#f0fdf4", padding: 8, borderRadius: 8 }}>{notice}</p>}
      {error && (
        <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>
          {error}
        </p>
      )}

      <section style={{ margin: "24px 0" }}>
        <h2 style={{ fontSize: 18 }}>{t("s_pdiscover_heading")}</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder={t("s_ptheme_placeholder")}
            aria-label={t("s_ptheme_aria")}
            style={{ ...input, flex: 1 }}
          />
          <button onClick={() => void discover()} disabled={busy || !theme.trim()} style={btn}>
            {t("s_pdiscover_button")}
          </button>
        </div>
      </section>

      <section style={{ margin: "24px 0" }}>
        <h2 style={{ fontSize: 18 }}>{t("s_padd_heading")}</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("s_pname_placeholder")}
            aria-label={t("s_pname_aria")}
            style={{ ...input, flex: 2, minWidth: 160 }}
          />
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t("s_pkind_aria")} style={{ ...input, width: "auto" }}>
            {Object.entries(KIND_LABEL_KEY).map(([k, labelKey]) => (
              <option key={k} value={k}>
                {t(labelKey)}
              </option>
            ))}
          </select>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("s_pemail_placeholder")}
            aria-label={t("s_pemail_aria")}
            style={{ ...input, flex: 2, minWidth: 160 }}
          />
          <button onClick={() => void addTarget()} disabled={busy || !name.trim()} style={btn}>
            {t("s_add")}
          </button>
        </div>
      </section>

      <section style={{ margin: "24px 0" }}>
        <h2 style={{ fontSize: 18 }}>{t("s_plist_heading")}</h2>
        {targets.length === 0 && <p style={{ color: "#64748b" }}>{t("s_plist_empty")}</p>}
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
          {targets.map((tg) => (
            <li key={tg.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <span>
                  <strong>{tg.name}</strong>
                  <small style={{ color: "#64748b", marginLeft: 8 }}>
                    {KIND_LABEL_KEY[tg.kind] ? t(KIND_LABEL_KEY[tg.kind]) : tg.kind} ・{" "}
                    {STATUS_LABEL_KEY[tg.status] ? t(STATUS_LABEL_KEY[tg.status]) : tg.status}
                    {tg.contactEmail ? "" : t("s_pemail_missing")}
                  </small>
                </span>
                <button onClick={() => void openTarget(tg.id)} style={btnGhost}>
                  {openId === tg.id ? t("s_pclose") : t("s_popen")}
                </button>
              </div>
              {tg.notes && <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 14 }}>{tg.notes}</p>}

              {openId === tg.id && (
                <div style={{ marginTop: 12, borderTop: "1px solid #e2e8f0", paddingTop: 12 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                    <input
                      defaultValue={tg.contactEmail ?? ""}
                      placeholder={t("s_pemail_edit_placeholder")}
                      aria-label={t("s_pemail_edit_aria").replace("{name}", tg.name)}
                      onBlur={(e) => {
                        if ((e.target.value.trim() || null) !== (tg.contactEmail ?? null)) {
                          void patchTarget(tg.id, { contactEmail: e.target.value }, t("s_pcontact_saved"));
                        }
                      }}
                      style={{ ...input, flex: 1, minWidth: 200 }}
                    />
                    <button onClick={() => void draft(tg.id)} disabled={busy} style={btn}>
                      {t("s_pdraft_button")}
                    </button>
                    <button onClick={() => void replyDraft(tg.id)} disabled={busy} style={btnGhost}>
                      {t("s_preply_button")}
                    </button>
                    <button
                      onClick={() => void patchTarget(tg.id, { status: "suppressed" }, t("s_psuppressed_ok"))}
                      disabled={busy || tg.status === "suppressed"}
                      style={btnGhost}
                    >
                      {t("s_psuppress_button")}
                    </button>
                    <button
                      onClick={() =>
                        void patchTarget(
                          tg.id,
                          { status: "partner", isPublic: !tg.isPublic },
                          tg.isPublic ? t("s_ppublish_off_ok") : t("s_ppublish_on_ok"),
                        )
                      }
                      disabled={busy}
                      style={btnGhost}
                    >
                      {tg.isPublic ? t("s_ppublish_off_button") : t("s_ppublish_on_button")}
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
                            {m.direction === "inbound" ? t("s_pfrom_them") : t("s_pfrom_us")} ・ {m.status}
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
                                {t("s_pedit")}
                              </button>
                              <button onClick={() => void approveAndSend(m.id)} disabled={busy} style={btn}>
                                {t("s_papprove_send")}
                              </button>
                            </span>
                          )}
                        </div>
                        {editMsgId === m.id ? (
                          <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                            <input
                              value={editSubject}
                              onChange={(e) => setEditSubject(e.target.value)}
                              aria-label={t("s_psubject_aria")}
                              style={input}
                            />
                            <textarea
                              value={editBody}
                              onChange={(e) => setEditBody(e.target.value)}
                              rows={8}
                              aria-label={t("s_pbody_aria")}
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
                    {messages.length === 0 && <p style={{ color: "#64748b" }}>{t("s_pno_messages")}</p>}
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <input
                      value={inboundText}
                      onChange={(e) => setInboundText(e.target.value)}
                      placeholder={t("s_pinbound_placeholder")}
                      aria-label={t("s_pinbound_aria")}
                      style={{ ...input, flex: 1 }}
                    />
                    <button onClick={() => void recordInbound(tg.id)} disabled={busy || !inboundText.trim()} style={btnGhost}>
                      {t("s_pinbound_button")}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <p style={{ color: "#94a3b8", fontSize: 13 }}>
        {t("s_pfooter_1")}
        <Link href="/partners" style={{ color: "#2563eb" }}>
          {t("s_ppartners_link")}
        </Link>
        {t("s_pfooter_2")}
      </p>
    </main>
  );
}
