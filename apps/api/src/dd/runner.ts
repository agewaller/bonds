// 人物DD ランナー — vm-suite の DD オーケストレータ (親 run + step 行を作成 → 実行 →
// 検証 → 保存) を人物評価向けに移植 (DESIGN-HANDOVER.md §4.2)。
// フェーズ1 は検索なし = 知識ベースモード: search ステップは skipped で記録し、
// evaluate ステップが DB 駆動プロンプトで評価を実行する。
//
// generate (AI 呼び出し) と onEvent は注入可能にし、テストでは実 AI を呼ばずに検証する。
import type { ExtendedPrismaClient } from "@bonds/db";
import type { GenerateFn } from "../lib/anthropic.js";
import { personSearchQueries, buildSearchDigest, type SearchFn } from "../lib/tavily.js";
import {
  type DdType,
  extractJson,
  validateConsciousness7d,
  validateSocialValueCreation,
  moduleScoreOf,
  confidenceScoreOf,
  buildOutputInstruction,
} from "../lib/dd-spec.js";
import {
  PERSON_EVAL_GUARD,
  PERSON_EVAL_SAFETY,
  PERSON_DD_MAX_TOKENS,
  PERSON_DD_TIMEOUT_MS,
  PERSON_DD_PURPOSE_PREFIX,
  buildPersonEvalUserMessage,
} from "../lib/person-eval.js";
import { jsonProseLanguageDirective } from "../lib/locale.js";
import { calcCostJpy, canonicalizeModelId, type ModelId } from "../lib/cost.js";

export const DD_PROMPT_KEYS: Record<DdType, string> = {
  consciousness_7d: "person_eval_7d",
  social_value_creation: "person_eval_svc",
};

export type DdRunEvent =
  | { type: "run_created"; runId: string; ddType: DdType }
  | { type: "step_started"; runId: string; stepKey: string }
  | { type: "step_done"; runId: string; stepKey: string; status: string }
  | { type: "run_done"; runId: string; status: string; moduleScore: number | null }
  | { type: "run_failed"; runId: string; detail: string };

export type RunPersonDdDeps = {
  prisma: ExtendedPrismaClient;
  generate: GenerateFn;
  search?: SearchFn | null; // 無ければ知識ベースモード (search ステップは skipped)
  onEvent?: (ev: DdRunEvent) => void;
};

export type RunPersonDdArgs = {
  subjectId: string;
  ddType: DdType;
  model: ModelId;
  locale?: string;
};

// DB から現行プロンプトを取得 (active な最大 version)。
export async function getPromptText(
  prisma: ExtendedPrismaClient,
  key: string,
): Promise<{ body: string; key: string; version: number } | null> {
  const p = await prisma.prompt.findFirst({
    where: { key, active: true },
    orderBy: { version: "desc" },
  });
  return p ? { body: p.body, key: p.key, version: p.version } : null;
}

// system プロンプトの組み立て。DB プロンプトは評価基準の正本、出力形式は
// DdResultSpec の JSON 指示で上書きする (プロンプト内の散文出力形式の節より優先)。
export function buildSystemPrompt(template: string, ddType: DdType, locale: string): string {
  const base = template
    .replace(/\{\{RESPOND_LANGUAGE_INSTRUCTION\}\}/g, jsonProseLanguageDirective(locale))
    .replace(/\{\{[A-Z_]+\}\}/g, ""); // 未対応プレースホルダは空に落とす
  return [
    base,
    PERSON_EVAL_SAFETY,
    PERSON_EVAL_GUARD,
    "上の「出力形式」の節に散文・表形式の指定があっても、それより次の JSON 出力指示を優先してください。",
    buildOutputInstruction(ddType),
  ].join("\n\n");
}

// 月次 (当月 1 日以降) の AI コスト合計 (円)。人物DD・発信生成・エンリッチを合算した
// 単一のグローバルキャップとして使う (フォールバック連鎖せず 422 で止める)。
export async function getMonthlyCostJpy(prisma: ExtendedPrismaClient): Promise<number> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const agg = await prisma.aiUsageLog.aggregate({
    _sum: { costJpy: true },
    where: { createdAt: { gte: monthStart } },
  });
  return agg._sum.costJpy ?? 0;
}

export type RunPersonDdResult = {
  runId: string;
  status: "completed" | "invalid_output" | "failed";
  moduleScore: number | null;
  confidenceScore: number | null;
  scores: unknown | null;
  outputText: string | null;
  errorDetail: string | null;
};

export async function runPersonDd(
  deps: RunPersonDdDeps,
  args: RunPersonDdArgs,
): Promise<RunPersonDdResult> {
  const { prisma, generate } = deps;
  const emit = deps.onEvent ?? (() => {});
  const { subjectId, ddType, model } = args;
  const locale = args.locale ?? "ja";
  const startedAt = Date.now();

  const subject = await prisma.ddSubject.findUniqueOrThrow({ where: { id: subjectId } });
  const promptKey = DD_PROMPT_KEYS[ddType];
  const prompt = await getPromptText(prisma, promptKey);
  if (!prompt) throw new Error(`prompt_missing:${promptKey}`);

  const run = await prisma.personDueDiligence.create({
    data: {
      subjectId,
      ddType,
      promptKey: prompt.key,
      promptVersion: prompt.version,
      model,
      provider: "anthropic",
      referenceDate: new Date(),
      status: "running",
      inputJson: { name: subject.name, locale },
    },
  });
  emit({ type: "run_created", runId: run.id, ddType });

  // search ステップ: Tavily 等の検索器が注入されていれば一次/実績/批判のクエリで収集し、
  // evaluate へ参考情報として渡す。無ければ知識ベースモード (skipped)。
  // 検索失敗は評価を止めない (failed 記録のうえ知識ベースで続行)。
  let searchDigest = "";
  if (deps.search) {
    const searchStep = await prisma.personDdStep.create({
      data: {
        personDdId: run.id,
        stepKey: "search",
        stepType: "search",
        status: "running",
        startedAt: new Date(),
      },
    });
    emit({ type: "step_started", runId: run.id, stepKey: "search" });
    try {
      const queries = personSearchQueries(subject.name, subject.profileHint);
      const results = [] as Array<{ query: string; items: Awaited<ReturnType<SearchFn>> }>;
      for (const q of queries) {
        results.push({ query: q, items: await deps.search(q) });
      }
      searchDigest = buildSearchDigest(results);
      await prisma.personDdStep.update({
        where: { id: searchStep.id },
        data: {
          status: "completed",
          outputJson: results as never,
          outputText: searchDigest || "検索結果なし",
          finishedAt: new Date(),
        },
      });
      emit({ type: "step_done", runId: run.id, stepKey: "search", status: "completed" });
    } catch (err) {
      await prisma.personDdStep.update({
        where: { id: searchStep.id },
        data: {
          status: "failed",
          errorDetail: err instanceof Error ? err.message : String(err),
          finishedAt: new Date(),
        },
      });
      emit({ type: "step_done", runId: run.id, stepKey: "search", status: "failed" });
    }
  } else {
    await prisma.personDdStep.create({
      data: {
        personDdId: run.id,
        stepKey: "search",
        stepType: "search",
        status: "skipped",
        outputText: "knowledge_base mode (検索キー未設定)",
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });
    emit({ type: "step_done", runId: run.id, stepKey: "search", status: "skipped" });
  }

  const evalStep = await prisma.personDdStep.create({
    data: {
      personDdId: run.id,
      stepKey: "evaluate",
      stepType: "evaluate",
      promptKey: prompt.key,
      model,
      status: "running",
      startedAt: new Date(),
    },
  });
  emit({ type: "step_started", runId: run.id, stepKey: "evaluate" });

  const system = buildSystemPrompt(prompt.body, ddType, locale);
  // profileHint (同姓同名の特定メモ) があれば接地し、別人との混同を防ぐ
  const base = buildPersonEvalUserMessage(subject.name, subject.profileHint);
  const userMessage = searchDigest ? `${base}\n\n${searchDigest}` : base;

  let text: string;
  try {
    const gen = await generate({
      model,
      system,
      userMessage,
      maxTokens: PERSON_DD_MAX_TOKENS,
      timeoutMs: PERSON_DD_TIMEOUT_MS,
    });
    text = gen.text;
    // コスト記録 (月次キャップの集計元)。canonical alias で計上する。
    const canonical = canonicalizeModelId(gen.model) ?? model;
    await prisma.aiUsageLog.create({
      data: {
        provider: "anthropic",
        model: canonical,
        purpose: `${PERSON_DD_PURPOSE_PREFIX}_${ddType}`,
        inputTokens: gen.inputTokens,
        outputTokens: gen.outputTokens,
        costJpy: calcCostJpy(canonical, gen.inputTokens, gen.outputTokens),
      },
    });
    await prisma.personDueDiligence.update({
      where: { id: run.id },
      data: { inputTokens: gen.inputTokens, outputTokens: gen.outputTokens },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await prisma.personDdStep.update({
      where: { id: evalStep.id },
      data: { status: "failed", errorDetail: detail, finishedAt: new Date() },
    });
    await prisma.personDueDiligence.update({
      where: { id: run.id },
      data: { status: "failed", errorDetail: detail, durationMs: Date.now() - startedAt },
    });
    emit({ type: "run_failed", runId: run.id, detail });
    return {
      runId: run.id,
      status: "failed",
      moduleScore: null,
      confidenceScore: null,
      scores: null,
      outputText: null,
      errorDetail: detail,
    };
  }

  // DdResultSpec 検証 (スコアは申告値でなく再計算 = ハルシネーション抑制)
  const parsed = extractJson(text);
  const outcome =
    ddType === "consciousness_7d"
      ? validateConsciousness7d(parsed)
      : validateSocialValueCreation(parsed);

  if (!outcome.ok) {
    const detail = `invalid_output: ${outcome.errors.join(" / ")}`;
    await prisma.personDdStep.update({
      where: { id: evalStep.id },
      data: {
        status: "failed",
        errorDetail: detail,
        outputText: text,
        finishedAt: new Date(),
      },
    });
    await prisma.personDueDiligence.update({
      where: { id: run.id },
      data: {
        status: "invalid_output",
        errorDetail: detail,
        outputText: text,
        durationMs: Date.now() - startedAt,
      },
    });
    emit({ type: "run_failed", runId: run.id, detail });
    return {
      runId: run.id,
      status: "invalid_output",
      moduleScore: null,
      confidenceScore: null,
      scores: null,
      outputText: text,
      errorDetail: detail,
    };
  }

  const moduleScore = moduleScoreOf(outcome.value);
  const confidenceScore = confidenceScoreOf(outcome.value);
  await prisma.personDdStep.update({
    where: { id: evalStep.id },
    data: {
      status: "completed",
      outputText: text,
      outputJson: outcome.value as never,
      finishedAt: new Date(),
    },
  });
  await prisma.personDueDiligence.update({
    where: { id: run.id },
    data: {
      status: "completed",
      outputText: text,
      outputJson: (parsed ?? undefined) as never,
      scores: outcome.value as never,
      moduleScore,
      confidenceScore,
      errorDetail: outcome.warnings.length > 0 ? `warnings: ${outcome.warnings.join(" / ")}` : null,
      durationMs: Date.now() - startedAt,
    },
  });
  emit({ type: "step_done", runId: run.id, stepKey: "evaluate", status: "completed" });
  emit({ type: "run_done", runId: run.id, status: "completed", moduleScore });
  return {
    runId: run.id,
    status: "completed",
    moduleScore,
    confidenceScore,
    scores: outcome.value,
    outputText: text,
    errorDetail: null,
  };
}
