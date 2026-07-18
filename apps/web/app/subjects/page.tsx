"use client";
// 評価対象 (公人) の一覧 + 追加。文言は自然な日本語で、技術語 (AI 等) を出さない。
// 追加時はまず同姓同名の候補を確かめ、複数いればユーザーに「どの方か」を選んでもらう。
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AuthBar } from "../../components/AuthBar";
import { apiFetch } from "../../lib/client-api";

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

const TYPE_LABEL: Record<string, string> = {
  politician: "政治家",
  executive: "経営者",
  other: "その他",
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
        setError(body.detail ?? "追加できませんでした");
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
    else setError("削除できませんでした。もう一度お試しください");
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
        body: JSON.stringify({ name: trimmed }),
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
        <Link href="/settings" style={{ color: "#64748b", fontSize: 14 }}>設定</Link>
        <AuthBar />
      </div>
      <h1 style={{ fontSize: 24 }}>評価対象の人物</h1>
      <p style={{ color: "#64748b" }}>
        政治家・経営者などの公人を登録すると、意識の七次元と社会価値創造の二つの視点から評価できます。
      </p>

      <div style={{ display: "flex", gap: 8, margin: "16px 0" }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          placeholder="例: 渋沢栄一"
          aria-label="人物名"
          style={{ flex: 1, padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8 }}
        />
        <select
          value={subjectType}
          onChange={(e) => setSubjectType(e.target.value)}
          aria-label="区分"
          style={{ padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8 }}
        >
          <option value="politician">政治家</option>
          <option value="executive">経営者</option>
          <option value="other">その他</option>
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
          追加
        </button>
      </div>
      {busy && !candidates && (
        <p style={{ color: "#64748b" }}>どなたのことか確認しています…</p>
      )}
      {error && (
        <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>
          {error}
        </p>
      )}

      {candidates && (
        <section
          aria-label="人物の候補"
          style={{
            border: "1px solid #bfdbfe",
            background: "#eff6ff",
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <p style={{ margin: "0 0 10px", fontWeight: 600 }}>
            「{pendingName}」というお名前の方は複数いるようです。どの方のことか選んでください。
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
              この中にはいない (名前のみで登録)
            </button>
            <button
              onClick={() => {
                setCandidates(null);
                setPendingName("");
              }}
              disabled={busy}
              style={{ padding: "8px 14px", background: "none", border: "none", color: "#64748b", cursor: "pointer" }}
            >
              やめる
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
                <small style={{ color: "#64748b", marginLeft: 8 }}>{TYPE_LABEL[s.subjectType] ?? s.subjectType}</small>
                {s.profileHint && (
                  <small style={{ display: "block", color: "#94a3b8" }}>{s.profileHint}</small>
                )}
              </span>
              <span style={{ color: "#64748b", whiteSpace: "nowrap" }}>
                {s.latestScores.consciousness_7d != null && `意識 ${s.latestScores.consciousness_7d}`}
                {s.latestScores.social_value_creation != null &&
                  ` ・ 価値 ${s.latestScores.social_value_creation}`}
              </span>
            </Link>
            {confirmingDelete === s.slug ? (
              <span style={{ whiteSpace: "nowrap" }}>
                <button
                  onClick={() => void deleteSubject(s.slug)}
                  style={{ padding: "4px 10px", background: "#b91c1c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
                >
                  削除する
                </button>
                <button
                  onClick={() => setConfirmingDelete("")}
                  style={{ marginLeft: 6, padding: "4px 10px", background: "none", border: "1px solid #cbd5e1", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
                >
                  やめる
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmingDelete(s.slug)}
                aria-label={`${s.name} を削除`}
                style={{ background: "none", border: "none", color: "#b91c1c", cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" }}
              >
                削除
              </button>
            )}
          </li>
        ))}
        {subjects.length === 0 && <li style={{ color: "#64748b" }}>まだ登録がありません。</li>}
      </ul>
    </main>
  );
}
