// 人物評価の結果表示 (共有可能な公開ページと、オーナーの詳細ページで共用)。
// フックやブラウザ API を使わない純粋な表示部品なので、server/client どちらでも使える。
// 長い散文は折りたたみ (details)、記号装飾は出さない (BR-09)。

export type DimensionResult = {
  score: number;
  confidence: string;
  keyEvidence: { summary: string; certainty: string }[];
  risks: string[];
};
export type Scores7d = {
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
export type ScoresSvc = {
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
export type RunSummary = {
  id: string;
  ddType: string;
  status: string;
  moduleScore: number | null;
  confidenceScore: number | null;
  scores: Scores7d | ScoresSvc | null;
  errorDetail: string | null;
  createdAt: string;
};

const DIM_LABEL: Record<string, string> = {
  "1D": "一の次元", "2D": "二の次元", "3D": "三の次元", "4D": "四の次元",
  "5D": "五の次元", "6D": "六の次元", "7D": "七の次元",
};
const RANK_COLOR: Record<string, string> = {
  S: "#7c3aed", A: "#2563eb", B: "#0891b2", C: "#d97706", D: "#64748b",
};
const CONF_LABEL: Record<string, string> = { A: "確か", B: "概ね確か", C: "推計含む", D: "情報少" };

export function Collapsible({ title, text }: { title: string; text?: string }) {
  if (!text) return null;
  return (
    <details style={{ margin: "8px 0" }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>{title}</summary>
      <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.8 }}>{text}</p>
    </details>
  );
}

export function ScoreHero({ value, max, chip, chipColor, caption }: {
  value: number; max: number; chip: string; chipColor: string; caption: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "12px 0 16px", flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span style={{ fontSize: 44, fontWeight: 700, color: "#0f172a", fontVariantNumeric: "tabular-nums" }}>
          {value}
        </span>
        <span style={{ color: "#64748b" }}>/{max}</span>
      </div>
      <span style={{ background: chipColor, color: "#fff", borderRadius: 999, padding: "4px 14px", fontWeight: 700 }}>
        {chip}
      </span>
      <span style={{ color: "#64748b", fontSize: 13 }}>{caption}</span>
    </div>
  );
}

export function Meter({ label, score, max, right, hint }: {
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

export function Section7d({ run }: { run: RunSummary }) {
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

export function SectionSvc({ run }: { run: RunSummary }) {
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
        <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 12, padding: "10px 16px", margin: "8px 0" }}>
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

// 共有テキスト/OG 説明に使う短い要約 (完了した評価のスコアだけを拾う)。
export function evalHeadline(name: string, r7?: RunSummary, rSvc?: RunSummary): string {
  const parts: string[] = [];
  const s7 = r7?.status === "completed" ? (r7.scores as Scores7d | null) : null;
  if (s7 && typeof s7.publicValueScore === "number") {
    parts.push(`公的社会価値創造 ${s7.publicValueScore}/100${s7.rank ? `(ランク${s7.rank})` : ""}`);
  }
  const sS = rSvc?.status === "completed" ? (rSvc.scores as ScoresSvc | null) : null;
  if (sS && typeof sS.total100 === "number") parts.push(`社会価値創造 ${sS.total100}/100`);
  return parts.length ? `${name}: ${parts.join(" ・ ")}` : `${name} の人物評価`;
}
