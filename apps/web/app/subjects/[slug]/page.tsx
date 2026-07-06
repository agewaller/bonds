"use client";
// 人物詳細 + 評価実行 + 2 セクション表示。
// 実行は 1〜2 分かかるためメッセージをローテーションして待たせる (プロトタイプ index.html の UX を踏襲)。
// 長い散文は折りたたみ、記号装飾は出さない。
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type DimensionResult = {
  score: number;
  confidence: string;
  keyEvidence: { summary: string; certainty: string }[];
  risks: string[];
};
type Scores7d = {
  identified: boolean;
  reason?: string;
  subjectNote?: string;
  dimensions?: Record<string, DimensionResult>;
  allocation?: Record<string, number>;
  publicValueScore?: number;
  rank?: string;
  createdValueEstimate?: string;
  socialCosts?: string;
  counterfactual?: string;
  evolutionConditions?: string[];
  summary?: string;
};
type ScoresSvc = {
  identified: boolean;
  reason?: string;
  subjectNote?: string;
  items?: { key: string; score: number; reason: string }[];
  total100?: number;
  grade?: number;
  createdValue?: { annualJpy: string; cumulativeJpy: string; assumptions: string[]; confidence: string };
  counterfactualContributionPct?: number;
  verdict?: string;
  somethingNew?: string;
  limitations?: string[];
  summary?: string;
};
type RunSummary = {
  id: string;
  ddType: string;
  status: string;
  moduleScore: number | null;
  confidenceScore: number | null;
  scores: Scores7d | ScoresSvc | null;
  errorDetail: string | null;
  createdAt: string;
};
type Detail = {
  subject: { id: string; slug: string; name: string; subjectType: string };
  latestByType: Record<string, RunSummary>;
};

const WAIT_MESSAGES = [
  "公開情報を思い出しながら整理しています",
  "七つの次元ごとに根拠を確かめています",
  "生み出した価値と社会的なコストを見比べています",
  "もう少しで評価がまとまります",
];

const DIM_LABEL: Record<string, string> = {
  "1D": "一の次元", "2D": "二の次元", "3D": "三の次元", "4D": "四の次元",
  "5D": "五の次元", "6D": "六の次元", "7D": "七の次元",
};

function Collapsible({ title, text }: { title: string; text?: string }) {
  if (!text) return null;
  return (
    <details style={{ margin: "8px 0" }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>{title}</summary>
      <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.8 }}>{text}</p>
    </details>
  );
}

function Section7d({ run }: { run: RunSummary }) {
  const s = run.scores as Scores7d | null;
  if (!s) return null;
  if (!s.identified) {
    return <p>この名前からは公人を特定できませんでした。{s.reason}</p>;
  }
  return (
    <div>
      {s.subjectNote && <p style={{ color: "#64748b" }}>{s.subjectNote}</p>}
      <p style={{ fontSize: 20 }}>
        公的社会価値創造スコア {s.publicValueScore} 点 (ランク {s.rank})
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["次元", "点数", "確からしさ", "意識配分"].map((h) => (
              <th key={h} style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #e2e8f0" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(s.dimensions ?? {}).map(([k, d]) => (
            <tr key={k}>
              <td style={{ padding: 6 }}>{DIM_LABEL[k] ?? k}</td>
              <td style={{ padding: 6 }}>{d.score}</td>
              <td style={{ padding: 6 }}>{d.confidence}</td>
              <td style={{ padding: 6 }}>{s.allocation?.[k] != null ? `${s.allocation[k]}%` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Collapsible title="総括" text={s.summary} />
      <Collapsible title="生み出した価値の見立て" text={s.createdValueEstimate} />
      <Collapsible title="社会的なコストや課題" text={s.socialCosts} />
      <Collapsible title="もしこの人がいなかったら" text={s.counterfactual} />
      <Collapsible title="さらに伸びる条件" text={(s.evolutionConditions ?? []).join("\n")} />
    </div>
  );
}

function SectionSvc({ run }: { run: RunSummary }) {
  const s = run.scores as ScoresSvc | null;
  if (!s) return null;
  if (!s.identified) {
    return <p>この名前からは公人を特定できませんでした。{s.reason}</p>;
  }
  return (
    <div>
      {s.subjectNote && <p style={{ color: "#64748b" }}>{s.subjectNote}</p>}
      <p style={{ fontSize: 20 }}>
        総合 {s.total100} 点 (10 段階で {s.grade})
        {s.counterfactualContributionPct != null && ` ・ 本人ならではの貢献 ${s.counterfactualContributionPct}%`}
      </p>
      {s.createdValue && (
        <p>
          生み出した価値の推計: 年間 {s.createdValue.annualJpy || "推計困難"} / 累積 {s.createdValue.cumulativeJpy || "推計困難"}
          (確からしさ {s.createdValue.confidence})
        </p>
      )}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["項目", "点数"].map((h) => (
              <th key={h} style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #e2e8f0" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(s.items ?? []).map((it) => (
            <tr key={it.key}>
              <td style={{ padding: 6 }}>{it.key}</td>
              <td style={{ padding: 6 }}>{it.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Collapsible title="総括" text={s.summary} />
      <Collapsible title="総合判断" text={s.verdict} />
      <Collapsible title="新しい視点" text={s.somethingNew} />
      <Collapsible title="この評価の限界" text={(s.limitations ?? []).join("\n")} />
    </div>
  );
}

export default function SubjectDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [running, setRunning] = useState(false);
  const [waitMsg, setWaitMsg] = useState(WAIT_MESSAGES[0]);
  const [error, setError] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/bff/dd/subjects/${slug}`);
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
    timerRef.current = setInterval(() => {
      i = (i + 1) % WAIT_MESSAGES.length;
      setWaitMsg(WAIT_MESSAGES[i]);
    }, 8000);
    try {
      const res = await fetch(`/api/bff/dd/subjects/${slug}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: "ja" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail ?? "評価を実行できませんでした。しばらくしてからお試しください");
        return;
      }
      await load();
    } catch {
      setError("評価を実行できませんでした。通信環境を確かめてお試しください");
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      setRunning(false);
    }
  };

  if (notFound) {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
        <p>この人物のページが見つかりませんでした。</p>
        <p><Link href="/subjects" style={{ color: "#2563eb" }}>一覧へ戻る</Link></p>
      </main>
    );
  }
  if (!detail) {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
        <p>読み込んでいます…</p>
      </main>
    );
  }

  const r7d = detail.latestByType.consciousness_7d;
  const rSvc = detail.latestByType.social_value_creation;

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 16px" }}>
      <p>
        <Link href="/subjects" style={{ color: "#2563eb" }}>
          一覧へ戻る
        </Link>
      </p>
      <h1 style={{ fontSize: 26 }}>{detail.subject.name}</h1>

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
        {running ? "評価しています…" : "二つの視点で評価する"}
      </button>
      {running && <p style={{ color: "#64748b" }}>{waitMsg} (1〜2 分ほどかかります)</p>}
      {error && (
        <p role="alert" style={{ color: "#b91c1c", background: "#fef2f2", padding: 8, borderRadius: 8 }}>
          {error}
        </p>
      )}

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 20, borderBottom: "2px solid #2563eb", paddingBottom: 4 }}>意識の七次元</h2>
        {r7d?.status === "completed" ? (
          <Section7d run={r7d} />
        ) : (
          <p style={{ color: "#64748b" }}>
            {r7d ? "前回の評価は完了しませんでした。もう一度お試しください。" : "まだ評価がありません。"}
          </p>
        )}
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 20, borderBottom: "2px solid #2563eb", paddingBottom: 4 }}>社会価値創造</h2>
        {rSvc?.status === "completed" ? (
          <SectionSvc run={rSvc} />
        ) : (
          <p style={{ color: "#64748b" }}>
            {rSvc ? "前回の評価は完了しませんでした。もう一度お試しください。" : "まだ評価がありません。"}
          </p>
        )}
      </section>

      <footer style={{ marginTop: 40, color: "#94a3b8", fontSize: 13 }}>
        この評価は公開情報にもとづく参考情報で、断定ではありません。最新の出来事が反映されていない場合があります。
      </footer>
    </main>
  );
}
