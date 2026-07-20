"use client";
// 一斉配信 (メールのお便り)。1 通の文面を、選んだ相手にまとめて送る。
// テンプレ + お名前差し込み (AI 費用ゼロ)。少しずつ送る + 配信停止 + 送信者表示つき。
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "../../lib/client-api";

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

const STATUS_LABEL: Record<string, string> = {
  draft: "下書き",
  approved: "配信待ち",
  sending: "配信中",
  sent: "配信済み",
  canceled: "中止",
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
      setError("件名と本文を入力してください");
      return;
    }
    const r = await apiFetch("campaigns", {
      method: "POST",
      body: JSON.stringify({ subject, body, fromName: fromName.trim() || undefined, dailyLimit: Number(dailyLimit) || 200, segment: buildSegment() }),
    });
    const bd = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(bd.detail ?? "作成できませんでした");
      return;
    }
    setCurrent(bd.campaign);
    setTested(false);
    setAudience(null);
    setSamples([]);
    setNotice("下書きを作りました。宛先を確かめ、テスト送信してから配信を始めます");
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
      setError("テストの送信先アドレスを確かめてください");
      return;
    }
    const r = await apiFetch(`campaigns/${current.id}/send-test`, { method: "POST", body: JSON.stringify({ to: testTo.trim() }) });
    const b = await r.json().catch(() => ({}));
    if (r.ok) {
      setTested(true);
      setNotice("テストを送りました。受信を確かめてから、配信を始めてください");
    } else {
      setError(b.detail ?? "テスト送信できませんでした");
    }
  };

  const approve = async () => {
    if (!current) return;
    setError("");
    const r = await apiFetch(`campaigns/${current.id}/approve`, { method: "POST", body: "{}" });
    const b = await r.json().catch(() => ({}));
    if (r.ok) {
      setNotice(`配信を始めました。${b.audience} 名に、1 日あたり最大 ${current.dailyLimit} 通ずつ、少しずつお送りします`);
      setCurrent(null);
      await load();
    } else {
      setError(b.detail ?? "配信を始められませんでした");
    }
  };

  const cancel = async (id: string) => {
    await apiFetch(`campaigns/${id}/cancel`, { method: "POST", body: "{}" });
    await load();
  };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
      <p>
        <Link href="/contacts" style={{ color: "#2563eb" }}>連絡帳へ戻る</Link>
      </p>
      <h1 style={{ fontSize: 24 }}>一斉配信（お便り）</h1>
      <p style={{ color: "#64748b", fontSize: 14, lineHeight: 1.8 }}>
        1 通の文面を、選んだ相手にまとめてお送りします。文面に <code>{"{{お名前}}"}</code> や <code>{"{{会社}}"}</code> と書くと、お一人ずつ差し込みます。
        迷惑メールと見なされないよう、少しずつ（1 日の上限まで）お送りし、配信停止のリンクと差出人を自動で添えます。
        取り込んだだけで面識のない多数への配信は、法律（特定電子メール法）と到達性の面からお控えください。
      </p>

      {!mailerReady && (
        <p style={{ color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", padding: 10, borderRadius: 8, fontSize: 13 }}>
          メール送信の準備がまだのため、いまは「配信待ち」で保留します。送信の設定（差出人アドレス）が整うと、少しずつ送り始めます。
        </p>
      )}
      {notice && <p style={{ color: "#166534", background: "#f0fdf4", padding: 8, borderRadius: 8 }}>{notice}</p>}
      {error && <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>{error}</p>}

      <section style={{ marginTop: 20, border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 }}>
        <h2 style={{ fontSize: 17 }}>文面をつくる</h2>
        <label style={{ display: "block", margin: "10px 0 4px", fontSize: 14 }}>件名</label>
        <input style={input} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="例: 夏のご挨拶" aria-label="件名" />
        <label style={{ display: "block", margin: "10px 0 4px", fontSize: 14 }}>本文（{"{{お名前}}"} / {"{{会社}}"} が差し込めます）</label>
        <textarea style={{ ...input, minHeight: 160 }} value={body} onChange={(e) => setBody(e.target.value)} aria-label="本文" />
        <label style={{ display: "block", margin: "10px 0 4px", fontSize: 14 }}>差出人の名前（任意）</label>
        <input style={input} value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="例: 山田太郎（〇〇株式会社）" aria-label="差出人の名前" />

        <h3 style={{ fontSize: 15, margin: "16px 0 6px" }}>宛先（誰に送るか）</h3>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, margin: "4px 0" }}>
          <input type="checkbox" checked={segAll} onChange={(e) => setSegAll(e.target.checked)} />
          メールアドレスのある方すべて
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, margin: "4px 0" }}>
          <input type="checkbox" checked={segPinned} onChange={(e) => setSegPinned(e.target.checked)} />
          「大切」と印を付けた方だけ
        </label>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "6px 0" }}>
          <label style={{ fontSize: 14 }}>
            距離感がこれ以下:{" "}
            <select value={segDistanceMax} onChange={(e) => setSegDistanceMax(e.target.value)} style={{ padding: 6, borderRadius: 6, border: "1px solid #e2e8f0" }}>
              <option value="">指定なし</option>
              <option value="2">2 まで（とても近い）</option>
              <option value="3">3 まで</option>
              <option value="4">4 まで</option>
            </select>
          </label>
          <label style={{ fontSize: 14 }}>
            最終連絡から:{" "}
            <select value={segLastDaysMin} onChange={(e) => setSegLastDaysMin(e.target.value)} style={{ padding: 6, borderRadius: 6, border: "1px solid #e2e8f0" }}>
              <option value="">指定なし</option>
              <option value="90">90 日以上あいた方</option>
              <option value="180">半年以上あいた方</option>
              <option value="365">1 年以上あいた方</option>
            </select>
          </label>
        </div>
        <label style={{ display: "block", margin: "6px 0 4px", fontSize: 14 }}>会社名にこの語を含む（任意）</label>
        <input style={input} value={segCompany} onChange={(e) => setSegCompany(e.target.value)} placeholder="例: 商事" aria-label="会社名で絞る" />
        <label style={{ display: "block", margin: "10px 0 4px", fontSize: 14 }}>1 日に送る上限（少しずつ送ると迷惑メール判定を避けられます）</label>
        <input style={{ ...input, width: 120 }} value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value.replace(/[^0-9]/g, ""))} aria-label="1日の上限" />

        <div style={{ marginTop: 14 }}>
          <button style={btn()} onClick={() => void createDraft()}>下書きを作って宛先を確かめる</button>
        </div>
      </section>

      {current && (
        <section style={{ marginTop: 20, border: "2px solid #93c5fd", borderRadius: 12, padding: 16, background: "#eff6ff" }}>
          <h2 style={{ fontSize: 17 }}>宛先の確認とテスト送信</h2>
          <p style={{ fontSize: 14, color: "#1e3a8a" }}>
            この文面が届く宛先は <strong>{audience ?? "…"}</strong> 名です（メール無し・配信停止済み・重複は自動で除いています）。
          </p>
          {samples.length > 0 && (
            <div style={{ margin: "8px 0" }}>
              <p style={{ fontSize: 13, color: "#475569", margin: "0 0 4px" }}>差し込みの見本:</p>
              {samples.slice(0, 2).map((s, i) => (
                <div key={i} style={{ border: "1px solid #dbeafe", borderRadius: 8, padding: "8px 10px", background: "#fff", margin: "4px 0" }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{s.subject}</div>
                  <div style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "#334155" }}>{s.body}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "8px 0" }}>
            <input style={{ ...input, flex: "1 1 220px" }} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="自分のメールアドレス（テスト用）" aria-label="テスト送信先" />
            <button style={btn(false)} onClick={() => void sendTest()}>テスト送信</button>
          </div>
          <button style={{ ...btn(), opacity: tested ? 1 : 0.5 }} disabled={!tested} onClick={() => void approve()}>
            {tested ? "この内容で配信を始める" : "まずテスト送信を済ませてください"}
          </button>
        </section>
      )}

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 17 }}>これまでの配信</h2>
        {campaigns.length === 0 ? (
          <p style={{ color: "#64748b" }}>まだありません。</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
            {campaigns.map((cm) => (
              <li key={cm.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600 }}>{cm.subject}</span>
                  <span style={{ color: "#64748b", fontSize: 13 }}>{STATUS_LABEL[cm.status] ?? cm.status}</span>
                </div>
                <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>
                  宛先 {cm.total} 名・送信 {cm.sent}・失敗 {cm.failed}・除外 {cm.skipped}
                </div>
                {(cm.status === "approved" || cm.status === "sending") && (
                  <button style={{ ...btn(false), marginTop: 6, fontSize: 13, padding: "4px 12px" }} onClick={() => void cancel(cm.id)}>
                    配信を止める
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
