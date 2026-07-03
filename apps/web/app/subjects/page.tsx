"use client";
// 評価対象 (公人) の一覧 + 追加。文言は自然な日本語で、技術語 (AI 等) を出さない。
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type SubjectRow = {
  id: string;
  slug: string;
  name: string;
  subjectType: string;
  country: string | null;
  latestScores: Record<string, number | null>;
};

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

  const load = useCallback(async () => {
    const res = await fetch("/api/bff/dd/subjects");
    if (res.ok) setSubjects((await res.json()).subjects);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/bff/dd/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), subjectType }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail ?? "追加できませんでした");
        return;
      }
      setName("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
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
      {error && (
        <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>
          {error}
        </p>
      )}

      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {subjects.map((s) => (
          <li key={s.id}>
            <Link
              href={`/subjects/${s.slug}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "12px 16px",
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <span>
                {s.name}
                <small style={{ color: "#64748b", marginLeft: 8 }}>{TYPE_LABEL[s.subjectType] ?? s.subjectType}</small>
              </span>
              <span style={{ color: "#64748b" }}>
                {s.latestScores.consciousness_7d != null && `意識 ${s.latestScores.consciousness_7d}`}
                {s.latestScores.social_value_creation != null &&
                  ` ・ 価値 ${s.latestScores.social_value_creation}`}
              </span>
            </Link>
          </li>
        ))}
        {subjects.length === 0 && <li style={{ color: "#64748b" }}>まだ登録がありません。</li>}
      </ul>
    </main>
  );
}
