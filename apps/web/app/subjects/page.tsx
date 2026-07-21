"use client";
// 評価対象 (公人) の一覧 + 追加。文言は自然な日本語で、技術語 (AI 等) を出さない。
// 追加時はまず同姓同名の候補を確かめ、複数いればユーザーに「どの方か」を選んでもらう。
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AuthBar } from "../../components/AuthBar";
import { apiFetch } from "../../lib/client-api";
import { t, currentLocale } from "../../lib/i18n";

type SubjectRow = {
  id: string;
  slug: string;
  name: string;
  subjectType: string;
  country: string | null;
  profileHint: string | null;
  latestScores: Record<string, number | null>;
};

type Candidate = { name: string; description: string };

// subjectType → 辞書キー (表示時に t() で引く)
const TYPE_LABEL_KEY: Record<string, string> = {
  politician: "s_type_politician",
  executive: "s_type_executive",
  other: "s_type_other",
};

export default function SubjectsPage() {
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [name, setName] = useState("");
  const [subjectType, setSubjectType] = useState("other");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // 同姓同名の候補選択 (null = 非表示)
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [pendingName, setPendingName] = useState("");
  // 削除の確認中の slug (confirm/alert は使わずインライン確認にする)
  const [confirmingDelete, setConfirmingDelete] = useState("");

  const load = useCallback(async () => {
    const res = await apiFetch("dd/subjects");
    if (res.ok) setSubjects((await res.json()).subjects);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createSubject = async (targetName: string, profileHint: string | null) => {
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch("dd/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: targetName, subjectType, profileHint }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail ?? t("s_add_failed"));
        return;
      }
      setName("");
      setCandidates(null);
      setPendingName("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const deleteSubject = async (slug: string) => {
    setError("");
    const res = await apiFetch(`dd/subjects/${slug}`, { method: "DELETE" });
    setConfirmingDelete("");
    if (res.ok) await load();
    else setError(t("s_delete_failed"));
  };

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    setCandidates(null);
    try {
      // まず「どの人物のことか」を確かめる。候補が複数ならユーザーに選んでもらう。
      const res = await apiFetch("dd/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, locale: currentLocale() }),
      });
      if (res.ok) {
        const body = await res.json().catch(() => ({ candidates: [] }));
        const list: Candidate[] = Array.isArray(body.candidates) ? body.candidates : [];
        if (list.length >= 2) {
          setPendingName(trimmed);
          setCandidates(list);
          setBusy(false);
          return;
        }
        await createSubject(trimmed, list[0]?.description ?? null);
        return;
      }
      // 確認が使えない環境 (キー未設定など) は名前のみで登録する
      await createSubject(trimmed, null);
    } catch {
      await createSubject(trimmed, null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 16, alignItems: "center" }}>
        <Link href="/settings" style={{ color: "#64748b", fontSize: 14 }}>{t("s_settings")}</Link>
        <AuthBar />
      </div>
      <h1 style={{ fontSize: 24 }}>{t("s_subjects_title")}</h1>
      <p style={{ color: "#64748b" }}>
        {t("s_subjects_intro")}
      </p>

      <div style={{ display: "flex", gap: 8, margin: "16px 0" }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          placeholder={t("s_name_placeholder")}
          aria-label={t("s_name_aria")}
          style={{ flex: 1, padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8 }}
        />
        <select
          value={subjectType}
          onChange={(e) => setSubjectType(e.target.value)}
          aria-label={t("s_type_aria")}
          style={{ padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8 }}
        >
          <option value="politician">{t("s_type_politician")}</option>
          <option value="executive">{t("s_type_executive")}</option>
          <option value="other">{t("s_type_other")}</option>
        </select>
        <button
          onClick={() => void add()}
          disabled={busy || !name.trim()}
          style={{
            padding: "10px 20px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          {t("s_add")}
        </button>
      </div>
      {busy && !candidates && (
        <p style={{ color: "#64748b" }}>{t("s_identifying")}</p>
      )}
      {error && (
        <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>
          {error}
        </p>
      )}

      {candidates && (
        <section
          aria-label={t("s_candidates_aria")}
          style={{
            border: "1px solid #bfdbfe",
            background: "#eff6ff",
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <p style={{ margin: "0 0 10px", fontWeight: 600 }}>
            {t("s_candidates_lead").replace("{name}", pendingName)}
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {candidates.map((cd, i) => (
              <button
                key={i}
                onClick={() => void createSubject(cd.name, cd.description)}
                disabled={busy}
                style={{
                  textAlign: "left",
                  padding: "10px 14px",
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  cursor: "pointer",
                }}
              >
                <span style={{ fontWeight: 600 }}>{cd.name}</span>
                <span style={{ display: "block", color: "#64748b", fontSize: 14 }}>{cd.description}</span>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
            <button
              onClick={() => void createSubject(pendingName, null)}
              disabled={busy}
              style={{
                padding: "8px 14px",
                background: "none",
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              {t("s_not_in_list")}
            </button>
            <button
              onClick={() => {
                setCandidates(null);
                setPendingName("");
              }}
              disabled={busy}
              style={{ padding: "8px 14px", background: "none", border: "none", color: "#64748b", cursor: "pointer" }}
            >
              {t("s_cancel")}
            </button>
          </div>
        </section>
      )}

      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {subjects.map((s) => (
          <li
            key={s.id}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              border: "1px solid #e2e8f0", borderRadius: 12, padding: "8px 12px 8px 16px",
            }}
          >
            <Link
              href={`/subjects/${s.slug}`}
              style={{
                flex: 1, display: "flex", justifyContent: "space-between", gap: 12,
                textDecoration: "none", color: "inherit", padding: "4px 0",
              }}
            >
              <span>
                {s.name}
                <small style={{ color: "#64748b", marginLeft: 8 }}>
                  {TYPE_LABEL_KEY[s.subjectType] ? t(TYPE_LABEL_KEY[s.subjectType]) : s.subjectType}
                </small>
                {s.profileHint && (
                  <small style={{ display: "block", color: "#94a3b8" }}>{s.profileHint}</small>
                )}
              </span>
              <span style={{ color: "#64748b", whiteSpace: "nowrap" }}>
                {s.latestScores.consciousness_7d != null &&
                  t("s_score_consciousness").replace("{score}", String(s.latestScores.consciousness_7d))}
                {s.latestScores.social_value_creation != null &&
                  t("s_score_value").replace("{score}", String(s.latestScores.social_value_creation))}
              </span>
            </Link>
            {confirmingDelete === s.slug ? (
              <span style={{ whiteSpace: "nowrap" }}>
                <button
                  onClick={() => void deleteSubject(s.slug)}
                  style={{ padding: "4px 10px", background: "#b91c1c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
                >
                  {t("s_delete_confirm")}
                </button>
                <button
                  onClick={() => setConfirmingDelete("")}
                  style={{ marginLeft: 6, padding: "4px 10px", background: "none", border: "1px solid #cbd5e1", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
                >
                  {t("s_cancel")}
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmingDelete(s.slug)}
                aria-label={t("s_delete_person_aria").replace("{name}", s.name)}
                style={{ background: "none", border: "none", color: "#b91c1c", cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" }}
              >
                {t("s_delete")}
              </button>
            )}
          </li>
        ))}
        {subjects.length === 0 && <li style={{ color: "#64748b" }}>{t("s_subjects_empty")}</li>}
      </ul>
    </main>
  );
}
