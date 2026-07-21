"use client";
// 差し出せるもの (資源カタログ) — 自分がシェアできる時間・知恵・モノを登録しておくと、
// 連絡先ごとのシェア画面からすぐ差し出せる。
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../lib/client-api";
import Link from "next/link";
import { t } from "../../lib/i18n";
import { LanguageSelector } from "../../components/LanguageSelector";

type Resource = {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  availability: string | null;
  status: string;
};

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

// 表示ラベルは辞書キーへの対応表にして、描画のたびに t() で引く (言語切替に追従)
const KIND_KEY: Record<string, string> = {
  time: "x_share_kind_time",
  wisdom: "x_share_kind_wisdom",
  thing: "x_share_kind_thing",
};

export default function ResourcesPage() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [kind, setKind] = useState("time");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [availability, setAvailability] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await apiFetch("resources");
    if (res.ok) setResources((await res.json()).resources ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch("resources", {
        method: "POST",
        body: JSON.stringify({
          kind,
          title: title.trim(),
          description: description.trim() || null,
          availability: availability.trim() || null,
        }),
      });
      if (!res.ok) {
        const rb = await res.json().catch(() => ({}));
        setError(rb.detail ?? t("x_error_generic"));
        return;
      }
      setTitle("");
      setDescription("");
      setAvailability("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const archive = async (id: string) => {
    setBusy(true);
    try {
      await apiFetch(`resources/${id}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Link href="/contacts" style={{ color: "#2563eb" }}>{t("x_back_contacts")}</Link>
        <LanguageSelector />
      </div>
      <h1 style={{ fontSize: 24 }}>{t("x_res_title")}</h1>
      <p style={{ color: "#64748b" }}>{t("x_res_desc")}</p>
      {error && (
        <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>{error}</p>
      )}

      <section style={{ marginTop: 16, border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>{t("x_res_new")}</h2>
        <div style={{ display: "flex", gap: 8, margin: "8px 0" }}>
          <select style={{ ...input, width: "auto" }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t("x_res_aria_kind")}>
            <option value="time">{t("x_share_opt_time")}</option>
            <option value="wisdom">{t("x_share_opt_wisdom")}</option>
            <option value="thing">{t("x_share_opt_thing")}</option>
          </select>
          <input
            style={{ ...input, flex: 1, width: "auto" }}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("x_res_title_ph")}
            aria-label={t("x_share_title_label")}
          />
        </div>
        <label style={{ display: "block", margin: "8px 0" }}>
          {t("x_res_desc_label")}
          <textarea style={input} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label style={{ display: "block", margin: "8px 0" }}>
          {t("x_res_avail_label")}
          <input style={input} value={availability} onChange={(e) => setAvailability(e.target.value)} placeholder={t("x_res_avail_ph")} />
        </label>
        <button style={btn()} onClick={() => void create()} disabled={busy || !title.trim()}>
          {t("x_res_register")}
        </button>
      </section>

      <section style={{ marginTop: 24 }}>
        {resources.length === 0 ? (
          <p style={{ color: "#64748b" }}>{t("x_res_empty")}</p>
        ) : (
          <ul style={{ paddingLeft: 0, listStyle: "none" }}>
            {resources.map((r) => (
              <li key={r.id} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 14px", marginBottom: 8 }}>
                <div>
                  <strong>{r.title}</strong>
                  <span style={{ color: "#64748b", marginLeft: 8, fontSize: 13 }}>{KIND_KEY[r.kind] ? t(KIND_KEY[r.kind]) : r.kind}</span>
                </div>
                {r.description && <div style={{ color: "#334155", fontSize: 14 }}>{r.description}</div>}
                {r.availability && <div style={{ color: "#64748b", fontSize: 13 }}>{r.availability}</div>}
                <button style={{ ...btn(false), marginTop: 6, fontSize: 13 }} onClick={() => void archive(r.id)} disabled={busy}>
                  {t("x_res_archive")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
