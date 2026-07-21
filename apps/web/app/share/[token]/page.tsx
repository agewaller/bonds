"use client";
// 相手 (第三者) 向けの公開ページ — ログイン不要。リンクを開くと内容が見え、
// 受け取る / 今回は見送る と、ひとことを返せる。返答は送り主のやりとりの記録に届く。
// 出すのは内容と一言だけ (送り主の個人情報・他の記録は出さない)。
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

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

const KIND_LABEL: Record<string, string> = { time: "お手伝い", wisdom: "ご相談・アドバイス", thing: "お譲り・お貸し" };

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
        setError(rb.detail ?? "うまくいきませんでした。しばらくしてからお試しください");
        return;
      }
      setDone(response === "accept" ? "accepted" : "declined");
    } finally {
      setBusy(false);
    }
  };

  if (notFound) {
    return (
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 16px" }}>
        <p>このページは見つかりませんでした。リンクの期限が切れているかもしれません。</p>
      </main>
    );
  }
  if (!share) {
    return (
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 16px" }}>
        <p>読み込んでいます…</p>
      </main>
    );
  }

  if (done) {
    return (
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 16px" }}>
        <h1 style={{ fontSize: 22 }}>お返事を伝えました</h1>
        <p>
          {done === "accepted"
            ? "ありがとうございます。送り主に届きました。このままお待ちください。"
            : "承知しました。お気遣いなく。お返事は送り主に届いています。"}
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 16px" }}>
      <p style={{ color: "#64748b" }}>{KIND_LABEL[share.kind] ?? "ご案内"}のお知らせが届いています</p>
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
            ひとこと (任意)
            <textarea
              style={input}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例: ありがとうございます。ぜひお願いします。"
            />
          </label>
          <div style={{ display: "flex", gap: 12 }}>
            <button style={btn()} onClick={() => void respond("accept")} disabled={busy}>
              {share.direction === "request" ? "お引き受けする" : "受け取る"}
            </button>
            <button style={btn(false)} onClick={() => void respond("decline")} disabled={busy}>
              今回は見送る
            </button>
          </div>
          <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 16 }}>
            ログインは要りません。押すとお返事だけが送り主に届きます。
          </p>
        </>
      ) : (
        <p style={{ color: "#64748b" }}>このお知らせにはすでにお返事済みか、受付が終わっています。</p>
      )}
    </main>
  );
}
