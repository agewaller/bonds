"use client";
// 管理画面 — DB 駆動プロンプトの版管理とモデル設定 (cares 管理画面「プロンプト」相当)。
// 認可は API 側の三段フェイルセーフ (admin claim / OWNER×password / break-glass)。
// 一般ユーザーの Firebase トークンでは 401 になり、何も表示されない。
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "../../lib/client-api";

type PromptRow = { key: string; version: number; body: string; active: boolean; versions: number };
type UsageRow = { ownerUid: string; costJpy: number };
type Usage = { monthStart: string; totalJpy: number; perUser: UsageRow[] };

const input = { width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 8 } as const;
const yen = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}円`;

export default function AdminPage() {
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [model, setModel] = useState("");
  const [userCap, setUserCap] = useState(""); // あなた以外の利用者の月次上限 (円。0 = 無制限)
  const [usage, setUsage] = useState<Usage | null>(null);
  const [editingKey, setEditingKey] = useState("");
  const [editBody, setEditBody] = useState("");
  const [denied, setDenied] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [pRes, mRes, cRes, uRes] = await Promise.all([
      apiFetch("admin/prompts"),
      apiFetch("admin/person-eval-config"),
      apiFetch("admin/ai-cost-config"),
      apiFetch("admin/ai-usage"),
    ]);
    if (pRes.status === 401 || pRes.status === 503) {
      setDenied(true);
      return;
    }
    if (pRes.ok) setPrompts((await pRes.json()).prompts);
    if (mRes.ok) setModel((await mRes.json()).model);
    if (cRes.ok) setUserCap((await cRes.json()).userCapJpy);
    if (uRes.ok) setUsage(await uRes.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const savePrompt = async () => {
    setError("");
    const res = await apiFetch(`admin/prompts/${editingKey}`, {
      method: "POST",
      body: JSON.stringify({ body: editBody }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.detail ?? "保存できませんでした");
      return;
    }
    setNotice(`${editingKey} を 版${body.prompt.version} として保存しました (旧版は残ります)`);
    setEditingKey("");
    await load();
  };

  const saveModel = async () => {
    setError("");
    const res = await apiFetch("admin/person-eval-config", {
      method: "PUT",
      body: JSON.stringify({ model }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).detail ?? "保存できませんでした");
      return;
    }
    setNotice("使用する種類を保存しました");
  };

  const saveUserCap = async () => {
    setError("");
    const res = await apiFetch("admin/ai-cost-config", {
      method: "PUT",
      body: JSON.stringify({ userCapJpy: userCap.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.detail ?? "保存できませんでした");
      return;
    }
    setNotice(body.unlimited ? "あなた以外の利用者を無制限にしました" : `あなた以外の利用者の上限を ${yen(Number(userCap))}/月 にしました`);
    await load();
  };

  if (denied) {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
        <p>このページは管理者だけが使えます。</p>
        <p><Link href="/" style={{ color: "#2563eb" }}>ホームへ戻る</Link></p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "40px 16px" }}>
      <p><Link href="/" style={{ color: "#2563eb" }}>ホームへ戻る</Link></p>
      <h1 style={{ fontSize: 24 }}>管理</h1>
      <p>
        <Link href="/admin/partners" style={{ color: "#2563eb" }}>
          提携先への連絡 (発見・下書き・送信・掲載)
        </Link>
      </p>
      {notice && <p style={{ color: "#166534", background: "#f0fdf4", padding: 8, borderRadius: 8 }}>{notice}</p>}
      {error && <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>{error}</p>}

      <section style={{ margin: "24px 0" }}>
        <h2 style={{ fontSize: 18 }}>使用する種類</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="種類" style={{ ...input, width: "auto" }}>
            <option value="claude-haiku-4-5">はやい</option>
            <option value="claude-sonnet-4-6">バランス (既定)</option>
            <option value="claude-opus-4-7">じっくり</option>
          </select>
          <button
            onClick={() => void saveModel()}
            style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
          >
            保存
          </button>
        </div>
      </section>

      <section style={{ margin: "24px 0" }}>
        <h2 style={{ fontSize: 18 }}>利用の上限 (あなた以外の利用者)</h2>
        <p style={{ color: "#475569", fontSize: 14, margin: "4px 0 10px" }}>
          あなた自身は上限なくお使いいただけます。ほかの利用者には、月ごとの上限額を設けられます。0 を入れると、ほかの利用者も上限なしになります。
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="number"
            min={0}
            step={100}
            value={userCap}
            onChange={(e) => setUserCap(e.target.value)}
            aria-label="ほかの利用者の月ごとの上限 (円)"
            style={{ ...input, width: 140 }}
          />
          <span style={{ color: "#475569" }}>円 / 月</span>
          <button
            onClick={() => void saveUserCap()}
            style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
          >
            保存
          </button>
        </div>
        {usage && (
          <div style={{ marginTop: 14, border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <strong>今月の利用 ({usage.monthStart} 以降)</strong>
              <span style={{ color: "#0f172a" }}>合計 {yen(usage.totalJpy)}</span>
            </div>
            {usage.perUser.length === 0 ? (
              <p style={{ color: "#64748b", margin: "8px 0 0" }}>今月の利用はまだありません。</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 4 }}>
                {usage.perUser.map((u) => (
                  <li key={u.ownerUid} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                    <span style={{ color: "#475569" }}>{u.ownerUid === "owner" ? "あなた" : u.ownerUid}</span>
                    <span>{yen(u.costJpy)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 18 }}>文章のもとになる指示 (版管理)</h2>
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
          {prompts.map((p) => (
            <li key={p.key} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>{p.key}</strong>
                <span style={{ color: "#64748b" }}>版{p.version} (履歴 {p.versions})</span>
              </div>
              {editingKey === p.key ? (
                <div>
                  <textarea
                    style={{ ...input, marginTop: 8 }}
                    rows={14}
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    aria-label={`${p.key} の本文`}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      onClick={() => void savePrompt()}
                      style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
                    >
                      新しい版として保存
                    </button>
                    <button
                      onClick={() => setEditingKey("")}
                      style={{ padding: "8px 16px", background: "#fff", color: "#2563eb", border: "1px solid #2563eb", borderRadius: 8, cursor: "pointer" }}
                    >
                      やめる
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setEditingKey(p.key);
                    setEditBody(p.body);
                  }}
                  style={{ marginTop: 8, background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0 }}
                >
                  ひらいて直す
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
