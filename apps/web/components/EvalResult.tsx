// 人物評価の結果表示 (共有可能な公開ページと、オーナーの詳細ページで共用)。
// フックやブラウザ API を使わない純粋な表示部品なので、server/client どちらでも使える。
// 長い散文は折りたたみ (details)、記号装飾は出さない (BR-09)。
import { DICT_SUBJECTS } from "../lib/i18n-dict-subjects";

// lib/i18n.ts は "use client" のため、server でも描画されるこの部品からは直接呼べない。
// 同じ規則 (cookie bonds_locale / en 未訳は ja へフォールバック) をここで最小限に再現する。
// server 描画 (公開ページ /p/[slug]) では従来どおり ja になる。
function tt(key: string): string {
  const entry = DICT_SUBJECTS[key];
  if (!entry) return key;
  const en =
    typeof document !== "undefined" &&
    document.cookie.match(/(?:^|; )bonds_locale=([^;]+)/)?.[1] === "en";
  return (en ? entry.en : undefined) ?? entry.ja ?? key;
}

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

// 次元 / 確からしさ → 辞書キー (表示時に tt() で引く)
const DIM_LABEL_KEY: Record<string, string> = {
  "1D": "s_dim_1d", "2D": "s_dim_2d", "3D": "s_dim_3d", "4D": "s_dim_4d",
  "5D": "s_dim_5d", "6D": "s_dim_6d", "7D": "s_dim_7d",
};
// 各次元が何を見ているかの、やさしい一言 (専門用語を避ける。65歳ペルソナ)。
const DIM_DESC_KEY: Record<string, string> = {
  "1D": "s_dimdesc_1d", "2D": "s_dimdesc_2d", "3D": "s_dimdesc_3d", "4D": "s_dimdesc_4d",
  "5D": "s_dimdesc_5d", "6D": "s_dimdesc_6d", "7D": "s_dimdesc_7d",
};
const RANK_COLOR: Record<string, string> = {
  S: "#7c3aed", A: "#2563eb", B: "#0891b2", C: "#d97706", D: "#64748b",
};
const CONF_LABEL_KEY: Record<string, string> = {
  A: "s_conf_a", B: "s_conf_b", C: "s_conf_c", D: "s_conf_d",
};
const confLabel = (c: string) => (CONF_LABEL_KEY[c] ? tt(CONF_LABEL_KEY[c]) : c);

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

export function Meter({ label, score, max, right, hint, note }: {
  label: string; score: number; max: number; right?: string; hint?: string; note?: string;
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
      {note ? <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 3, lineHeight: 1.6 }}>{note}</div> : null}
    </div>
  );
}

export function Section7d({ run }: { run: RunSummary }) {
  const s = run.scores as Scores7d | null;
  if (!s) return null;
  if (!s.identified) {
    return <p>{tt("s_not_identified")}{s.reason}</p>;
  }
  return (
    <div>
      {s.subjectNote && <p style={{ color: "#64748b" }}>{s.subjectNote}</p>}
      <ScoreHero
        value={s.publicValueScore ?? 0}
        max={100}
        chip={tt("s_rank_chip").replace("{rank}", s.rank ?? "")}
        chipColor={RANK_COLOR[s.rank ?? "D"] ?? "#64748b"}
        caption={tt("s_public_value_caption")}
      />
      <p style={{ color: "#64748b", fontSize: 13, margin: "4px 0 8px" }}>
        {tt("s_7d_lead")}
      </p>
      <div style={{ background: "#f8fafc", borderRadius: 12, padding: "12px 16px" }}>
        {Object.entries(s.dimensions ?? {}).map(([k, d]) => (
          <Meter
            key={k}
            label={DIM_LABEL_KEY[k] ? tt(DIM_LABEL_KEY[k]) : k}
            hint={confLabel(d.confidence)}
            score={d.score}
            max={10}
            right={s.allocation?.[k] != null ? tt("s_allocation").replace("{pct}", String(s.allocation[k])) : undefined}
            note={DIM_DESC_KEY[k] ? tt(DIM_DESC_KEY[k]) : undefined}
          />
        ))}
      </div>
      <Collapsible title={tt("s_summary")} text={s.summary} />
      <Collapsible title={tt("s_created_value_estimate")} text={s.createdValueEstimate} />
      <Collapsible title={tt("s_social_costs")} text={s.socialCosts} />
      <Collapsible title={tt("s_counterfactual")} text={s.counterfactual} />
      <Collapsible title={tt("s_evolution_conditions")} text={(s.evolutionConditions ?? []).join("\n")} />
    </div>
  );
}

export function SectionSvc({ run }: { run: RunSummary }) {
  const s = run.scores as ScoresSvc | null;
  if (!s) return null;
  if (!s.identified) {
    return <p>{tt("s_not_identified")}{s.reason}</p>;
  }
  return (
    <div>
      {s.subjectNote && <p style={{ color: "#64748b" }}>{s.subjectNote}</p>}
      <ScoreHero
        value={s.total100 ?? 0}
        max={100}
        chip={tt("s_grade_chip").replace("{grade}", String(s.grade))}
        chipColor="#0891b2"
        caption={
          s.counterfactualContributionPct != null
            ? tt("s_svc_contrib").replace("{pct}", String(s.counterfactualContributionPct))
            : tt("s_ddtype_social_value_creation")
        }
      />
      {s.createdValue && (
        <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 12, padding: "10px 16px", margin: "8px 0" }}>
          <div style={{ color: "#0369a1", fontSize: 13 }}>
            {tt("s_created_value_box").replace("{conf}", confLabel(s.createdValue.confidence))}
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#0c4a6e" }}>
            {tt("s_value_amounts")
              .replace("{annual}", s.createdValue.annualJpy || tt("s_estimate_hard"))
              .replace("{cumulative}", s.createdValue.cumulativeJpy || tt("s_estimate_hard"))}
          </div>
        </div>
      )}
      <p style={{ color: "#64748b", fontSize: 13, margin: "4px 0 8px" }}>
        {tt("s_svc_lead")}
      </p>
      <div style={{ background: "#f8fafc", borderRadius: 12, padding: "12px 16px" }}>
        {(s.items ?? []).map((it) => (
          <Meter key={it.key} label={it.key} score={it.score} max={10} note={it.reason} />
        ))}
      </div>
      <Collapsible title={tt("s_summary")} text={s.summary} />
      <Collapsible title={tt("s_verdict")} text={s.verdict} />
      <Collapsible title={tt("s_something_new")} text={s.somethingNew} />
      <Collapsible title={tt("s_limitations")} text={(s.limitations ?? []).join("\n")} />
    </div>
  );
}

// 共有テキスト/OG 説明に使う短い要約 (完了した評価のスコアだけを拾う)。
export function evalHeadline(name: string, r7?: RunSummary, rSvc?: RunSummary): string {
  const parts: string[] = [];
  const s7 = r7?.status === "completed" ? (r7.scores as Scores7d | null) : null;
  if (s7 && typeof s7.publicValueScore === "number") {
    parts.push(
      tt("s_headline_7d").replace("{score}", String(s7.publicValueScore)) +
        (s7.rank ? tt("s_headline_rank").replace("{rank}", s7.rank) : ""),
    );
  }
  const sS = rSvc?.status === "completed" ? (rSvc.scores as ScoresSvc | null) : null;
  if (sS && typeof sS.total100 === "number") {
    parts.push(tt("s_headline_svc").replace("{score}", String(sS.total100)));
  }
  return parts.length ? `${name}: ${parts.join(" ・ ")}` : tt("s_share_title").replace("{name}", name);
}
