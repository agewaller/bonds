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
import { parseContacts } from "./lib/contact-parsers.js";
import { parseIsoIntervals, meetingSlotProposals, toIso } from "./lib/timeslots.js";
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

export type AppDeps = {
  prisma: ExtendedPrismaClient;
  generate?: GenerateFn | null;
  mailer?: MailerFn | null;
};

const SUBJECT_TYPES = ["politician", "executive", "other"] as const;

export function createApp(deps: AppDeps) {
  const { prisma } = deps;
  // generate 未注入なら env 鍵から構築 (鍵なしなら null = 実行系は 503)
  const generate = deps.generate !== undefined ? deps.generate : buildAnthropicGenerate();
  // mailer も同様 (SENDGRID_API_KEY / OUTREACH_FROM_EMAIL 未設定なら送信は 503)
  const mailer = deps.mailer !== undefined ? deps.mailer : buildSendGridMailer();

  const app = new Hono();

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

  // 管理ガード: 書き込み・実行・管理系は x-admin-token 必須 (fail closed)。
  // フェーズ5 で cares の三段フェイルセーフ (custom claim / OWNER×password / token) に拡張する。
  const requireAdmin = async (c: Context, next: Next) => {
    const expected = process.env.ADMIN_BREAKGLASS_TOKEN;
    if (!expected) {
      return c.json({ error: "unavailable", detail: "管理トークンが未設定です" }, 503);
    }
    if (c.req.header("x-admin-token") !== expected) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
  app.use("/api/admin/*", requireAdmin);
  app.post("/api/dd/*", requireAdmin);
  app.put("/api/dd/*", requireAdmin);
  app.delete("/api/dd/*", requireAdmin);
  // 連絡先は PII (復号して返す) のため読み取りも含めて全メソッドをガードする。
  // ブラウザは BFF プロキシ経由 (トークンは web サーバ側にのみ存在)。
  app.use("/api/contacts/*", requireAdmin);
  app.use("/api/contacts", requireAdmin);
  app.use("/api/relationship/*", requireAdmin);
  app.use("/api/outreach/*", requireAdmin);
  app.use("/api/outreach", requireAdmin);

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
        latestScores: scoreMap.get(s.id) ?? {},
        createdAt: s.createdAt,
      })),
    });
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
            { prisma, generate: generate!, onEvent },
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

  const OWNER = "owner";

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
      where: { ownerUid: OWNER, state: "active" },
      orderBy: [{ distance: "asc" }, { name: "asc" }],
      take: 500,
    });
    return c.json({ contacts });
  });

  app.post("/api/contacts", async (c) => {
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const name = clampName(b.name);
    if (!name) return c.json({ error: "name_required", detail: "お名前を入力してください" }, 400);
    const created = await prisma.contact.create({
      data: { ownerUid: OWNER, name, source: "manual", ...contactData(b) },
    });
    return c.json({ contact: created }, 201);
  });

  app.get("/api/contacts/export", async (c) => {
    // データ主権: 全件エクスポート (復号済み JSON)。ロックインしない。
    const [contacts, interactions, gifts] = await Promise.all([
      prisma.contact.findMany({ where: { ownerUid: OWNER } }),
      prisma.contactInteraction.findMany(),
      prisma.contactGift.findMany(),
    ]);
    c.header("Content-Disposition", "attachment; filename=bonds-contacts-export.json");
    return c.json({ exportedAt: new Date().toISOString(), contacts, interactions, gifts });
  });

  app.get("/api/contacts/:id", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: OWNER },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    // 暗号化列は親 include で復号フックが漏れるケースがあるため直接クエリで読む (cares の教訓)
    const [interactions, gifts] = await Promise.all([
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
    ]);
    return c.json({ contact, interactions, gifts });
  });

  app.put("/api/contacts/:id", async (c) => {
    const exists = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: OWNER },
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
      where: { id: c.req.param("id"), ownerUid: OWNER },
    });
    if (!exists) return c.json({ error: "not_found" }, 404);
    await prisma.contact.update({ where: { id: exists.id }, data: { state: "archived" } });
    return c.json({ ok: true });
  });

  // 取込 (CSV / vCard / auto)。取り込み件数とスキップ件数を返す。
  app.post("/api/contacts/import", async (c) => {
    const b = await c.req
      .json<{ content?: string; format?: string }>()
      .catch(() => ({}) as { content?: string; format?: string });
    if (typeof b.content !== "string" || !b.content.trim()) {
      return c.json({ error: "content_required", detail: "取り込む内容がありません" }, 400);
    }
    const format = b.format === "csv" || b.format === "vcard" ? b.format : "auto";
    const rows = parseContacts(b.content, format);
    let imported = 0;
    for (const r of rows) {
      await prisma.contact.create({
        data: {
          ownerUid: OWNER,
          name: clampName(r.name),
          source: format === "auto" ? "import" : format,
          ...contactData(r as Record<string, unknown>),
        },
      });
      imported++;
    }
    return c.json({ imported, skipped: 0, parsed: rows.length });
  });

  // 接触記録 (連絡済み)。距離スコアの検証還流。
  app.post("/api/contacts/:id/interactions", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: OWNER },
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

  // つながりサマリ: 孤立スコア + 今日連絡してみませんか (lms 移植ロジック)
  app.get("/api/relationship/summary", async (c) => {
    const contacts = await prisma.contact.findMany({
      where: { ownerUid: OWNER, state: "active" },
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

  const saveBusy = async (contactId: string, raw: unknown) => {
    const busy = toIso(parseIsoIntervals(raw));
    await prisma.calendarLink.upsert({
      where: { ownerUid_contactId: { ownerUid: OWNER, contactId } },
      update: { busySlots: busy as never },
      create: { ownerUid: OWNER, contactId, provider: "manual", busySlots: busy as never },
    });
    return busy.length;
  };

  // 自分の busy 登録
  app.put("/api/relationship/my-busy", async (c) => {
    const b = await c.req.json<{ busySlots?: unknown }>().catch(() => ({}) as { busySlots?: unknown });
    const saved = await saveBusy(SELF_CALENDAR, b.busySlots);
    return c.json({ saved });
  });

  // 相手の busy 登録
  app.put("/api/contacts/:id/busy", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: OWNER },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    const b = await c.req.json<{ busySlots?: unknown }>().catch(() => ({}) as { busySlots?: unknown });
    const saved = await saveBusy(contact.id, b.busySlots);
    return c.json({ saved });
  });

  // 二者空き重なり → 面談候補 (busy → 各自の free → 積集合)
  app.get("/api/contacts/:id/meeting-slots", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: OWNER },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    const days = Math.min(30, Math.max(1, Number(c.req.query("days")) || 14));
    const [mine, theirs] = await Promise.all([
      prisma.calendarLink.findUnique({
        where: { ownerUid_contactId: { ownerUid: OWNER, contactId: SELF_CALENDAR } },
      }),
      prisma.calendarLink.findUnique({
        where: { ownerUid_contactId: { ownerUid: OWNER, contactId: contact.id } },
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
  const buildContactContext = async (contactId: string) => {
    const contact = await prisma.contact.findFirst({ where: { id: contactId, ownerUid: OWNER } });
    if (!contact) return null;
    const interactions = await prisma.contactInteraction.findMany({
      where: { contactId: contact.id },
      orderBy: { occurredAt: "desc" },
      take: 10,
    });
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
    const ctx = await buildContactContext(c.req.param("id"));
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

  // ---------------- 発信 (outreach) — フェーズ4 ----------------
  // 既定フロー: draft (複数候補生成) → approve (ユーザーが選択・編集して承認) → send。
  // 承認なしで送信はできない (CLAUDE.md 自律性の段階)。

  const OUTREACH_PURPOSES = ["keepup", "birthday", "thanks", "meeting", "contribution", "repair"] as const;

  app.post("/api/outreach/draft", async (c) => {
    const b = await c.req
      .json<{ contactId?: string; purpose?: string; points?: string; locale?: string }>()
      .catch(() => ({}) as Record<string, never>);
    if (!b.contactId) return c.json({ error: "contact_required" }, 400);
    const ctx = await buildContactContext(b.contactId);
    if (!ctx) return c.json({ error: "not_found" }, 404);
    const purpose = OUTREACH_PURPOSES.includes(b.purpose as never) ? b.purpose! : "keepup";
    const points = typeof b.points === "string" ? b.points.trim() : "";
    const userMessage = [
      "相手の情報:",
      ctx.context,
      "",
      `送る目的: ${purpose}`,
      points ? `伝えたいこと: ${points}` : "伝えたいこと: 特になし (関係を温めるひとことを)",
      `今日の日付: ${new Date().toISOString().slice(0, 10)}`,
    ].join("\n");
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
        ownerUid: OWNER,
        contactId: ctx.contact.id,
        channel: "email",
        purpose,
        status: "draft",
        candidates: JSON.stringify(validated.candidates),
      },
    });
    return c.json({ id: message.id, candidates: validated.candidates }, 201);
  });

  app.get("/api/outreach", async (c) => {
    const contactId = c.req.query("contactId");
    const messages = await prisma.outreachMessage.findMany({
      where: { ownerUid: OWNER, ...(contactId ? { contactId } : {}) },
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
      where: { id: c.req.param("id"), ownerUid: OWNER },
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
      where: { id: c.req.param("id"), ownerUid: OWNER },
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
    const contact = await prisma.contact.findFirst({
      where: { id: m.contactId, ownerUid: OWNER },
    });
    if (!contact?.email) {
      return c.json({ error: "no_email", detail: "この方のメールアドレスが登録されていません" }, 400);
    }
    try {
      const sent = await mailer({ to: contact.email, subject: m.subject ?? "", body: m.body ?? "" });
      const updated = await prisma.outreachMessage.update({
        where: { id: m.id },
        data: { status: "sent", sentAt: new Date(), providerMessageId: sent.messageId },
      });
      await prisma.contactInteraction.create({
        data: { contactId: contact.id, type: "email", occurredAt: new Date(), notes: m.subject },
      });
      return c.json({ message: { id: updated.id, status: updated.status, sentAt: updated.sentAt } });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await prisma.outreachMessage.update({
        where: { id: m.id },
        data: { status: "failed", errorDetail: detail },
      });
      return c.json({ error: "send_failed", detail: "送信できませんでした。しばらくしてからお試しください" }, 502);
    }
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
