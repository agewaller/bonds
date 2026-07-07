// bonds API (Hono) — フェーズ1: 人物DD MVP。
// ルート定義は app.ts に集約し、index.ts はサーバ起動のみ担う
// (テストは app.request() で app を直接叩けるようにするため)。
// prisma / generate (AI 呼び出し) は注入可能: 結合テストは実テスト DB + 偽 generate で検証する。
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { ExtendedPrismaClient } from "@bonds/db";
import type { GenerateFn } from "./lib/anthropic.js";
import { buildAnthropicGenerate } from "./lib/anthropic.js";
import { isDdType, DD_TYPES, type DdType } from "./lib/dd-spec.js";
import {
  clampName,
  slugify,
  PERSON_DD_MONTHLY_CAP_JPY,
  PERSON_DD_MODEL_CONFIG_KEY,
  PERSON_DD_DEFAULT_MODEL_ID,
} from "./lib/person-eval.js";
import { canonicalizeModelId, isValidModelId, type ModelId } from "./lib/cost.js";
import { runPersonDd, getMonthlyCostJpy, type DdRunEvent } from "./dd/runner.js";
import { normalizeLocale } from "./lib/locale.js";
import { clampScore } from "./lib/dd-spec.js";
import { clampDistance, calculateIsolationScore, todaySuggestions } from "./lib/relationship.js";
import { computeProgress } from "./lib/progress.js";
import { parseContacts, parseImportText, type ParsedContact, type ParsedInteraction } from "./lib/contact-parsers.js";
import { parseImportFile, MAX_IMPORT_FILE_BYTES } from "./lib/import-file.js";
import { parseIsoIntervals, meetingSlotProposals, toIso } from "./lib/timeslots.js";
import { parseIcsBusy, looksLikeIcs, buildMeetingInviteIcs } from "./lib/ics.js";
import {
  buildSendGridMailer,
  validateOutreachCandidates,
  OUTREACH_JSON_INSTRUCTION,
  type MailerFn,
} from "./lib/mailer.js";
import { getPromptText } from "./dd/runner.js";
import { jsonProseLanguageDirective } from "./lib/locale.js";
import { extractJson } from "./lib/dd-spec.js";
import { calcCostJpy } from "./lib/cost.js";
import { PERSON_DD_MAX_TOKENS, PERSON_DD_TIMEOUT_MS } from "./lib/person-eval.js";
import { authorizeAdmin, authorizeUser, type VerifyIdTokenFn } from "./lib/auth.js";
import { buildTavilySearch, type SearchFn } from "./lib/tavily.js";
import { sanitizeProse } from "./lib/plain-text.js";
import {
  IDENTIFY_SYSTEM_PROMPT,
  IDENTIFY_MAX_TOKENS,
  IDENTIFY_TIMEOUT_MS,
  buildIdentifyUserMessage,
  parseIdentifyCandidates,
  clampProfileHint,
} from "./lib/identify.js";

export type AppDeps = {
  prisma: ExtendedPrismaClient;
  generate?: GenerateFn | null;
  mailer?: MailerFn | null;
  verifyIdToken?: VerifyIdTokenFn | null;
  fetchText?: ((url: string) => Promise<string>) | null;
  search?: SearchFn | null;
};

const SUBJECT_TYPES = ["politician", "executive", "other"] as const;

export function createApp(deps: AppDeps) {
  const { prisma } = deps;
  // generate 未注入なら env 鍵から構築 (鍵なしなら null = 実行系は 503)
  const generate = deps.generate !== undefined ? deps.generate : buildAnthropicGenerate();
  // mailer も同様 (SENDGRID_API_KEY / OUTREACH_FROM_EMAIL 未設定なら送信は 503)
  const mailer = deps.mailer !== undefined ? deps.mailer : buildSendGridMailer();
  // 人物DD の検索器 (TAVILY_API_KEY 無しなら null = 知識ベースモード)
  const ddSearch = deps.search !== undefined ? deps.search : buildTavilySearch();
  // ICS 購読 URL の取得器 (既定は素の fetch + 15 秒タイムアウト)
  const fetchText =
    deps.fetchText !== undefined
      ? deps.fetchText
      : async (url: string) => {
          const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
          if (!res.ok) throw new Error(`ics_fetch_failed: ${res.status}`);
          return res.text();
        };

  // ownerUid: 認可済みユーザーのデータスコープ (Firebase uid / break-glass は "owner")
  const app = new Hono<{ Variables: { ownerUid: string } }>();

  // CORS: 許可 Origin は env で制御。
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(
    "/api/*",
    cors({
      origin: (origin) => (allowedOrigins.includes(origin) ? origin : null),
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "x-admin-token"],
    }),
  );

  // ヘルスチェック (/api/healthz が正本。Cloud Run frontend の /healthz intercept 回避)。
  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/api/healthz", (c) => c.json({ status: "ok" }));

  // 管理ガード: cares の三段フェイルセーフ (①Firebase custom claim admin:true
  // ②OWNER_EMAIL×password provider ③break-glass token)。どれも無ければ fail closed。
  // 書き込み系は監査ログ (who/what/when) を残す。
  const requireAdmin = async (c: Context, next: Next) => {
    const result = await authorizeAdmin(
      {
        authorization: c.req.header("authorization"),
        adminToken: c.req.header("x-admin-token"),
      },
      { verifyIdToken: deps.verifyIdToken ?? null },
    );
    if (!result.ok) {
      return c.json({ error: result.error, detail: result.detail }, result.status);
    }
    await next();
    auditWrite(c, result.actor); // 監査記録は応答をブロックしない (失敗はログのみ)
  };
  const auditWrite = (c: Context, actor: string) => {
    if (c.req.method === "GET") return;
    prisma.auditLog
      .create({
        data: { actor, method: c.req.method, path: c.req.path, status: c.res.status },
      })
      .catch((err: unknown) =>
        console.error(
          JSON.stringify({
            event: "audit_log_failed",
            detail: err instanceof Error ? err.message : String(err),
          }),
        ),
      );
  };

  // 一般ユーザーガード (関係性系): Firebase ログインユーザーは自分の uid スコープ、
  // break-glass は "owner" スコープ。データは ownerUid で完全分離する。
  const requireUser = async (c: Context, next: Next) => {
    const result = await authorizeUser(
      {
        authorization: c.req.header("authorization"),
        adminToken: c.req.header("x-admin-token"),
      },
      { verifyIdToken: deps.verifyIdToken ?? null },
    );
    if (!result.ok) {
      return c.json({ error: result.error, detail: result.detail }, result.status);
    }
    c.set("ownerUid", result.ownerUid);
    await next();
    auditWrite(c, result.actor);
  };

  app.use("/api/admin/*", requireAdmin);
  app.post("/api/dd/*", requireAdmin);
  app.put("/api/dd/*", requireAdmin);
  app.delete("/api/dd/*", requireAdmin);
  // 連絡先は PII (復号して返す) のため読み取りも含めて全メソッドをガードする。
  // ブラウザは BFF プロキシ経由 (トークンは web サーバ側にのみ存在)。
  app.use("/api/contacts/*", requireUser);
  app.use("/api/contacts", requireUser);
  app.use("/api/relationship/*", requireUser);
  app.use("/api/outreach/*", requireUser);
  app.use("/api/outreach", requireUser);

  // ---------------- 管理: モデル設定 (cares person-eval-config と同形) ----------------

  app.get("/api/admin/person-eval-config", async (c) => {
    const row = await prisma.appConfig.findUnique({ where: { key: PERSON_DD_MODEL_CONFIG_KEY } });
    const model = canonicalizeModelId(row?.value) ?? PERSON_DD_DEFAULT_MODEL_ID;
    return c.json({ model, isDefault: !row });
  });

  app.put("/api/admin/person-eval-config", async (c) => {
    const body = await c.req.json<{ model?: string }>().catch(() => ({}) as { model?: string });
    const model = canonicalizeModelId(body.model);
    if (!model || !isValidModelId(model)) {
      return c.json({ error: "invalid_model", detail: "canonical alias のみ指定できます" }, 400);
    }
    await prisma.appConfig.upsert({
      where: { key: PERSON_DD_MODEL_CONFIG_KEY },
      update: { value: model },
      create: { key: PERSON_DD_MODEL_CONFIG_KEY, value: model },
    });
    return c.json({ model });
  });

  // ---------------- 管理: プロンプト版管理 (DB 駆動プロンプトの編集 UI 用) ----------------

  app.get("/api/admin/prompts", async (c) => {
    const prompts = await prisma.prompt.findMany({
      orderBy: [{ key: "asc" }, { version: "desc" }],
    });
    // key ごとに最新版 + 履歴数
    const byKey = new Map<string, { key: string; version: number; body: string; active: boolean; versions: number }>();
    for (const p of prompts) {
      const cur = byKey.get(p.key);
      if (!cur) byKey.set(p.key, { key: p.key, version: p.version, body: p.body, active: p.active, versions: 1 });
      else cur.versions++;
    }
    return c.json({ prompts: [...byKey.values()] });
  });

  // 編集 = 新しい版を積む (既存版は書き換えない = 版管理)
  app.post("/api/admin/prompts/:key", async (c) => {
    const key = c.req.param("key");
    const b = await c.req.json<{ body?: string }>().catch(() => ({}) as { body?: string });
    if (typeof b.body !== "string" || !b.body.trim()) {
      return c.json({ error: "body_required", detail: "プロンプト本文を入力してください" }, 400);
    }
    const latest = await prisma.prompt.findFirst({ where: { key }, orderBy: { version: "desc" } });
    const version = (latest?.version ?? 0) + 1;
    const created = await prisma.prompt.create({
      data: { key, version, body: b.body, active: true },
    });
    return c.json({ prompt: { key: created.key, version: created.version } }, 201);
  });

  // ---------------- 評価対象 (dd_subjects) ----------------

  app.get("/api/dd/subjects", async (c) => {
    const subjects = await prisma.ddSubject.findMany({
      where: { state: "active" },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    // 一覧には最新 completed run のスコアを添える (subject 詳細画面より軽い形)
    const latest = await prisma.personDueDiligence.findMany({
      where: { subjectId: { in: subjects.map((s) => s.id) }, status: "completed" },
      orderBy: { createdAt: "desc" },
      select: { subjectId: true, ddType: true, moduleScore: true, createdAt: true },
    });
    const scoreMap = new Map<string, Record<string, number | null>>();
    for (const r of latest) {
      const m = scoreMap.get(r.subjectId) ?? {};
      if (!(r.ddType in m)) m[r.ddType] = r.moduleScore;
      scoreMap.set(r.subjectId, m);
    }
    return c.json({
      subjects: subjects.map((s) => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        subjectType: s.subjectType,
        country: s.country,
        profileHint: s.profileHint,
        latestScores: scoreMap.get(s.id) ?? {},
        createdAt: s.createdAt,
      })),
    });
  });

  // 同姓同名の特定 — 評価の前に「どの人物のことか」の候補を簡単なプロフィール付きで返す。
  // AI キー無し環境は 503 (クライアントは名前のみで登録に縮退)。壊れた出力は候補ゼロで返す。
  app.post("/api/dd/identify", async (c) => {
    const body = await c.req
      .json<{ name?: string }>()
      .catch(() => ({}) as { name?: string });
    const name = clampName(body.name);
    if (!name) {
      return c.json({ error: "name_required", detail: "人物名を入力してください" }, 400);
    }
    // AI キー無し環境は候補確認をスキップし「候補なし」で返す (名前のみで登録に縮退)。
    // 実行系 (run) の 503 縮退とは違い、確認は補助機能のため画面を 5xx にしない。
    if (!generate) {
      return c.json({ name, candidates: [], unavailable: true });
    }
    const cost = await getMonthlyCostJpy(prisma);
    if (cost >= PERSON_DD_MONTHLY_CAP_JPY) {
      return c.json({ error: "quota_exceeded", detail: "今月の評価枠は終了しました" }, 422);
    }
    const model = await resolveModel();
    try {
      const gen = await generate({
        model,
        system: IDENTIFY_SYSTEM_PROMPT,
        userMessage: buildIdentifyUserMessage(name),
        maxTokens: IDENTIFY_MAX_TOKENS,
        timeoutMs: IDENTIFY_TIMEOUT_MS,
      });
      const canonical = canonicalizeModelId(gen.model) ?? model;
      await prisma.aiUsageLog.create({
        data: {
          provider: "anthropic",
          model: canonical,
          purpose: "person_dd_identify",
          inputTokens: gen.inputTokens,
          outputTokens: gen.outputTokens,
          costJpy: calcCostJpy(canonical, gen.inputTokens, gen.outputTokens),
        },
      });
      return c.json({ name, candidates: parseIdentifyCandidates(gen.text) });
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "ai_error",
          purpose: "person_dd_identify",
          detail: err instanceof Error ? err.message : String(err),
        }),
      );
      return c.json(
        { error: "ai_failed", detail: "候補の確認に失敗しました。名前のみで登録できます" },
        502,
      );
    }
  });

  app.post("/api/dd/subjects", async (c) => {
    const body = await c.req
      .json<{
        name?: string;
        nameEn?: string;
        nameKana?: string;
        subjectType?: string;
        country?: string;
        affiliations?: unknown;
        profileHint?: string;
      }>()
      .catch(() => ({}) as Record<string, never>);
    const name = clampName(body.name);
    if (!name) {
      return c.json({ error: "name_required", detail: "人物名を入力してください" }, 400);
    }
    const subjectType = SUBJECT_TYPES.includes(body.subjectType as never)
      ? (body.subjectType as string)
      : "other";
    // slug 衝突時は -2, -3 ... と付番
    const base = slugify(name);
    let slug = base;
    for (let i = 2; await prisma.ddSubject.findUnique({ where: { slug } }); i++) {
      slug = `${base}-${i}`;
    }
    const subject = await prisma.ddSubject.create({
      data: {
        slug,
        name,
        nameEn: typeof body.nameEn === "string" ? body.nameEn.trim() || null : null,
        nameKana: typeof body.nameKana === "string" ? body.nameKana.trim() || null : null,
        subjectType,
        country: typeof body.country === "string" ? body.country.trim() || null : null,
        affiliations: (body.affiliations ?? undefined) as never,
        profileHint: clampProfileHint(body.profileHint),
      },
    });
    return c.json({ subject }, 201);
  });

  app.get("/api/dd/subjects/:slug", async (c) => {
    const subject = await prisma.ddSubject.findUnique({ where: { slug: c.req.param("slug") } });
    if (!subject) return c.json({ error: "not_found" }, 404);
    // ddType ごとの最新 run (状態問わず) と最新 completed
    const runs = await prisma.personDueDiligence.findMany({
      where: { subjectId: subject.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        ddType: true,
        status: true,
        model: true,
        moduleScore: true,
        confidenceScore: true,
        scores: true,
        errorDetail: true,
        durationMs: true,
        createdAt: true,
      },
    });
    const latestByType: Record<string, (typeof runs)[number]> = {};
    for (const r of runs) {
      const cur = latestByType[r.ddType];
      const better =
        !cur || (cur.status !== "completed" && r.status === "completed");
      if (better) latestByType[r.ddType] = r;
    }
    return c.json({ subject, latestByType, recentRuns: runs.map(({ scores: _s, ...r }) => r) });
  });

  // ---------------- 実行 ----------------

  const resolveModel = async (): Promise<ModelId> => {
    const row = await prisma.appConfig.findUnique({ where: { key: PERSON_DD_MODEL_CONFIG_KEY } });
    return canonicalizeModelId(row?.value) ?? PERSON_DD_DEFAULT_MODEL_ID;
  };

  // 実行前の共通チェック。NG なら {status, body} を返す。
  const preflight = async (): Promise<{ status: 422 | 503; body: unknown } | null> => {
    if (!generate) {
      return {
        status: 503,
        body: { error: "unavailable", detail: "AI キーが未設定のため実行できません" },
      };
    }
    const cost = await getMonthlyCostJpy(prisma);
    if (cost >= PERSON_DD_MONTHLY_CAP_JPY) {
      return {
        status: 422,
        body: { error: "quota_exceeded", detail: "今月の評価枠は終了しました" },
      };
    }
    return null;
  };

  // POST /api/dd/subjects/:slug/run — 既定は両モジュール並列・同期 JSON。
  // ?stream=1 なら SSE で進捗 (run_created/step_done/run_done) を流し最後に result を送る。
  app.post("/api/dd/subjects/:slug/run", async (c) => {
    const subject = await prisma.ddSubject.findUnique({ where: { slug: c.req.param("slug") } });
    if (!subject) return c.json({ error: "not_found" }, 404);
    const body = await c.req
      .json<{ ddType?: string; locale?: string }>()
      .catch(() => ({}) as { ddType?: string; locale?: string });
    const ddTypes: DdType[] = isDdType(body.ddType) ? [body.ddType] : [...DD_TYPES];
    const locale = normalizeLocale(body.locale);
    const ng = await preflight();
    if (ng) return c.json(ng.body as never, ng.status);
    const model = await resolveModel();

    const execute = async (onEvent?: (ev: DdRunEvent) => void) => {
      const settled = await Promise.allSettled(
        ddTypes.map((ddType) =>
          runPersonDd(
            { prisma, generate: generate!, search: ddSearch, onEvent },
            { subjectId: subject.id, ddType, model, locale },
          ),
        ),
      );
      const results: Record<string, unknown> = {};
      settled.forEach((s, i) => {
        results[ddTypes[i]!] =
          s.status === "fulfilled"
            ? s.value
            : { status: "failed", errorDetail: s.reason instanceof Error ? s.reason.message : String(s.reason) };
      });
      return results;
    };

    if (c.req.query("stream") === "1") {
      return streamSSE(c, async (stream) => {
        const results = await execute((ev) => {
          void stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
        });
        await stream.writeSSE({
          event: "result",
          data: JSON.stringify({ subject: { slug: subject.slug, name: subject.name }, model, results }),
        });
      });
    }
    const results = await execute();
    return c.json({ subject: { slug: subject.slug, name: subject.name }, model, results });
  });

  // ---------------- 関係性 (contacts) — フェーズ2 ----------------
  // フェーズ5 の認証導入までは単一オーナー ("owner")。全操作は requireAdmin 済み。

  const parseBirthday = (v: unknown): Date | null => {
    if (typeof v !== "string" || !v.trim()) return null;
    const d = new Date(v.trim());
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const contactData = (b: Record<string, unknown>) => ({
    furigana: typeof b.furigana === "string" ? b.furigana.trim() || null : null,
    distance: clampDistance(b.distance),
    relationship: typeof b.relationship === "string" && b.relationship.trim() ? b.relationship.trim() : "other",
    birthday: parseBirthday(b.birthday),
    phone: typeof b.phone === "string" ? b.phone.trim() || null : null,
    email: typeof b.email === "string" ? b.email.trim() || null : null,
    address: typeof b.address === "string" ? b.address.trim() || null : null,
    company: typeof b.company === "string" ? b.company.trim() || null : null,
    title: typeof b.title === "string" ? b.title.trim() || null : null,
    sns: typeof b.sns === "string" ? b.sns.trim() || null : null,
    personalProfile: typeof b.personalProfile === "string" ? b.personalProfile.trim() || null : null,
    socialPosition: typeof b.socialPosition === "string" ? b.socialPosition.trim() || null : null,
    valuesProfile: typeof b.valuesProfile === "string" ? b.valuesProfile.trim() || null : null,
    notes: typeof b.notes === "string" ? b.notes.trim() || null : null,
  });

  app.get("/api/contacts", async (c) => {
    const contacts = await prisma.contact.findMany({
      where: { ownerUid: c.get("ownerUid"), state: "active" },
      orderBy: [{ distance: "asc" }, { name: "asc" }],
      take: 500,
    });
    return c.json({ contacts });
  });

  app.post("/api/contacts", async (c) => {
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const name = clampName(b.name);
    if (!name) return c.json({ error: "name_required", detail: "お名前を入力してください" }, 400);
    // 同姓同名の確認 — 既に同じお名前の方がいれば、まず「同じ人か別の人か」を
    // ユーザーに特定してもらう (confirmNew:true の再送で別人として追加できる)。
    if (b.confirmNew !== true) {
      const sameName = await prisma.contact.findMany({
        where: { ownerUid: c.get("ownerUid"), state: "active", name },
        orderBy: { createdAt: "asc" },
        take: 10,
      });
      if (sameName.length > 0) {
        return c.json(
          {
            error: "same_name_exists",
            detail: "同じお名前の方がすでに連絡帳にいます",
            duplicates: sameName.map((d) => ({
              id: d.id,
              name: d.name,
              company: d.company,
              title: d.title,
              relationship: d.relationship,
              distance: d.distance,
              createdAt: d.createdAt,
            })),
          },
          409,
        );
      }
    }
    const created = await prisma.contact.create({
      data: { ownerUid: c.get("ownerUid"), name, source: "manual", ...contactData(b) },
    });
    return c.json({ contact: created }, 201);
  });

  app.get("/api/contacts/export", async (c) => {
    // データ主権: 全件エクスポート (復号済み JSON)。ロックインしない。
    const [contacts, interactions, gifts] = await Promise.all([
      prisma.contact.findMany({ where: { ownerUid: c.get("ownerUid") } }),
      prisma.contactInteraction.findMany(),
      prisma.contactGift.findMany(),
    ]);
    c.header("Content-Disposition", "attachment; filename=bonds-contacts-export.json");
    return c.json({ exportedAt: new Date().toISOString(), contacts, interactions, gifts });
  });

  app.get("/api/contacts/:id", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    // 暗号化列は親 include で復号フックが漏れるケースがあるため直接クエリで読む (cares の教訓)
    const [interactions, gifts, links] = await Promise.all([
      prisma.contactInteraction.findMany({
        where: { contactId: contact.id },
        orderBy: { occurredAt: "desc" },
        take: 50,
      }),
      prisma.contactGift.findMany({
        where: { contactId: contact.id },
        orderBy: { givenAt: "desc" },
        take: 50,
      }),
      prisma.personLink.findMany({ where: { contactId: contact.id, ownerUid: c.get("ownerUid") } }),
    ]);
    const subjects = links.length
      ? await prisma.ddSubject.findMany({ where: { id: { in: links.map((l) => l.subjectId) } } })
      : [];
    const linkedSubjects = links.map((l) => {
      const sub = subjects.find((x) => x.id === l.subjectId);
      return { linkId: l.id, slug: sub?.slug ?? "", name: sub?.name ?? "" };
    });
    return c.json({ contact, interactions, gifts, linkedSubjects });
  });

  app.put("/api/contacts/:id", async (c) => {
    const exists = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!exists) return c.json({ error: "not_found" }, 404);
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const name = clampName(b.name) || exists.name;
    const updated = await prisma.contact.update({
      where: { id: exists.id },
      data: { name, ...contactData(b) },
    });
    return c.json({ contact: updated });
  });

  app.delete("/api/contacts/:id", async (c) => {
    // ソフト削除 (state=archived)。1 件単位の削除導線 = データ主権原則
    const exists = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!exists) return c.json({ error: "not_found" }, 404);
    await prisma.contact.update({ where: { id: exists.id }, data: { state: "archived" } });
    return c.json({ ok: true });
  });

  // 取込 (CSV / vCard / auto)。取り込み件数とスキップ件数を返す。
  // 取込結果を DB に反映する共通処理。同名の既存連絡先はスキップ (再取込で二重登録しない)、
  // トーク履歴由来の接触記録は同じ相手・同じ日の重複を登録しない (冪等)。
  const applyImport = async (
    ownerUid: string,
    parsed: { contacts: ParsedContact[]; interactions: ParsedInteraction[] },
  ) => {
    const existing = await prisma.contact.findMany({
      where: { ownerUid, state: "active" },
      select: { id: true, name: true },
    });
    const byName = new Map(existing.map((e) => [e.name, e.id]));
    let imported = 0;
    let skipped = 0;
    // 同姓同名で見送った名前。世の中には同じ名前の別人がいるため、黙って捨てず
    // ユーザーに知らせ、「別の人」なら追加欄 (confirmNew) から特定して足してもらう。
    const sameName = new Set<string>();
    for (const r of parsed.contacts) {
      const name = clampName(r.name);
      if (!name || byName.has(name)) {
        if (name) sameName.add(name);
        skipped++;
        continue;
      }
      const created = await prisma.contact.create({
        data: { ownerUid, name, source: r.source ?? "import", ...contactData(r as Record<string, unknown>) },
      });
      byName.set(name, created.id);
      imported++;
    }
    let interactionsAdded = 0;
    const daysByContact = new Map<string, Set<string>>();
    for (const it of parsed.interactions) {
      const contactId = byName.get(clampName(it.name));
      if (!contactId) continue;
      if (!daysByContact.has(contactId)) {
        const rows = await prisma.contactInteraction.findMany({
          where: { contactId },
          select: { occurredAt: true },
        });
        daysByContact.set(contactId, new Set(rows.map((r) => r.occurredAt.toISOString().slice(0, 10))));
      }
      const seen = daysByContact.get(contactId)!;
      if (seen.has(it.occurredAt)) continue;
      await prisma.contactInteraction.create({
        data: { contactId, type: it.type, occurredAt: new Date(`${it.occurredAt}T12:00:00Z`) },
      });
      seen.add(it.occurredAt);
      interactionsAdded++;
    }
    return {
      imported,
      skipped,
      parsed: parsed.contacts.length,
      interactionsAdded,
      sameName: [...sameName].slice(0, 20),
    };
  };

  app.post("/api/contacts/import", async (c) => {
    const b = await c.req
      .json<{ content?: string; format?: string; filename?: string }>()
      .catch(() => ({}) as { content?: string; format?: string; filename?: string });
    if (typeof b.content !== "string" || !b.content.trim()) {
      return c.json({ error: "content_required", detail: "取り込む内容がありません" }, 400);
    }
    const format = b.format === "csv" || b.format === "vcard" ? b.format : "auto";
    const parsed =
      format === "auto"
        ? parseImportText(b.content, typeof b.filename === "string" ? b.filename : undefined)
        : { contacts: parseContacts(b.content, format), interactions: [] as ParsedInteraction[] };
    const result = await applyImport(c.get("ownerUid"), parsed);
    return c.json(result);
  });

  // ファイル/ZIP まるごと取込。SNS の「データをダウンロード」の ZIP をそのまま受け、
  // 中の友だち/つながりファイルを自動発見する (ユーザーに中身を探させない)。
  app.post("/api/contacts/import-file", async (c) => {
    const buf = await c.req.arrayBuffer();
    if (buf.byteLength === 0) {
      return c.json({ error: "content_required", detail: "ファイルが空です" }, 400);
    }
    if (buf.byteLength > MAX_IMPORT_FILE_BYTES) {
      return c.json(
        {
          error: "file_too_large",
          detail:
            "ファイルが大きすぎます (30MBまで)。エクスポートするとき、対象を友達やつながりの情報だけに絞ると小さくなります",
        },
        413,
      );
    }
    const filename = c.req.query("filename") ?? c.req.header("x-filename") ?? undefined;
    const parsed = parseImportFile(new Uint8Array(buf), filename);
    if (parsed.contacts.length === 0) {
      return c.json(
        {
          error: "no_contacts_found",
          detail:
            "このファイルからは連絡先を見つけられませんでした。対応しているのは LinkedIn・Facebook・Instagram・X のダウンロードデータ (ZIPのまま可)、Google 連絡先、LINE のトーク履歴、CSV や vCard です",
        },
        422,
      );
    }
    const result = await applyImport(c.get("ownerUid"), parsed);
    return c.json({ ...result, foundIn: parsed.foundIn });
  });

  // 接触記録 (連絡済み)。距離スコアの検証還流。
  app.post("/api/contacts/:id/interactions", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const type = typeof b.type === "string" && b.type.trim() ? b.type.trim() : "message";
    const quality = clampScore(b.quality, 1, 5);
    const occurredAt = parseBirthday(b.occurredAt) ?? new Date();
    const created = await prisma.contactInteraction.create({
      data: {
        contactId: contact.id,
        type,
        quality: quality === null ? null : Math.round(quality),
        occurredAt,
        notes: typeof b.notes === "string" ? b.notes.trim() || null : null,
      },
    });
    return c.json({ interaction: created }, 201);
  });

  // 公人プロフィール (人物DD) とのリンク。相手が公人でもあるとき、評価を関係づくりの参考にする。
  app.post("/api/contacts/:id/links", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    const b = await c.req.json<{ slug?: string }>().catch(() => ({}) as { slug?: string });
    const subject = b.slug
      ? await prisma.ddSubject.findUnique({ where: { slug: b.slug.trim() } })
      : null;
    if (!subject) return c.json({ error: "subject_not_found", detail: "その評価対象が見つかりません" }, 404);
    const link = await prisma.personLink.upsert({
      where: {
        ownerUid_contactId_subjectId: {
          ownerUid: c.get("ownerUid"),
          contactId: contact.id,
          subjectId: subject.id,
        },
      },
      update: {},
      create: { ownerUid: c.get("ownerUid"), contactId: contact.id, subjectId: subject.id },
    });
    return c.json({ link: { id: link.id, subject: { slug: subject.slug, name: subject.name } } }, 201);
  });

  app.delete("/api/contacts/:id/links/:linkId", async (c) => {
    const link = await prisma.personLink.findFirst({
      where: { id: c.req.param("linkId"), ownerUid: c.get("ownerUid"), contactId: c.req.param("id") },
    });
    if (!link) return c.json({ error: "not_found" }, 404);
    await prisma.personLink.delete({ where: { id: link.id } });
    return c.json({ ok: true });
  });

  // 贈り物の記録 (誕生日・年賀状・慶事)。記録と同時に接触としても還流する。
  app.post("/api/contacts/:id/gifts", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const item = typeof b.item === "string" ? b.item.trim() : "";
    if (!item) return c.json({ error: "item_required", detail: "何を贈ったか (いただいたか) を入力してください" }, 400);
    const occasions = ["birthday", "new_year", "celebration", "thanks", "other"];
    const occasion = occasions.includes(b.occasion as string) ? (b.occasion as string) : "other";
    const direction = b.direction === "inbound" ? "inbound" : "outbound";
    const amount = clampScore(b.amount, 0, 100_000_000);
    const givenAt = typeof b.givenAt === "string" && !Number.isNaN(new Date(b.givenAt).getTime())
      ? new Date(b.givenAt)
      : new Date();
    const gift = await prisma.contactGift.create({
      data: {
        contactId: contact.id,
        occasion,
        direction,
        item,
        amount: amount === null ? null : Math.round(amount),
        notes: typeof b.notes === "string" ? b.notes.trim() || null : null,
        givenAt,
      },
    });
    await prisma.contactInteraction.create({
      data: {
        contactId: contact.id,
        type: direction === "outbound" ? "gift_sent" : "gift_received",
        occurredAt: givenAt,
        notes: item,
      },
    });
    return c.json({ gift }, 201);
  });

  app.delete("/api/contacts/:id/gifts/:giftId", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    const gift = await prisma.contactGift.findFirst({
      where: { id: c.req.param("giftId"), contactId: contact.id },
    });
    if (!gift) return c.json({ error: "not_found" }, 404);
    await prisma.contactGift.delete({ where: { id: gift.id } });
    return c.json({ ok: true });
  });

  // 面談招待 (.ics)。二者空き重なりの候補をそのままカレンダー取込用ファイルにする。
  app.get("/api/contacts/:id/meeting-invite", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    const start = new Date(c.req.query("start") ?? "");
    const end = new Date(c.req.query("end") ?? "");
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return c.json({ error: "invalid_range", detail: "候補の時間を読み取れませんでした" }, 400);
    }
    const ics = buildMeetingInviteIcs({
      title: `${contact.name}様と面談`,
      start,
      end,
      description: "bonds の面談候補から作成",
    });
    c.header("Content-Type", "text/calendar; charset=utf-8");
    c.header("Content-Disposition", 'attachment; filename="meeting.ics"');
    return c.body(ics);
  });

  // つながりサマリ: 孤立スコア + 今日連絡してみませんか (lms 移植ロジック)
  app.get("/api/relationship/summary", async (c) => {
    const contacts = await prisma.contact.findMany({
      where: { ownerUid: c.get("ownerUid"), state: "active" },
      select: { id: true, name: true, distance: true, birthday: true },
    });
    const interactions = await prisma.contactInteraction.findMany({
      where: { contactId: { in: contacts.map((x) => x.id) } },
      select: { contactId: true, occurredAt: true, type: true },
    });
    const isolation = calculateIsolationScore(contacts, interactions);
    const today = todaySuggestions(contacts, interactions);
    return c.json({
      isolation,
      today,
      connectionScore: 100 - isolation.score, // 高い方が良い表示 (lms と同じ)
    });
  });

  // ---------------- カレンダー & 面談候補 — フェーズ3 ----------------
  // busy スロットは手動/API 登録 (フェーズ5 で Google/Outlook ライブ同期)。

  // 自分のカレンダーは contact_id = "self" の番兵値で保存する
  // (NULL は Postgres の複合ユニークで重複可になり upsert が効かないため)。
  const SELF_CALENDAR = "self";

  // busy の保存。busySlots (手動) / ics (貼り付け) / icsUrl (購読 URL = ライブ同期) の
  // 3 経路。icsUrl は保存しておき、refresh-calendars で最新を取り直す。
  const saveBusy = async (
    ownerUid: string,
    contactId: string,
    body: { busySlots?: unknown; ics?: unknown; icsUrl?: unknown },
  ): Promise<{ saved: number } | { error: string; detail: string }> => {
    let busy: ReturnType<typeof toIso>;
    let provider = "manual";
    let icsUrl: string | null = null;
    if (typeof body.icsUrl === "string" && body.icsUrl.trim()) {
      const url = body.icsUrl.trim();
      if (!/^https:\/\//.test(url)) {
        return { error: "invalid_url", detail: "https の予定表アドレスを入力してください" };
      }
      if (!fetchText) return { error: "unavailable", detail: "いまは予定表を取得できません" };
      let content: string;
      try {
        content = await fetchText(url);
      } catch {
        return { error: "ics_fetch_failed", detail: "予定表を取得できませんでした。アドレスを確かめてください" };
      }
      if (!looksLikeIcs(content)) {
        return { error: "not_ics", detail: "予定表の形式を読み取れませんでした" };
      }
      busy = parseIcsBusy(content);
      provider = "ics";
      icsUrl = url;
    } else if (typeof body.ics === "string" && looksLikeIcs(body.ics)) {
      busy = parseIcsBusy(body.ics);
      provider = "ics";
    } else {
      busy = toIso(parseIsoIntervals(body.busySlots));
    }
    await prisma.calendarLink.upsert({
      where: { ownerUid_contactId: { ownerUid, contactId } },
      update: { busySlots: busy as never, provider, icsUrl },
      create: { ownerUid, contactId, provider, icsUrl, busySlots: busy as never },
    });
    return { saved: busy.length };
  };

  // 自分の busy 登録
  app.put("/api/relationship/my-busy", async (c) => {
    const b = await c.req
      .json<{ busySlots?: unknown; ics?: unknown; icsUrl?: unknown }>()
      .catch(() => ({}) as Record<string, never>);
    const r = await saveBusy(c.get("ownerUid"), SELF_CALENDAR, b);
    if ("error" in r) return c.json(r, 400);
    return c.json(r);
  });

  // 相手の busy 登録
  app.put("/api/contacts/:id/busy", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    const b = await c.req
      .json<{ busySlots?: unknown; ics?: unknown; icsUrl?: unknown }>()
      .catch(() => ({}) as Record<string, never>);
    const r = await saveBusy(c.get("ownerUid"), contact.id, b);
    if ("error" in r) return c.json(r, 400);
    return c.json(r);
  });

  // 二者空き重なり → 面談候補 (busy → 各自の free → 積集合)
  app.get("/api/contacts/:id/meeting-slots", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    const days = Math.min(30, Math.max(1, Number(c.req.query("days")) || 14));
    const [mine, theirs] = await Promise.all([
      prisma.calendarLink.findUnique({
        where: { ownerUid_contactId: { ownerUid: c.get("ownerUid"), contactId: SELF_CALENDAR } },
      }),
      prisma.calendarLink.findUnique({
        where: { ownerUid_contactId: { ownerUid: c.get("ownerUid"), contactId: contact.id } },
      }),
    ]);
    const proposals = meetingSlotProposals(
      parseIsoIntervals(mine?.busySlots),
      parseIsoIntervals(theirs?.busySlots),
      { from: new Date(), days, maxProposals: 5 },
    );
    return c.json({
      proposals: toIso(proposals),
      hasMyCalendar: !!mine,
      hasTheirCalendar: !!theirs,
    });
  });

  // AI 共通: 相手の文脈 (プロフィール + 直近のやりとり) を組み立てる
  const buildContactContext = async (ownerUid: string, contactId: string) => {
    const contact = await prisma.contact.findFirst({ where: { id: contactId, ownerUid } });
    if (!contact) return null;
    const [interactions, gifts] = await Promise.all([
      prisma.contactInteraction.findMany({
        where: { contactId: contact.id },
        orderBy: { occurredAt: "desc" },
        take: 20,
      }),
      prisma.contactGift.findMany({
        where: { contactId: contact.id },
        orderBy: { givenAt: "desc" },
        take: 10,
      }),
    ]);
    const lines = [
      `お名前: ${contact.name}`,
      `距離感: ${contact.distance} (1=毎日会う親しさ 〜 5=年に一度)`,
      `関係: ${contact.relationship}`,
      contact.company ? `所属: ${contact.company} ${contact.title ?? ""}` : "",
      contact.personalProfile ? `近況・状況: ${contact.personalProfile}` : "",
      contact.valuesProfile ? `価値観・大切にしていること: ${contact.valuesProfile}` : "",
      contact.notes ? `メモ: ${contact.notes}` : "",
      interactions.length > 0
        ? `最近のやりとり:\n${interactions
            .map((i) => `- ${i.occurredAt.toISOString().slice(0, 10)} ${i.type}${i.notes ? ` (${i.notes})` : ""}`)
            .join("\n")}`
        : "やりとりの記録はまだありません",
      gifts.length > 0
        ? `贈り物の記録:\n${gifts
            .map(
              (g) =>
                `- ${g.givenAt.toISOString().slice(0, 10)} ${g.direction === "inbound" ? "いただいた" : "贈った"}: ${g.item}${g.notes ? ` (${g.notes})` : ""}`,
            )
            .join("\n")}`
        : "",
    ].filter(Boolean);
    return { contact, context: lines.join("\n") };
  };

  // AI 実行の共通ラッパ (キャップ確認 → 生成 → 使用記録)
  const runRelationshipAi = async (
    promptKey: string,
    extraSystem: string,
    userMessage: string,
    purpose: string,
    locale: string,
  ): Promise<{ ok: true; text: string } | { ok: false; status: 422 | 503 | 502; body: unknown }> => {
    if (!generate) {
      return { ok: false, status: 503, body: { error: "unavailable", detail: "いまは文章の下書きを作れません" } };
    }
    const cost = await getMonthlyCostJpy(prisma);
    if (cost >= PERSON_DD_MONTHLY_CAP_JPY) {
      return { ok: false, status: 422, body: { error: "quota_exceeded", detail: "今月の利用枠は終了しました" } };
    }
    const prompt = await getPromptText(prisma, promptKey);
    if (!prompt) {
      return { ok: false, status: 503, body: { error: "unavailable", detail: "いまは文章の下書きを作れません" } };
    }
    const model = await resolveModel();
    const system = [
      prompt.body.replace(/\{\{RESPOND_LANGUAGE_INSTRUCTION\}\}/g, jsonProseLanguageDirective(locale)),
      extraSystem,
    ]
      .filter(Boolean)
      .join("\n\n");
    try {
      const gen = await generate({
        model,
        system,
        userMessage,
        maxTokens: PERSON_DD_MAX_TOKENS,
        timeoutMs: PERSON_DD_TIMEOUT_MS,
      });
      const canonical = canonicalizeModelId(gen.model) ?? model;
      await prisma.aiUsageLog.create({
        data: {
          provider: "anthropic",
          model: canonical,
          purpose,
          inputTokens: gen.inputTokens,
          outputTokens: gen.outputTokens,
          costJpy: calcCostJpy(canonical, gen.inputTokens, gen.outputTokens),
        },
      });
      return { ok: true, text: gen.text };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({ event: "ai_error", purpose, detail }));
      return {
        ok: false,
        status: 502,
        body: { error: "ai_failed", detail: "下書きづくりに失敗しました。しばらくしてからお試しください" },
      };
    }
  };

  // 価値観プロフィールの下書き (AI 下書き → ユーザーが編集して PUT で確定 = 自動保存しない)
  app.post("/api/contacts/:id/enrich-values", async (c) => {
    const ctx = await buildContactContext(c.get("ownerUid"), c.req.param("id"));
    if (!ctx) return c.json({ error: "not_found" }, 404);
    const b = await c.req.json<{ locale?: string }>().catch(() => ({}) as { locale?: string });
    const r = await runRelationshipAi(
      "values_profile_enrich",
      '出力は JSON オブジェクト 1 個だけ: {"draft": "価値観プロフィールの下書き (散文)"}',
      ctx.context,
      "values_enrich",
      normalizeLocale(b.locale),
    );
    if (!r.ok) return c.json(r.body as never, r.status);
    const parsed = extractJson(r.text) as { draft?: unknown } | null;
    const draft = typeof parsed?.draft === "string" ? parsed.draft.trim() : r.text.trim();
    return c.json({ draft });
  });

  // 相手ノート (見立て) の生成 — 蓄積した記録に根拠を置き、希望があれば公開情報の検索を足す。
  // 検索はユーザーが明示的に頼んだときだけ (相手の尊厳: 自動巡回で私人を web 検索しない)。
  const generateDigest = async (
    contact: { id: string; name: string; company: string | null; sns: string | null },
    context: string,
    includePublic: boolean,
    locale: string,
  ): Promise<{ ok: true; digest: string; searched: boolean } | { ok: false; status: 422 | 503 | 502; body: unknown }> => {
    let searchNote = "";
    let searched = false;
    if (includePublic && ddSearch && (contact.company || contact.sns)) {
      try {
        const results = await ddSearch([contact.name, contact.company ?? ""].filter(Boolean).join(" "));
        if (results.length > 0) {
          searchNote = results
            .slice(0, 5)
            .map((r) => `出典 ${r.url} : ${r.title} ${r.snippet.slice(0, 300)}`)
            .join("\n");
          searched = true;
        }
      } catch {
        // 検索の失敗で全体を止めない (記録のみで続行)
      }
    }
    const userMessage = [
      "これまでの記録:",
      context,
      searchNote ? `\n公開情報の検索結果 (同姓同名に注意。本人と確信できるものだけ使う):\n${searchNote}` : "",
      `今日の日付: ${new Date().toISOString().slice(0, 10)}`,
    ]
      .filter(Boolean)
      .join("\n");
    const r = await runRelationshipAi(
      "profile_digest_gen",
      '出力は JSON オブジェクト 1 個だけ: {"digest": "相手ノートの散文"}',
      userMessage,
      "profile_digest",
      locale,
    );
    if (!r.ok) return r;
    const parsed = extractJson(r.text) as { digest?: unknown } | null;
    const digest = sanitizeProse(typeof parsed?.digest === "string" ? parsed.digest : r.text).trim();
    if (!digest) {
      return { ok: false, status: 502, body: { error: "invalid_output", detail: "まとめづくりに失敗しました" } };
    }
    return { ok: true, digest, searched };
  };

  // 相手ノートの更新 (個別)。includePublic を付けたときだけ公開情報も調べる。
  app.post("/api/contacts/:id/refresh-digest", async (c) => {
    const ctx = await buildContactContext(c.get("ownerUid"), c.req.param("id"));
    if (!ctx) return c.json({ error: "not_found" }, 404);
    const b = await c.req
      .json<{ includePublic?: boolean; locale?: string }>()
      .catch(() => ({}) as { includePublic?: boolean; locale?: string });
    const r = await generateDigest(ctx.contact, ctx.context, b.includePublic === true, normalizeLocale(b.locale));
    if (!r.ok) return c.json(r.body as never, r.status);
    const updated = await prisma.contact.update({
      where: { id: ctx.contact.id },
      data: { profileDigest: r.digest, profileDigestAt: new Date() },
    });
    return c.json({ digest: updated.profileDigest, digestAt: updated.profileDigestAt, searched: r.searched });
  });

  // 相手ノートの自動更新 (バッチ)。新しい記録が積まれた人だけを対象に、1 回の実行で少数ずつ回す
  // (毎時の sweep から呼ぶ。月次キャップは runRelationshipAi が守る)。web 検索は行わない。
  app.post("/api/admin/contacts/refresh-digests", async (c) => {
    if (!generate) return c.json({ error: "unavailable", detail: "AI が設定されていません" }, 503);
    const batch = Math.min(Math.max(parseInt(c.req.query("batch") ?? "5", 10) || 5, 1), 20);
    const candidates = await prisma.contact.findMany({
      where: { state: "active" },
      select: { id: true, ownerUid: true, profileDigestAt: true },
      take: 500,
    });
    const targets: Array<{ id: string; ownerUid: string }> = [];
    for (const ct of candidates) {
      if (targets.length >= batch) break;
      const latest = await prisma.contactInteraction.findFirst({
        where: { contactId: ct.id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (!latest) continue; // 記録が無い人はまとめても中身が無い
      if (ct.profileDigestAt && ct.profileDigestAt >= latest.createdAt) continue; // 新しい記録なし
      targets.push({ id: ct.id, ownerUid: ct.ownerUid });
    }
    let refreshed = 0;
    const failures: string[] = [];
    for (const t of targets) {
      const ctx = await buildContactContext(t.ownerUid, t.id);
      if (!ctx) continue;
      const r = await generateDigest(ctx.contact, ctx.context, false, "ja");
      if (!r.ok) {
        failures.push(t.id);
        if (r.status === 422) break; // 月次キャップ到達: これ以上回さない
        continue;
      }
      await prisma.contact.update({
        where: { id: t.id },
        data: { profileDigest: r.digest, profileDigestAt: new Date() },
      });
      refreshed++;
    }
    return c.json({ refreshed, candidates: targets.length, failed: failures.length });
  });

  // 会話メモ・音声の文字起こし (Plaud / ZenTrack など) から登場人物と近況を抽出して「提案」する。
  // 自動反映はしない — ユーザーが選んで反映する (自律性の段階: 外へ出ない情報整理でも提案どまり)。
  app.post("/api/contacts/extract-from-conversation", async (c) => {
    const b = await c.req
      .json<{ text?: string; locale?: string }>()
      .catch(() => ({}) as { text?: string; locale?: string });
    const text = typeof b.text === "string" ? b.text.trim() : "";
    if (!text) return c.json({ error: "text_required", detail: "会話の内容がありません" }, 400);
    const instruction =
      '出力は JSON オブジェクト 1 個だけ: {"people": [{"name": "人物名", "note": "近況の短い散文 (無ければ空文字)", "date": "会った/話した日 YYYY-MM-DD (分からなければ空文字)"}]}';
    const r = await runRelationshipAi(
      "conversation_extract",
      instruction,
      `会話の記録:\n${text.slice(0, 20000)}`,
      "conversation_extract",
      normalizeLocale(b.locale),
    );
    if (!r.ok) return c.json(r.body as never, r.status);
    const parsed = extractJson(r.text) as { people?: unknown } | null;
    const rawPeople = Array.isArray(parsed?.people) ? (parsed.people as Array<Record<string, unknown>>) : [];
    const existing = await prisma.contact.findMany({
      where: { ownerUid: c.get("ownerUid"), state: "active" },
      select: { id: true, name: true },
    });
    const byName = new Map(existing.map((e) => [e.name, e.id]));
    const proposals: Array<{ name: string; note: string; date: string | null; contactId: string | null }> = [];
    for (const p of rawPeople.slice(0, 20)) {
      const name = clampName(p?.name);
      if (!name) continue;
      const note = sanitizeProse(typeof p.note === "string" ? p.note : "").trim();
      const dateRaw = typeof p.date === "string" ? p.date.trim() : "";
      proposals.push({
        name,
        note,
        date: /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null,
        contactId: byName.get(name) ?? null, // 既存の連絡先なら反映先として返す
      });
    }
    return c.json({ proposals });
  });

  // ---------------- 発信 (outreach) — フェーズ4 ----------------
  // 既定フロー: draft (複数候補生成) → approve (ユーザーが選択・編集して承認) → send。
  // 承認なしで送信はできない (CLAUDE.md 自律性の段階)。

  const OUTREACH_PURPOSES = ["keepup", "birthday", "thanks", "meeting", "contribution", "repair"] as const;
  const OUTREACH_CHANNELS = ["email", "gift", "nengajo", "meeting_invite"] as const;
  const CHANNEL_HINTS: Record<string, string> = {
    email: "",
    gift: "この文面は贈り物に添える手紙 (添え状) です。品物への言及を自然に入れ、押しつけがましくならないようにしてください。",
    nengajo: "この文面は年賀状 (または季節のご挨拶状) です。季節の挨拶を主役に、短く品よくまとめてください。",
    meeting_invite: "この文面はお会いする日程の打診です。相手の都合を最優先する姿勢で、候補日の提示を自然に含めてください。",
  };

  app.post("/api/outreach/draft", async (c) => {
    const b = await c.req
      .json<{ contactId?: string; purpose?: string; points?: string; locale?: string; channel?: string }>()
      .catch(() => ({}) as Record<string, never>);
    if (!b.contactId) return c.json({ error: "contact_required" }, 400);
    const ctx = await buildContactContext(c.get("ownerUid"), b.contactId);
    if (!ctx) return c.json({ error: "not_found" }, 404);
    const purpose = OUTREACH_PURPOSES.includes(b.purpose as never) ? b.purpose! : "keepup";
    const channel = OUTREACH_CHANNELS.includes(b.channel as never) ? b.channel! : "email";
    const points = typeof b.points === "string" ? b.points.trim() : "";
    const userMessage = [
      "相手の情報:",
      ctx.context,
      "",
      `送る目的: ${purpose}`,
      CHANNEL_HINTS[channel] ?? "",
      points ? `伝えたいこと: ${points}` : "伝えたいこと: 特になし (関係を温めるひとことを)",
      `今日の日付: ${new Date().toISOString().slice(0, 10)}`,
    ].filter(Boolean).join("\n");
    const r = await runRelationshipAi(
      "outreach_message_gen",
      OUTREACH_JSON_INSTRUCTION,
      userMessage,
      "outreach_gen",
      normalizeLocale(b.locale),
    );
    if (!r.ok) return c.json(r.body as never, r.status);
    const validated = validateOutreachCandidates(extractJson(r.text));
    if (!validated.ok) {
      return c.json(
        { error: "invalid_output", detail: "下書きづくりに失敗しました。もう一度お試しください" },
        502,
      );
    }
    const message = await prisma.outreachMessage.create({
      data: {
        ownerUid: c.get("ownerUid"),
        contactId: ctx.contact.id,
        channel,
        purpose,
        status: "draft",
        candidates: JSON.stringify(validated.candidates),
      },
    });
    return c.json({ id: message.id, channel, candidates: validated.candidates }, 201);
  });

  app.get("/api/outreach", async (c) => {
    const contactId = c.req.query("contactId");
    const messages = await prisma.outreachMessage.findMany({
      where: { ownerUid: c.get("ownerUid"), ...(contactId ? { contactId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return c.json({
      messages: messages.map((m) => ({
        ...m,
        candidates: m.candidates ? JSON.parse(m.candidates) : null,
      })),
    });
  });

  // 承認: 候補から選び (編集可)、件名と本文を確定する
  app.post("/api/outreach/:id/approve", async (c) => {
    const m = await prisma.outreachMessage.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!m) return c.json({ error: "not_found" }, 404);
    if (m.status !== "draft") {
      return c.json({ error: "invalid_status", detail: `status=${m.status} は承認できません` }, 409);
    }
    const b = await c.req
      .json<{ subject?: string; body?: string }>()
      .catch(() => ({}) as { subject?: string; body?: string });
    const subject = typeof b.subject === "string" ? b.subject.trim() : "";
    const body = typeof b.body === "string" ? b.body.trim() : "";
    if (!subject || !body) {
      return c.json({ error: "subject_body_required", detail: "件名と本文を確定してください" }, 400);
    }
    const updated = await prisma.outreachMessage.update({
      where: { id: m.id },
      data: { subject, body, status: "approved" },
    });
    return c.json({ message: { id: updated.id, status: updated.status } });
  });

  // 送信: approved のみ。成功で sent + contact_interactions へ還流 (距離スコア更新)。
  app.post("/api/outreach/:id/send", async (c) => {
    const m = await prisma.outreachMessage.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!m) return c.json({ error: "not_found" }, 404);
    if (m.status !== "approved") {
      return c.json(
        { error: "not_approved", detail: "送信の前に文面の承認が必要です" },
        409,
      );
    }
    if (!mailer) {
      return c.json({ error: "unavailable", detail: "送信の設定がまだ済んでいません" }, 503);
    }
    const r = await deliverApproved(m);
    if (!r.ok) {
      if (r.detail === "no_email") {
        return c.json({ error: "no_email", detail: "この方のメールアドレスが登録されていません" }, 400);
      }
      return c.json({ error: "send_failed", detail: "送信できませんでした。しばらくしてからお試しください" }, 502);
    }
    const updated = await prisma.outreachMessage.findFirstOrThrow({ where: { id: m.id } });
    return c.json({ message: { id: updated.id, status: updated.status, sentAt: updated.sentAt } });
  });

  // 前進の記録 (ゲーミフィケーション): 連続記録・バッジ・次の節目
  app.get("/api/relationship/progress", async (c) => {
    const contacts = await prisma.contact.findMany({
      where: { ownerUid: c.get("ownerUid"), state: "active" },
      select: { id: true },
    });
    const ids = contacts.map((x) => x.id);
    const interactions = await prisma.contactInteraction.findMany({
      where: { contactId: { in: ids } },
      select: { contactId: true, occurredAt: true },
    });
    const progress = computeProgress({
      interactionDates: interactions.map((i) => i.occurredAt),
      distinctContacts: new Set(interactions.map((i) => i.contactId)).size,
      contactsTotal: ids.length,
    });
    return c.json(progress);
  });

  // ICS 購読 URL を登録済みのカレンダーを再取得する (ライブ同期の実体)。
  // ユーザーのボタン操作か、外部スケジューラ (Actions cron 等) から叩く。
  app.post("/api/relationship/refresh-calendars", async (c) => {
    const links = await prisma.calendarLink.findMany({
      where: { ownerUid: c.get("ownerUid"), provider: "ics", icsUrl: { not: null } },
    });
    let refreshed = 0;
    const failed: string[] = [];
    for (const link of links) {
      try {
        if (!fetchText || !link.icsUrl) throw new Error("no_fetcher");
        const content = await fetchText(link.icsUrl);
        if (!looksLikeIcs(content)) throw new Error("not_ics");
        await prisma.calendarLink.update({
          where: { id: link.id },
          data: { busySlots: parseIcsBusy(content) as never },
        });
        refreshed++;
      } catch {
        failed.push(link.contactId ?? "self");
      }
    }
    return c.json({ refreshed, failed });
  });

  // ---------------- 一括配信キュー (フェーズ4 残作業) ----------------
  // 承認済みメッセージに送信予定時刻をつけてキューに載せ、ワーカー
  // (process-queue。Actions cron / Cloud Scheduler から admin 権限で起動) が順に送る。
  // 承認フローの強制は不変: approved 以外は schedule もキュー処理も対象外。

  app.post("/api/outreach/:id/schedule", async (c) => {
    const m = await prisma.outreachMessage.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!m) return c.json({ error: "not_found" }, 404);
    if (m.status !== "approved") {
      return c.json({ error: "not_approved", detail: "先に文面を承認してください" }, 409);
    }
    const b = await c.req.json<{ sendAt?: string }>().catch(() => ({}) as { sendAt?: string });
    const sendAt = b.sendAt ? new Date(b.sendAt) : new Date();
    if (Number.isNaN(sendAt.getTime())) {
      return c.json({ error: "invalid_send_at", detail: "送信予定時刻を読み取れませんでした" }, 400);
    }
    await prisma.outreachMessage.update({
      where: { id: m.id },
      data: { scheduledAt: sendAt },
    });
    return c.json({ id: m.id, scheduledAt: sendAt.toISOString() });
  });

  // 承認済みメッセージ 1 通を送って還流する (単発 send とキューの共通処理)
  const deliverApproved = async (m: {
    id: string;
    ownerUid: string;
    contactId: string;
    subject: string | null;
    body: string | null;
  }): Promise<{ ok: boolean; detail?: string }> => {
    if (!mailer) return { ok: false, detail: "mailer_not_configured" };
    const contact = await prisma.contact.findFirst({
      where: { id: m.contactId, ownerUid: m.ownerUid },
    });
    if (!contact?.email) {
      await prisma.outreachMessage.update({
        where: { id: m.id },
        data: { status: "failed", errorDetail: "no_email" },
      });
      return { ok: false, detail: "no_email" };
    }
    try {
      const sent = await mailer({ to: contact.email, subject: m.subject ?? "", body: m.body ?? "" });
      await prisma.outreachMessage.update({
        where: { id: m.id },
        data: { status: "sent", sentAt: new Date(), providerMessageId: sent.messageId },
      });
      await prisma.contactInteraction.create({
        data: { contactId: contact.id, type: "email", occurredAt: new Date(), notes: m.subject },
      });
      return { ok: true };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await prisma.outreachMessage.update({
        where: { id: m.id },
        data: { status: "failed", errorDetail: detail },
      });
      return { ok: false, detail };
    }
  };

  // メール以外のチャネル (贈り物・年賀状・面談打診を別手段で送った) の完了記録。
  // 承認済みのみ。接触へ還流し、gift チャネルは贈り物記録も残す。
  app.post("/api/outreach/:id/mark-sent", async (c) => {
    const m = await prisma.outreachMessage.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!m) return c.json({ error: "not_found" }, 404);
    if (m.status !== "approved") {
      return c.json({ error: "not_approved", detail: "先に文面の承認が必要です" }, 409);
    }
    const b = await c.req.json<{ item?: string }>().catch(() => ({}) as { item?: string });
    const updated = await prisma.outreachMessage.update({
      where: { id: m.id },
      data: { status: "sent", sentAt: new Date() },
    });
    await prisma.contactInteraction.create({
      data: {
        contactId: m.contactId,
        type: m.channel === "gift" ? "gift_sent" : m.channel === "nengajo" ? "letter" : "message",
        occurredAt: new Date(),
        notes: m.subject,
      },
    });
    if (m.channel === "gift" && typeof b.item === "string" && b.item.trim()) {
      await prisma.contactGift.create({
        data: {
          contactId: m.contactId,
          occasion: m.purpose === "birthday" ? "birthday" : "other",
          direction: "outbound",
          item: b.item.trim(),
          givenAt: new Date(),
        },
      });
    }
    return c.json({ message: { id: updated.id, status: updated.status } });
  });

  // キューのワーカー (全オーナー横断のため admin 権限)。1 回の起動で最大 batch 件 =
  // 送信レートの上限。1 通の失敗は failed として記録し、残りの処理は続ける。
  app.post("/api/admin/outreach/process-queue", async (c) => {
    const batch = Math.min(50, Math.max(1, Number(c.req.query("batch")) || 10));
    const due = await prisma.outreachMessage.findMany({
      where: { status: "approved", scheduledAt: { not: null, lte: new Date() } },
      orderBy: { scheduledAt: "asc" },
      take: batch,
    });
    let sent = 0;
    let failed = 0;
    for (const m of due) {
      const r = await deliverApproved(m);
      if (r.ok) sent++;
      else failed++;
    }
    return c.json({ picked: due.length, sent, failed });
  });

  // 実行詳細 (ステップ含む)
  app.get("/api/dd/runs/:id", async (c) => {
    const run = await prisma.personDueDiligence.findUnique({
      where: { id: c.req.param("id") },
      include: { steps: { orderBy: { createdAt: "asc" } }, subject: true },
    });
    if (!run) return c.json({ error: "not_found" }, 404);
    return c.json({ run });
  });

  return app;
}

export type AppType = ReturnType<typeof createApp>;
