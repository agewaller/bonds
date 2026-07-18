"use client";
// 設定 — 散らばっていた設定ごとを一箇所に集める入り口。
// アカウント / Google 連携 / 空き時間と日程調整 / ことば / データの書き出し /
// 見送った提案の戻し / 管理者向け / プライバシーポリシー。
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "../../lib/client-api";
import { AuthBar } from "../../components/AuthBar";
import { LanguageSelector } from "../../components/LanguageSelector";

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
  }, []);

  const purgeAudit = async () => {
    setError("");
    setPurging(true);
    const res = await apiFetch("admin/audit-data/purge", { method: "POST", body: "{}" });
    setPurging(false);
    if (res.ok) {
      setNotice("テストで作られたデータを片づけました。連絡先はアーカイブしたので、30日以内なら元に戻せます");
      await loadAudit();
    } else {
      setError("いまは片づけられませんでした。時間をおいてお試しください");
    }
  };

  const googleConnect = async (scope?: "extended") => {
    setError("");
    const res = await apiFetch(`google/auth-url${scope ? "?scope=extended" : ""}`);
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.url) window.location.href = body.url;
    else setError(body.detail ?? "いまはつなげませんでした");
  };

  const restoreDismissals = async () => {
    setError("");
    const res = await apiFetch("relationship/dismissals", { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) setNotice(`見送っていた提案を ${body.restored ?? 0} 件戻しました。連絡帳にまた表示されます`);
    else setError("いまは戻せませんでした。時間をおいてお試しください");
  };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
      <AuthBar />
      <p><Link href="/contacts" style={{ color: "#2563eb" }}>連絡帳へ戻る</Link></p>
      <h1 style={{ fontSize: 24 }}>設定</h1>

      {notice && <p style={{ color: "#166534", background: "#f0fdf4", padding: 8, borderRadius: 8 }}>{notice}</p>}
      {error && <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>{error}</p>}

      <section style={card}>
        <h2 style={h2}>Google 連携</h2>
        <p style={desc}>
          連絡先（アドレス帳）とカレンダーを読み取り専用でつなぎ、お相手を連絡帳へ自動でまとめます。
          つなぐと連絡帳の画面に戻り、その場で取り込みが始まります。
        </p>
        {google === null && <p style={{ color: "#64748b", fontSize: 14 }}>確認しています…</p>}
        {google?.available === false && (
          <p style={{ color: "#64748b", fontSize: 14 }}>この機能は準備中です (運営者側の接続設定が済むと使えるようになります)。</p>
        )}
        {google?.available && !google.connected && (
          <button style={btn} onClick={() => void googleConnect()}>Google とつなぐ</button>
        )}
        {google?.available && google.connected && (
          <div>
            <p style={{ color: "#166534", fontSize: 14, margin: "0 0 8px" }}>
              つながっています{google.email ? ` (${google.email})` : ""}
            </p>
            {!google.extended && (
              <div>
                <p style={desc}>
                  さらに、メールでやりとりした相手や共有ファイルの仲間も拾えます（メールは宛先と件名だけで本文は読みません）。
                </p>
                <button style={btnGhost} onClick={() => void googleConnect("extended")}>
                  メール・共有ファイルの相手も拾えるようにする
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <section style={card}>
        <h2 style={h2}>空き時間と日程調整</h2>
        <p style={desc}>
          受け付ける曜日と時間、カレンダーをなぞる空き枠、日程を選んでもらうページ、お時間の受け付けはこちらで。
        </p>
        <Link href="/schedule" style={{ color: "#2563eb", fontSize: 14 }}>日程調整と時間の受け付けを開く</Link>
      </section>

      <section style={card}>
        <h2 style={h2}>ことば (表示の言語)</h2>
        <p style={desc}>画面の表示に使うことばを選べます。</p>
        <LanguageSelector />
      </section>

      <section style={card}>
        <h2 style={h2}>見送った提案を戻す</h2>
        <p style={desc}>
          連絡帳のご提案で ✖ を押して見送ったものを、すべてもう一度表示するようにします。
        </p>
        <button style={btnGhost} onClick={() => void restoreDismissals()}>見送った提案をすべて戻す</button>
      </section>

      <section style={card}>
        <h2 style={h2}>データの書き出し</h2>
        <p style={desc}>
          連絡先・やりとり・贈り物・台帳の全データを、いつでもファイル (JSON) で書き出せます。囲い込みはしません。
        </p>
        <a href="/api/bff/contacts/export" style={{ color: "#2563eb", fontSize: 14 }}>全データを書き出す</a>
      </section>

      {audit && audit.total > 0 && (
        <section style={{ ...card, border: "1px solid #fecaca", background: "#fef2f2" }}>
          <h2 style={h2}>テストで作られたデータの片づけ</h2>
          <p style={desc}>
            動作確認のときに作られた「監査」で始まるお試しデータが {audit.total} 件見つかりました
            （例: {audit.sample.slice(0, 5).join("、")} など）。ふだんのご利用には不要なので、まとめて片づけられます。
            連絡先はアーカイブするだけなので、30日以内なら元に戻せます。
          </p>
          <button style={{ ...btn, background: "#dc2626" }} disabled={purging} onClick={() => void purgeAudit()}>
            {purging ? "片づけています…" : `お試しデータ ${audit.total} 件を片づける`}
          </button>
        </section>
      )}

      <section style={card}>
        <h2 style={h2}>管理者向け</h2>
        <p style={desc}>文章のひな型・利用額・提携先の管理はこちら (管理者のみ)。</p>
        <Link href="/admin" style={{ color: "#2563eb", fontSize: 14 }}>管理画面を開く</Link>
      </section>

      <p style={{ marginTop: 24 }}>
        <Link href="/privacy" style={{ color: "#64748b", fontSize: 13 }}>プライバシーポリシー</Link>
      </p>
    </main>
  );
}
