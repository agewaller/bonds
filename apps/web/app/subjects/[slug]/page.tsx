"use client";
// 人物詳細 + 評価実行 + 2 セクション表示。
// 実行は 1〜2 分かかるためメッセージをローテーションして待たせる (プロトタイプ index.html の UX を踏襲)。
// 結果表示部品は components/EvalResult に集約し、公開共有ページ (/p/[slug]) と共用する。
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "../../../lib/client-api";
import { t, currentLocale } from "../../../lib/i18n";
import {
  Section7d,
  SectionSvc,
  evalHeadline,
  type RunSummary,
} from "../../../components/EvalResult";

type HistoryRun = {
  id: string;
  ddType: string;
  status: string;
  moduleScore: number | null;
  errorDetail: string | null;
  createdAt: string;
};
type Detail = {
  subject: { id: string; slug: string; name: string; subjectType: string; profileHint: string | null };
  latestByType: Record<string, RunSummary>;
  recentRuns: HistoryRun[];
};

// ddType / status → 辞書キー (表示時に t() で引く)
const DDTYPE_LABEL_KEY: Record<string, string> = {
  consciousness_7d: "s_ddtype_consciousness_7d",
  social_value_creation: "s_ddtype_social_value_creation",
};
const STATUS_LABEL_KEY: Record<string, string> = {
  completed: "s_status_completed",
  invalid_output: "s_status_invalid_output",
  failed: "s_status_failed",
};

const WAIT_MESSAGE_KEYS = ["s_wait_1", "s_wait_2", "s_wait_3", "s_wait_4"];

export default function SubjectDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [running, setRunning] = useState(false);
  const [waitMsg, setWaitMsg] = useState("");
  const [error, setError] = useState("");
  const [shareMsg, setShareMsg] = useState("");
  const [confirmDeletePerson, setConfirmDeletePerson] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch(`dd/subjects/${slug}`);
    if (res.ok) setDetail(await res.json());
    else if (res.status === 404) setNotFound(true);
  }, [slug]);

  useEffect(() => {
    void load();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load]);

  const run = async () => {
    if (running) return;
    setRunning(true);
    setError("");
    let i = 0;
    setWaitMsg(t(WAIT_MESSAGE_KEYS[0]));
    timerRef.current = setInterval(() => {
      i = (i + 1) % WAIT_MESSAGE_KEYS.length;
      setWaitMsg(t(WAIT_MESSAGE_KEYS[i]));
    }, 8000);
    try {
      const res = await apiFetch(`dd/subjects/${slug}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: currentLocale() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail ?? t("s_run_failed"));
        return;
      }
      await load();
    } catch {
      setError(t("s_run_failed_network"));
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      setRunning(false);
    }
  };

  // 評価結果そのものが出る公開ページ (/p/[slug]) の URL を共有する。
  // 受け取った人はリンクを開くだけで結果を見られ、そこから自分でも試せる。
  const shareResult = async () => {
    if (!detail) return;
    const r7 = detail.latestByType.consciousness_7d;
    const rS = detail.latestByType.social_value_creation;
    if (r7?.status !== "completed" && rS?.status !== "completed") {
      setShareMsg(t("s_share_none"));
      return;
    }
    setShareMsg("");
    const url = `${location.origin}/p/${detail.subject.slug}`;
    const headline = evalHeadline(detail.subject.name, r7, rS);
    const nav = navigator as Navigator & {
      share?: (d: { title?: string; text?: string; url?: string }) => Promise<void>;
    };
    if (typeof nav.share === "function") {
      try {
        await nav.share({ title: t("s_share_title").replace("{name}", detail.subject.name), text: headline, url });
        return;
      } catch {
        // 共有をキャンセル/失敗したらコピーにフォールバック
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareMsg(t("s_share_copied"));
    } catch {
      setShareMsg(t("s_share_copy_failed").replace("{url}", url));
    }
  };

  // 評価の履歴を 1 件ずつ削除する (データ主権: 1 件単位で消せる)。
  const deleteRun = async (runId: string) => {
    setError("");
    const res = await apiFetch(`dd/subjects/${slug}/runs/${runId}`, { method: "DELETE" });
    if (res.ok) await load();
    else setError(t("s_history_delete_failed"));
  };

  // この人物ごと (評価履歴すべて) を削除する。
  const deletePerson = async () => {
    setError("");
    const res = await apiFetch(`dd/subjects/${slug}`, { method: "DELETE" });
    if (res.ok) location.href = "/subjects";
    else setError(t("s_delete_failed"));
  };

  if (notFound) {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
        <p>{t("s_subject_not_found")}</p>
        <p><Link href="/subjects" style={{ color: "#2563eb" }}>{t("s_back_to_list")}</Link></p>
      </main>
    );
  }
  if (!detail) {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
        <p>{t("s_loading")}</p>
      </main>
    );
  }

  const r7d = detail.latestByType.consciousness_7d;
  const rSvc = detail.latestByType.social_value_creation;
  const hasResult = r7d?.status === "completed" || rSvc?.status === "completed";

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
      <p>
        <Link href="/subjects" style={{ color: "#2563eb" }}>
          {t("s_back_to_list")}
        </Link>
      </p>
      <h1 style={{ fontSize: 26, marginBottom: detail.subject.profileHint ? 4 : undefined }}>
        {detail.subject.name}
      </h1>
      {detail.subject.profileHint && (
        <p style={{ color: "#64748b", margin: "0 0 16px", fontSize: 14 }}>{detail.subject.profileHint}</p>
      )}

      <button
        onClick={() => void run()}
        disabled={running}
        style={{
          padding: "12px 24px",
          background: running ? "#94a3b8" : "#2563eb",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          cursor: running ? "wait" : "pointer",
          fontSize: 16,
        }}
      >
        {running ? t("s_run_running") : t("s_run_button")}
      </button>
      {hasResult && (
        <button
          onClick={() => void shareResult()}
          style={{
            marginLeft: 12,
            padding: "12px 20px",
            background: "#fff",
            color: "#2563eb",
            border: "1px solid #2563eb",
            borderRadius: 8,
            cursor: "pointer",
            fontSize: 16,
          }}
        >
          {t("s_share_button")}
        </button>
      )}
      {hasResult && (
        <p style={{ marginTop: 8 }}>
          <Link href={`/p/${detail.subject.slug}`} style={{ color: "#2563eb", fontSize: 14 }} target="_blank">
            {t("s_open_share_page")}
          </Link>
        </p>
      )}
      {running && <p style={{ color: "#64748b" }}>{waitMsg} {t("s_wait_takes")}</p>}
      {shareMsg && <p style={{ color: "#166534", background: "#f0fdf4", padding: 8, borderRadius: 8 }}>{shareMsg}</p>}
      {error && (
        <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>
          {error}
        </p>
      )}

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 20, borderBottom: "2px solid #2563eb", paddingBottom: 4 }}>{t("s_ddtype_consciousness_7d")}</h2>
        {r7d?.status === "completed" ? (
          <Section7d run={r7d} />
        ) : (
          <p style={{ color: "#64748b" }}>
            {r7d ? t("s_prev_not_completed") : t("s_no_eval_yet")}
          </p>
        )}
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 20, borderBottom: "2px solid #2563eb", paddingBottom: 4 }}>{t("s_ddtype_social_value_creation")}</h2>
        {rSvc?.status === "completed" ? (
          <SectionSvc run={rSvc} />
        ) : (
          <p style={{ color: "#64748b" }}>
            {rSvc ? t("s_prev_not_completed") : t("s_no_eval_yet")}
          </p>
        )}
      </section>

      {detail.recentRuns.length > 0 && (
        <section style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 18 }}>{t("s_history_heading")}</h2>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
            {detail.recentRuns.map((r) => (
              <li
                key={r.id}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 14,
                }}
              >
                <span style={{ color: "#334155" }}>
                  {DDTYPE_LABEL_KEY[r.ddType] ? t(DDTYPE_LABEL_KEY[r.ddType]) : r.ddType}
                  <span style={{ color: "#94a3b8", marginLeft: 8 }}>
                    {new Date(r.createdAt).toLocaleString(currentLocale() === "en" ? "en-US" : "ja-JP")}
                  </span>
                  <span style={{ color: "#64748b", marginLeft: 8 }}>
                    {STATUS_LABEL_KEY[r.status] ? t(STATUS_LABEL_KEY[r.status]) : r.status}
                  </span>
                  {typeof r.moduleScore === "number" && (
                    <span style={{ color: "#334155", marginLeft: 8 }}>{r.moduleScore}/100</span>
                  )}
                </span>
                <button
                  onClick={() => void deleteRun(r.id)}
                  style={{ background: "none", border: "none", color: "#b91c1c", cursor: "pointer", padding: "2px 6px" }}
                >
                  {t("s_delete")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section style={{ marginTop: 28 }}>
        {confirmDeletePerson ? (
          <div style={{ border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 8, padding: "12px 14px" }}>
            <p style={{ margin: "0 0 10px", color: "#7f1d1d" }}>
              {t("s_delete_person_lead").replace("{name}", detail.subject.name)}
            </p>
            <button
              onClick={() => void deletePerson()}
              style={{ padding: "8px 16px", background: "#b91c1c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
            >
              {t("s_delete_confirm")}
            </button>
            <button
              onClick={() => setConfirmDeletePerson(false)}
              style={{ marginLeft: 8, padding: "8px 16px", background: "#fff", color: "#334155", border: "1px solid #cbd5e1", borderRadius: 8, cursor: "pointer" }}
            >
              {t("s_cancel")}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDeletePerson(true)}
            style={{ background: "none", border: "none", color: "#b91c1c", cursor: "pointer", padding: 0, fontSize: 14 }}
          >
            {t("s_delete_person_button")}
          </button>
        )}
      </section>

      <footer style={{ marginTop: 40, color: "#94a3b8", fontSize: 13 }}>
        {t("s_disclaimer")}
      </footer>
    </main>
  );
}
