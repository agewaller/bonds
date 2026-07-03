// 人物DD API の結合テスト。実テスト DB (bonds_test) + 偽 generate (実 AI は呼ばない)。
// AI が実際に返るかは e2e/tests/ai-answers.spec.ts (実機スモーク) が担う —
// モックは常に成功する偽 AI であることを忘れない (cares CLAUDE.md)。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrismaClient, type ExtendedPrismaClient } from "@bonds/db";
import { createApp } from "../../src/app.js";
import { seedDdPrompts } from "../../src/dd/seed-prompts.js";
import type { GenerateFn } from "../../src/lib/anthropic.js";

const ADMIN_TOKEN = "test-admin-token";
process.env.ADMIN_BREAKGLASS_TOKEN = ADMIN_TOKEN;

let prisma: ExtendedPrismaClient;

// 偽 generate: system 内の JSON スキーマ名でモジュールを判定し、有効な canned JSON を返す
const validGenerate: GenerateFn = async ({ system, model }) => {
  const is7d = system.includes("JSON スキーマ (consciousness_7d)");
  const dim = { score: 8, confidence: "B", key_evidence: [{ summary: "根拠", certainty: "fact" }], risks: [] };
  const body = is7d
    ? {
        identified: true,
        subject_note: "テスト",
        dimensions: { "1D": dim, "2D": dim, "3D": dim, "4D": dim, "5D": dim, "6D": dim, "7D": dim },
        allocation: { "1D": 10, "2D": 10, "3D": 20, "4D": 20, "5D": 15, "6D": 15, "7D": 10 },
        created_value_estimate: "推計",
        social_costs: "整理",
        counterfactual: "反実仮想",
        evolution_conditions: ["a", "b", "c"],
        summary: "総括",
      }
    : {
        identified: true,
        subject_note: "テスト",
        frames: { f1: "a", f2: "b", f3: "c", f4: "d", f5: "e", f6: "f", f7: "g", f8: "h" },
        items: Array.from({ length: 10 }, (_, i) => ({ key: `k${i}`, score: 7, reason: "r" })),
        grade: 7,
        created_value: { annual_jpy: "100億円", cumulative_jpy: "1兆円", low: "l", mid: "m", high: "h", assumptions: ["x"], confidence: "B" },
        counterfactual_contribution_pct: 25,
        comparative: "c",
        verdict: "v",
        something_new: "s",
        limitations: ["l"],
        summary: "総括",
      };
  return { text: JSON.stringify(body), model, inputTokens: 1000, outputTokens: 2000 };
};

const adminHeaders = { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN };

async function createSubject(app: ReturnType<typeof createApp>, name = "渋沢栄一") {
  const res = await app.request("/api/dd/subjects", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ name, subjectType: "executive" }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).subject as { id: string; slug: string; name: string };
}

beforeAll(async () => {
  prisma = createPrismaClient();
});

afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "person_dd_steps", "person_due_diligences", "dd_subjects", "ai_usage_logs", "prompts", "app_config" CASCADE',
  );
  await seedDdPrompts(prisma);
});

describe("prompts seed", () => {
  it("person_eval_7d / person_eval_svc が seed され、再実行しても増えない (冪等)", async () => {
    expect(await prisma.prompt.count()).toBe(2);
    const again = await seedDdPrompts(prisma);
    expect(again).toEqual([]);
    expect(await prisma.prompt.count()).toBe(2);
  });
});

describe("subjects CRUD", () => {
  it("作成 → 一覧 → 詳細。slug は衝突時に付番される", async () => {
    const app = createApp({ prisma, generate: validGenerate });
    const s1 = await createSubject(app, "Eiichi Shibusawa");
    expect(s1.slug).toBe("eiichi-shibusawa");
    const s2 = await createSubject(app, "Eiichi Shibusawa");
    expect(s2.slug).toBe("eiichi-shibusawa-2");

    const list = await app.request("/api/dd/subjects");
    expect(list.status).toBe(200);
    expect((await list.json()).subjects).toHaveLength(2);

    const detail = await app.request(`/api/dd/subjects/${s1.slug}`);
    expect(detail.status).toBe(200);
    expect((await detail.json()).subject.name).toBe("Eiichi Shibusawa");

    const missing = await app.request("/api/dd/subjects/no-such-slug");
    expect(missing.status).toBe(404);
  });

  it("name 無しは 400、読み取り系は認証不要", async () => {
    const app = createApp({ prisma, generate: validGenerate });
    const res = await app.request("/api/dd/subjects", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((await app.request("/api/dd/subjects")).status).toBe(200);
  });
});

describe("run (両評価並列)", () => {
  it("completed になり、moduleScore は再計算値、steps/usage が記録される", async () => {
    const app = createApp({ prisma, generate: validGenerate });
    const s = await createSubject(app);
    const res = await app.request(`/api/dd/subjects/${s.slug}/run`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model).toBe("claude-sonnet-4-6"); // 既定モデル
    // 7d: 全次元 8 → 8/10×100 = 80。svc: 7×10 = 70。
    expect(body.results.consciousness_7d.status).toBe("completed");
    expect(body.results.consciousness_7d.moduleScore).toBeCloseTo(80, 1);
    expect(body.results.social_value_creation.status).toBe("completed");
    expect(body.results.social_value_creation.moduleScore).toBe(70);

    // DB 側: run 2 件 + 各 2 ステップ (search=skipped, evaluate=completed) + usage 2 件
    const runs = await prisma.personDueDiligence.findMany({ include: { steps: true } });
    expect(runs).toHaveLength(2);
    for (const r of runs) {
      expect(r.status).toBe("completed");
      expect(r.moduleScore).not.toBeNull();
      expect(r.confidenceScore).toBeCloseTo(0.75, 2); // 全て B
      const kinds = r.steps.map((st) => `${st.stepKey}:${st.status}`).sort();
      expect(kinds).toEqual(["evaluate:completed", "search:skipped"]);
    }
    const usage = await prisma.aiUsageLog.findMany();
    expect(usage).toHaveLength(2);
    expect(usage[0]?.costJpy).toBeGreaterThan(0);

    // 実行詳細 API
    const runRes = await app.request(`/api/dd/runs/${runs[0]!.id}`);
    expect(runRes.status).toBe(200);
    expect((await runRes.json()).run.steps).toHaveLength(2);

    // 詳細 API に最新スコアが載る
    const detail = await (await app.request(`/api/dd/subjects/${s.slug}`)).json();
    expect(Object.keys(detail.latestByType).sort()).toEqual([
      "consciousness_7d",
      "social_value_creation",
    ]);
  });

  it("ddType 指定で片方だけ実行できる", async () => {
    const app = createApp({ prisma, generate: validGenerate });
    const s = await createSubject(app);
    const res = await app.request(`/api/dd/subjects/${s.slug}/run`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ ddType: "consciousness_7d" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.results)).toEqual(["consciousness_7d"]);
    expect(await prisma.personDueDiligence.count()).toBe(1);
  });

  it("スキーマを満たさない AI 出力は invalid_output として原文つきで保存する", async () => {
    const broken: GenerateFn = async ({ model }) => ({
      text: '{"identified": true, "dimensions": {}}',
      model,
      inputTokens: 10,
      outputTokens: 10,
    });
    const app = createApp({ prisma, generate: broken });
    const s = await createSubject(app);
    const res = await app.request(`/api/dd/subjects/${s.slug}/run`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ ddType: "consciousness_7d" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results.consciousness_7d.status).toBe("invalid_output");
    const run = await prisma.personDueDiligence.findFirstOrThrow();
    expect(run.status).toBe("invalid_output");
    expect(run.outputText).toContain("identified"); // 原文保存 (再検証・プロンプト改善用)
    expect(run.errorDetail).toContain("invalid_output");
  });

  it("identified:false (私人/特定不能) は completed だがスコア無し", async () => {
    const notFound: GenerateFn = async ({ model }) => ({
      text: '{"identified": false, "reason": "特定できない", "needed_info": "国・所属"}',
      model,
      inputTokens: 10,
      outputTokens: 10,
    });
    const app = createApp({ prisma, generate: notFound });
    const s = await createSubject(app, "山田太郎");
    const res = await app.request(`/api/dd/subjects/${s.slug}/run`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ ddType: "consciousness_7d" }),
    });
    const body = await res.json();
    expect(body.results.consciousness_7d.status).toBe("completed");
    expect(body.results.consciousness_7d.moduleScore).toBeNull();
  });

  it("AI 失敗は failed として記録され、片方失敗でも他方は返る", async () => {
    let call = 0;
    const flaky: GenerateFn = async (args) => {
      call++;
      if (args.system.includes("JSON スキーマ (consciousness_7d)")) {
        throw new Error("boom");
      }
      return validGenerate(args);
    };
    const app = createApp({ prisma, generate: flaky });
    const s = await createSubject(app);
    const res = await app.request(`/api/dd/subjects/${s.slug}/run`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({}),
    });
    const body = await res.json();
    expect(body.results.consciousness_7d.status).toBe("failed");
    expect(body.results.consciousness_7d.errorDetail).toContain("boom");
    expect(body.results.social_value_creation.status).toBe("completed");
    expect(call).toBe(2);
  });

  it("月次キャップ到達で 422 (フォールバックなし)", async () => {
    await prisma.aiUsageLog.create({
      data: {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        purpose: "person_dd_consciousness_7d",
        inputTokens: 0,
        outputTokens: 0,
        costJpy: 999999,
      },
    });
    const app = createApp({ prisma, generate: validGenerate });
    const s = await createSubject(app);
    const res = await app.request(`/api/dd/subjects/${s.slug}/run`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });

  it("AI キー未設定 (generate=null) は 503", async () => {
    const app = createApp({ prisma, generate: null });
    const s = await createSubject(app);
    const res = await app.request(`/api/dd/subjects/${s.slug}/run`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(503);
  });
});

describe("admin person-eval-config", () => {
  it("既定は sonnet、canonical alias のみ受け付け、datestamped は正規化", async () => {
    const app = createApp({ prisma, generate: validGenerate });
    const got = await (await app.request("/api/admin/person-eval-config", { headers: adminHeaders })).json();
    expect(got.model).toBe("claude-sonnet-4-6");
    expect(got.isDefault).toBe(true);

    const putBad = await app.request("/api/admin/person-eval-config", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ model: "gpt-4o" }),
    });
    expect(putBad.status).toBe(400);

    const putDated = await app.request("/api/admin/person-eval-config", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001" }),
    });
    expect(putDated.status).toBe(200);
    expect((await putDated.json()).model).toBe("claude-haiku-4-5");

    const got2 = await (await app.request("/api/admin/person-eval-config", { headers: adminHeaders })).json();
    expect(got2.model).toBe("claude-haiku-4-5");
    expect(got2.isDefault).toBe(false);
  });
});
