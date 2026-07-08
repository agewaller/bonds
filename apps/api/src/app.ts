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
import { MAX_EXTRACT_TEXT_CHARS } from "./lib/file-text.js";
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
import {
  BONDS_PITCH,
  PARTNER_KINDS,
  PARTNER_STATUSES,
  PARTNER_DRAFT_JSON_INSTRUCTION,
  partnerDailyLimit,
  partnerAutoSendEnabled,
  buildPartnerFooter,
  isValidEmail,
  parseDiscoveredTargets,
  validatePartnerDraft,
} from "./lib/partners.js";
import {
  buildGoogleClient,
  collectGooglePeople,
  signState,
  verifyState,
  GOOGLE_SCOPES,
  GMAIL_MAX_MESSAGES,
  DRIVE_MAX_FILES,
  CALENDAR_LOOKBACK_DAYS,
  CALENDAR_LOOKAHEAD_DAYS,
  type GoogleClient,
  type CalendarEvent,
  type GmailHeaderMessage,
  type DriveFile,
} from "./lib/google.js";

export type AppDeps = {
  prisma: ExtendedPrismaClient;
  generate?: GenerateFn | null;
  mailer?: MailerFn | null;
  verifyIdToken?: VerifyIdTokenFn | null;
  fetchText?: ((url: string) => Promise<string>) | null;
  search?: SearchFn | null;
  google?: GoogleClient | null;
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
  // Google 連携 (env 未設定なら null = 「準備中」に縮退)
  const google = deps.google !== undefined ? deps.google : buildGoogleClient();
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
  // Google 連携: callback (OAuth リダイレクト受け) だけは未認証 (state 署名で本人性を担保)
  app.use("/api/google/status", requireUser);
  app.use("/api/google/auth-url", requireUser);
  app.use("/api/google/sync", requireUser);

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
  // 既存の方 (同名が 1 人だけ) には、空いている項目の補完とメモの書き足しで情報を「育てる」
  // — 上書きはしない (ユーザーが書いた値が常に勝つ)。
  const MAX_NOTES_CHARS = 6000;
  const applyImport = async (
    ownerUid: string,
    parsed: { contacts: ParsedContact[]; interactions: ParsedInteraction[] },
  ) => {
    const existing = await prisma.contact.findMany({
      where: { ownerUid, state: "active" },
    });
    const byName = new Map(existing.map((e) => [e.name, e.id]));
    const nameCount = new Map<string, number>();
    for (const e of existing) nameCount.set(e.name, (nameCount.get(e.name) ?? 0) + 1);
    let imported = 0;
    let skipped = 0;
    let enriched = 0;
    // 同姓同名で見送った名前。世の中には同じ名前の別人がいるため、黙って捨てず
    // ユーザーに知らせ、「別の人」なら追加欄 (confirmNew) から特定して足してもらう。
    const sameName = new Set<string>();
    for (const r of parsed.contacts) {
      const name = clampName(r.name);
      if (!name || byName.has(name)) {
        if (name) {
          sameName.add(name);
          // 同名が 1 人だけなら同一人物とみなし、空欄の補完とメモの書き足しだけ行う
          if (nameCount.get(name) === 1) {
            const target = existing.find((e) => e.name === name)!;
            const fill: Record<string, unknown> = {};
            const fields = ["furigana", "phone", "email", "address", "company", "title"] as const;
            for (const f of fields) {
              const v = (r as Record<string, unknown>)[f];
              if (!target[f] && typeof v === "string" && v.trim()) fill[f] = v.trim();
            }
            if (!target.birthday && r.birthday) fill.birthday = parseBirthday(r.birthday);
            const note = typeof r.notes === "string" ? r.notes.trim() : "";
            if (note && !(target.notes ?? "").includes(note)) {
              fill.notes = `${target.notes ? `${target.notes}\n` : ""}${note}`.slice(0, MAX_NOTES_CHARS);
            }
            if (Object.keys(fill).length > 0) {
              await prisma.contact.update({ where: { id: target.id }, data: fill });
              Object.assign(target, fill);
              enriched++;
            }
          }
        }
        skipped++;
        continue;
      }
      const created = await prisma.contact.create({
        data: { ownerUid, name, source: r.source ?? "import", ...contactData(r as Record<string, unknown>) },
      });
      byName.set(name, created.id);
      nameCount.set(name, 1);
      existing.push(created);
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
        data: {
          contactId,
          type: it.type,
          occurredAt: new Date(`${it.occurredAt}T12:00:00Z`),
          notes: typeof it.note === "string" && it.note.trim() ? it.note.trim().slice(0, 1000) : null,
        },
      });
      seen.add(it.occurredAt);
      interactionsAdded++;
    }
    return {
      imported,
      skipped,
      enriched,
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
  // 既知の構造化形式で拾えないファイル (Word・Excel・PDF・メール・議事録・自由なメモなど)
  // は本文テキストに落とし、AI の人物抽出 (import_extract) で名前・連絡先・所属・
  // 近況メモ・会った日を読み取って、同じ冪等取込 (applyImport) で連絡帳へ整理する。
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
    let ai: { contacts: ParsedContact[]; interactions: ParsedInteraction[] } | null = null;
    let aiUnavailable = false;
    if (parsed.texts.length > 0) {
      const r = await extractPeopleFromTexts(parsed.texts, normalizeLocale(c.req.query("locale")));
      if (r.ok) ai = r;
      else aiUnavailable = true;
    }
    const merged = {
      contacts: [...parsed.contacts, ...(ai?.contacts ?? [])],
      interactions: [...parsed.interactions, ...(ai?.interactions ?? [])],
    };
    if (merged.contacts.length === 0) {
      if (aiUnavailable) {
        return c.json(
          {
            error: "extract_unavailable",
            detail: "内容は読めましたが、いまは人物の読み取りができません。しばらくしてからもう一度お試しください",
          },
          422,
        );
      }
      return c.json(
        {
          error: "no_contacts_found",
          detail:
            "このファイルからは人物にまつわる情報を見つけられませんでした。文字の入った書類 (Word・Excel・PDF・メール・テキスト・CSV・vCard・SNS のダウンロード ZIP など) ならたいてい読み取れます",
        },
        422,
      );
    }
    const result = await applyImport(c.get("ownerUid"), merged);
    return c.json({ ...result, foundIn: parsed.foundIn, aiPeople: ai?.contacts.length ?? 0 });
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

  // ファイル本文からの人物抽出 — 名前だけでなく連絡先・所属・近況・会った日まで
  // 整理された形で拾い、applyImport (冪等・既存の方は補完) に渡せる形に検証して返す。
  // 出力は必ずここで検証・サニタイズし、AI の申告のまま DB に入れない。
  const IMPORT_EXTRACT_INSTRUCTION =
    '出力は JSON オブジェクト 1 個だけ: {"people": [{"name": "人物名", "furigana": "よみがな (無ければ空)", "email": "", "phone": "", "company": "所属 (無ければ空)", "title": "役職 (無ければ空)", "address": "", "birthday": "YYYY-MM-DD (無ければ空)", "relationship": "family か friend か work か community か other", "note": "その人について分かったことの短い散文 (無ければ空)", "dates": [{"date": "YYYY-MM-DD", "type": "meeting か message か call か other", "summary": "その日のできごとの短い一文 (無ければ空)"}]}]}';

  const extractPeopleFromTexts = async (
    texts: Array<{ file: string; kind: string; text: string }>,
    locale: string,
  ): Promise<
    | { ok: true; contacts: ParsedContact[]; interactions: ParsedInteraction[] }
    | { ok: false; status: 422 | 503 | 502; body: unknown }
  > => {
    const joined = texts
      .map((t) => `ファイル ${t.file} (${t.kind}) の内容:\n${t.text}`)
      .join("\n\n----\n\n")
      .slice(0, MAX_EXTRACT_TEXT_CHARS);
    const r = await runRelationshipAi(
      "import_extract",
      IMPORT_EXTRACT_INSTRUCTION,
      joined,
      "import_extract",
      locale,
    );
    if (!r.ok) return r;
    const parsed = extractJson(r.text) as { people?: unknown } | null;
    const raw = Array.isArray(parsed?.people) ? (parsed.people as Array<Record<string, unknown>>) : [];
    const str = (v: unknown, max = 200) =>
      typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
    const isoDay = (v: unknown) =>
      typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : undefined;
    const today = new Date().toISOString().slice(0, 10);
    const contacts: ParsedContact[] = [];
    const interactions: ParsedInteraction[] = [];
    for (const p of raw.slice(0, 30)) {
      const name = clampName(p?.name);
      if (!name) continue;
      const note = sanitizeProse(typeof p.note === "string" ? p.note : "").trim().slice(0, 1000);
      contacts.push({
        name,
        furigana: str(p.furigana, 100),
        email: str(p.email, 200),
        phone: str(p.phone, 50),
        company: str(p.company, 200),
        title: str(p.title, 200),
        address: str(p.address, 300),
        birthday: isoDay(p.birthday),
        relationship: ["family", "friend", "work", "community"].includes(p.relationship as string)
          ? (p.relationship as string)
          : undefined,
        notes: note || undefined,
        source: "file",
      });
      const dates = Array.isArray(p.dates) ? (p.dates as Array<Record<string, unknown>>) : [];
      for (const d of dates.slice(0, 30)) {
        const date = isoDay(d?.date);
        if (!date || date > today) continue; // 未来日は接触記録にしない
        interactions.push({
          name,
          occurredAt: date,
          type: ["meeting", "message", "call"].includes(d.type as string) ? (d.type as string) : "other",
          note: sanitizeProse(typeof d.summary === "string" ? d.summary : "").trim().slice(0, 300) || undefined,
        });
      }
    }
    return { ok: true, contacts, interactions };
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

  // ---------------- 提携先アウトリーチ (cares ADR-0022 の移植) ----------------
  // bonds を広げるための提携候補 (サイト/協会/コミュニティ/サービス/企業) の
  // 発見 → 個別連絡文の下書き → 送信 → 返信対応 → 公開ディレクトリ掲載。
  // 管理者 (オーナー) 専用 (/api/admin/* ガード済み)。公開ディレクトリのみ未認証。
  // 外への送信は既定で承認制。自動送信は PARTNER_AUTO_SEND=1 の明示許可時のみで、
  // その場合も送信除外 (suppressed)・日次上限・法的フッタは必ず効く。

  const partnerContext = (t: {
    name: string;
    kind: string;
    url: string | null;
    handle: string | null;
    source: string | null;
    notes: string | null;
  }): string =>
    [
      `名称: ${t.name}`,
      `種別: ${t.kind}`,
      t.url ? `URL: ${t.url}` : "",
      t.handle ? `ハンドル: ${t.handle}` : "",
      t.source ? `発見元: ${t.source}` : "",
      t.notes ? `メモ: ${t.notes}` : "",
    ]
      .filter(Boolean)
      .join("\n");

  // 実送信の共通処理 (承認送信 / 自動送信 / キューから呼ぶ)。安全装置はここに集約する。
  const performPartnerSend = async (
    messageId: string,
  ): Promise<{ status: string; detail?: string }> => {
    const msg = await prisma.partnerMessage.findFirst({
      where: { id: messageId, direction: "outbound" },
    });
    if (!msg) return { status: "not_found", detail: "メッセージが見つかりません" };
    if (msg.status === "sent") return { status: "sent" };
    const target = await prisma.partnerTarget.findFirst({
      where: { id: msg.targetId, state: "active" },
    });
    if (!target) return { status: "not_found", detail: "提携先が見つかりません" };
    if (target.status === "suppressed") {
      return { status: "suppressed", detail: "この提携先は送信除外に設定されています" };
    }
    if (!isValidEmail(target.contactEmail)) {
      return { status: "no_email", detail: "送信先メールが未設定か不正です" };
    }
    // 日次送信上限 (迷惑メール判定・ドメイン汚染の防止)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await prisma.partnerMessage.count({
      where: { direction: "outbound", status: "sent", sentAt: { gte: since } },
    });
    if (recent >= partnerDailyLimit()) {
      return { status: "rate_limited", detail: "本日の送信上限に達しました" };
    }
    if (!mailer) {
      // 送信基盤が未設定でも失敗にせず、承認済みとして保留 (設定後に process-queue が送る)
      await prisma.partnerMessage.update({ where: { id: msg.id }, data: { status: "approved" } });
      return {
        status: "approved",
        detail: "送信基盤が未設定のため、承認済みとして保留しました。設定が整うと送信されます",
      };
    }
    try {
      const result = await mailer({
        to: (target.contactEmail as string).trim(),
        subject: msg.subject ?? "bonds との連携のご相談",
        body: `${msg.body}${buildPartnerFooter()}`, // 送信者明示 + 配信停止フッタは必ず付ける
      });
      await prisma.partnerMessage.update({
        where: { id: msg.id },
        data: { status: "sent", sentAt: new Date(), providerMessageId: result.messageId, errorDetail: null },
      });
      await prisma.partnerTarget.update({
        where: { id: target.id },
        data: { status: target.status === "replied" || target.status === "partner" ? target.status : "contacted", lastContactedAt: new Date() },
      });
      return { status: "sent" };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await prisma.partnerMessage.update({
        where: { id: msg.id },
        data: { status: "failed", errorDetail: detail.slice(0, 300) },
      });
      return { status: "failed", detail: "送信できませんでした" };
    }
  };

  // 公開ディレクトリ (未認証可)。掲載許可した提携先のみ・PII (メール等) は返さない。
  app.get("/api/partners", async (c) => {
    const rows = await prisma.partnerTarget.findMany({
      where: { isPublic: true, state: "active" },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
      take: 100,
    });
    return c.json({
      partners: rows.map((t) => ({ kind: t.kind, name: t.name, url: t.url, blurb: t.blurb })),
    });
  });

  app.get("/api/admin/partners/targets", async (c) => {
    const status = c.req.query("status");
    const targets = await prisma.partnerTarget.findMany({
      where: {
        state: "active",
        ...(status && (PARTNER_STATUSES as readonly string[]).includes(status) ? { status } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
      include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    return c.json({
      targets: targets.map(({ messages, ...t }) => ({
        ...t,
        latestMessage: messages[0]
          ? { id: messages[0].id, direction: messages[0].direction, status: messages[0].status, createdAt: messages[0].createdAt }
          : null,
      })),
    });
  });

  app.get("/api/admin/partners/targets/:id", async (c) => {
    const target = await prisma.partnerTarget.findFirst({
      where: { id: c.req.param("id"), state: "active" },
    });
    if (!target) return c.json({ error: "not_found" }, 404);
    const messages = await prisma.partnerMessage.findMany({
      where: { targetId: target.id },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    return c.json({ target, messages });
  });

  const partnerTargetData = (b: Record<string, unknown>) => ({
    kind:
      typeof b.kind === "string" && (PARTNER_KINDS as readonly string[]).includes(b.kind)
        ? b.kind
        : "other",
    url: typeof b.url === "string" ? b.url.trim() || null : null,
    handle: typeof b.handle === "string" ? b.handle.trim() || null : null,
    contactEmail: typeof b.contactEmail === "string" ? b.contactEmail.trim() || null : null,
    source: typeof b.source === "string" ? b.source.trim() || null : null,
    notes: typeof b.notes === "string" ? b.notes.trim() || null : null,
  });

  app.post("/api/admin/partners/targets", async (c) => {
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const name = typeof b.name === "string" ? b.name.trim().slice(0, 120) : "";
    if (!name) return c.json({ error: "name_required", detail: "名称を入力してください" }, 400);
    const created = await prisma.partnerTarget.create({
      data: { name, ...partnerTargetData(b) },
    });
    return c.json({ target: created }, 201);
  });

  app.patch("/api/admin/partners/targets/:id", async (c) => {
    const target = await prisma.partnerTarget.findFirst({
      where: { id: c.req.param("id"), state: "active" },
    });
    if (!target) return c.json({ error: "not_found" }, 404);
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const data: Record<string, unknown> = {};
    if (typeof b.name === "string" && b.name.trim()) data.name = b.name.trim().slice(0, 120);
    if (typeof b.kind === "string" && (PARTNER_KINDS as readonly string[]).includes(b.kind)) data.kind = b.kind;
    if (typeof b.status === "string" && (PARTNER_STATUSES as readonly string[]).includes(b.status)) data.status = b.status;
    for (const f of ["url", "handle", "contactEmail", "source", "notes", "blurb"] as const) {
      if (typeof b[f] === "string") data[f] = (b[f] as string).trim() || null;
    }
    if (typeof b.isPublic === "boolean") data.isPublic = b.isPublic;
    if (typeof b.displayOrder === "number" && Number.isFinite(b.displayOrder)) {
      data.displayOrder = Math.trunc(b.displayOrder);
    }
    const updated = await prisma.partnerTarget.update({ where: { id: target.id }, data: data as never });
    return c.json({ target: updated });
  });

  app.delete("/api/admin/partners/targets/:id", async (c) => {
    const target = await prisma.partnerTarget.findFirst({
      where: { id: c.req.param("id"), state: "active" },
    });
    if (!target) return c.json({ error: "not_found" }, 404);
    await prisma.partnerTarget.update({ where: { id: target.id }, data: { state: "archived" } });
    return c.json({ ok: true });
  });

  // 候補の発見: テーマから提携候補を AI が提案 → candidate として保存 (同名は重複させない)
  app.post("/api/admin/partners/discover", async (c) => {
    const b = await c.req
      .json<{ theme?: string; locale?: string }>()
      .catch(() => ({}) as { theme?: string; locale?: string });
    const theme = typeof b.theme === "string" ? b.theme.trim().slice(0, 200) : "";
    if (!theme) return c.json({ error: "theme_required", detail: "テーマを入力してください" }, 400);

    // 検索器があれば実在確認の材料を渡す (無ければ知識ベース)
    let digest = "";
    if (ddSearch) {
      try {
        const items = await ddSearch(`${theme} 団体 コミュニティ サービス`);
        digest = items
          .slice(0, 5)
          .map((i) => `参考: ${i.url} ${i.title} ${i.snippet.slice(0, 200)}`)
          .join("\n");
      } catch {
        digest = "";
      }
    }
    const userMessage = [`テーマ: ${theme}`, `bonds の紹介: ${BONDS_PITCH}`, digest]
      .filter(Boolean)
      .join("\n\n");
    const r = await runRelationshipAi(
      "partner_discover",
      "",
      userMessage,
      "partner_discover",
      normalizeLocale(b.locale),
    );
    if (!r.ok) return c.json(r.body as never, r.status);
    const found = parseDiscoveredTargets(r.text);
    const existing = new Set(
      (await prisma.partnerTarget.findMany({ where: { state: "active" }, select: { name: true } })).map(
        (t) => t.name,
      ),
    );
    const created = [];
    for (const f of found) {
      if (existing.has(f.name)) continue;
      existing.add(f.name);
      created.push(
        await prisma.partnerTarget.create({
          data: { name: f.name, kind: f.kind, url: f.url, source: `discover: ${theme}`, notes: f.reason || null },
        }),
      );
    }
    return c.json({ found: found.length, created: created.map((t) => ({ id: t.id, name: t.name, kind: t.kind })) });
  });

  // 連絡文の下書き (AI)。PARTNER_AUTO_SEND=1 のときだけ下書き後に自動送信まで進む。
  app.post("/api/admin/partners/targets/:id/draft", async (c) => {
    const target = await prisma.partnerTarget.findFirst({
      where: { id: c.req.param("id"), state: "active" },
    });
    if (!target) return c.json({ error: "not_found" }, 404);
    const b = await c.req
      .json<{ points?: string; locale?: string }>()
      .catch(() => ({}) as { points?: string; locale?: string });
    const userMessage = [
      "提携候補の情報:",
      partnerContext(target),
      "",
      `bonds の紹介: ${BONDS_PITCH}`,
      `bonds の URL: 本文にはシステムが署名として自動で付けるため書かなくてよい`,
      typeof b.points === "string" && b.points.trim()
        ? `伝えたいこと: ${b.points.trim().slice(0, 500)}`
        : "伝えたいこと: 特になし (連携のご相談の最初のご挨拶)",
    ].join("\n");
    const r = await runRelationshipAi(
      "partner_outreach_draft",
      PARTNER_DRAFT_JSON_INSTRUCTION,
      userMessage,
      "partner_draft",
      normalizeLocale(b.locale),
    );
    if (!r.ok) return c.json(r.body as never, r.status);
    const validated = validatePartnerDraft(extractJson(r.text));
    if (!validated.ok) {
      return c.json({ error: "invalid_output", detail: "下書きづくりに失敗しました。もう一度お試しください" }, 502);
    }
    const message = await prisma.partnerMessage.create({
      data: {
        targetId: target.id,
        direction: "outbound",
        channel: "email",
        subject: validated.draft.subject,
        body: validated.draft.body,
        status: "draft",
      },
    });
    if (target.status === "candidate") {
      await prisma.partnerTarget.update({ where: { id: target.id }, data: { status: "queued" } });
    }
    // 自動送信 (既定 OFF)。明示的に有効化された場合のみ。安全装置は performPartnerSend 側で必ず効く。
    let autoSend: { status: string; detail?: string } | null = null;
    if (partnerAutoSendEnabled()) {
      autoSend = await performPartnerSend(message.id);
    }
    const fresh = await prisma.partnerMessage.findUnique({ where: { id: message.id } });
    return c.json({ message: fresh, autoSend }, 201);
  });

  // 返信への返事の下書き (スレッド文脈を渡す)。送信は同じく承認制/明示許可時のみ自動。
  app.post("/api/admin/partners/targets/:id/reply-draft", async (c) => {
    const target = await prisma.partnerTarget.findFirst({
      where: { id: c.req.param("id"), state: "active" },
    });
    if (!target) return c.json({ error: "not_found" }, 404);
    const b = await c.req.json<{ locale?: string }>().catch(() => ({}) as { locale?: string });
    const thread = await prisma.partnerMessage.findMany({
      where: { targetId: target.id },
      orderBy: { createdAt: "desc" },
      take: 6,
    });
    if (!thread.some((m) => m.direction === "inbound")) {
      return c.json({ error: "no_inbound", detail: "まだ相手からの返信が記録されていません" }, 400);
    }
    const userMessage = [
      "提携候補の情報:",
      partnerContext(target),
      "",
      `bonds の紹介: ${BONDS_PITCH}`,
      "",
      "これまでのやりとり (古い順):",
      ...thread
        .reverse()
        .map((m) => `${m.direction === "outbound" ? "こちらから" : "相手から"}: ${m.subject ?? ""}\n${m.body}`),
    ].join("\n");
    const r = await runRelationshipAi(
      "partner_reply_draft",
      PARTNER_DRAFT_JSON_INSTRUCTION,
      userMessage,
      "partner_reply_draft",
      normalizeLocale(b.locale),
    );
    if (!r.ok) return c.json(r.body as never, r.status);
    const validated = validatePartnerDraft(extractJson(r.text));
    if (!validated.ok) {
      return c.json({ error: "invalid_output", detail: "下書きづくりに失敗しました。もう一度お試しください" }, 502);
    }
    const message = await prisma.partnerMessage.create({
      data: {
        targetId: target.id,
        direction: "outbound",
        channel: "email",
        subject: validated.draft.subject,
        body: validated.draft.body,
        status: "draft",
      },
    });
    let autoSend: { status: string; detail?: string } | null = null;
    if (partnerAutoSendEnabled()) {
      autoSend = await performPartnerSend(message.id);
    }
    const fresh = await prisma.partnerMessage.findUnique({ where: { id: message.id } });
    return c.json({ message: fresh, autoSend }, 201);
  });

  // 返信の記録 (受信)。target を replied にし、返事の下書きにつなげる。
  app.post("/api/admin/partners/targets/:id/inbound", async (c) => {
    const target = await prisma.partnerTarget.findFirst({
      where: { id: c.req.param("id"), state: "active" },
    });
    if (!target) return c.json({ error: "not_found" }, 404);
    const b = await c.req
      .json<{ body?: string; subject?: string }>()
      .catch(() => ({}) as { body?: string; subject?: string });
    if (typeof b.body !== "string" || !b.body.trim()) {
      return c.json({ error: "body_required", detail: "返信の内容を入力してください" }, 400);
    }
    const message = await prisma.partnerMessage.create({
      data: {
        targetId: target.id,
        direction: "inbound",
        channel: "email",
        subject: typeof b.subject === "string" ? b.subject.trim() || null : null,
        body: b.body.trim(),
        status: "received",
      },
    });
    if (target.status !== "partner" && target.status !== "suppressed") {
      await prisma.partnerTarget.update({ where: { id: target.id }, data: { status: "replied" } });
    }
    return c.json({ message }, 201);
  });

  // 承認 (本文の手直しつき)。人が確認した印。
  app.post("/api/admin/partners/messages/:id/approve", async (c) => {
    const msg = await prisma.partnerMessage.findFirst({
      where: { id: c.req.param("id"), direction: "outbound" },
    });
    if (!msg) return c.json({ error: "not_found" }, 404);
    if (msg.status === "sent") return c.json({ error: "already_sent", detail: "すでに送信済みです" }, 409);
    const b = await c.req
      .json<{ subject?: string; body?: string }>()
      .catch(() => ({}) as { subject?: string; body?: string });
    const updated = await prisma.partnerMessage.update({
      where: { id: msg.id },
      data: {
        status: "approved",
        subject: typeof b.subject === "string" && b.subject.trim() ? b.subject.trim().slice(0, 150) : msg.subject,
        body: typeof b.body === "string" && b.body.trim() ? b.body.trim() : msg.body,
      },
    });
    return c.json({ message: updated });
  });

  // 送信 (人の明示操作 = 承認とみなす)。安全装置は performPartnerSend が担う。
  app.post("/api/admin/partners/messages/:id/send", async (c) => {
    const msg = await prisma.partnerMessage.findFirst({
      where: { id: c.req.param("id"), direction: "outbound" },
    });
    if (!msg) return c.json({ error: "not_found" }, 404);
    if (msg.status === "sent") return c.json({ error: "already_sent", detail: "すでに送信済みです" }, 409);
    const r = await performPartnerSend(msg.id);
    const ok = r.status === "sent" || r.status === "approved";
    return c.json(r, ok ? 200 : 422);
  });

  // 承認済みの一括送信 (Actions cron から)。送信基盤が整った後の保留分もここで流れる。
  app.post("/api/admin/partners/process-queue", async (c) => {
    const batch = Math.min(50, Math.max(1, Number(c.req.query("batch")) || 10));
    const due = await prisma.partnerMessage.findMany({
      where: { status: "approved", direction: "outbound" },
      orderBy: { createdAt: "asc" },
      take: batch,
    });
    let sent = 0;
    let held = 0;
    let failed = 0;
    for (const m of due) {
      const r = await performPartnerSend(m.id);
      if (r.status === "sent") sent++;
      else if (r.status === "approved" || r.status === "rate_limited") held++;
      else failed++;
      if (r.status === "rate_limited") break; // 上限到達: 以降は次回に回す
    }
    return c.json({ picked: due.length, sent, held, failed });
  });

  // ---------------- Google 連携 (Calendar / Gmail / Drive → 人物データの受動収集) ----------------
  // 読み取り専用の最小権限 (Gmail はヘッダのみ)。refresh token は暗号化保存。
  // env (GOOGLE_OAUTH_CLIENT_ID/SECRET) 未設定なら「準備中」に縮退する。

  const googleRedirectUri = () =>
    process.env.GOOGLE_OAUTH_REDIRECT_URL ?? "http://localhost:8080/api/google/callback";
  const webBaseUrl = () => allowedOrigins[0] ?? "http://localhost:3000";

  // 1 ユーザーぶんの同期。Calendar 90日+30日 / Gmail 送受信 各50通のヘッダ / Drive 共有50件。
  const runGoogleSync = async (
    ownerUid: string,
  ): Promise<
    | { ok: true; imported: number; skipped: number; interactionsAdded: number; people: number; sameName: string[] }
    | { ok: false; detail: string }
  > => {
    if (!google) return { ok: false, detail: "Google 連携は準備中です" };
    const conn = await prisma.googleConnection.findUnique({ where: { ownerUid } });
    if (!conn) return { ok: false, detail: "まだ Google とつながっていません" };
    const accessToken = await google.refreshAccessToken(conn.refreshToken);

    const now = Date.now();
    const timeMin = new Date(now - CALENDAR_LOOKBACK_DAYS * 86400_000).toISOString();
    const timeMax = new Date(now + CALENDAR_LOOKAHEAD_DAYS * 86400_000).toISOString();

    // Calendar
    const cal = (await google
      .apiGet(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&maxResults=250&fields=items(start,attendees)&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
        accessToken,
      )
      .catch(() => ({}))) as { items?: Array<{ start?: { date?: string; dateTime?: string }; attendees?: CalendarEvent["attendees"] }> };
    const calendarEvents: CalendarEvent[] = (cal.items ?? []).map((ev) => ({
      startDate: (ev.start?.dateTime ?? ev.start?.date ?? "").slice(0, 10) || undefined,
      attendees: ev.attendees,
    }));

    // Gmail (ヘッダのみ)。SENT = 自分が書いた相手 (強い信号)、INBOX = 受信相手。
    const gmailMessages: GmailHeaderMessage[] = [];
    for (const label of ["SENT", "INBOX"] as const) {
      const list = (await google
        .apiGet(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${GMAIL_MAX_MESSAGES}&labelIds=${label}`,
          accessToken,
        )
        .catch(() => ({}))) as { messages?: Array<{ id: string }> };
      for (const m of list.messages ?? []) {
        const detail = (await google
          .apiGet(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc`,
            accessToken,
          )
          .catch(() => null)) as {
          internalDate?: string;
          payload?: { headers?: Array<{ name: string; value: string }> };
        } | null;
        if (!detail) continue;
        const h = (name: string) =>
          detail.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value;
        gmailMessages.push({
          from: h("From"),
          to: h("To"),
          cc: h("Cc"),
          dateMs: detail.internalDate ? Number(detail.internalDate) : undefined,
          sent: label === "SENT",
        });
      }
    }

    // Drive (共有されているファイルの持ち主・最終更新者)
    const drive = (await google
      .apiGet(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("sharedWithMe=true")}&orderBy=modifiedTime%20desc&pageSize=${DRIVE_MAX_FILES}&fields=files(owners(displayName,emailAddress,me),lastModifyingUser(displayName,emailAddress,me))`,
        accessToken,
      )
      .catch(() => ({}))) as { files?: DriveFile[] };

    const collected = collectGooglePeople({
      selfEmails: conn.email ? [conn.email] : [],
      calendarEvents,
      gmailMessages,
      driveFiles: drive.files ?? [],
    });

    // 既存の連絡先とメールアドレスで突き合わせ、同一人物は既存のお名前に寄せる
    // (表記ゆれで二重登録しない。applyImport は同名スキップの冪等)。
    const existing = await prisma.contact.findMany({
      where: { ownerUid, state: "active" },
      select: { name: true, email: true },
      take: 500,
    });
    const emailToExisting = new Map(
      existing.filter((c2) => c2.email).map((c2) => [c2.email!.toLowerCase(), c2.name]),
    );
    for (const c2 of collected.contacts) {
      const known = c2.email ? emailToExisting.get(c2.email.toLowerCase()) : undefined;
      if (known && known !== c2.name) {
        for (const i of collected.interactions) if (i.name === c2.name) i.name = known;
        c2.name = known;
      }
    }

    const result = await applyImport(ownerUid, collected);
    const note = `連絡先${result.imported}件、やりとり${result.interactionsAdded}件を取り込み`;
    await prisma.googleConnection.update({
      where: { ownerUid },
      data: { lastSyncAt: new Date(), lastSyncNote: note },
    });
    return { ok: true, ...result, people: collected.contacts.length };
  };

  app.get("/api/google/status", async (c) => {
    if (!google) return c.json({ available: false, connected: false });
    const conn = await prisma.googleConnection.findUnique({
      where: { ownerUid: c.get("ownerUid") },
      select: { email: true, lastSyncAt: true, lastSyncNote: true },
    });
    return c.json({
      available: true,
      connected: !!conn,
      email: conn?.email ?? null,
      lastSyncAt: conn?.lastSyncAt ?? null,
      lastSyncNote: conn?.lastSyncNote ?? null,
    });
  });

  app.get("/api/google/auth-url", async (c) => {
    if (!google) {
      return c.json({ error: "unavailable", detail: "Google 連携は準備中です" }, 503);
    }
    const state = signState(c.get("ownerUid"), Math.floor(Date.now() / 1000) + 600);
    if (!state) {
      return c.json({ error: "unavailable", detail: "サーバの設定が未完了です" }, 503);
    }
    return c.json({ url: google.authUrl(state, googleRedirectUri()) });
  });

  // OAuth コールバック (未認証)。state の署名で「誰の接続か」を確かめてから保存する。
  app.get("/api/google/callback", async (c) => {
    const back = (q: string) => c.redirect(`${webBaseUrl()}/contacts?google=${q}`, 302);
    if (!google) return back("error");
    const ownerUid = verifyState(c.req.query("state"), Math.floor(Date.now() / 1000));
    const code = c.req.query("code");
    if (!ownerUid || !code) return back("error");
    try {
      const t = await google.exchangeCode(code, googleRedirectUri());
      const existing = await prisma.googleConnection.findUnique({ where: { ownerUid } });
      const refreshToken = t.refreshToken ?? existing?.refreshToken;
      if (!refreshToken) return back("error");
      await prisma.googleConnection.upsert({
        where: { ownerUid },
        create: { ownerUid, email: t.email, refreshToken, scopes: GOOGLE_SCOPES.join(" ") },
        update: { email: t.email ?? existing?.email, refreshToken, scopes: GOOGLE_SCOPES.join(" ") },
      });
      return back("connected");
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "google_callback_failed",
          detail: err instanceof Error ? err.message : String(err),
        }),
      );
      return back("error");
    }
  });

  app.post("/api/google/sync", async (c) => {
    try {
      const r = await runGoogleSync(c.get("ownerUid"));
      if (!r.ok) return c.json({ error: "unavailable", detail: r.detail }, 503);
      return c.json(r);
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "google_sync_failed",
          detail: err instanceof Error ? err.message : String(err),
        }),
      );
      return c.json(
        { error: "sync_failed", detail: "いまは取り込めませんでした。しばらくしてからお試しください" },
        502,
      );
    }
  });

  // 毎時 sweep 用: つながっている人を古い順に少しずつ同期 (受動収集)
  app.post("/api/admin/google/sync-all", async (c) => {
    if (!google) return c.json({ picked: 0, synced: 0, failed: 0, note: "not_configured" });
    const batch = Math.min(20, Math.max(1, Number(c.req.query("batch")) || 5));
    const conns = await prisma.googleConnection.findMany({
      orderBy: [{ lastSyncAt: { sort: "asc", nulls: "first" } }],
      take: batch,
      select: { ownerUid: true },
    });
    let synced = 0;
    let failed = 0;
    for (const conn of conns) {
      try {
        const r = await runGoogleSync(conn.ownerUid);
        if (r.ok) synced++;
        else failed++;
      } catch {
        failed++;
      }
    }
    return c.json({ picked: conns.length, synced, failed });
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
