"use client";
// 管理画面 — DB 駆動プロンプトの版管理とモデル設定 (cares 管理画面「プロンプト」相当)。
// 認可は API 側の三段フェイルセーフ (admin claim / OWNER×password / break-glass)。
// 一般ユーザーの Firebase トークンでは 401 になり、何も表示されない。
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "../../lib/client-api";
import { t, currentLocale } from "../../lib/i18n";

type PromptRow = { key: string; version: number; body: string; active: boolean; versions: number };
type UsageRow = { ownerUid: string; costJpy: number };
type Usage = { monthStart: string; totalJpy: number; perUser: UsageRow[] };

const input = { width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 8 } as const;
const yen = (n: number) =>
  currentLocale() === "en"
    ? `¥${Math.round(n).toLocaleString("en-US")}`
    : `${Math.round(n).toLocaleString("ja-JP")}円`;

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
      setError(body.detail ?? t("s_save_failed"));
      return;
    }
    setNotice(
      t("s_prompt_saved")
        .replace("{key}", editingKey)
        .replace("{version}", String(body.prompt.version)),
    );
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
      setError((await res.json().catch(() => ({}))).detail ?? t("s_save_failed"));
      return;
    }
    setNotice(t("s_model_saved"));
  };

  const saveUserCap = async () => {
    setError("");
    const res = await apiFetch("admin/ai-cost-config", {
      method: "PUT",
      body: JSON.stringify({ userCapJpy: userCap.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.detail ?? t("s_save_failed"));
      return;
    }
    setNotice(
      body.unlimited
        ? t("s_cap_unlimited")
        : t("s_cap_set").replace("{amount}", yen(Number(userCap))),
    );
    await load();
  };

  if (denied) {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
        <p>{t("s_admin_denied")}</p>
        <p><Link href="/" style={{ color: "#2563eb" }}>{t("back_home")}</Link></p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "40px 16px" }}>
      <p><Link href="/" style={{ color: "#2563eb" }}>{t("back_home")}</Link></p>
      <h1 style={{ fontSize: 24 }}>{t("s_admin_title")}</h1>
      <p>
        <Link href="/admin/partners" style={{ color: "#2563eb" }}>
          {t("s_admin_partners_link")}
        </Link>
      </p>
      {notice && <p style={{ color: "#166534", background: "#f0fdf4", padding: 8, borderRadius: 8 }}>{notice}</p>}
      {error && <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>{error}</p>}

      <section style={{ margin: "24px 0" }}>
        <h2 style={{ fontSize: 18 }}>{t("s_model_heading")}</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={model} onChange={(e) => setModel(e.target.value)} aria-label={t("s_model_aria")} style={{ ...input, width: "auto" }}>
            <option value="claude-haiku-4-5">{t("s_model_fast")}</option>
            <option value="claude-sonnet-4-6">{t("s_model_balanced")}</option>
            <option value="claude-opus-4-7">{t("s_model_deep")}</option>
          </select>
          <button
            onClick={() => void saveModel()}
            style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
          >
            {t("s_save")}
          </button>
        </div>
      </section>

      <section style={{ margin: "24px 0" }}>
        <h2 style={{ fontSize: 18 }}>{t("s_cap_heading")}</h2>
        <p style={{ color: "#475569", fontSize: 14, margin: "4px 0 10px" }}>
          {t("s_cap_desc")}
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="number"
            min={0}
            step={100}
            value={userCap}
            onChange={(e) => setUserCap(e.target.value)}
            aria-label={t("s_cap_aria")}
            style={{ ...input, width: 140 }}
          />
          <span style={{ color: "#475569" }}>{t("s_yen_per_month")}</span>
          <button
            onClick={() => void saveUserCap()}
            style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
          >
            {t("s_save")}
          </button>
        </div>
        {usage && (
          <div style={{ marginTop: 14, border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <strong>{t("s_usage_heading").replace("{month}", usage.monthStart)}</strong>
              <span style={{ color: "#0f172a" }}>{t("s_usage_total").replace("{amount}", yen(usage.totalJpy))}</span>
            </div>
            {usage.perUser.length === 0 ? (
              <p style={{ color: "#64748b", margin: "8px 0 0" }}>{t("s_usage_none")}</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 4 }}>
                {usage.perUser.map((u) => (
                  <li key={u.ownerUid} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                    <span style={{ color: "#475569" }}>{u.ownerUid === "owner" ? t("s_usage_you") : u.ownerUid}</span>
                    <span>{yen(u.costJpy)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 18 }}>{t("s_prompts_heading")}</h2>
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
          {prompts.map((p) => (
            <li key={p.key} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>{p.key}</strong>
                <span style={{ color: "#64748b" }}>
                  {t("s_prompt_version")
                    .replace("{version}", String(p.version))
                    .replace("{count}", String(p.versions))}
                </span>
              </div>
              {editingKey === p.key ? (
                <div>
                  <textarea
                    style={{ ...input, marginTop: 8 }}
                    rows={14}
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    aria-label={t("s_prompt_body_aria").replace("{key}", p.key)}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      onClick={() => void savePrompt()}
                      style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
                    >
                      {t("s_prompt_save_new")}
                    </button>
                    <button
                      onClick={() => setEditingKey("")}
                      style={{ padding: "8px 16px", background: "#fff", color: "#2563eb", border: "1px solid #2563eb", borderRadius: 8, cursor: "pointer" }}
                    >
                      {t("s_cancel")}
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
                  {t("s_prompt_edit")}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
