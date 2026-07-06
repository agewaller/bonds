"use client";
// 管理画面 — DB 駆動プロンプトの版管理とモデル設定 (cares 管理画面「プロンプト」相当)。
// 認可は API 側の三段フェイルセーフ (admin claim / OWNER×password / break-glass)。
// 一般ユーザーの Firebase トークンでは 401 になり、何も表示されない。
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "../../lib/client-api";

type PromptRow = { key: string; version: number; body: string; active: boolean; versions: number };

const input = { width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 8 } as const;

export default function AdminPage() {
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [model, setModel] = useState("");
  const [editingKey, setEditingKey] = useState("");
  const [editBody, setEditBody] = useState("");
  const [denied, setDenied] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [pRes, mRes] = await Promise.all([
      apiFetch("admin/prompts"),
      apiFetch("admin/person-eval-config"),
    ]);
    if (pRes.status === 401 || pRes.status === 503) {
      setDenied(true);
      return;
    }
    if (pRes.ok) setPrompts((await pRes.json()).prompts);
    if (mRes.ok) setModel((await mRes.json()).model);
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
