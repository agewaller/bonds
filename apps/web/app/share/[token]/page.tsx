"use client";
// 相手 (第三者) 向けの公開ページ — ログイン不要。リンクを開くと内容が見え、
// 受け取る / 今回は見送る と、ひとことを返せる。返答は送り主のやりとりの記録に届く。
// 出すのは内容と一言だけ (送り主の個人情報・他の記録は出さない)。
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { t } from "../../../lib/i18n";
import { LanguageSelector } from "../../../components/LanguageSelector";

type ShareView = {
  kind: string;
  direction: string;
  title: string;
  message: string | null;
  description: string | null;
  status: string;
  respondable: boolean;
};

const input = { width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 8 } as const;
const btn = (primary = true) =>
  ({
    padding: "10px 20px",
    background: primary ? "#2563eb" : "#fff",
    color: primary ? "#fff" : "#2563eb",
    border: "1px solid #2563eb",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 16,
  }) as const;

// 表示ラベルは辞書キーへの対応表にして、描画のたびに t() で引く (言語切替に追従)
const KIND_KEY: Record<string, string> = {
  time: "x_pub_kind_time",
  wisdom: "x_pub_kind_wisdom",
  thing: "x_pub_kind_thing",
};

// どの状態の画面でも同じ枠 + 言語切替 (相手はログインなしの第三者なので、ことばを選べるように)
function Shell({ children }: { children: ReactNode }) {
  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 16px" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <LanguageSelector />
      </div>
      {children}
    </main>
  );
}

export default function ShareTokenPage() {
  const { token } = useParams<{ token: string }>();
  const [share, setShare] = useState<ShareView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<"accepted" | "declined" | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/bff/share/${token}`, { cache: "no-store" });
    if (!res.ok) {
      setNotFound(true);
      return;
    }
    setShare((await res.json()).share);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const respond = async (response: "accept" | "decline") => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/bff/share/${token}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response, note: note.trim() || null }),
      });
      const rb = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(rb.detail ?? t("x_error_retry_later"));
        return;
      }
      setDone(response === "accept" ? "accepted" : "declined");
    } finally {
      setBusy(false);
    }
  };

  if (notFound) {
    return (
      <Shell>
        <p>{t("x_pub_not_found")}</p>
      </Shell>
    );
  }
  if (!share) {
    return (
      <Shell>
        <p>{t("x_pub_loading")}</p>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <h1 style={{ fontSize: 22 }}>{t("x_pub_done_title")}</h1>
        <p>{done === "accepted" ? t("x_pub_done_accepted") : t("x_pub_done_declined")}</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <p style={{ color: "#64748b" }}>
        {t("x_pub_notice_before")}
        {KIND_KEY[share.kind] ? t(KIND_KEY[share.kind]) : t("x_pub_kind_fallback")}
        {t("x_pub_notice_after")}
      </p>
      <h1 style={{ fontSize: 24, marginTop: 8 }}>{share.title}</h1>
      {share.message && (
        <p style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, whiteSpace: "pre-wrap" }}>
          {share.message}
        </p>
      )}
      {share.description && <p style={{ color: "#334155", whiteSpace: "pre-wrap" }}>{share.description}</p>}

      {error && (
        <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>{error}</p>
      )}

      {share.respondable ? (
        <>
          <label style={{ display: "block", margin: "16px 0 8px" }}>
            {t("x_share_message_label")}
            <textarea
              style={input}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("x_pub_note_ph")}
            />
          </label>
          <div style={{ display: "flex", gap: 12 }}>
            <button style={btn()} onClick={() => void respond("accept")} disabled={busy}>
              {share.direction === "request" ? t("x_pub_btn_accept_request") : t("x_pub_btn_accept")}
            </button>
            <button style={btn(false)} onClick={() => void respond("decline")} disabled={busy}>
              {t("x_pub_btn_decline")}
            </button>
          </div>
          <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 16 }}>
            {t("x_pub_no_login")}
          </p>
        </>
      ) : (
        <p style={{ color: "#64748b" }}>{t("x_pub_closed")}</p>
      )}
    </Shell>
  );
}
