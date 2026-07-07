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
  subject: { id: string; slug: string; name: string; subjectType: string; profileHint: string | null };
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

const RANK_COLOR: Record<string, string> = {
  S: "#7c3aed", A: "#2563eb", B: "#0891b2", C: "#d97706", D: "#64748b",
};
const CONF_LABEL: Record<string, string> = { A: "確か", B: "概ね確か", C: "推計含む", D: "情報少" };

function ScoreHero({ value, max, chip, chipColor, caption }: {
  value: number; max: number; chip: string; chipColor: string; caption: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "12px 0 16px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span style={{ fontSize: 44, fontWeight: 700, color: "#0f172a", fontVariantNumeric: "tabular-nums" }}>
          {value}
        </span>
        <span style={{ color: "#64748b" }}>/{max}</span>
      </div>
      <span
        style={{
          background: chipColor, color: "#fff", borderRadius: 999,
          padding: "4px 14px", fontWeight: 700,
        }}
      >
        {chip}
      </span>
      <span style={{ color: "#64748b", fontSize: 13 }}>{caption}</span>
    </div>
  );
}

function Meter({ label, score, max, right, hint }: {
  label: string; score: number; max: number; right?: string; hint?: string;
}) {
  const pct = Math.min(100, Math.round((score / max) * 100));
  return (
    <div style={{ margin: "10px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 3 }}>
        <span>{label}{hint ? <span style={{ color: "#94a3b8", marginLeft: 8, fontSize: 12 }}>{hint}</span> : null}</span>
        <span style={{ color: "#334155", fontVariantNumeric: "tabular-nums" }}>
          {score}
          <span style={{ color: "#94a3b8" }}>/{max}</span>
          {right ? <span style={{ color: "#64748b", marginLeft: 8 }}>{right}</span> : null}
        </span>
      </div>
      <div style={{ background: "#e2e8f0", borderRadius: 6, height: 10 }}>
        <div style={{ width: `${pct}%`, background: "linear-gradient(90deg,#60a5fa,#2563eb)", height: 10, borderRadius: 6 }} />
      </div>
    </div>
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
      <ScoreHero
        value={s.publicValueScore ?? 0}
        max={100}
        chip={`ランク ${s.rank}`}
        chipColor={RANK_COLOR[s.rank ?? "D"] ?? "#64748b"}
        caption="公的社会価値創造スコア"
      />
      <div style={{ background: "#f8fafc", borderRadius: 12, padding: "12px 16px" }}>
        {Object.entries(s.dimensions ?? {}).map(([k, d]) => (
          <Meter
            key={k}
            label={DIM_LABEL[k] ?? k}
            hint={CONF_LABEL[d.confidence] ?? d.confidence}
            score={d.score}
            max={10}
            right={s.allocation?.[k] != null ? `意識 ${s.allocation[k]}%` : undefined}
          />
        ))}
      </div>
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
      <ScoreHero
        value={s.total100 ?? 0}
        max={100}
        chip={`10段階で ${s.grade}`}
        chipColor="#0891b2"
        caption={s.counterfactualContributionPct != null ? `本人ならではの貢献 ${s.counterfactualContributionPct}%` : "社会価値創造"}
      />
      {s.createdValue && (
        <div
          style={{
            background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 12,
            padding: "10px 16px", margin: "8px 0",
          }}
        >
          <div style={{ color: "#0369a1", fontSize: 13 }}>生み出した価値の推計 (確からしさ {CONF_LABEL[s.createdValue.confidence] ?? s.createdValue.confidence})</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#0c4a6e" }}>
            年間 {s.createdValue.annualJpy || "推計困難"} ・ 累積 {s.createdValue.cumulativeJpy || "推計困難"}
          </div>
        </div>
      )}
      <div style={{ background: "#f8fafc", borderRadius: 12, padding: "12px 16px" }}>
        {(s.items ?? []).map((it) => (
          <Meter key={it.key} label={it.key} score={it.score} max={10} />
        ))}
      </div>
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
