"use client";
// 連絡帳 + つながりスコア + 「今日、連絡してみませんか」(lms の関係性ダッシュボードを移植)。
// 文言は寄り添い基調・技術語なし・記号装飾なし (CLAUDE.md 共通プロダクト原則)。
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../lib/client-api";
import { AuthBar } from "../../components/AuthBar";
import { LanguageSelector } from "../../components/LanguageSelector";
import { t } from "../../lib/i18n";
import Link from "next/link";

type Contact = {
  id: string;
  name: string;
  furigana: string | null;
  distance: number;
  relationship: string;
  company: string | null;
  birthday: string | null;
};
type Summary = {
  connectionScore: number;
  isolation: { level: string; overdueCount: number; total: number };
  today: { contactId: string; name: string; kind: string; reason: string }[];
};

const LEVEL_LABEL: Record<string, { label: string; color: string; message: string }> = {
  good: { label: "良好", color: "#27ae60", message: "大切な方とのつながりがしっかり保たれています。" },
  fair: { label: "まずまず", color: "#f1c40f", message: "概ね良いですが、少し間が空いている方がいます。" },
  caution: { label: "少し注意", color: "#e67e22", message: "しばらくご連絡していない方がいらっしゃいます。" },
  warning: { label: "要注意", color: "#e74c3c", message: "大切な方との連絡が途絶えがちです。ぜひお声がけを。" },
  unknown: { label: "これから", color: "#8896a6", message: "連絡先を登録すると、つながりの状態を確認できます。" },
};

const DISTANCE_LABEL: Record<number, string> = {
  1: "毎日会いたい",
  2: "週に一度は",
  3: "月に一度は",
  4: "折々に",
  5: "年に一度は",
};

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [name, setName] = useState("");
  const [distance, setDistance] = useState("3");
  const [importText, setImportText] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [cRes, sRes] = await Promise.all([
      apiFetch("contacts"),
      apiFetch("relationship/summary"),
    ]);
    if (cRes.ok) setContacts((await cRes.json()).contacts);
    if (sRes.ok) setSummary(await sRes.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch("contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), distance: Number(distance) }),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).detail ?? "追加できませんでした");
        return;
      }
      setName("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (!importText.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch("contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: importText }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.detail ?? "取り込めませんでした");
        return;
      }
      setNotice(`${body.imported}件の連絡先を取り込みました`);
      setImportText("");
      setShowImport(false);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const logContact = async (contactId: string) => {
    await apiFetch(`contacts/${contactId}/interactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "message" }),
    });
    setNotice("連絡の記録をつけました");
    await load();
  };

  const level = LEVEL_LABEL[summary?.isolation.level ?? "unknown"] ?? LEVEL_LABEL.unknown!;

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <LanguageSelector />
        <AuthBar />
      </div>
      <p>
        <Link href="/" style={{ color: "#2563eb" }}>{t("back_home")}</Link>
      </p>
      <h1 style={{ fontSize: 24 }}>{t("contacts_title")}</h1>

      {summary && (
        <section
          style={{
            borderLeft: `5px solid ${level.color}`,
            background: "#f8fafc",
            borderRadius: 12,
            padding: "12px 16px",
            margin: "16px 0",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 style={{ fontSize: 18, margin: 0 }}>{t("connection_score")}</h2>
            <div style={{ fontSize: 28, color: level.color }}>
              {summary.connectionScore}
              <small style={{ fontSize: 14, color: "#64748b" }}>/100</small>
            </div>
          </div>
          <p style={{ margin: "4px 0", color: level.color }}>{level.label}</p>
          <p style={{ margin: 0, color: "#334155" }}>{level.message}</p>
        </section>
      )}

      {summary && summary.today.length > 0 && (
        <section style={{ margin: "16px 0" }}>
          <h2 style={{ fontSize: 18 }}>{t("today_suggestion")}</h2>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
            {summary.today.map((sug) => (
              <li
                key={sug.contactId}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                  padding: "10px 14px",
                }}
              >
                <span>
                  <strong>{sug.name}</strong>さん
                  <span style={{ color: "#64748b", marginLeft: 8 }}>{sug.reason}</span>
                </span>
                <button
                  onClick={() => void logContact(sug.contactId)}
                  style={{
                    padding: "6px 12px",
                    border: "1px solid #2563eb",
                    color: "#2563eb",
                    background: "#fff",
                    borderRadius: 8,
                    cursor: "pointer",
                  }}
                >
                  {t("contacted")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {summary && summary.today.length === 0 && contacts.length > 0 && (
        <p style={{ color: "#27ae60" }}>すべての方と適切な頻度でつながれています。素晴らしいですね。</p>
      )}

      {notice && <p style={{ color: "#166534", background: "#f0fdf4", padding: 8, borderRadius: 8 }}>{notice}</p>}
      {error && (
        <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>
          {error}
        </p>
      )}

      <section style={{ margin: "24px 0" }}>
        <h2 style={{ fontSize: 18 }}>{t("add_section")}</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            placeholder={t("name_placeholder")}
            aria-label="お名前"
            style={{ flex: 1, padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8 }}
          />
          <select
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            aria-label="距離感"
            style={{ padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 8 }}
          >
            {[1, 2, 3, 4, 5].map((d) => (
              <option key={d} value={d}>{DISTANCE_LABEL[d]}</option>
            ))}
          </select>
          <button
            onClick={() => void add()}
            disabled={busy || !name.trim()}
            style={{ padding: "10px 20px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
          >
            {t("add_button")}
          </button>
        </div>
        <p style={{ marginTop: 8 }}>
          <button
            onClick={() => setShowImport(!showImport)}
            style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0 }}
          >
            {showImport ? "取り込みを閉じる" : "ファイルからまとめて取り込む (CSV や連絡先ファイル)"}
          </button>
        </p>
        {showImport && (
          <div>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="CSV または vCard の内容をここに貼り付けてください"
              aria-label="取り込み内容"
              rows={6}
              style={{ width: "100%", padding: 10, border: "1px solid #e2e8f0", borderRadius: 8 }}
            />
            <button
              onClick={() => void runImport()}
              disabled={busy || !importText.trim()}
              style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
            >
              取り込む
            </button>
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 18 }}>{t("everyone")} ({contacts.length})</h2>
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {contacts.map((c) => (
            <li key={c.id}>
              <Link
                href={`/contacts/${c.id}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: "10px 14px",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <span>
                  {c.name}
                  {c.company && <small style={{ color: "#64748b", marginLeft: 8 }}>{c.company}</small>}
                </span>
                <small style={{ color: "#64748b" }}>{DISTANCE_LABEL[c.distance] ?? ""}</small>
              </Link>
            </li>
          ))}
          {contacts.length === 0 && <li style={{ color: "#64748b" }}>まだ登録がありません。大切な方から登録してみましょう。</li>}
        </ul>
      </section>
    </main>
  );
}
