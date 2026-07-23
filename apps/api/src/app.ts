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
import { summarizeForHistory, buildPriorBlock } from "./lib/novelty.js";
import {
  clampName,
  slugify,
  ownerMonthlyCapJpy,
  PERSON_DD_MODEL_CONFIG_KEY,
  PERSON_DD_DEFAULT_MODEL_ID,
  AI_USER_CAP_CONFIG_KEY,
  AI_USER_CAP_DEFAULT_JPY,
  resolveUserCapJpy,
} from "./lib/person-eval.js";
import { canonicalizeModelId, isValidModelId, type ModelId } from "./lib/cost.js";
import { runPersonDd, getMonthlyCostJpy, getMonthlyCostJpyForUser, type DdRunEvent } from "./dd/runner.js";
import { normalizeLocale } from "./lib/locale.js";
import { clampScore } from "./lib/dd-spec.js";
import { clampDistance, calculateIsolationScore, todaySuggestions, suggestDistance, scoreRelationship } from "./lib/relationship.js";
import { nominateIntroPairs, type IntroPerson } from "./lib/introductions.js";
import { detectDrift } from "./lib/drift.js";
import { firstMoves, type OnboardPerson } from "./lib/onboarding.js";
import { pickGrowthContacts, type GrowthInput } from "./lib/growth.js";
import {
  renderTemplate,
  matchesSegment,
  emailHash,
  signUnsub,
  verifyUnsub,
  buildCampaignFooter,
  normalizeEmail,
  type Segment,
  type CampaignContact,
} from "./lib/campaigns.js";
import {
  findTextAttachments,
  decodeGmailData,
  headerValue,
  validatePlaudDigest,
  transcriptHash,
  type GmailPart,
  type PlaudTask,
} from "./lib/plaud.js";
import { recentMeetings, pickDailyQuestion, type DailyPerson } from "./lib/capture.js";
import { parseGoalField, serializeGoal, goalPlan, validateGoalInput, PURPOSE_LABEL } from "./lib/goals.js";
import { pickFocusContacts, type FocusInput } from "./lib/priority.js";
import { planCareActions, shouldSuggestAgain, type CarePlanInput } from "./lib/care.js";
import { contactMatches } from "./lib/search.js";
import { computeProgress } from "./lib/progress.js";
import { parseContacts, parseImportText, stripHonorific, type ParsedContact, type ParsedInteraction } from "./lib/contact-parsers.js";
import { parseNewcomerLines, normalizeEventDate, decorateWithEvent, type NewcomerEvent } from "./lib/newcomers.js";
import { normalizeActionKind, sortActionItems, ACTION_KIND_LABEL } from "./lib/actions.js";
import { pickUnreachableTargets, findBridges, isReachable, type ReachPerson } from "./lib/reachability.js";
import { identityKeys, normalizeName } from "./lib/identity.js";
import { parseImportFile, MAX_IMPORT_FILE_BYTES } from "./lib/import-file.js";
import { computeGiftOccasions, summarizeGiftLedger } from "./lib/gifts.js";
import {
  summarizeExchangeLedger,
  computeExchangeReminders,
  hashExchangeCore,
  verifyExchangeChain,
  type ExchangeCore,
} from "./lib/exchanges.js";
import { parseIsoIntervals, freeSlots, intersectSlots, formatFreeSlotText, toIso, type Interval } from "./lib/timeslots.js";
import {
  defaultAvailability,
  parseAvailability,
  availabilityToJson,
  freeIntervalsByAvailability,
  freeIntervalsWithExplicitSlots,
  fullDayAvailability,
  startOptions,
  filterValidCandidates,
  intervalsToIso,
  parseOfferWindow,
  restrictToOfferWindow,
  type Availability,
} from "./lib/availability.js";
import {
  hashSharePassword,
  verifySharePassword,
  shareProof,
  verifyShareProof,
  parseShareInput,
  parseProposalInput,
  shareIsVisible,
  SHARE_METHOD_LABEL,
  type ShareMethod,
} from "./lib/schedule-share.js";
import { safeFetchText } from "./lib/safe-fetch.js";
import { RateLimiter, clientKey } from "./lib/rate-limit.js";
import {
  parseOfferInput,
  buildStripeClient,
  bookingHoldsSlot,
  PENDING_BOOKING_TTL_MS,
  MAX_PENDING_BOOKINGS_PER_OFFER,
  type StripeClient,
} from "./lib/time-offers.js";
import {
  parseSnsField,
  serializeSnsEntries,
  snsSearchQueries,
  snsPlatformLabel,
  extractSnsCandidates,
  parseSnsCandidates,
  type SnsEntry,
} from "./lib/sns.js";
import { searchByAxis, looksLikePublicFigure, AXES, AXIS_LABEL, type Axis, type AxisInput } from "./lib/axes.js";
import {
  parseOfferingInput,
  parseOfferingsBulk,
  matchOfferingToContacts,
  OFFERING_KINDS,
  OFFERING_KIND_LABEL,
  LOGISTICS_OPTIONS,
  type OfferingLike,
  type ContactNeed,
} from "./lib/offerings.js";
import { randomUUID, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import {
  SHARE_STATUSES,
  normalizeKind,
  normalizeDirection,
  canTransition,
  initialStatus,
  counterpartTargetStatus,
  canCounterpartRespond,
  shareEligibility,
  type ShareStatus,
  type CounterpartResponse,
} from "./lib/sharing.js";
import { normalizeProduct, normalizeEmail as normalizeFromAddress, matchByEmail } from "./lib/integration.js";
import { parseIcsBusy, parseIcsEvents, looksLikeIcs, buildMeetingInviteIcs, type IsoEvent } from "./lib/ics.js";
import {
  buildMailer,
  validateOutreachCandidates,
  OUTREACH_JSON_INSTRUCTION,
  type MailerFn,
} from "./lib/mailer.js";
import { getPromptText } from "./dd/runner.js";
import { jsonProseLanguageDirective } from "./lib/locale.js";
import { extractJson } from "./lib/dd-spec.js";
import { calcCostJpy } from "./lib/cost.js";
import { PERSON_DD_MAX_TOKENS, PERSON_DD_TIMEOUT_MS } from "./lib/person-eval.js";
import { authorizeAdmin, authorizeUser, ownerBucket, secretEquals, type VerifyIdTokenFn } from "./lib/auth.js";
import { buildTavilySearch, type SearchFn, type SearchResult } from "./lib/tavily.js";
import { sanitizeProse } from "./lib/plain-text.js";
import {
  IDENTIFY_SYSTEM_PROMPT,
  IDENTIFY_MAX_TOKENS,
  IDENTIFY_TIMEOUT_MS,
  buildIdentifyUserMessage,
  parseIdentifyCandidates,
  clampProfileHint,
  identifyQueries,
  buildIdentifyDigest,
  type IdentifyCandidate,
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
  parseGoogleConnections,
  signState,
  verifyState,
  GOOGLE_SCOPES_BASE,
  GOOGLE_SCOPES_EXTENDED,
  GOOGLE_SCOPES_MAIL_READ,
  GOOGLE_SCOPES_GUEST,
  hasExtendedScopes,
  hasMailReadScope,
  GMAIL_MAX_MESSAGES,
  DRIVE_MAX_FILES,
  CONTACTS_MAX,
  CALENDAR_LOOKBACK_DAYS,
  CALENDAR_LOOKAHEAD_DAYS,
  type GoogleClient,
  type CalendarEvent,
  type GmailHeaderMessage,
  type DriveFile,
} from "./lib/google.js";
import {
  buildDeviceClient,
  signDeviceState,
  verifyDeviceState,
  isDeviceProvider,
  DEVICE_PROVIDERS,
  type DeviceClient,
  type DeviceProvider,
} from "./lib/devices.js";

export type AppDeps = {
  prisma: ExtendedPrismaClient;
  generate?: GenerateFn | null;
  mailer?: MailerFn | null;
  verifyIdToken?: VerifyIdTokenFn | null;
  fetchText?: ((url: string) => Promise<string>) | null;
  search?: SearchFn | null;
  google?: GoogleClient | null;
  stripe?: StripeClient | null;
  devices?: DeviceClient | null;
};

const SUBJECT_TYPES = ["politician", "executive", "other"] as const;


// 共有シークレットの定数時間比較 (受信 webhook 認証用)
function secretMatches(provided: string | undefined | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createApp(deps: AppDeps) {
  const { prisma } = deps;
  // generate 未注入なら env 鍵から構築 (鍵なしなら null = 実行系は 503)
  const generate = deps.generate !== undefined ? deps.generate : buildAnthropicGenerate();
  // mailer も同様 (SENDGRID_API_KEY / OUTREACH_FROM_EMAIL 未設定なら送信は 503)。
  // 鍵が re_ 始まりなら Resend、そうでなければ SendGrid に自動で振り分ける (cares と同じ鍵で可)。
  const mailer = deps.mailer !== undefined ? deps.mailer : buildMailer();
  // 人物DD の検索器 (TAVILY_API_KEY 無しなら null = 知識ベースモード)
  const ddSearch = deps.search !== undefined ? deps.search : buildTavilySearch();
  // Google 連携 (env 未設定なら null = 「準備中」に縮退)
  const google = deps.google !== undefined ? deps.google : buildGoogleClient();
  // Stripe (時間の出品の決済)。STRIPE_SECRET_KEY 未設定なら null = 有料出品は「準備中」に縮退
  const stripe = deps.stripe !== undefined ? deps.stripe : buildStripeClient();
  // デバイス連携 (Oura/Withings)。env 未設定のプロバイダは「準備中」に縮退
  const devices = deps.devices !== undefined ? deps.devices : buildDeviceClient();
  // ICS 購読 URL の取得器。既定は SSRF 対策つき (https のみ・内部IP拒否・リダイレクト手動
  // 再検証・サイズ上限・タイムアウト)。ゲストが指定できる公開経路からも呼ばれるため必須。
  const fetchText = deps.fetchText !== undefined ? deps.fetchText : (url: string) => safeFetchText(url);

  // 公開経路のレートリミッタ (未認証のスパム・総当り抑止。インメモリ・ベストエフォート)。
  // あいことば解錠は総当り対策で厳しめ、その他の書き込みは中庸に。
  const unlockLimiter = new RateLimiter(10, 5 * 60 * 1000); // 5 分に 10 回/IP
  const publicWriteLimiter = new RateLimiter(30, 5 * 60 * 1000); // 5 分に 30 回/IP
  const tooMany = (c: { json: (b: unknown, s: 429) => Response }) =>
    c.json({ error: "rate_limited", detail: "アクセスが集中しています。少し時間をおいてお試しください" }, 429);

  // ownerUid: 認可済みユーザーのデータスコープ (Firebase uid / break-glass は "owner")
  // isOwner: オーナー本人か (AI 月次上限をオーナーは無制限、それ以外は設定値で効かせる)
  const app = new Hono<{ Variables: { ownerUid: string; isOwner: boolean } }>();

  // 例外は必ず JSON で返す (本文なしの 500 を出さない = 画面で必ず理由が出せる)。
  // 原因はサーバログに残し、ユーザーには簡潔な文言を返す。
  app.onError((err, c) => {
    console.error(JSON.stringify({ event: "unhandled_error", path: c.req.path, detail: err instanceof Error ? err.message : String(err) }));
    return c.json(
      { error: "internal_error", detail: "処理中に問題が起きました。時間をおいてもう一度お試しください" },
      500,
    );
  });

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
    c.set("isOwner", result.isOwner);
    await next();
    auditWrite(c, result.actor);
  };

  app.use("/api/admin/*", requireAdmin);
  // 人物DD は管理系。GET も含めて全メソッドをガードする (被評価者の一覧・下書き評価・
  // 失敗した評価の内部エラー・AI の中間ステップを未認証に晒さない)。一般公開は
  // 完了済み・PII なしに絞った /api/public/subjects/:slug のみに通す。
  app.get("/api/dd/*", requireAdmin);
  app.post("/api/dd/*", requireAdmin);
  app.put("/api/dd/*", requireAdmin);
  app.delete("/api/dd/*", requireAdmin);
  // 連絡先は PII (復号して返す) のため読み取りも含めて全メソッドをガードする。
  // ブラウザは BFF プロキシ経由 (トークンは web サーバ側にのみ存在)。
  app.use("/api/contacts/*", requireUser);
  app.use("/api/contacts", requireUser);
  app.use("/api/relationship/*", requireUser);
  app.use("/api/outreach/*", requireUser);
  // シェア (時間・知恵・モノ) のオーナー操作。相手 (第三者) の公開応答 /api/share/:token
  // は別プレフィックス (単数) なので、この requireUser ガードには掛からない = 認証不要で開ける。
  app.use("/api/resources/*", requireUser);
  app.use("/api/resources", requireUser);
  app.use("/api/shares/*", requireUser);
  app.use("/api/shares", requireUser);
  app.use("/api/outreach", requireUser);
  app.use("/api/gifts/*", requireUser);
  app.use("/api/gifts", requireUser);
  app.use("/api/exchanges/*", requireUser);
  app.use("/api/exchanges", requireUser);
  app.use("/api/offerings/*", requireUser);
  app.use("/api/offerings", requireUser);
  // 一斉配信 (オーナー側)。配信停止だけは公開 (/api/public/unsubscribe/:token、HMAC 署名)
  app.use("/api/campaigns/*", requireUser);
  app.use("/api/campaigns", requireUser);
  app.use("/api/actions/*", requireUser);
  app.use("/api/actions", requireUser);
  // 日程調整・時間の出品 (オーナー側)。公開側は /api/public/schedule/* と /api/public/offers/*
  // で、shareKey / offerKey (推測不能な URL) がそのままスコープになるため認証を掛けない。
  app.use("/api/schedule/*", requireUser);
  // Google 連携: callback (OAuth リダイレクト受け) だけは未認証 (state 署名で本人性を担保)
  app.use("/api/google/status", requireUser);
  app.use("/api/google/auth-url", requireUser);
  app.use("/api/google/sync", requireUser);
  // デバイス連携 (Oura/Withings): callback だけは未認証 (state 署名で本人性を担保)
  app.use("/api/devices/status", requireUser);
  app.use("/api/devices/:provider/auth-url", requireUser);
  app.use("/api/devices/:provider/sync", requireUser);
  app.use("/api/devices/:provider/disconnect", requireUser);
  app.use("/api/health/*", requireUser);

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

  // ---------------- 管理: AI コスト上限 (あなた以外の利用者) ----------------
  // オーナー本人は無制限 (ownerMonthlyCapJpy)。それ以外の利用者に月次上限を設ける。
  // 0 = 上限なし、正の数 = その額 (円)、未設定 = 既定 AI_USER_CAP_DEFAULT_JPY。

  app.get("/api/admin/ai-cost-config", async (c) => {
    const row = await prisma.appConfig.findUnique({ where: { key: AI_USER_CAP_CONFIG_KEY } });
    const cap = resolveUserCapJpy(row?.value);
    return c.json({
      // 保存されている生の値 (未設定なら既定額を返して UI の初期表示に使う)
      userCapJpy: row?.value ?? String(AI_USER_CAP_DEFAULT_JPY),
      unlimited: !Number.isFinite(cap),
      isDefault: !row,
      defaultJpy: AI_USER_CAP_DEFAULT_JPY,
    });
  });

  app.put("/api/admin/ai-cost-config", async (c) => {
    const body = await c.req.json<{ userCapJpy?: string | number }>().catch(() => ({}) as { userCapJpy?: string });
    const raw = body.userCapJpy;
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      return c.json({ error: "value_required", detail: "上限額を入力してください (0 で無制限)" }, 400);
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      return c.json({ error: "invalid_value", detail: "0 以上の整数 (円) を入力してください" }, 400);
    }
    const value = String(n);
    await prisma.appConfig.upsert({
      where: { key: AI_USER_CAP_CONFIG_KEY },
      update: { value },
      create: { key: AI_USER_CAP_CONFIG_KEY, value },
    });
    return c.json({ userCapJpy: value, unlimited: n === 0 });
  });

  // 当月の利用状況 (オーナー全体 + 利用者ごと)。管理画面に見せてコストの透明性を保つ。
  app.get("/api/admin/ai-usage", async (c) => {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const grouped = await prisma.aiUsageLog.groupBy({
      by: ["ownerUid"],
      where: { createdAt: { gte: monthStart } },
      _sum: { costJpy: true },
    });
    const capRow = await prisma.appConfig.findUnique({ where: { key: AI_USER_CAP_CONFIG_KEY } });
    const userCap = resolveUserCapJpy(capRow?.value);
    const perUser = grouped
      .map((g) => ({ ownerUid: g.ownerUid ?? "(不明)", costJpy: g._sum.costJpy ?? 0 }))
      .sort((a, b) => b.costJpy - a.costJpy);
    const totalJpy = perUser.reduce((s, u) => s + u.costJpy, 0);
    return c.json({
      monthStart: monthStart.toISOString().slice(0, 10),
      totalJpy,
      ownerCapUnlimited: !Number.isFinite(ownerMonthlyCapJpy()),
      userCapJpy: Number.isFinite(userCap) ? userCap : 0,
      userCapUnlimited: !Number.isFinite(userCap),
      perUser,
    });
  });

  // ---------------- 管理: テスト・監査データの片づけ ----------------
  // 以前 e2e-audit を本番に対して走らせたため、監査用フィクスチャ (名前が「監査」で
  // 始まる連絡先・共有・出品・人物DD・提携先) が owner バケツに溜まった。実在のデータが
  // 「監査」で始まることはまず無いため、この接頭辞で正確に拾える。連絡先はアーカイブ
  // (元に戻せる)、その他は子ごと削除する。まず件数を見せ、確認して片づける。
  const AUDIT_PREFIX = "監査";
  const auditName = { startsWith: AUDIT_PREFIX };
  const findAuditData = async (ownerUid: string) => {
    const [contacts, subjects, shares, offers, partners] = await Promise.all([
      prisma.contact.findMany({ where: { ownerUid, state: "active", name: auditName }, select: { id: true, name: true } }),
      prisma.ddSubject.findMany({ where: { name: auditName }, select: { id: true, name: true } }),
      prisma.scheduleShare.findMany({
        where: { ownerUid, OR: [{ title: auditName }, { displayName: auditName }] },
        select: { id: true, title: true },
      }),
      prisma.timeOffer.findMany({ where: { ownerUid, title: auditName }, select: { id: true, title: true } }),
      prisma.partnerTarget.findMany({ where: { name: auditName }, select: { id: true, name: true } }),
    ]);
    return { contacts, subjects, shares, offers, partners };
  };

  app.get("/api/admin/audit-data", async (c) => {
    const d = await findAuditData(c.get("ownerUid"));
    const total = d.contacts.length + d.subjects.length + d.shares.length + d.offers.length + d.partners.length;
    const sample = [
      ...d.contacts.map((x) => x.name),
      ...d.subjects.map((x) => x.name),
      ...d.shares.map((x) => x.title),
      ...d.offers.map((x) => x.title),
      ...d.partners.map((x) => x.name),
    ].slice(0, 30);
    return c.json({
      total,
      contacts: d.contacts.length,
      subjects: d.subjects.length,
      shares: d.shares.length,
      offers: d.offers.length,
      partners: d.partners.length,
      sample,
    });
  });

  app.post("/api/admin/audit-data/purge", async (c) => {
    const owner = c.get("ownerUid");
    const d = await findAuditData(owner);
    // 連絡先はアーカイブ (30 日は元に戻せる)。その他は子ごと削除 (onDelete: Cascade)。
    if (d.contacts.length) {
      await prisma.contact.updateMany({ where: { id: { in: d.contacts.map((x) => x.id) } }, data: { state: "archived" } });
    }
    if (d.subjects.length) await prisma.ddSubject.deleteMany({ where: { id: { in: d.subjects.map((x) => x.id) } } });
    if (d.shares.length) await prisma.scheduleShare.deleteMany({ where: { id: { in: d.shares.map((x) => x.id) } } });
    if (d.offers.length) await prisma.timeOffer.deleteMany({ where: { id: { in: d.offers.map((x) => x.id) } } });
    if (d.partners.length) await prisma.partnerTarget.deleteMany({ where: { id: { in: d.partners.map((x) => x.id) } } });
    return c.json({
      archivedContacts: d.contacts.length,
      deletedSubjects: d.subjects.length,
      deletedShares: d.shares.length,
      deletedOffers: d.offers.length,
      deletedPartners: d.partners.length,
    });
  });

  // Stripe 決済の点検 (読み取り専用・鍵は出さない)。「支払いが機能しない」の切り分け用:
  // 本番の STRIPE_SECRET_KEY で Stripe の balance を叩き、鍵が有効か・mode(live/test)を返す。
  // 返すのは prefix (sk_live_ 等・秘密部分は含まない) と長さ・HTTP ステータスのみ。
  app.get("/api/admin/stripe-check", async (c) => {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return c.json({ configured: false, note: "STRIPE_SECRET_KEY 未設定 = 有料は準備中に縮退" });
    const prefix = key.slice(0, 8); // "sk_live_" / "sk_test_" / "unset" など。秘密部分は含まない
    const mode = key.startsWith("sk_live") ? "live" : key.startsWith("sk_test") ? "test" : "invalid_prefix";
    try {
      const r = await fetch("https://api.stripe.com/v1/balance", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15000),
      });
      const ok = r.ok;
      const detail = ok ? "" : (await r.text().catch(() => "")).slice(0, 300);
      return c.json({ configured: true, prefix, mode, keyLength: key.length, balanceStatus: r.status, ok, detail });
    } catch (e) {
      return c.json({ configured: true, prefix, mode, keyLength: key.length, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // メール送信の点検 (読み取り専用・鍵は出さない)。「送ろうとしたが失敗した」の切り分け用:
  // 設定の有無 (鍵・差出人)・プロバイダ判別・直近の失敗理由 (errorDetail) を返す。
  // ?probe=1 のときだけ OWNER_EMAIL 宛に実際に 1 通だけテスト送信し、生きた経路かを確かめる。
  app.get("/api/admin/mailer-status", async (c) => {
    const key = process.env.SENDGRID_API_KEY ?? "";
    const from = process.env.OUTREACH_FROM_EMAIL ?? "";
    const provider = key.startsWith("re_") ? "resend" : key && key !== "unset" ? "sendgrid" : "none";
    const recentFailures = await prisma.outreachMessage.findMany({
      where: { status: "failed" },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { id: true, channel: true, errorDetail: true, updatedAt: true },
    });
    let probe: { ok: boolean; detail?: string | null } | null = null;
    const ownerEmail = process.env.OWNER_EMAIL ?? "";
    if (c.req.query("probe") === "1" && mailer && ownerEmail) {
      try {
        const s = await mailer({
          to: ownerEmail,
          subject: "bonds 送信テスト",
          body: "bonds からの送信経路の点検メールです。届いていれば設定は生きています。",
        });
        probe = { ok: true, detail: s.messageId };
      } catch (e) {
        probe = { ok: false, detail: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
      }
    }
    return c.json({
      configured: !!mailer,
      provider,
      keyLooksSentinel: key === "" || key === "unset",
      keyLength: key.length,
      fromConfigured: !!from,
      fromDomain: from.includes("@") ? from.split("@")[1] : null,
      senderIdentity: process.env.OUTREACH_SENDER_IDENTITY ?? null,
      recentFailures: recentFailures.map((f) => ({
        id: f.id,
        channel: f.channel,
        errorDetail: (f.errorDetail ?? "").slice(0, 300),
        updatedAt: f.updatedAt,
      })),
      probe,
    });
  });

  // 録音メモ (Plaud) 取り込みの点検 (読み取り専用・オーナー専用)。パイプラインの
  // どの段で止まっているかを実測で返す: 連携→メール読み取り許可→Gmail 検索→添付の形式→保存済み件数。
  // 件名・差出人はオーナー自身の受信箱のもの (admin 認証必須)。添付は名前と種類だけで中身は読まない。
  app.get("/api/admin/plaud-status", async (c) => {
    const out: Record<string, unknown> = { googleConfigured: !!google };
    const memoCount = await prisma.voiceMemo.count();
    const latest = await prisma.voiceMemo.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true, subject: true } });
    out.memos = { count: memoCount, latestAt: latest?.createdAt ?? null };
    if (!google) return c.json(out);
    const conns = await prisma.googleConnection.findMany();
    out.connections = conns.map((x) => ({
      ownerUid: x.ownerUid,
      scopes: x.scopes,
      mailRead: hasMailReadScope(x.scopes),
    }));
    const conn = conns.find((x) => hasMailReadScope(x.scopes)) ?? conns[0];
    if (!conn) return c.json({ ...out, note: "google_not_connected" });
    if (!hasMailReadScope(conn.scopes)) return c.json({ ...out, note: "mailread_scope_missing" });
    try {
      // 検索 (q) は metadata スコープ同居トークンだと 403 のため、readonly だけに絞って取る
      const accessToken = await google.refreshAccessToken(conn.refreshToken, "https://www.googleapis.com/auth/gmail.readonly");
      const q = async (query: string) => {
        const r = (await google!.apiGet(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=${encodeURIComponent(query)}`,
          accessToken,
        )) as { messages?: Array<{ id: string }>; resultSizeEstimate?: number };
        return { count: (r.messages ?? []).length, ids: (r.messages ?? []).map((m) => m.id) };
      };
      const strict = await q("from:plaud has:attachment newer_than:90d");
      const broad = await q("from:plaud newer_than:90d");
      const domain = await q("from:plaud.ai newer_than:90d");
      out.gmail = { strictQuery: strict.count, fromPlaud: broad.count, fromPlaudAi: domain.count };
      // 直近のメールの形 (添付の名前と種類だけ) を最大 3 通ぶん
      const sampleIds = (strict.count > 0 ? strict.ids : broad.count > 0 ? broad.ids : domain.ids).slice(0, 3);
      const samples: Array<Record<string, unknown>> = [];
      for (const id of sampleIds) {
        const msg = (await google
          .apiGet(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, accessToken)
          .catch(() => null)) as { payload?: GmailPart & { headers?: Array<{ name?: string; value?: string }> } } | null;
        if (!msg?.payload) continue;
        const parts: Array<{ filename: string; mimeType: string }> = [];
        const walk = (p: GmailPart | undefined) => {
          if (!p) return;
          if ((p.filename ?? "").trim()) parts.push({ filename: p.filename!, mimeType: p.mimeType ?? "" });
          for (const ch of p.parts ?? []) walk(ch);
        };
        walk(msg.payload);
        samples.push({
          from: headerValue(msg.payload.headers, "From").slice(0, 80),
          subject: headerValue(msg.payload.headers, "Subject").slice(0, 80),
          attachments: parts,
          textAttachmentsFound: findTextAttachments(msg.payload).map((a) => a.filename),
        });
      }
      out.samples = samples;
    } catch (e) {
      out.gmailError = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    }
    return c.json(out);
  });

  // 公開情報の検索 (Tavily) と AI の設定状況の点検 (読み取り専用・秘密は返さない)。
  // ?probe=1 のときだけ実際に 1 回だけ検索して、鍵が本当に有効か (件数が返るか) を確かめる。
  app.get("/api/admin/search-status", async (c) => {
    const searchConfigured = !!ddSearch;
    let probe: number | null = null;
    let probeError: string | null = null;
    if (searchConfigured && ddSearch && c.req.query("probe") === "1") {
      try {
        probe = (await ddSearch("bonds Tavily 接続テスト")).length;
      } catch (e) {
        probeError = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      }
    }
    return c.json({ searchConfigured, aiConfigured: !!generate, probe, probeError });
  });

  // データ所在の診断 (読み取り専用・PII なし)。「ログインしたらデータが消えて見える」の
  // 切り分け用: 連絡先がどの ownerUid バケツに何件あるか (active/archived) を横断集計し、
  // いまの呼び出し元が一般ユーザーとしてどの ownerUid に解決されるかを併せて返す。
  // これで「データは別バケツに無事あり、着地先がずれている」ことを実測で確定できる。
  app.get("/api/admin/data-locator", async (c) => {
    const grouped = await prisma.contact.groupBy({
      by: ["ownerUid", "state"],
      _count: { _all: true },
    });
    const buckets: Record<string, { active: number; archived: number; other: number }> = {};
    for (const g of grouped) {
      const b = (buckets[g.ownerUid] ??= { active: 0, archived: 0, other: 0 });
      if (g.state === "active") b.active = g._count._all;
      else if (g.state === "archived") b.archived = g._count._all;
      else b.other += g._count._all;
    }
    // 呼び出し元が「一般ユーザーとして」どの ownerUid に解決されるか (= 連絡帳で見えるバケツ)。
    const who = await authorizeUser(
      { authorization: c.req.header("authorization"), adminToken: c.req.header("x-admin-token") },
      { verifyIdToken: deps.verifyIdToken ?? null },
    );
    return c.json({
      ownerEmailConfigured: !!(process.env.OWNER_EMAIL ?? "").trim(),
      callerResolvesTo: who.ok
        ? { ownerUid: who.ownerUid, isOwner: who.isOwner, actor: who.actor }
        : { error: who.error, detail: who.detail },
      contactBuckets: Object.entries(buckets)
        .map(([ownerUid, counts]) => ({ ownerUid, ...counts }))
        .sort((a, b) => b.active - a.active),
    });
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
  // 名前から公人候補を確認する共通ヘルパ (identify エンドポイントと dd-scan の共用)。
  const identifyPersonByName = async (
    name: string,
  ): Promise<{ ok: true; candidates: IdentifyCandidate[] } | { ok: false; status: 422 | 502 | 503 }> => {
    if (!generate) return { ok: false, status: 503 };
    const cost = await getMonthlyCostJpy(prisma);
    if (cost >= ownerMonthlyCapJpy()) return { ok: false, status: 422 };
    const model = await resolveModel();
    // Tavily があれば名前で検索し、同姓同名の別人と最新の肩書きを手がかりに与える
    // (LLM の知識だけだと別人を取りこぼす・古くなるため)。キー無しは従来どおり知識のみ。
    let searchDigest = "";
    if (ddSearch) {
      try {
        const batches = await Promise.all(identifyQueries(name).map((q) => ddSearch(q).catch(() => [])));
        const seen = new Set<string>();
        const items = batches.flat().filter((r) => r.url && !seen.has(r.url) && seen.add(r.url));
        searchDigest = buildIdentifyDigest(items);
      } catch {
        // 検索の失敗で確認全体を止めない (知識のみで続行)
      }
    }
    try {
      const gen = await generate({
        model,
        system: IDENTIFY_SYSTEM_PROMPT,
        userMessage: buildIdentifyUserMessage(name, searchDigest),
        maxTokens: IDENTIFY_MAX_TOKENS,
        timeoutMs: IDENTIFY_TIMEOUT_MS,
      });
      const canonical = canonicalizeModelId(gen.model) ?? model;
      await prisma.aiUsageLog.create({
        data: {
          ownerUid: "owner", // 人物DD は管理系 (requireAdmin = オーナー専用)
          provider: "anthropic",
          model: canonical,
          purpose: "person_dd_identify",
          inputTokens: gen.inputTokens,
          outputTokens: gen.outputTokens,
          costJpy: calcCostJpy(canonical, gen.inputTokens, gen.outputTokens),
        },
      });
      return { ok: true, candidates: parseIdentifyCandidates(gen.text) };
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "ai_error",
          purpose: "person_dd_identify",
          detail: err instanceof Error ? err.message : String(err),
        }),
      );
      return { ok: false, status: 502 };
    }
  };

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
    const r = await identifyPersonByName(name);
    if (!r.ok) {
      if (r.status === 422) return c.json({ error: "quota_exceeded", detail: "今月の評価枠は終了しました" }, 422);
      return c.json({ error: "ai_failed", detail: "候補の確認に失敗しました。名前のみで登録できます" }, 502);
    }
    return c.json({ name, candidates: r.candidates });
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

  // 評価履歴の削除 (1 回分の評価 = run 単位)。データ主権: 1 件単位で消せること。
  // cascade で紐づく steps も消える (schema onDelete: Cascade)。
  app.delete("/api/dd/subjects/:slug/runs/:runId", async (c) => {
    const subject = await prisma.ddSubject.findUnique({ where: { slug: c.req.param("slug") } });
    if (!subject) return c.json({ error: "not_found" }, 404);
    const run = await prisma.personDueDiligence.findFirst({
      where: { id: c.req.param("runId"), subjectId: subject.id },
      select: { id: true },
    });
    if (!run) return c.json({ error: "not_found" }, 404);
    await prisma.personDueDiligence.delete({ where: { id: run.id } });
    return c.json({ deleted: true });
  });

  // 人物ごと丸ごと削除 (その人の評価履歴もすべて消える)。
  // person_links は FK 制約が無いため明示的に消す (孤児レコードを残さない)。
  app.delete("/api/dd/subjects/:slug", async (c) => {
    const subject = await prisma.ddSubject.findUnique({ where: { slug: c.req.param("slug") } });
    if (!subject) return c.json({ error: "not_found" }, 404);
    await prisma.personLink.deleteMany({ where: { subjectId: subject.id } });
    await prisma.ddSubject.delete({ where: { id: subject.id } });
    return c.json({ deleted: true });
  });

  // 公開の評価結果 (共有リンク用・認証不要)。人物DD は公人評価のみで PII を含まないため
  // だれでも閲覧できる URL にしてよい。完了した評価だけを返し、未完了/失敗は出さない。
  // 完了した評価が一つも無ければ 404 (共有できる中身がない)。
  app.get("/api/public/subjects/:slug", async (c) => {
    const subject = await prisma.ddSubject.findUnique({ where: { slug: c.req.param("slug") } });
    if (!subject) return c.json({ error: "not_found" }, 404);
    const runs = await prisma.personDueDiligence.findMany({
      where: { subjectId: subject.id, status: "completed" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        ddType: true,
        status: true,
        moduleScore: true,
        confidenceScore: true,
        scores: true,
        createdAt: true,
      },
    });
    const latestByType: Record<string, (typeof runs)[number]> = {};
    for (const r of runs) if (!latestByType[r.ddType]) latestByType[r.ddType] = r;
    if (Object.keys(latestByType).length === 0) {
      return c.json({ error: "no_result", detail: "まだ共有できる評価がありません" }, 404);
    }
    return c.json({
      subject: { name: subject.name, subjectType: subject.subjectType, profileHint: subject.profileHint },
      latestByType,
    });
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
    if (cost >= ownerMonthlyCapJpy()) {
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
    anniversary: parseBirthday(b.anniversary),
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

  // 一覧 + 検索。q があれば全員を対象に、名前・ふりがな・ローマ字・メール・電話・
  // 会社・メモまで横断して探す (暗号化列は SQL で検索できないため、復号済みの行に
  // アプリ内で照合する)。q が無いときは従来どおり近しい順の一覧 (500 件まで)。
  app.get("/api/contacts", async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    // 取り込み元での絞り込み (例: source=line で LINE から迎えた方の一覧)。source は平文列
    const source = (c.req.query("source") ?? "").trim().slice(0, 30);
    if (source && !q) {
      const [contacts, total] = await Promise.all([
        prisma.contact.findMany({
          where: { ownerUid: c.get("ownerUid"), state: "active", source },
          orderBy: [{ createdAt: "desc" }, { name: "asc" }],
          take: 500,
        }),
        prisma.contact.count({ where: { ownerUid: c.get("ownerUid"), state: "active", source } }),
      ]);
      return c.json({ contacts, total });
    }
    if (q) {
      const all = await prisma.contact.findMany({
        where: { ownerUid: c.get("ownerUid"), state: "active" },
        orderBy: [{ distance: "asc" }, { name: "asc" }],
      });
      const contacts = all.filter((ct) => contactMatches(q, ct)).slice(0, 100);
      return c.json({ contacts, total: all.length });
    }
    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where: { ownerUid: c.get("ownerUid"), state: "active" },
        orderBy: [{ distance: "asc" }, { name: "asc" }],
        take: 500,
      }),
      prisma.contact.count({ where: { ownerUid: c.get("ownerUid"), state: "active" } }),
    ]);
    return c.json({ contacts, total });
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
    const ownerUid = c.get("ownerUid");
    const [contacts, interactions, gifts, exchanges, externalRefs, resources, shares, threads] = await Promise.all([
      prisma.contact.findMany({ where: { ownerUid } }),
      // interaction / gift は ownerUid 列を持たず、contact 経由でスコープする
      // (where を付け忘れると他ユーザーの記録が混ざる = テナント越境)。
      prisma.contactInteraction.findMany({ where: { contact: { ownerUid } } }),
      prisma.contactGift.findMany({ where: { contact: { ownerUid } } }),
      prisma.exchange.findMany({ where: { ownerUid } }),
      prisma.contactExternalRef.findMany({ where: { ownerUid } }),
      prisma.sharedResource.findMany({ where: { ownerUid } }),
      prisma.resourceShare.findMany({ where: { ownerUid } }),
      prisma.messageThread.findMany({ where: { ownerUid } }),
    ]);
    const messages = await prisma.message.findMany({ where: { threadId: { in: threads.map((t) => t.id) } } });
    c.header("Content-Disposition", "attachment; filename=bonds-contacts-export.json");
    return c.json({
      exportedAt: new Date().toISOString(),
      contacts, interactions, gifts, exchanges, externalRefs, resources, shares, threads, messages,
    });
  });

  // 名寄せ: 同じ人が二重に登録されていそうな組を検出する。メール/電話が一致する組は
  // 確度が高く、名前だけ一致する組は候補 (同姓同名の別人もいる)。まとめるかはユーザーが決める。
  // 注: /:id より前に定義する (でないと "duplicates" が :id として捕まる)。
  app.get("/api/contacts/duplicates", async (c) => {
    const ownerUid = c.get("ownerUid");
    const [rows, dismissals] = await Promise.all([
      prisma.contact.findMany({ where: { ownerUid, state: "active" }, orderBy: { createdAt: "asc" } }),
      prisma.suggestionDismissal.findMany({ where: { ownerUid, kind: "dupe" }, select: { key: true } }),
    ]);
    // 「別の方として扱う」で見送った組は二度と出さない。組の同一性は構成メンバーの
    // 並びに依らないよう、id を並べ替えてから短いハッシュにする (メンバーが増減すれば
    // 別の組として再確認を促す)。
    const dismissed = new Set(dismissals.map((d) => d.key));
    const groupKey = (ids: string[]) => {
      const joined = [...ids].sort().join(",");
      let h = 0x811c9dc5;
      for (let i = 0; i < joined.length; i++) {
        h ^= joined.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      return `g${(h >>> 0).toString(16)}_${ids.length}`;
    };
    type Row = (typeof rows)[number];
    const view = (e: Row) => ({
      id: e.id,
      name: e.name,
      company: e.company,
      email: e.email,
      phone: e.phone,
      distance: e.distance,
    });
    const groups: Array<{ key: string; reason: string; strong: boolean; members: ReturnType<typeof view>[] }> = [];
    const used = new Set<string>();
    const groupBy = (keyFn: (e: Row) => string | undefined, reason: string, strong: boolean) => {
      const m = new Map<string, Row[]>();
      for (const e of rows) {
        if (used.has(e.id)) continue;
        const k = keyFn(e);
        if (!k) continue;
        const list = m.get(k);
        if (list) list.push(e);
        else m.set(k, [e]);
      }
      for (const members of m.values()) {
        if (members.length < 2) continue;
        const key = groupKey(members.map((x) => x.id));
        members.forEach((x) => used.add(x.id));
        if (dismissed.has(key)) continue; // 別人として見送り済みは出さない
        groups.push({ key, reason, strong, members: members.map(view) });
      }
    };
    groupBy((e) => identityKeys(e).email, "メールアドレスが同じ", true);
    groupBy((e) => identityKeys(e).phone, "電話番号が同じ", true);
    groupBy((e) => normalizeName(e.name) || undefined, "お名前が同じ", false);
    return c.json({ groups });
  });

  // 取り込みの状況 (待機中・読み取り中・完了・失敗)。ページを離れても戻れば見える。
  // 注: /:id より前に定義する (でないと "import-jobs" が :id として捕まる)。
  app.get("/api/contacts/import-jobs", async (c) => {
    const ownerUid = c.get("ownerUid");
    const jobs = await prisma.importJob.findMany({
      where: { ownerUid },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        kind: true,
        filename: true,
        status: true,
        imported: true,
        enriched: true,
        interactionsAdded: true,
        skipped: true,
        detail: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const active = jobs.filter((j) => j.status === "queued" || j.status === "processing").length;
    return c.json({ jobs, active });
  });

  // 関係性スコア (距離感・深さ・ポテンシャル) を、この 1 人について算出する。
  // やりとり・贈り物・台帳 (貸し借り/貢献) の量と、論点整理 (facets)・相手ノートから
  // 「どれだけ把握できているか」「伸ばせる手がかりがどれだけあるか」を数える。純粋計算は
  // scoreRelationship に委ね、ここは DB からの信号集めに徹する。
  const computeRelationshipScore = async (
    contactId: string,
    contact: { distance: number; profileFacets: string | null; profileDigest: string | null },
  ) => {
    const [interactions, giftCount, exchanges] = await Promise.all([
      prisma.contactInteraction.findMany({ where: { contactId }, select: { occurredAt: true } }),
      prisma.contactGift.count({ where: { contactId } }),
      prisma.exchange.findMany({ where: { contactId }, select: { direction: true } }),
    ]);
    const days = new Set<string>();
    let first: number | null = null;
    let last: number | null = null;
    for (const it of interactions) {
      const t = it.occurredAt.getTime();
      days.add(it.occurredAt.toISOString().slice(0, 10));
      if (first === null || t < first) first = t;
      if (last === null || t > last) last = t;
    }
    const DAY = 86_400_000;
    const now = Date.now();
    let exchangeInbound = 0;
    let exchangeOutbound = 0;
    for (const e of exchanges) {
      if (e.direction === "inbound") exchangeInbound++;
      else exchangeOutbound++;
    }
    // 論点整理 (facets) から「把握度」と「伸ばせる手がかり」を数える。
    // 把握度 = 埋まっている観点の数 (相手ノートがあれば +1)。
    // 手がかり = 強み・目標・貢献余地の項目数 (これが伸ばす起点になる)。
    let understandingSignals = contact.profileDigest ? 1 : 0;
    let potentialSignals = 0;
    try {
      const f = contact.profileFacets ? (JSON.parse(contact.profileFacets) as Record<string, unknown>) : null;
      if (f) {
        for (const k of ["summary", "contact", "status", "work", "family", "health", "values"]) {
          if (typeof f[k] === "string" && (f[k] as string).trim()) understandingSignals++;
        }
        for (const k of ["concerns", "likes", "cautions"]) {
          if (Array.isArray(f[k]) && (f[k] as unknown[]).length) understandingSignals++;
        }
        for (const k of ["skills", "goals", "opportunities"]) {
          if (Array.isArray(f[k])) potentialSignals += Math.min(3, (f[k] as unknown[]).length);
        }
      }
    } catch {
      // facets が壊れていてもスコアは出す (把握度 0 のまま)
    }
    return scoreRelationship({
      interactionCount: interactions.length,
      distinctDays: days.size,
      daysSinceLast: last === null ? null : Math.floor((now - last) / DAY),
      spanDays: first !== null && last !== null ? Math.floor((last - first) / DAY) : 0,
      giftCount,
      exchangeInbound,
      exchangeOutbound,
      understandingSignals,
      potentialSignals,
    });
  };

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
    const relationshipScore = await computeRelationshipScore(contact.id, {
      distance: contact.distance,
      profileFacets: contact.profileFacets,
      profileDigest: contact.profileDigest,
    });
    // 関係の目標と、現状との差から出す接触ペース・次の一手
    const goal = parseGoalField(contact.goal);
    const lastContactDays =
      interactions.length > 0
        ? Math.floor((Date.now() - interactions[0]!.occurredAt.getTime()) / 86_400_000)
        : null;
    const plan = goal ? goalPlan(goal, { distance: contact.distance, lastContactDays }) : null;
    return c.json({ contact, interactions, gifts, linkedSubjects, relationshipScore, goal, goalPlan: plan });
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

  // 名寄せの実行: others を primary に統合する。子レコード (やりとり・贈り物・発信・公人リンク) を
  // 付け替え、空いている項目を補完し、プロフィール系は追記する。other はソフト削除 (元に戻せる)。
  // 同一人物のマージの実体 (手動マージと自動名寄せの共用)。
  // primary に空欄補完・メモ結合・子レコード付け替えを行い、others はアーカイブする。
  type ContactRow = NonNullable<Awaited<ReturnType<typeof prisma.contact.findFirst>>>;
  const mergeContactGroup = async (ownerUid: string, primary: ContactRow, others: ContactRow[]): Promise<number> => {
    const fill: Record<string, unknown> = {};
    const appendKeys = ["notes", "personalProfile", "valuesProfile", "socialPosition"] as const;
    const appended: Record<string, string[]> = { notes: [], personalProfile: [], valuesProfile: [], socialPosition: [] };
    const primLinks = new Set(
      (await prisma.personLink.findMany({ where: { ownerUid, contactId: primary.id }, select: { subjectId: true } })).map(
        (l) => l.subjectId,
      ),
    );
    let merged = 0;
    for (const o of others) {
      for (const f of ["furigana", "phone", "email", "address", "company", "title"] as const) {
        if (!primary[f] && !fill[f] && o[f]) fill[f] = o[f];
      }
      if (!primary.birthday && !fill.birthday && o.birthday) fill.birthday = o.birthday;
      if (!primary.anniversary && !fill.anniversary && o.anniversary) fill.anniversary = o.anniversary;
      for (const f of appendKeys) if (o[f]) appended[f]!.push(o[f] as string);
      // 子レコードの付け替え
      await prisma.contactInteraction.updateMany({ where: { contactId: o.id }, data: { contactId: primary.id } });
      await prisma.contactGift.updateMany({ where: { contactId: o.id }, data: { contactId: primary.id } });
      await prisma.exchange.updateMany({ where: { contactId: o.id }, data: { contactId: primary.id } });
      await prisma.outreachMessage.updateMany({ where: { contactId: o.id }, data: { contactId: primary.id } });
      // person_links は (ownerUid, contactId, subjectId) が一意。衝突する分は捨てる。
      const oLinks = await prisma.personLink.findMany({ where: { ownerUid, contactId: o.id } });
      for (const l of oLinks) {
        if (primLinks.has(l.subjectId)) await prisma.personLink.delete({ where: { id: l.id } });
        else {
          await prisma.personLink.update({ where: { id: l.id }, data: { contactId: primary.id } });
          primLinks.add(l.subjectId);
        }
      }
      await prisma.contact.update({ where: { id: o.id }, data: { state: "archived" } });
      merged++;
    }
    // 距離は最も近い (小さい) 値を採用
    const minDistance = Math.min(primary.distance, ...others.map((o) => o.distance));
    if (minDistance < primary.distance) fill.distance = minDistance;
    // くり返し登場のカウントは合算する (別々の取込で作られた = それだけ登場した)
    const mergedHits = others.reduce((n, o) => n + (o.sourceHits ?? 1), 0);
    if (mergedHits > 0) fill.sourceHits = { increment: mergedHits };
    // プロフィール系は primary の既存 + others を改行でつなぐ (重複はそのまま許容し上限で切る)
    for (const f of appendKeys) {
      if (appended[f]!.length === 0) continue;
      const base = primary[f] ? [primary[f] as string] : [];
      const fresh = appended[f]!.filter((v) => !base.some((x) => x.includes(v)));
      if (fresh.length === 0) continue;
      fill[f] = [...base, ...fresh].join("\n").slice(0, MAX_NOTES_CHARS);
    }
    if (Object.keys(fill).length > 0) await prisma.contact.update({ where: { id: primary.id }, data: fill });
    return merged;
  };

  app.post("/api/contacts/merge", async (c) => {
    const ownerUid = c.get("ownerUid");
    const b = await c.req
      .json<{ primaryId?: string; otherIds?: string[] }>()
      .catch(() => ({}) as { primaryId?: string; otherIds?: string[] });
    const primaryId = typeof b.primaryId === "string" ? b.primaryId : "";
    const otherIds = Array.isArray(b.otherIds)
      ? b.otherIds.filter((x): x is string => typeof x === "string" && x !== primaryId)
      : [];
    if (!primaryId || otherIds.length === 0) {
      return c.json({ error: "invalid", detail: "まとめる相手を選んでください" }, 400);
    }
    const primary = await prisma.contact.findFirst({ where: { id: primaryId, ownerUid, state: "active" } });
    if (!primary) return c.json({ error: "not_found" }, 404);
    const others = await prisma.contact.findMany({
      where: { id: { in: otherIds }, ownerUid, state: "active" },
    });
    if (others.length === 0) return c.json({ error: "not_found" }, 404);
    const merged = await mergeContactGroup(ownerUid, primary, others);
    return c.json({ merged, primaryId: primary.id });
  });

  // 名寄せの自動実行 (毎時 sweep から)。メール/電話が一致する「同じ人」だけを黙って
  // まとめる (ユーザーの手を煩わせない)。名前だけの一致は同姓同名の別人がいるため
  // 自動ではまとめず、従来どおり画面の提案に留める。残った側は情報が最も厚い記録。
  app.post("/api/admin/contacts/auto-merge", async (c) => {
    const batch = Math.min(Math.max(parseInt(c.req.query("batch") ?? "50", 10) || 50, 1), 200);
    const rows = await prisma.contact.findMany({ where: { state: "active" }, orderBy: { createdAt: "asc" } });
    // 情報の厚み (埋まっている項目数)。厚い方を残す
    const richness = (e: ContactRow): number =>
      ["furigana", "phone", "email", "address", "company", "title"].filter((f) => (e as Record<string, unknown>)[f]).length +
      (e.profileFacets ? 2 : 0) +
      (e.profileDigest ? 1 : 0) +
      (e.notes ? 1 : 0) +
      (e.goal ? 2 : 0);
    // ownerUid ごと・強いキー (メール/電話) ごとにまとめる
    const groups = new Map<string, ContactRow[]>();
    for (const e of rows) {
      const k = identityKeys(e);
      for (const key of [k.email && `e:${k.email}`, k.phone && `p:${k.phone}`]) {
        if (!key) continue;
        const gk = `${e.ownerUid} ${key}`;
        const list = groups.get(gk);
        if (list) list.push(e);
        else groups.set(gk, [e]);
      }
    }
    let mergedGroups = 0;
    let mergedContacts = 0;
    const consumed = new Set<string>();
    for (const members of groups.values()) {
      if (mergedGroups >= batch) break;
      const alive = members.filter((m) => !consumed.has(m.id));
      if (alive.length < 2) continue;
      const sorted = [...alive].sort(
        (a, b) => richness(b) - richness(a) || a.createdAt.getTime() - b.createdAt.getTime(),
      );
      const primary = sorted[0]!;
      const others = sorted.slice(1);
      mergedContacts += await mergeContactGroup(primary.ownerUid, primary, others);
      others.forEach((o) => consumed.add(o.id));
      mergedGroups++;
    }
    return c.json({ mergedGroups, mergedContacts });
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
    // 名寄せ: メール/電話は「同じ人」を強く示すので、名前が違っても既存に結合する
    // (表記ゆれや姓のみ登録での二重化を防ぐ)。名前だけの一致は従来どおり慎重に扱う
    // (同姓同名の別人がいるため自動結合しない)。
    type Row = (typeof existing)[number];
    const byEmail = new Map<string, Row>();
    const byPhone = new Map<string, Row>();
    for (const e of existing) {
      nameCount.set(e.name, (nameCount.get(e.name) ?? 0) + 1);
      const k = identityKeys(e);
      if (k.email && !byEmail.has(k.email)) byEmail.set(k.email, e);
      if (k.phone && !byPhone.has(k.phone)) byPhone.set(k.phone, e);
    }
    let imported = 0;
    let skipped = 0;
    let enriched = 0;
    const sameName = new Set<string>();
    // 大量取込 (Eight 名刺 CSV 等) で 1 行ずつ INSERT すると DB 往復が積み重なって遅い。
    // 新規は createMany で一括投入する。まだ DB に無い「保留中」の行はメモリ上で育て、
    // 既に DB にある行だけ UPDATE する (pending は id で見分ける)。
    const toCreate: Array<Record<string, unknown>> = [];
    const pending = new Set<string>();
    const pendingUpdates = new Map<string, Record<string, unknown>>(); // 既存 (永続) 行の後追い更新をまとめる
    // くり返し登場のカウント (優先リストの弱いシグナル)。新しい情報が無くても
    // 「また出てきた」こと自体が生活圏での接点の多さを示す。
    const hitCounts = new Map<string, number>();
    const countHit = (target: Row) => {
      if (pending.has(target.id)) {
        (target as unknown as { sourceHits?: number }).sourceHits =
          ((target as unknown as { sourceHits?: number }).sourceHits ?? 1) + 1;
      } else {
        hitCounts.set(target.id, (hitCounts.get(target.id) ?? 0) + 1);
      }
    };

    // 既存の相手に、空いている項目の補完とメモの書き足しだけ行う (上書きしない)。
    const enrichContact = (target: Row, r: ParsedContact): boolean => {
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
      if (Object.keys(fill).length === 0) return false;
      Object.assign(target, fill); // target は toCreate の実体 or existing の実体を指す (メモリ反映)
      if (pending.has(target.id)) {
        // まだ作成前 = createMany のデータをそのまま育てる (DB 往復なし)
      } else {
        // 永続済み = あとで 1 件ずつ更新 (fill をマージして最後にまとめて流す)
        pendingUpdates.set(target.id, { ...(pendingUpdates.get(target.id) ?? {}), ...fill });
      }
      const k = identityKeys(target);
      if (k.email) byEmail.set(k.email, target);
      if (k.phone) byPhone.set(k.phone, target);
      return true;
    };

    for (const r of parsed.contacts) {
      const name = clampName(r.name);
      if (!name) {
        skipped++;
        continue;
      }
      const rk = identityKeys(r);
      // 1) メール/電話が既存と一致 = 同一人物。名前が違っても結合する。
      const strong = (rk.email && byEmail.get(rk.email)) || (rk.phone && byPhone.get(rk.phone));
      if (strong) {
        countHit(strong);
        if (enrichContact(strong, r)) enriched++;
        else skipped++;
        byName.set(name, strong.id); // この名前で来た接触記録は結合先にひもづける
        continue;
      }
      // 2) 同名の既存 — 1 人だけなら育てる、複数なら別人の恐れがあるので sameName で知らせる。
      if (byName.has(name)) {
        sameName.add(name);
        if (nameCount.get(name) === 1) {
          const target = existing.find((e) => e.name === name);
          if (target) {
            countHit(target);
            if (enrichContact(target, r)) enriched++;
          }
        }
        skipped++;
        continue;
      }
      // 3) 新規作成 (id を先に採番し、実体を maps に載せてから一括投入する)。
      const id = randomUUID();
      const data: Record<string, unknown> = {
        id,
        ownerUid,
        name,
        source: r.source ?? "import",
        ...contactData(r as Record<string, unknown>),
      };
      toCreate.push(data);
      pending.add(id);
      const rowLike = data as unknown as Row; // id/name/平文フィールドを持つ (dedup と接触ひもづけに使う)
      byName.set(name, id);
      nameCount.set(name, 1);
      existing.push(rowLike);
      if (rk.email) byEmail.set(rk.email, rowLike);
      if (rk.phone) byPhone.set(rk.phone, rowLike);
      imported++;
    }
    // 一括投入 (暗号化は透過拡張が createMany の data 配列に効く)。
    if (toCreate.length > 0) await prisma.contact.createMany({ data: toCreate as never });
    // 既存行の補完はまとめて (件数は通常少ない)。
    for (const [id, data] of pendingUpdates) {
      await prisma.contact.update({ where: { id }, data: data as never });
    }
    // くり返し登場のカウントを反映 (補完の有無に関わらず数える)
    for (const [id, hits] of hitCounts) {
      await prisma.contact.update({ where: { id }, data: { sourceHits: { increment: hits } } });
    }

    let interactionsAdded = 0;
    const daysByContact = new Map<string, Set<string>>();
    const toCreateInteractions: Array<Record<string, unknown>> = [];
    for (const it of parsed.interactions) {
      const contactId = byName.get(clampName(it.name));
      if (!contactId) continue;
      if (!daysByContact.has(contactId)) {
        // 新規作成した相手 (pending) には既存の接触が無いので DB を引かない (往復削減)。
        if (pending.has(contactId)) {
          daysByContact.set(contactId, new Set());
        } else {
          const rows = await prisma.contactInteraction.findMany({
            where: { contactId },
            select: { occurredAt: true },
          });
          daysByContact.set(contactId, new Set(rows.map((r) => r.occurredAt.toISOString().slice(0, 10))));
        }
      }
      const seen = daysByContact.get(contactId)!;
      if (seen.has(it.occurredAt)) continue;
      toCreateInteractions.push({
        contactId,
        type: it.type,
        occurredAt: new Date(`${it.occurredAt}T12:00:00Z`),
        notes: typeof it.note === "string" && it.note.trim() ? it.note.trim().slice(0, 1000) : null,
      });
      seen.add(it.occurredAt);
      interactionsAdded++;
    }
    if (toCreateInteractions.length > 0) {
      await prisma.contactInteraction.createMany({ data: toCreateInteractions as never });
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

  // 取り込みの本処理 (同期ルートと、ページを離れても続くジョブ実行の両方から使う)。
  type ImportOutcome =
    | {
        ok: true;
        imported: number;
        enriched: number;
        interactionsAdded: number;
        skipped: number;
        sameName: string[];
        foundIn?: Array<{ file: string; contacts: number }>;
        aiPeople?: number;
        talkNotes?: number;
      }
    | { ok: false; status: 422 | 503 | 502; error: string; detail: string };

  // トーク履歴 (LINE/WhatsApp) の中身から相手の近況を整理し、取込に添える。
  // 接触日だけでなく「何が起きているか」を拾う (ユーザーが自分で持ち込んだ会話であり
  // web 検索はしない)。AI 未設定・失敗なら静かにスキップ = 取込自体は従来どおり通る。
  const TALK_DIGEST_INSTRUCTION =
    '出力は JSON オブジェクト 1 個だけ: {"note": "相手の近況の短い散文 (材料が無ければ空文字)"}';
  const applyTalkDigests = async (
    talks: Array<{ file: string; partner: string; text: string }>,
    contacts: ParsedContact[],
    locale: string,
    actor: AiActor,
  ): Promise<number> => {
    if (!generate || talks.length === 0) return 0;
    let added = 0;
    for (const talk of talks.slice(0, 5)) {
      const target = contacts.find((ct) => ct.name === talk.partner);
      if (!target) continue;
      const r = await runRelationshipAi(
        "talk_digest",
        TALK_DIGEST_INSTRUCTION,
        `トークのお相手: ${talk.partner}\nトーク履歴 (下ほど新しい):\n${talk.text}`,
        "talk_digest",
        locale,
        { actor },
      );
      if (!r.ok) {
        if (r.status === 422) break; // 月次キャップ到達: これ以上回さない
        continue;
      }
      const parsed = extractJson(r.text) as { note?: unknown } | null;
      const note = sanitizeProse(typeof parsed?.note === "string" ? parsed.note : "")
        .trim()
        .slice(0, 1000);
      if (!note) continue;
      // applyImport が既存の方へは「まだ無いメモだけ書き足す」ので、再取込でも重複しにくい
      target.notes = target.notes ? `${target.notes}\n${note}` : note;
      added++;
    }
    return added;
  };

  const importPastedText = async (
    ownerUid: string,
    content: string,
    format: string,
    filename: string | undefined,
    locale: string,
    actor: AiActor,
    event?: NewcomerEvent, // イベント文脈 (どこで・いつ出会ったか) を添えて迎える
  ): Promise<ImportOutcome> => {
    const parsed =
      format === "csv" || format === "vcard"
        ? { contacts: parseContacts(content, format), interactions: [] as ParsedInteraction[] }
        : parseImportText(content, filename);
    let toApply = parsed;
    // 構造化パーサで 1 件も拾えないときは AI 抽出に回す (未知の列並び・姓/名分割・自由な名簿)。
    if (parsed.contacts.length === 0) {
      const r = await extractPeopleFromTexts([{ file: filename ?? "paste", kind: "text", text: content }], locale, actor);
      if (!r.ok) {
        const b = r.body as { error?: string; detail?: string };
        return { ok: false, status: r.status, error: b.error ?? "ai_failed", detail: b.detail ?? "取り込めませんでした" };
      }
      if (r.contacts.length === 0) {
        return {
          ok: false,
          status: 422,
          error: "no_contacts_found",
          detail: "この内容からはお名前を見つけられませんでした。氏名 (または姓と名) の列がある表や vCard、名簿の文面ならたいてい読み取れます",
        };
      }
      toApply = { contacts: r.contacts, interactions: r.interactions };
    }
    // 貼り付けがトーク履歴なら、中身から相手の近況も整理して添える
    const first = toApply.contacts[0];
    let talkNotes = 0;
    if (first && (first.source === "line" || first.source === "whatsapp")) {
      talkNotes = await applyTalkDigests(
        [{ file: filename ?? "paste", partner: first.name, text: content.slice(-15000) }],
        toApply.contacts,
        locale,
        actor,
      );
    }
    if (event) toApply = decorateWithEvent(toApply, event);
    const result = await applyImport(ownerUid, toApply);
    return {
      ok: true,
      imported: result.imported,
      enriched: result.enriched,
      interactionsAdded: result.interactionsAdded,
      skipped: result.skipped,
      sameName: result.sameName,
      talkNotes,
    };
  };

  const importFileBytes = async (
    ownerUid: string,
    bytes: Uint8Array,
    filename: string | undefined,
    locale: string,
    actor: AiActor,
    event?: NewcomerEvent, // 名刺写真などにもイベント文脈を添えられる
  ): Promise<ImportOutcome> => {
    const parsed = parseImportFile(bytes, filename);
    const aiContacts: ParsedContact[] = [];
    const aiInteractions: ParsedInteraction[] = [];
    let aiUnavailable = false;
    if (parsed.texts.length > 0) {
      const r = await extractPeopleFromTexts(parsed.texts, locale, actor);
      if (r.ok) {
        aiContacts.push(...r.contacts);
        aiInteractions.push(...r.interactions);
      } else aiUnavailable = true;
    }
    if (parsed.images.length > 0) {
      const r = await extractPeopleFromImages(parsed.images, locale, actor);
      if (r.ok) {
        aiContacts.push(...r.contacts);
        aiInteractions.push(...r.interactions);
      } else aiUnavailable = true;
    }
    let merged = {
      contacts: [...parsed.contacts, ...aiContacts],
      interactions: [...parsed.interactions, ...aiInteractions],
    };
    if (event && merged.contacts.length > 0) merged = decorateWithEvent(merged, event);
    // トーク履歴 (単体/ZIP 内) は中身から相手の近況も整理して添える
    const talkNotes = await applyTalkDigests(parsed.talks, merged.contacts, locale, actor);
    if (merged.contacts.length === 0) {
      if (aiUnavailable) {
        return {
          ok: false,
          status: 422,
          error: "extract_unavailable",
          detail: "内容は読めましたが、いまは人物の読み取りができません。しばらくしてからもう一度お試しください",
        };
      }
      return {
        ok: false,
        status: 422,
        error: "no_contacts_found",
        detail: "このファイルからは人物にまつわる情報を見つけられませんでした。名刺や名簿の写真、文字の入った書類 (Word・Excel・PDF・メール・テキスト・CSV・vCard・SNS のダウンロード ZIP など) ならたいてい読み取れます",
      };
    }
    const result = await applyImport(ownerUid, merged);
    return {
      ok: true,
      imported: result.imported,
      enriched: result.enriched,
      interactionsAdded: result.interactionsAdded,
      skipped: result.skipped,
      sameName: result.sameName,
      foundIn: parsed.foundIn,
      aiPeople: aiContacts.length,
      talkNotes,
    };
  };

  app.post("/api/contacts/import", async (c) => {
    const b = await c.req
      .json<{ content?: string; format?: string; filename?: string; locale?: string }>()
      .catch(() => ({}) as { content?: string; format?: string; filename?: string; locale?: string });
    if (typeof b.content !== "string" || !b.content.trim()) {
      return c.json({ error: "content_required", detail: "取り込む内容がありません" }, 400);
    }
    const format = b.format === "csv" || b.format === "vcard" ? b.format : "auto";
    const out = await importPastedText(
      c.get("ownerUid"),
      b.content,
      format,
      typeof b.filename === "string" ? b.filename : undefined,
      normalizeLocale(b.locale),
      actorOf(c),
    );
    if (!out.ok) return c.json({ error: out.error, detail: out.detail }, out.status);
    return c.json({
      imported: out.imported,
      enriched: out.enriched,
      interactionsAdded: out.interactionsAdded,
      skipped: out.skipped,
      sameName: out.sameName,
      talkNotes: out.talkNotes ?? 0,
    });
  });

  // パーティ・イベントで一気に増えた知り合い (ニューカマー) をまとめて迎える。
  // 1 行 1 人の貼り付け (名前と SNS の URL・メール・電話・会社・肩書きが混ざっていてよい) を
  // 軽量パーサ (AI 不要) で読む。既知の構造化形式 (CSV/vCard/SNS エクスポート等) なら
  // いつもの取込に、どちらでも読めなければ AI 抽出に落ちる。どの道でもイベント名と日付を
  // 「出会いの記録」(メモ + meeting の接触) として各人に添える。
  app.post("/api/contacts/newcomers", async (c) => {
    const b = await c.req
      .json<{ content?: string; eventName?: string; eventDate?: string; locale?: string }>()
      .catch(() => ({}) as { content?: string; eventName?: string; eventDate?: string; locale?: string });
    if (typeof b.content !== "string" || !b.content.trim()) {
      return c.json({ error: "content_required", detail: "取り込む内容がありません" }, 400);
    }
    const eventName = (typeof b.eventName === "string" ? b.eventName.trim() : "").slice(0, 100) || "イベント";
    const event: NewcomerEvent = { name: eventName, date: normalizeEventDate(b.eventDate) };
    const ownerUid = c.get("ownerUid");
    const structured = parseImportText(b.content);
    if (structured.contacts.length === 0) {
      const newcomers = parseNewcomerLines(b.content);
      if (newcomers.length > 0) {
        const result = await applyImport(
          ownerUid,
          decorateWithEvent({ contacts: newcomers, interactions: [] }, event),
        );
        return c.json({
          imported: result.imported,
          enriched: result.enriched,
          interactionsAdded: result.interactionsAdded,
          skipped: result.skipped,
          sameName: result.sameName,
          event,
        });
      }
    }
    const out = await importPastedText(ownerUid, b.content, "auto", undefined, normalizeLocale(b.locale), actorOf(c), event);
    if (!out.ok) return c.json({ error: out.error, detail: out.detail }, out.status);
    return c.json({
      imported: out.imported,
      enriched: out.enriched,
      interactionsAdded: out.interactionsAdded,
      skipped: out.skipped,
      sameName: out.sameName,
      talkNotes: out.talkNotes ?? 0,
      event,
    });
  });

  // Content-Length で早期に上限超過を弾く (全量をメモリに読み込む前に切る)。
  const declaredTooLarge = (c: { req: { header(n: string): string | undefined } }): boolean => {
    const len = Number(c.req.header("content-length"));
    return Number.isFinite(len) && len > MAX_IMPORT_FILE_BYTES;
  };

  // ファイル/ZIP まるごと取込 (同期)。中身は importFileBytes に委譲。
  app.post("/api/contacts/import-file", async (c) => {
    if (declaredTooLarge(c)) {
      return c.json({ error: "file_too_large", detail: "ファイルが大きすぎます (30MB まで)" }, 413);
    }
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
    const out = await importFileBytes(
      c.get("ownerUid"),
      new Uint8Array(buf),
      filename,
      normalizeLocale(c.req.query("locale")),
      actorOf(c),
    );
    if (!out.ok) return c.json({ error: out.error, detail: out.detail }, out.status);
    return c.json({
      imported: out.imported,
      enriched: out.enriched,
      interactionsAdded: out.interactionsAdded,
      skipped: out.skipped,
      sameName: out.sameName,
      foundIn: out.foundIn,
      aiPeople: out.aiPeople,
      talkNotes: out.talkNotes ?? 0,
    });
  });

  // ---- 取り込みジョブ (ページを離れても続く・状況を見せて安心してもらう) ----
  // ファイル/貼り付けをサーバに預けて queued にし、run で順に処理する。処理はサーバ側で
  // 進むため、ユーザーはページを離れても・他のことをしていても取り込みは続く。
  const MAX_JOB_PAYLOAD_CHARS = 45_000_000; // base64(30MB) ≒ 40MB の安全上限
  const MAX_QUEUED_JOBS = 300;

  // 1 件のジョブを処理する。updateMany で queued を奪って二重処理を防ぐ。
  // 停止した (processing のまま固まった) ジョブの扱い。Cloud Run のリクエストが処理の
  // 途中で打ち切られる (大きな CSV が AI 経路に落ちて timeout 等) と、queued→processing に
  // したまま done/error に到達せず「永久に読み取り中」になる。run と sweep は queued しか
  // 拾わないため回収されない。そこで古い processing を queued に戻して再挑戦し、
  // 何度も固まる不良ジョブは error として打ち切る (無限ループ防止)。
  const STALE_PROCESSING_MS = 3 * 60 * 1000;
  const MAX_IMPORT_ATTEMPTS = 3;
  const IMPORT_JOB_TIMEOUT_MS = 150_000; // 1 ジョブの処理上限 (Cloud Run 打ち切り前に自分で error にする)
  const reclaimStaleImportJobs = async (): Promise<void> => {
    const cutoff = new Date(Date.now() - STALE_PROCESSING_MS);
    // 上限に達したものは打ち切り
    await prisma.importJob.updateMany({
      where: { status: "processing", updatedAt: { lt: cutoff }, attempts: { gte: MAX_IMPORT_ATTEMPTS } },
      data: { status: "error", detail: "読み取りに時間がかかりすぎたため中断しました。ファイルを分けるか、もう一度お試しください", payload: "" },
    });
    // まだ挑戦できるものは queued に戻す
    await prisma.importJob.updateMany({
      where: { status: "processing", updatedAt: { lt: cutoff }, attempts: { lt: MAX_IMPORT_ATTEMPTS } },
      data: { status: "queued" },
    });
  };

  const processOneImportJob = async (jobId: string): Promise<boolean> => {
    const claimed = await prisma.importJob.updateMany({
      where: { id: jobId, status: "queued" },
      data: { status: "processing", attempts: { increment: 1 } },
    });
    if (claimed.count === 0) return false;
    const job = await prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job) return false;
    // 取り込みはオーナー運用のデータ取り込み。無制限 (isOwner) で回し、消費は本人に計上。
    const actor: AiActor = { ownerUid: job.ownerUid, isOwner: true };
    try {
      // 1 ジョブに時間の上限を設ける。これを超えたら「読み取り中」で固まる前に error にする
      // (Cloud Run にリクエストごと打ち切られると processing のまま孤児になるため、その前に自分で止める)。
      const event: NewcomerEvent | undefined = job.eventName
        ? { name: job.eventName, date: normalizeEventDate(job.eventDate) }
        : undefined;
      const work =
        job.kind === "text"
          ? importPastedText(job.ownerUid, job.payload, "auto", job.filename ?? undefined, job.locale, actor, event)
          : importFileBytes(
              job.ownerUid,
              new Uint8Array(Buffer.from(job.payload, "base64")),
              job.filename ?? undefined,
              job.locale,
              actor,
              event,
            );
      const out = await Promise.race([
        work,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("import_timeout")), IMPORT_JOB_TIMEOUT_MS),
        ),
      ]);
      if (out.ok) {
        await prisma.importJob.update({
          where: { id: job.id },
          data: {
            status: "done",
            imported: out.imported,
            enriched: out.enriched,
            interactionsAdded: out.interactionsAdded,
            skipped: out.skipped,
            detail: null,
            payload: "", // 済んだら本文は保持しない (容量とデータ最小化)
          },
        });
      } else {
        await prisma.importJob.update({
          where: { id: job.id },
          data: { status: "error", detail: out.detail.slice(0, 300), payload: "" },
        });
      }
      return true;
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const detail =
        raw === "import_timeout"
          ? "読み取りに時間がかかりすぎました。件数が多い場合はファイルを分けると入りやすくなります"
          : raw.slice(0, 300);
      await prisma.importJob.update({
        where: { id: job.id },
        data: { status: "error", detail, payload: "" },
      });
      return true;
    }
  };

  // ジョブ作成: テキスト (JSON {content}) か ファイル (raw bytes ?filename=)。
  app.post("/api/contacts/import-jobs", async (c) => {
    const ownerUid = c.get("ownerUid");
    const active = await prisma.importJob.count({ where: { ownerUid, status: { in: ["queued", "processing"] } } });
    if (active >= MAX_QUEUED_JOBS) {
      return c.json({ error: "too_many", detail: "取り込み待ちが多いため、少し待ってからお試しください" }, 429);
    }
    const ct = c.req.header("content-type") ?? "";
    let kind: string;
    let payload: string;
    let filename: string | null;
    let locale: string;
    // イベント文脈 (パーティ等での出会い)。ファイル経路は query、JSON 経路は body で受ける。
    let eventName: string | null = (c.req.query("eventName") ?? "").trim().slice(0, 100) || null;
    let eventDate: string | null = c.req.query("eventDate") ?? null;
    if (ct.includes("application/json")) {
      const b = await c.req
        .json<{ content?: string; locale?: string; filename?: string; eventName?: string; eventDate?: string }>()
        .catch(() => ({}) as { content?: string; locale?: string; filename?: string; eventName?: string; eventDate?: string });
      if (typeof b.content !== "string" || !b.content.trim()) {
        return c.json({ error: "content_required", detail: "取り込む内容がありません" }, 400);
      }
      kind = "text";
      payload = b.content;
      filename = typeof b.filename === "string" ? b.filename : null;
      locale = normalizeLocale(b.locale);
      if (typeof b.eventName === "string" && b.eventName.trim()) eventName = b.eventName.trim().slice(0, 100);
      if (typeof b.eventDate === "string") eventDate = b.eventDate;
    } else {
      if (declaredTooLarge(c)) {
        return c.json({ error: "file_too_large", detail: "ファイルが大きすぎます (30MBまで)" }, 413);
      }
      const buf = await c.req.arrayBuffer();
      if (buf.byteLength === 0) return c.json({ error: "content_required", detail: "ファイルが空です" }, 400);
      if (buf.byteLength > MAX_IMPORT_FILE_BYTES) {
        return c.json({ error: "file_too_large", detail: "ファイルが大きすぎます (30MBまで)" }, 413);
      }
      kind = "file";
      payload = Buffer.from(buf).toString("base64");
      filename = c.req.query("filename") ?? null;
      locale = normalizeLocale(c.req.query("locale"));
    }
    if (payload.length > MAX_JOB_PAYLOAD_CHARS) {
      return c.json({ error: "file_too_large", detail: "内容が大きすぎます" }, 413);
    }
    const job = await prisma.importJob.create({
      data: {
        ownerUid,
        kind,
        filename,
        payload,
        locale,
        status: "queued",
        eventName,
        eventDate: eventName ? normalizeEventDate(eventDate) : null,
      },
    });
    return c.json({ job: { id: job.id, kind, filename, status: job.status } }, 201);
  });

  // 待ち行列を処理する。サーバ側で進むのでクライアントが離れても続く (残りは sweep が拾う)。
  app.post("/api/contacts/import-jobs/run", async (c) => {
    const ownerUid = c.get("ownerUid");
    await reclaimStaleImportJobs(); // 固まった processing を先に回収する
    const jobs = await prisma.importJob.findMany({
      where: { ownerUid, status: "queued" },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: { id: true },
    });
    let processed = 0;
    for (const j of jobs) if (await processOneImportJob(j.id)) processed++;
    const remaining = await prisma.importJob.count({ where: { ownerUid, status: { in: ["queued", "processing"] } } });
    return c.json({ processed, remaining });
  });

  // 済んだ/失敗した表示を片付ける (状況パネルを消せるように)。
  app.post("/api/contacts/import-jobs/clear", async (c) => {
    const del = await prisma.importJob.deleteMany({
      where: { ownerUid: c.get("ownerUid"), status: { in: ["done", "error"] } },
    });
    return c.json({ cleared: del.count });
  });

  // 取り残された待ち行列を処理するバックストップ (毎時 sweep / スケジューラから admin で叩く)。
  // ユーザーがすべて閉じても、ここが拾って最後まで取り込む。
  app.post("/api/admin/contacts/process-import-jobs", async (c) => {
    const batch = Math.min(Math.max(parseInt(c.req.query("batch") ?? "20", 10) || 20, 1), 100);
    await reclaimStaleImportJobs(); // 固まった processing を先に回収する
    const jobs = await prisma.importJob.findMany({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      take: batch,
      select: { id: true },
    });
    let processed = 0;
    for (const j of jobs) if (await processOneImportJob(j.id)) processed++;
    return c.json({ processed });
  });

  // ZenTrack (音声文字起こしの日次インサイト) からの受け口 (server-to-server)。
  // 日々の文字起こしには「誰と会った・誰の近況」が詰まっているので、bonds の取込
  // パイプライン (会話から人物・近況・接触を抽出 → 関係グラフへ) に流して受動収集する。
  // 認証は ZenTrack 専用の共有シークレット (オーナーの管理トークンは渡さない)。
  // 未設定なら「準備中」に縮退 (fail closed)。bonds は単一オーナー運用なので owner に紐づく。
  app.post("/api/ingest/zentrack", async (c) => {
    const secret = process.env.ZENTRACK_INGEST_SECRET;
    if (!secret) return c.json({ error: "not_configured", detail: "ZenTrack 連携は準備中です" }, 503);
    if (!secretEquals(c.req.header("x-zentrack-secret"), secret)) return c.json({ error: "unauthorized" }, 401);
    const b = await c.req
      .json<{ transcript?: string; date?: string; label?: string }>()
      .catch(() => ({}) as { transcript?: string; date?: string; label?: string });
    const transcript = typeof b.transcript === "string" ? b.transcript.trim() : "";
    if (!transcript) return c.json({ error: "transcript_required", detail: "文字起こしがありません" }, 400);
    if (transcript.length > MAX_JOB_PAYLOAD_CHARS) {
      return c.json({ error: "too_large", detail: "内容が大きすぎます" }, 413);
    }
    const ownerUid = ownerBucket(); // webhook はユーザー識別を持たないためオーナーの正準バケツへ
    const date = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(b.date) ? b.date.slice(0, 10) : null;
    const label = typeof b.label === "string" ? b.label.trim().slice(0, 60) : "";
    // 日付を接地して、会った相手の接触記録をその日に寄せる (抽出プロンプトが日付を拾う)。
    const payload = date ? `日付: ${date}\n\n${transcript}` : transcript;
    const job = await prisma.importJob.create({
      data: {
        ownerUid,
        kind: "text",
        filename: `ZenTrack ${label || date || "音声メモ"}`.slice(0, 80),
        payload,
        locale: "ja",
        status: "queued",
      },
    });
    // すぐ処理する (会話抽出 → 関係グラフへ)。失敗しても毎時 sweep が拾い直す。
    try {
      await processOneImportJob(job.id);
    } catch {
      // sweep が再処理する
    }
    // 録音メモ (タスクと課題) にも取り込む。同じ文字起こしを Gmail 経由で既に
    // 読んでいれば二重にしない (正規化ハッシュで同一性を判定 = 経路またぎの冪等)。
    let memo: "created" | "duplicate" | "failed" = "failed";
    try {
      await backfillMemoHashes(ownerUid);
      const content = transcript.slice(0, 20000);
      const hash = transcriptHash(content);
      const existing = await prisma.voiceMemo.findFirst({
        where: { ownerUid, contentHash: hash },
        select: { id: true },
      });
      if (existing) {
        memo = "duplicate";
      } else {
        const d = await digestPlaudContent(ownerUid, content);
        await prisma.voiceMemo.create({
          data: {
            ownerUid,
            gmailMessageId: `zentrack:${hash.slice(0, 48)}`,
            source: "zentrack",
            contentHash: hash,
            subject: (label || (date ? `${date} の録音メモ` : "録音メモ")).slice(0, 200),
            receivedAt: date ? new Date(`${date}T12:00:00`) : new Date(),
            content,
            summary: d.summary,
            tasks: d.tasks ? JSON.stringify(d.tasks) : null,
          },
        });
        memo = "created";
      }
    } catch {
      // unique 競合 (同時着) や AI 失敗はここで止めない。取込ジョブ側は既に受理済み
      memo = "failed";
    }
    return c.json({ ok: true, jobId: job.id, memo }, 202);
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

  // 贈り物 (Gift): いま贈るとよい方・行事。誕生日・記念日・季節の贈答・未返礼を算出する。
  app.get("/api/gifts/occasions", async (c) => {
    const ownerUid = c.get("ownerUid");
    const contacts = await prisma.contact.findMany({
      where: { ownerUid, state: "active" },
      select: { id: true, name: true, birthday: true, anniversary: true, distance: true },
      take: 1000,
    });
    const gifts = await prisma.contactGift.findMany({
      where: { contact: { ownerUid } },
      select: { contactId: true, direction: true, occasion: true, givenAt: true },
    });
    const lookahead = clampScore(c.req.query("days"), 7, 120) ?? 45;
    const occasions = computeGiftOccasions({ contacts, gifts, today: new Date() }, Math.round(lookahead));
    return c.json({ occasions });
  });

  // 贈り物 (Gift): 贈答の履歴 (収支・お返し) の一覧。相手ごとの贈った/いただいたを集計する。
  app.get("/api/gifts", async (c) => {
    const ownerUid = c.get("ownerUid");
    const contacts = await prisma.contact.findMany({
      where: { ownerUid, state: "active" },
      select: { id: true, name: true },
      take: 1000,
    });
    const nameById = new Map(contacts.map((c2) => [c2.id, c2.name]));
    const gifts = await prisma.contactGift.findMany({
      where: { contact: { ownerUid } },
      orderBy: { givenAt: "desc" },
      take: 500,
    });
    const byContact = new Map<string, typeof gifts>();
    for (const g of gifts) {
      if (!byContact.has(g.contactId)) byContact.set(g.contactId, []);
      byContact.get(g.contactId)!.push(g);
    }
    const ledgers = [...byContact.entries()]
      .map(([contactId, recs]) => ({
        contactId,
        contactName: nameById.get(contactId) ?? "",
        ledger: summarizeGiftLedger(recs),
      }))
      .filter((l) => l.contactName)
      .sort((a, b) => Number(b.ledger.needsReturn) - Number(a.ledger.needsReturn));
    return c.json({ gifts, ledgers });
  });

  // やり取り台帳 (Gift を一般化)。贈与だけでなく貢献・貸し借り・取引・約束を、
  // 状態 (open/done/returned/canceled) と期日つきで記録する。改ざん検知のため
  // ハッシュチェーンで連ねる (ブロックチェーンは使わない = docs のオーナー判断)。
  const EXCHANGE_KINDS = ["gift", "favor", "loan", "deal", "promise", "other"];
  const EXCHANGE_STATUSES = ["open", "done", "returned", "canceled"];

  function exchangeCore(ownerUid: string, e: {
    contactId: string;
    kind: string;
    direction: string;
    title: string;
    value: number | null;
    occurredAt: Date;
  }): ExchangeCore {
    return {
      ownerUid,
      contactId: e.contactId,
      kind: e.kind,
      direction: e.direction,
      title: e.title,
      value: e.value,
      occurredAt: e.occurredAt.toISOString(),
    };
  }

  // 台帳の一覧 (相手ごとの収支・未完了) と、期日が近い/過ぎた督促。
  app.get("/api/exchanges", async (c) => {
    const ownerUid = c.get("ownerUid");
    const contacts = await prisma.contact.findMany({
      where: { ownerUid, state: "active" },
      select: { id: true, name: true },
      take: 1000,
    });
    const nameById = new Map(contacts.map((c2) => [c2.id, c2.name]));
    const exchanges = await prisma.exchange.findMany({
      where: { ownerUid },
      orderBy: { occurredAt: "desc" },
      take: 500,
    });
    const byContact = new Map<string, typeof exchanges>();
    for (const e of exchanges) {
      if (!byContact.has(e.contactId)) byContact.set(e.contactId, []);
      byContact.get(e.contactId)!.push(e);
    }
    const ledgers = [...byContact.entries()]
      .map(([contactId, recs]) => ({
        contactId,
        contactName: nameById.get(contactId) ?? "",
        ledger: summarizeExchangeLedger(
          contactId,
          recs.map((r) => ({ ...r, contactName: nameById.get(r.contactId) })),
        ),
      }))
      .filter((l) => l.contactName)
      .sort(
        (a, b) =>
          Number(b.ledger.needsReturn) - Number(a.ledger.needsReturn) ||
          b.ledger.openCount - a.ledger.openCount,
      );
    const reminders = computeExchangeReminders(
      exchanges.map((e) => ({ ...e, contactName: nameById.get(e.contactId) })),
      new Date(),
    );
    return c.json({ exchanges, ledgers, reminders });
  });

  // 台帳の改ざん検知。ハッシュチェーンを頭から検証し、intact / どこで切れたかを返す。
  app.get("/api/exchanges/verify", async (c) => {
    const ownerUid = c.get("ownerUid");
    const exchanges = await prisma.exchange.findMany({
      where: { ownerUid },
      orderBy: { createdAt: "asc" },
    });
    const result = verifyExchangeChain(
      exchanges.map((e) => ({
        ...exchangeCore(e.ownerUid, e),
        hash: e.hash,
        prevHash: e.prevHash,
      })),
    );
    return c.json({ ...result, count: exchanges.length });
  });

  // 相手ごとのやり取り一覧。
  app.get("/api/contacts/:id/exchanges", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    const exchanges = await prisma.exchange.findMany({
      where: { contactId: contact.id },
      orderBy: { occurredAt: "desc" },
    });
    const ledger = summarizeExchangeLedger(
      contact.id,
      exchanges.map((e) => ({ ...e, contactName: contact.name })),
    );
    return c.json({ exchanges, ledger });
  });

  // やり取りを記録する。ハッシュチェーンに連ね、接触としても還流する。
  app.post("/api/contacts/:id/exchanges", async (c) => {
    const ownerUid = c.get("ownerUid");
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const title = typeof b.title === "string" ? b.title.trim() : "";
    if (!title) return c.json({ error: "title_required", detail: "何のやり取りか (内容) を入力してください" }, 400);
    const kind = EXCHANGE_KINDS.includes(b.kind as string) ? (b.kind as string) : "gift";
    const direction = b.direction === "inbound" ? "inbound" : "outbound";
    const status = EXCHANGE_STATUSES.includes(b.status as string) ? (b.status as string) : "done";
    const valueRaw = clampScore(b.value, 0, 1_000_000_000);
    const value = valueRaw === null ? null : Math.round(valueRaw);
    const occurredAt =
      typeof b.occurredAt === "string" && !Number.isNaN(new Date(b.occurredAt).getTime())
        ? new Date(b.occurredAt)
        : new Date();
    const dueAt =
      typeof b.dueAt === "string" && !Number.isNaN(new Date(b.dueAt).getTime())
        ? new Date(b.dueAt)
        : null;
    // 直前レコードの hash を prevHash として連ねる (owner 単位の 1 本の鎖)。
    const last = await prisma.exchange.findFirst({
      where: { ownerUid, hash: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { hash: true },
    });
    const prevHash = last?.hash ?? null;
    const hash = hashExchangeCore(
      prevHash,
      exchangeCore(ownerUid, { contactId: contact.id, kind, direction, title, value, occurredAt }),
    );
    const exchange = await prisma.exchange.create({
      data: {
        ownerUid,
        contactId: contact.id,
        kind,
        direction,
        title,
        value,
        status,
        dueAt,
        occurredAt,
        notes: typeof b.notes === "string" ? b.notes.trim() || null : null,
        prevHash,
        hash,
      },
    });
    // 完了済みのやり取りは接触としても還流する (約束・貸し借りの open は接触にしない)。
    if (status === "done" || status === "returned") {
      await prisma.contactInteraction.create({
        data: {
          contactId: contact.id,
          type: direction === "outbound" ? "exchange_out" : "exchange_in",
          occurredAt,
          notes: title,
        },
      });
    }
    return c.json({ exchange }, 201);
  });

  // やり取りの更新 (主に状態・期日・メモ)。ハッシュ対象の中核は書き換えない設計だが、
  // 中核を変えたい場合は再計算してこの一件の hash を更新する (以降の鎖は次回検証で検出される)。
  app.put("/api/exchanges/:id", async (c) => {
    const ownerUid = c.get("ownerUid");
    const existing = await prisma.exchange.findFirst({
      where: { id: c.req.param("id"), ownerUid },
    });
    if (!existing) return c.json({ error: "not_found" }, 404);
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const data: Record<string, unknown> = {};
    if (typeof b.status === "string" && EXCHANGE_STATUSES.includes(b.status)) data.status = b.status;
    if (typeof b.notes === "string") data.notes = b.notes.trim() || null;
    if (b.dueAt === null) data.dueAt = null;
    else if (typeof b.dueAt === "string" && !Number.isNaN(new Date(b.dueAt).getTime())) data.dueAt = new Date(b.dueAt);
    if (typeof b.title === "string" && b.title.trim()) data.title = b.title.trim();
    if (b.value !== undefined) {
      const v = clampScore(b.value, 0, 1_000_000_000);
      data.value = v === null ? null : Math.round(v);
    }
    const exchange = await prisma.exchange.update({ where: { id: existing.id }, data });
    return c.json({ exchange });
  });

  app.delete("/api/exchanges/:id", async (c) => {
    const ownerUid = c.get("ownerUid");
    const existing = await prisma.exchange.findFirst({
      where: { id: c.req.param("id"), ownerUid },
    });
    if (!existing) return c.json({ error: "not_found" }, 404);
    await prisma.exchange.delete({ where: { id: existing.id } });
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

  // こじれ・疎遠の検知 (ミッション項目4)。やりとりの記録から「そっと気にかけたい関係」を
  // 見つける。断定せず気づきの提示に留め、修復の打ち手 (お便りの下書き) は連絡先詳細の
  // 発信フロー (purpose=repair) に委ねる。AI 不要 = 安く毎回出せる。
  app.get("/api/relationship/drift", async (c) => {
    const contacts = await prisma.contact.findMany({
      where: { ownerUid: c.get("ownerUid"), state: "active" },
      select: { id: true, name: true, distance: true, birthday: true },
    });
    if (contacts.length === 0) return c.json({ items: [] });
    const interactions = await prisma.contactInteraction.findMany({
      where: { contactId: { in: contacts.map((x) => x.id) } },
      select: { contactId: true, occurredAt: true, type: true },
    });
    const items = detectDrift(contacts, interactions).slice(0, 8);
    return c.json({ items });
  });

  // 新しく迎えた方への「はじめの一手」— 取り込んだきりの方から、動いたほうがよい方を
  // 理由つきで挙げる (AI 不要の純粋計算)。深い対応は連絡先詳細の「対応を考える」に委ねる。
  app.get("/api/relationship/first-moves", async (c) => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const contacts = await prisma.contact.findMany({
      where: { ownerUid: c.get("ownerUid"), state: "active", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    if (contacts.length === 0) return c.json({ moves: [] });
    const counts = await prisma.contactInteraction.groupBy({
      by: ["contactId"],
      where: { contactId: { in: contacts.map((x) => x.id) } },
      _count: { contactId: true },
    });
    const countBy = new Map(counts.map((x) => [x.contactId, x._count.contactId]));
    const people: OnboardPerson[] = contacts.map((ct) => {
      let facets: OnboardPerson["facets"] = null;
      if (ct.profileFacets) {
        try {
          const f = JSON.parse(ct.profileFacets) as Record<string, unknown>;
          facets = {
            work: typeof f.work === "string" && f.work.trim() ? f.work : undefined,
            goals: Array.isArray(f.goals) ? (f.goals as string[]) : [],
            opportunities: Array.isArray(f.opportunities) ? (f.opportunities as string[]) : [],
            concerns: Array.isArray(f.concerns) ? (f.concerns as string[]) : [],
          };
        } catch {
          // 壊れた facets は無視 (材料なし扱い)
        }
      }
      return {
        id: ct.id,
        name: ct.name,
        company: ct.company,
        title: ct.title,
        relationship: ct.relationship,
        source: ct.source,
        createdAt: ct.createdAt,
        hasEmail: !!ct.email,
        interactionCount: countBy.get(ct.id) ?? 0,
        facets,
      };
    });
    // 多めに返し、web 側が見送り (✖️) を除いて先頭 8 名を出す。見送っても次の方が繰り上がる
    return c.json({ moves: firstMoves(people, new Date(), 24) });
  });

  // 大切にしたい方々 — 取り込んだリストの大半は動かない名簿である前提で、実際の
  // やりとり・ユーザーの意思 (目標/距離/手入力)・記録の厚みから、関係を高める価値の
  // ありそうな方を選んで返す (AI 不要・毎回無料)。残りは消さずに静かに置いておく。
  // 優先リストの計算 (focus 表示と自動ケア sweep の共用)。
  const buildFocusPicks = async (ownerUid: string) => {
    const contacts = await prisma.contact.findMany({ where: { ownerUid, state: "active" } });
    const byId = new Map(contacts.map((x) => [x.id, x]));
    const inter = new Map<string, { count: number; lastAt: Date | null }>();
    if (contacts.length === 0) return { byId, inter, picks: [] as ReturnType<typeof pickFocusContacts>, total: 0 };
    const ids = contacts.map((x) => x.id);
    const [interactions, gifts, exchanges] = await Promise.all([
      prisma.contactInteraction.groupBy({
        by: ["contactId"],
        where: { contactId: { in: ids } },
        _count: { contactId: true },
        _max: { occurredAt: true },
      }),
      prisma.contactGift.groupBy({ by: ["contactId"], where: { contactId: { in: ids } }, _count: { contactId: true } }),
      prisma.exchange.groupBy({ by: ["contactId"], where: { contactId: { in: ids } }, _count: { contactId: true } }),
    ]);
    for (const x of interactions) inter.set(x.contactId, { count: x._count.contactId, lastAt: x._max.occurredAt });
    const giftBy = new Map(gifts.map((x) => [x.contactId, x._count.contactId]));
    const exBy = new Map(exchanges.map((x) => [x.contactId, x._count.contactId]));
    const now = Date.now();
    const people: FocusInput[] = contacts.map((ct) => {
      const it = inter.get(ct.id);
      const lastAt = it?.lastAt ?? null;
      return {
        id: ct.id,
        name: ct.name,
        company: ct.company,
        title: ct.title,
        hasEmail: !!ct.email,
        hasPhone: !!ct.phone,
        distance: ct.distance,
        source: ct.source,
        interactionCount: it?.count ?? 0,
        lastContactDays: lastAt ? Math.floor((now - lastAt.getTime()) / 86_400_000) : null,
        giftExchangeCount: (giftBy.get(ct.id) ?? 0) + (exBy.get(ct.id) ?? 0),
        hasFacets: !!ct.profileFacets,
        hasDigest: !!ct.profileDigest,
        hasGoal: !!ct.goal,
        sourceHits: ct.sourceHits,
        focusPreference: ct.focusPreference,
      };
    });
    return { byId, inter, picks: pickFocusContacts(people), total: contacts.length };
  };

  app.get("/api/relationship/focus", async (c) => {
    const { byId, picks, total } = await buildFocusPicks(c.get("ownerUid"));
    // 優先リストはユーザーがその場でカスタムできるよう、距離感・目標・意思も同梱する
    const items = picks.map((pick) => {
      const ct = byId.get(pick.contactId)!;
      const goal = parseGoalField(ct.goal);
      return {
        ...pick,
        distance: ct.distance,
        focusPreference: ct.focusPreference,
        goal: goal ? { purpose: goal.purpose, targetDistance: goal.targetDistance } : null,
      };
    });
    return c.json({ items, total });
  });

  // あなたへの提案 (優先度に基づく自動ケアの受け箱) — 一覧と、実行済み/見送りの記録
  app.get("/api/relationship/care-suggestions", async (c) => {
    const rows = await prisma.careSuggestion.findMany({
      where: { ownerUid: c.get("ownerUid"), status: "proposed" },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    const contacts = await prisma.contact.findMany({
      where: { id: { in: rows.map((r) => r.contactId) } },
      select: { id: true, name: true },
    });
    const nameBy = new Map(contacts.map((x) => [x.id, x.name]));
    return c.json({
      items: rows
        .filter((r) => nameBy.has(r.contactId))
        .map((r) => ({ id: r.id, contactId: r.contactId, name: nameBy.get(r.contactId), kind: r.kind, body: r.body, createdAt: r.createdAt })),
    });
  });

  app.post("/api/relationship/care-suggestions/:id/resolve", async (c) => {
    const row = await prisma.careSuggestion.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid"), status: "proposed" },
    });
    if (!row) return c.json({ error: "not_found" }, 404);
    const b = await c.req.json<{ status?: string }>().catch(() => ({}) as { status?: string });
    const status = b.status === "done" ? "done" : "dismissed";
    await prisma.careSuggestion.update({ where: { id: row.id }, data: { status } });
    return c.json({ status });
  });

  // ---- 実行待ち (受け入れた提案の在庫) ----
  // ホームの提案 (サービスの提供・時間調整・メール連絡・贈り物など) をユーザーが
  // 受け入れたら貯めておき、実際に動きやすい形で種類別に並べて返す。
  // source (kind+key) が付いていれば同じ提案の二重受け入れを防ぐ (冪等)。
  app.post("/api/actions", async (c) => {
    const ownerUid = c.get("ownerUid");
    const b = await c.req
      .json<{ kind?: string; contactId?: string; title?: string; note?: string; sourceKind?: string; sourceKey?: string }>()
      .catch(() => ({}) as Record<string, never>);
    const title = typeof b.title === "string" ? b.title.trim().slice(0, 200) : "";
    if (!title) return c.json({ error: "title_required", detail: "何をするかを書いてください" }, 400);
    const kind = normalizeActionKind(b.kind);
    let contactId: string | null = null;
    if (typeof b.contactId === "string" && b.contactId) {
      const ct = await prisma.contact.findFirst({ where: { id: b.contactId, ownerUid }, select: { id: true } });
      if (!ct) return c.json({ error: "contact_not_found" }, 404);
      contactId = ct.id;
    }
    const note = typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 500) : null;
    const sourceKind = typeof b.sourceKind === "string" && b.sourceKind.trim() ? b.sourceKind.trim().slice(0, 60) : null;
    const sourceKey = typeof b.sourceKey === "string" && b.sourceKey.trim() ? b.sourceKey.trim().slice(0, 200) : null;
    if (sourceKind && sourceKey) {
      const existing = await prisma.actionItem.findFirst({ where: { ownerUid, sourceKind, sourceKey } });
      if (existing) {
        // 済み/見送り後にもう一度受け入れたら pending に戻す。pending のままなら何もしない
        if (existing.status !== "pending") {
          await prisma.actionItem.update({ where: { id: existing.id }, data: { status: "pending", doneAt: null } });
        }
        return c.json({ action: { id: existing.id, status: "pending" }, already: existing.status === "pending" });
      }
    }
    const created = await prisma.actionItem.create({
      data: { ownerUid, contactId, kind, title, note, sourceKind, sourceKey },
    });
    return c.json({ action: { id: created.id, status: created.status } }, 201);
  });

  app.get("/api/actions", async (c) => {
    const ownerUid = c.get("ownerUid");
    const status = c.req.query("status") === "done" ? "done" : "pending";
    const rows = await prisma.actionItem.findMany({
      where: { ownerUid, status },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    const ids = [...new Set(rows.map((r) => r.contactId).filter((v): v is string => !!v))];
    const contacts = ids.length
      ? await prisma.contact.findMany({ where: { id: { in: ids }, ownerUid }, select: { id: true, name: true, email: true } })
      : [];
    const byId = new Map(contacts.map((ct) => [ct.id, ct]));
    const items = sortActionItems(rows).map((r) => ({
      id: r.id,
      kind: r.kind,
      kindLabel: ACTION_KIND_LABEL[normalizeActionKind(r.kind)],
      title: r.title,
      note: r.note,
      contactId: r.contactId,
      name: r.contactId ? (byId.get(r.contactId)?.name ?? null) : null,
      email: r.contactId ? (byId.get(r.contactId)?.email ?? null) : null,
      createdAt: r.createdAt,
    }));
    return c.json({ items });
  });

  // 済み/見送り/戻す (1 件単位)。記録そのものは消さない (削除は DELETE で明示的に)。
  app.put("/api/actions/:id", async (c) => {
    const ownerUid = c.get("ownerUid");
    const row = await prisma.actionItem.findFirst({ where: { id: c.req.param("id"), ownerUid } });
    if (!row) return c.json({ error: "not_found" }, 404);
    const b = await c.req.json<{ status?: string }>().catch(() => ({}) as { status?: string });
    const status = b.status === "done" ? "done" : b.status === "pending" ? "pending" : "dismissed";
    await prisma.actionItem.update({
      where: { id: row.id },
      data: { status, doneAt: status === "done" ? new Date() : null },
    });
    return c.json({ status });
  });

  app.delete("/api/actions/:id", async (c) => {
    const r = await prisma.actionItem.deleteMany({ where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") } });
    if (r.count === 0) return c.json({ error: "not_found" }, 404);
    return c.json({ deleted: true });
  });

  // 提案の見送り (✖️) — 連絡帳の各提案でユーザーが消したものを記録し、再表示しない。
  // 記録そのものは何も消さない。key に日付や年を含む提案は次の機会にまた出る。
  app.get("/api/relationship/dismissals", async (c) => {
    const rows = await prisma.suggestionDismissal.findMany({
      where: { ownerUid: c.get("ownerUid") },
      orderBy: { createdAt: "desc" },
      take: 2000,
      select: { kind: true, key: true },
    });
    return c.json({ items: rows });
  });

  app.post("/api/relationship/dismissals", async (c) => {
    const b = await c.req.json<{ kind?: string; key?: string }>().catch(() => ({}) as { kind?: string; key?: string });
    const kind = (b.kind ?? "").trim().slice(0, 60);
    const key = (b.key ?? "").trim().slice(0, 200);
    if (!kind || !key) return c.json({ error: "invalid_input" }, 400);
    await prisma.suggestionDismissal.upsert({
      where: { ownerUid_kind_key: { ownerUid: c.get("ownerUid"), kind, key } },
      update: {},
      create: { ownerUid: c.get("ownerUid"), kind, key },
    });
    return c.json({ dismissed: true });
  });

  // 見送りをすべて取り消す (設定画面の「見送った提案をすべて戻す」)。
  app.delete("/api/relationship/dismissals", async (c) => {
    const r = await prisma.suggestionDismissal.deleteMany({ where: { ownerUid: c.get("ownerUid") } });
    return c.json({ restored: r.count });
  });

  // 優先リストへのユーザーの意思: pinned (必ず載せる) / excluded (載せない) / null (自動判定)。
  // 「外す」は消すことではない — 記録はそのまま残り、いつでも戻せる。
  app.put("/api/contacts/:id/focus-preference", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    const b = await c.req.json<{ preference?: string | null }>().catch(() => ({}) as { preference?: string | null });
    const preference = b.preference === "pinned" || b.preference === "excluded" ? b.preference : null;
    await prisma.contact.update({ where: { id: contact.id }, data: { focusPreference: preference } });
    // 外した方への未対応の提案は片付ける (見せ続けない)
    if (preference === "excluded") {
      await prisma.careSuggestion.updateMany({
        where: { contactId: contact.id, status: "proposed" },
        data: { status: "dismissed" },
      });
    }
    return c.json({ focusPreference: preference });
  });

  // 会った直後のひとこと伺い — 直近に会った方で、まだその後のメモが無い方を挙げる。
  // 会った直後は記憶が新しく、ここで拾えなかった近況は二度と記録されない (AI 不要)。
  app.get("/api/relationship/recent-meetings", async (c) => {
    const since = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const contacts = await prisma.contact.findMany({
      where: { ownerUid: c.get("ownerUid"), state: "active" },
      select: { id: true, name: true },
    });
    if (contacts.length === 0) return c.json({ items: [] });
    const rows = await prisma.contactInteraction.findMany({
      where: { contactId: { in: contacts.map((x) => x.id) }, occurredAt: { gte: since } },
      select: { contactId: true, type: true, occurredAt: true, notes: true },
    });
    const items = recentMeetings(
      contacts,
      rows.map((r) => ({ contactId: r.contactId, type: r.type, occurredAt: r.occurredAt, hasNote: !!r.notes })),
    );
    return c.json({ items });
  });

  // 取り込み元の内訳 — どの経路 (LINE・Facebook・Google・名刺など) から何名迎えたか。
  // 経路チップで「LINE のリスト」のように経路別の一覧を出すために使う (AI 不要・毎回無料)。
  app.get("/api/relationship/contact-sources", async (c) => {
    const rows = await prisma.contact.groupBy({
      by: ["source"],
      where: { ownerUid: c.get("ownerUid"), state: "active" },
      _count: { source: true },
    });
    const items = rows
      .map((r) => ({ source: r.source, count: r._count.source }))
      .sort((a, b) => b.count - a.count);
    return c.json({ items });
  });

  // 連絡先がわからない方を、つながりでたどる — 連絡手段 (メール・電話・SNS) の無い方に
  // ついて、別の登録者の中から橋渡し役 (同じ所属・同じ日の同席・同じイベント・記録への登場)
  // を探して提案する (AI 不要・毎回無料)。実際に頼むかはユーザーが決める。
  app.get("/api/relationship/reachability", async (c) => {
    const ownerUid = c.get("ownerUid");
    const rows = await prisma.contact.findMany({
      where: { ownerUid, state: "active" },
      select: {
        id: true, name: true, company: true, email: true, phone: true, sns: true,
        notes: true, personalProfile: true, sourceHits: true, distance: true,
      },
    });
    const people: ReachPerson[] = rows;
    const ids = people.map((p) => p.id);
    const meetings = await prisma.contactInteraction.findMany({
      where: { contactId: { in: ids }, type: { in: ["meeting", "meet"] } },
      select: { contactId: true, occurredAt: true },
    });
    const meetDays = new Map<string, Set<string>>();
    const interactionCount = new Map<string, number>();
    for (const m of meetings) {
      interactionCount.set(m.contactId, (interactionCount.get(m.contactId) ?? 0) + 1);
      if (!meetDays.has(m.contactId)) meetDays.set(m.contactId, new Set());
      meetDays.get(m.contactId)!.add(m.occurredAt.toISOString().slice(0, 10));
    }
    const targets = pickUnreachableTargets(people, interactionCount, 20);
    const items = targets
      .map((t) => ({
        contactId: t.id,
        name: t.name,
        company: t.company,
        hasSnsCandidates: false, // 下で埋める (暗号化列のため個別に見る)
        bridges: findBridges(t, people, meetDays),
      }))
      // 橋渡し役が見つかった方を先に (見つからない方も取り込みの促しのため少数出す)
      .sort((a, b) => b.bridges.length - a.bridges.length)
      .slice(0, 12);
    // SNS 候補 (未確認) の有無 — 「本人らしきアカウントが見つかっています」の案内に使う
    const withCand = await prisma.contact.findMany({
      where: { id: { in: items.map((x) => x.contactId) } },
      select: { id: true, snsCandidates: true },
    });
    const candSet = new Set(withCand.filter((x) => (x.snsCandidates ?? "").trim().length > 2).map((x) => x.id));
    for (const it of items) it.hasSnsCandidates = candSet.has(it.contactId);
    return c.json({ items, unreachableTotal: people.filter((p) => !isReachable(p)).length });
  });

  // 最近の動き — 最近お迎えした方 (登録) と、最近情報が新しくなった方 (編集・取込・
  // 自動整理などでの更新)。ホームで「いま動いている名簿」がひと目で分かる (AI 不要・毎回無料)。
  app.get("/api/relationship/recent-contacts", async (c) => {
    const ownerUid = c.get("ownerUid");
    const pick = { id: true, name: true, company: true, email: true, distance: true, createdAt: true, updatedAt: true } as const;
    const added = await prisma.contact.findMany({
      where: { ownerUid, state: "active" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: pick,
    });
    // 「情報が新しくなった」= 作成から 1 時間より後に更新された方 (作りたては added 側に出す)
    const updatedRows = await prisma.contact.findMany({
      where: { ownerUid, state: "active" },
      orderBy: { updatedAt: "desc" },
      take: 40,
      select: pick,
    });
    const updated = updatedRows
      .filter((x) => x.updatedAt.getTime() - x.createdAt.getTime() > 60 * 60 * 1000)
      .slice(0, 10);
    const shape = (x: (typeof added)[number]) => ({
      contactId: x.id,
      name: x.name,
      company: x.company,
      email: x.email,
      addedAt: x.createdAt,
      updatedAt: x.updatedAt,
    });
    return c.json({ added: added.map(shape), updated: updated.map(shape) });
  });

  // 1日1問 — 毎日ひとりについて、まだ知らない論点をひとつだけ聞く (定型・AI 不要)。
  // 1年続けば 365 個の事実が溜まる。答えは /api/contacts/:id/note で還流する。
  app.get("/api/relationship/daily-question", async (c) => {
    const contacts = await prisma.contact.findMany({
      where: { ownerUid: c.get("ownerUid"), state: "active" },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    if (contacts.length === 0) return c.json({ question: null });
    const ids = contacts.map((x) => x.id);
    const counts = await prisma.contactInteraction.groupBy({
      by: ["contactId"],
      where: { contactId: { in: ids } },
      _count: { contactId: true },
    });
    const countBy = new Map(counts.map((x) => [x.contactId, x._count.contactId]));
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const todays = await prisma.contactInteraction.findMany({
      where: { contactId: { in: ids }, type: "note", occurredAt: { gte: dayStart } },
      select: { contactId: true },
    });
    const answered = new Set(todays.map((x) => x.contactId));
    const people: DailyPerson[] = contacts.map((ct) => {
      let facets: DailyPerson["facets"] = null;
      if (ct.profileFacets) {
        try {
          facets = JSON.parse(ct.profileFacets) as DailyPerson["facets"];
        } catch {
          // 壊れた facets は「まだ知らない」扱い
        }
      }
      return {
        id: ct.id,
        name: ct.name,
        distance: ct.distance,
        interactionCount: countBy.get(ct.id) ?? 0,
        answeredToday: answered.has(ct.id),
        facets,
      };
    });
    const dateKey = new Date().toISOString().slice(0, 10);
    return c.json({ question: pickDailyQuestion(people, dateKey) });
  });

  // 距離感 (1〜5) の自動レーティング。やりとりの多さ・新しさ・贈り物から推し量る。
  // ownerUid の全 active 連絡先について {現状, おすすめ, 理由} を返す。ユーザーの手入力を
  // 勝手に消さないため「提案」に留め、適用は明示操作 (下の apply) で行う。
  const computeDistanceSuggestions = async (ownerUid: string) => {
    const contacts = await prisma.contact.findMany({
      where: { ownerUid, state: "active" },
      select: { id: true, name: true, distance: true },
    });
    if (contacts.length === 0) return [];
    const ids = contacts.map((x) => x.id);
    const [interactions, gifts] = await Promise.all([
      prisma.contactInteraction.findMany({
        where: { contactId: { in: ids } },
        select: { contactId: true, occurredAt: true },
      }),
      prisma.contactGift.findMany({
        where: { contactId: { in: ids } },
        select: { contactId: true },
      }),
    ]);
    const now = Date.now();
    const byContact = new Map<string, { count: number; days: Set<string>; last: number | null }>();
    for (const it of interactions) {
      let e = byContact.get(it.contactId);
      if (!e) byContact.set(it.contactId, (e = { count: 0, days: new Set(), last: null }));
      e.count++;
      e.days.add(it.occurredAt.toISOString().slice(0, 10));
      const t = it.occurredAt.getTime();
      if (e.last === null || t > e.last) e.last = t;
    }
    const giftByContact = new Map<string, number>();
    for (const g of gifts) giftByContact.set(g.contactId, (giftByContact.get(g.contactId) ?? 0) + 1);
    const DAY = 86_400_000;
    return contacts.map((ct) => {
      const e = byContact.get(ct.id);
      const s = suggestDistance({
        interactionCount: e?.count ?? 0,
        distinctDays: e?.days.size ?? 0,
        daysSinceLast: e && e.last !== null ? Math.floor((now - e.last) / DAY) : null,
        giftCount: giftByContact.get(ct.id) ?? 0,
      });
      return {
        contactId: ct.id,
        name: ct.name,
        current: clampDistance(ct.distance),
        suggested: s.suggested,
        reason: s.reason,
        confident: s.confident,
      };
    });
  };

  app.get("/api/relationship/distance-suggestions", async (c) => {
    const all = await computeDistanceSuggestions(c.get("ownerUid"));
    // 変えたほうがよい (現状と違う) 提案を、確信のあるものから先に返す
    const changes = all
      .filter((s) => s.confident && s.suggested !== s.current)
      .sort((a, b) => a.suggested - b.suggested);
    return c.json({ suggestions: changes, total: all.length });
  });

  // 距離感の提案を適用する。ids を指定すればその人だけ、無指定なら確信のある提案すべて。
  app.post("/api/relationship/apply-distances", async (c) => {
    const ownerUid = c.get("ownerUid");
    const b = await c.req.json<{ ids?: unknown }>().catch(() => ({}) as { ids?: unknown });
    const idSet = Array.isArray(b.ids) ? new Set(b.ids.filter((x): x is string => typeof x === "string")) : null;
    const all = await computeDistanceSuggestions(ownerUid);
    const targets = all.filter(
      (s) => s.confident && s.suggested !== s.current && (idSet ? idSet.has(s.contactId) : true),
    );
    let applied = 0;
    for (const t of targets) {
      await prisma.contact.updateMany({
        where: { id: t.contactId, ownerUid },
        data: { distance: t.suggested },
      });
      applied++;
    }
    return c.json({ applied });
  });

  // 引き合わせの提案 (「気づかない一手」の核) — 連絡帳の中から、一方の困りごと/目標に
  // もう一方の強み/貢献が噛み合うお二人を見つけて提案する。論点整理 (facets) を突き合わせて
  // 候補を安く指名し (nominateIntroPairs)、是非と文面は AI が判断する。3軸ミッションの中核。
  app.get("/api/relationship/introductions", async (c) => {
    const contacts = await prisma.contact.findMany({
      where: { ownerUid: c.get("ownerUid"), state: "active" },
      select: { id: true, name: true, profileFacets: true },
    });
    // facets から needs (困りごと+目標) と offers (強み+貢献できること) を取り出す。
    const roster: IntroPerson[] = [];
    for (const ct of contacts) {
      if (!ct.profileFacets) continue;
      let f: Record<string, unknown> | null = null;
      try {
        f = JSON.parse(ct.profileFacets) as Record<string, unknown>;
      } catch {
        continue;
      }
      const arr = (k: string) => (Array.isArray(f![k]) ? (f![k] as unknown[]).map((x) => String(x)).filter(Boolean) : []);
      const needs = [...arr("concerns"), ...arr("goals")];
      const offers = [...arr("skills"), ...arr("opportunities")];
      if (needs.length || offers.length) roster.push({ id: ct.id, name: ct.name, needs, offers });
    }
    const pairs = nominateIntroPairs(roster, 8);
    if (pairs.length === 0) {
      return c.json({
        introductions: [],
        note: roster.length < 2
          ? "連絡先の論点 (強みや困りごと) を整理していくと、引き合わせるとよいお二人が見えてきます。"
          : "いまのところ、はっきり噛み合うお二人は見当たりませんでした。記録が増えると見つかりやすくなります。",
      });
    }
    // AI が使えないときは、噛み合った手がかりだけを添えて候補として返す (縮退)。
    if (!generate) {
      return c.json({
        introductions: pairs.map((p) => ({
          personA: p.aName,
          personB: p.bName,
          reason: `おふたりには「${[...p.aNeedsBOffers, ...p.bNeedsAOffers].slice(0, 3).join("、")}」で噛み合いそうなところがあります。`,
          how: "",
          caution: "",
        })),
        note: "",
      });
    }
    // 候補を AI に渡して是非を見極めてもらう。名簿は候補に出た人だけに絞る (接地・混同防止)。
    const involved = new Map<string, IntroPerson>();
    for (const p of pairs) {
      const a = roster.find((r) => r.id === p.aId);
      const b = roster.find((r) => r.id === p.bId);
      if (a) involved.set(a.id, a);
      if (b) involved.set(b.id, b);
    }
    const b2 = await c.req.json<{ locale?: string }>().catch(() => ({}) as { locale?: string });
    const rosterText = [...involved.values()]
      .map((p) => `${p.name}: 強み・貢献できること=[${p.offers.join("、") || "なし"}] / 困りごと・目標=[${p.needs.join("、") || "なし"}]`)
      .join("\n");
    const pairsText = pairs
      .map((p) => `${p.aName} と ${p.bName}: 噛み合う手がかり=${[...p.aNeedsBOffers, ...p.bNeedsAOffers].join("、")}${p.mutual ? " (双方向)" : ""}`)
      .join("\n");
    const userMessage = [
      "名簿 (この中の人だけを扱う):",
      rosterText,
      "",
      "噛み合いそうな候補の組:",
      pairsText,
    ].join("\n");
    const r = await runRelationshipAi(
      "intro_suggest",
      '出力は JSON オブジェクト 1 個だけ: {"introductions": [{"personA": "", "personB": "", "reason": "", "how": "", "caution": ""}]}',
      userMessage,
      "intro_suggest",
      normalizeLocale(b2.locale),
      { actor: actorOf(c) },
    );
    if (!r.ok) return c.json(r.body as never, r.status);
    const parsed = extractJson(r.text) as { introductions?: unknown } | null;
    const names = new Set([...involved.values()].map((p) => p.name));
    const clean = (v: unknown, max = 300) => sanitizeProse(typeof v === "string" ? v : "").trim().slice(0, max);
    const introductions = (Array.isArray(parsed?.introductions) ? (parsed.introductions as Array<Record<string, unknown>>) : [])
      .slice(0, 6)
      .map((x) => ({
        personA: clean(x.personA, 60),
        personB: clean(x.personB, 60),
        reason: clean(x.reason),
        how: clean(x.how),
        caution: clean(x.caution),
      }))
      // 名簿に無い人物を勝手に作っていないか検証 (混同・捏造を落とす)。
      .filter((x) => x.personA && x.personB && x.personA !== x.personB && names.has(x.personA) && names.has(x.personB));
    return c.json({ introductions, note: "" });
  });

  // ---------------- カレンダー & 面談候補 — フェーズ3 ----------------
  // busy スロットは手動/API 登録 (フェーズ5 で Google/Outlook ライブ同期)。

  // 自分のカレンダーは contact_id = "self" の番兵値で保存する
  // (NULL は Postgres の複合ユニークで重複可になり upsert が効かないため)。
  const SELF_CALENDAR = "self"; // ICS 貼り付け / 購読 URL (Outlook・iCloud 等) の自分の予定表
  const SELF_GOOGLE = "self:google"; // Google カレンダーの予定 (freeBusy)。両方を重ねて空きを出す
  const SELF_SOURCES = [SELF_CALENDAR, SELF_GOOGLE];

  // busy の保存。busySlots (手動) / ics (貼り付け) / icsUrl (購読 URL = ライブ同期) の
  // 3 経路。icsUrl は保存しておき、refresh-calendars で最新を取り直す。
  const saveBusy = async (
    ownerUid: string,
    contactId: string,
    body: { busySlots?: unknown; ics?: unknown; icsUrl?: unknown },
  ): Promise<{ saved: number } | { error: string; detail: string }> => {
    // オーナー自身のカレンダー (SELF) は、本人だけに見せるため件名も持つ。
    // 第三者 (相手) の予定は従来どおり時間帯だけ = 中身は保存しない。
    const isSelf = SELF_SOURCES.includes(contactId);
    const parseIcs = (s: string): IsoEvent[] => (isSelf ? parseIcsEvents(s) : parseIcsBusy(s));
    let busy: IsoEvent[];
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
      busy = parseIcs(content);
      provider = "ics";
      icsUrl = url;
    } else if (typeof body.ics === "string" && looksLikeIcs(body.ics)) {
      busy = parseIcs(body.ics);
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

  // 空き時間の設定 (曜日別の受け付け時間窓・予定の前後の余白・最低時間) を読む。
  // 未設定なら既定 (毎日 9-18・余白なし・最低 30 分 = 従来の挙動)。
  const loadAvailability = async (ownerUid: string): Promise<Availability> => {
    const row = await prisma.availabilitySetting.findUnique({ where: { ownerUid } });
    if (!row) return defaultAvailability();
    return parseAvailability({ days: (row.days as { days?: unknown })?.days ?? row.days, bufferMinutes: row.bufferMinutes, minMinutes: row.minMinutes });
  };

  // bonds 経由で決まった予定 (承認済みの提案・確保中の予約) も busy に数える。
  // カレンダー連携がまだでも、bonds 内の確定枠が二重に売れる/約束されるのを防ぐ。
  const committedBusy = async (ownerUid: string): Promise<Interval[]> => {
    const [accepted, bookings] = await Promise.all([
      prisma.scheduleShareProposal.findMany({
        where: { status: "accepted", share: { ownerUid } },
        select: { decidedSlot: true },
      }),
      prisma.timeBooking.findMany({
        where: { ownerUid, status: { in: ["confirmed", "pending_payment"] } },
        select: { slot: true, status: true, createdAt: true },
      }),
    ]);
    const slots = [
      ...accepted.map((p) => p.decidedSlot),
      ...bookings.filter((b) => bookingHoldsSlot(b)).map((b) => b.slot),
    ];
    return parseIsoIntervals(slots.filter(Boolean));
  };

  // 自分の空き (busy + bonds 内の確定枠 + 設定 + カレンダーでなぞった明示枠) を期間で計算する共通ヘルパ
  // 取り込んだ自分の予定表 (Outlook 等の ICS + Google カレンダー) の busy をまとめて返す。
  const selfBusyIntervals = async (ownerUid: string): Promise<{ busy: Interval[]; hasMyCalendar: boolean }> => {
    const links = await prisma.calendarLink.findMany({
      where: { ownerUid, contactId: { in: SELF_SOURCES } },
    });
    const busy = links.flatMap((l) => parseIsoIntervals(l.busySlots));
    return { busy, hasMyCalendar: links.length > 0 };
  };

  const myFreeIntervals = async (
    ownerUid: string,
    period: { from: Date; periodStart: Date; periodEnd: Date },
  ): Promise<{ free: Interval[]; hasMyCalendar: boolean; avail: Availability }> => {
    const [self, committed, avail, slots] = await Promise.all([
      selfBusyIntervals(ownerUid),
      committedBusy(ownerUid),
      loadAvailability(ownerUid),
      prisma.availabilitySlot.findMany({
        where: { ownerUid, endAt: { gte: period.periodStart }, startAt: { lte: period.periodEnd } },
        orderBy: { startAt: "asc" },
      }),
    ]);
    const busy = [...self.busy, ...committed];
    const explicit = slots.map((s) => ({ start: s.startAt, end: s.endAt }));
    return {
      free: freeIntervalsWithExplicitSlots(busy, period, avail, explicit),
      hasMyCalendar: self.hasMyCalendar,
      avail,
    };
  };

  // 空き時間カレンダーに重ねて表示する「予定あり (busy)」を期間で返す。
  // 予定の中身 (件名) は持たず、時間帯だけ (プライバシー: 中身は保存しない)。
  app.get("/api/relationship/my-busy", async (c) => {
    const from = new Date(c.req.query("from") ?? "");
    const to = new Date(c.req.query("to") ?? "");
    const start = Number.isNaN(from.getTime()) ? new Date() : from;
    const end = Number.isNaN(to.getTime()) ? new Date(start.getTime() + 60 * 86_400_000) : to;
    const [self, committed] = await Promise.all([selfBusyIntervals(c.get("ownerUid")), committedBusy(c.get("ownerUid"))]);
    const links = await prisma.calendarLink.findMany({
      where: { ownerUid: c.get("ownerUid"), contactId: { in: SELF_SOURCES } },
      select: { contactId: true, provider: true },
    });
    // 期間に重なる busy だけに絞る
    const clip = (iv: Interval) => iv.end > start && iv.start < end;
    const busy = [...self.busy, ...committed].filter(clip);
    return c.json({
      busy: intervalsToIso(busy),
      google: links.some((l) => l.contactId === SELF_GOOGLE),
      ics: links.some((l) => l.contactId === SELF_CALENDAR),
    });
  });

  // 空き時間カレンダーに重ねて表示する「自分の予定」を、件名つきで期間で返す。
  // オーナー自身のカレンダー (Google / 取り込んだ予定表) の予定を、本人にだけ見せる。
  app.get("/api/relationship/my-events", async (c) => {
    const from = new Date(c.req.query("from") ?? "");
    const to = new Date(c.req.query("to") ?? "");
    const start = Number.isNaN(from.getTime()) ? new Date() : from;
    const end = Number.isNaN(to.getTime()) ? new Date(start.getTime() + 60 * 86_400_000) : to;
    const links = await prisma.calendarLink.findMany({
      where: { ownerUid: c.get("ownerUid"), contactId: { in: SELF_SOURCES } },
      select: { contactId: true, busySlots: true },
    });
    const events: Array<{ start: string; end: string; title: string; source: string }> = [];
    for (const l of links) {
      const source = l.contactId === SELF_GOOGLE ? "google" : "calendar";
      const raw = Array.isArray(l.busySlots) ? (l.busySlots as unknown[]) : [];
      for (const r of raw) {
        if (!r || typeof r !== "object") continue;
        const ev = r as { start?: string; end?: string; title?: string };
        const s = new Date(String(ev.start));
        const e = new Date(String(ev.end));
        if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) continue;
        if (e <= start || s >= end) continue; // 期間外は返さない
        events.push({ start: s.toISOString(), end: e.toISOString(), title: (ev.title ?? "").trim() || "予定", source });
      }
    }
    events.sort((a, b) => a.start.localeCompare(b.start));
    return c.json({ events: events.slice(0, 500) });
  });

  // Google カレンダーの予定 (busy) だけを取り込む (連絡先の取込はしない軽い経路)。
  app.post("/api/relationship/import-google-calendar", async (c) => {
    if (!google) return c.json({ error: "unavailable", detail: "Google 連携は準備中です" }, 503);
    const conn = await prisma.googleConnection.findUnique({ where: { ownerUid: c.get("ownerUid") } });
    if (!conn) return c.json({ error: "not_connected", detail: "先に設定から Google とつないでください" }, 400);
    try {
      const accessToken = await google.refreshAccessToken(conn.refreshToken);
      const count = await syncGoogleBusy(c.get("ownerUid"), accessToken, parseCalendarIds(conn.syncCalendarIds));
      return c.json({ imported: count });
    } catch {
      return c.json({ error: "import_failed", detail: "カレンダーを取り込めませんでした。時間をおいてお試しください" }, 502);
    }
  });

  // 分けている Google カレンダーの一覧と、いま取り込む/表示する選択を返す。
  app.get("/api/relationship/google-calendars", async (c) => {
    if (!google) return c.json({ available: false, calendars: [], selected: [] });
    const conn = await prisma.googleConnection.findUnique({ where: { ownerUid: c.get("ownerUid") } });
    if (!conn) return c.json({ available: true, connected: false, calendars: [], selected: [] });
    try {
      const accessToken = await google.refreshAccessToken(conn.refreshToken);
      const res = (await google.apiGet(
        "https://www.googleapis.com/calendar/v3/users/me/calendarList?fields=items(id,summary,summaryOverride,primary)&minAccessRole=reader",
        accessToken,
      )) as { items?: Array<{ id?: string; summary?: string; summaryOverride?: string; primary?: boolean }> };
      const calendars = (res.items ?? [])
        .filter((it) => typeof it.id === "string")
        .map((it) => ({ id: it.id as string, name: (it.summaryOverride ?? it.summary ?? it.id) as string, primary: !!it.primary }));
      // 未設定なら primary を既定選択にする (従来どおり)
      const stored = Array.isArray(conn.syncCalendarIds) ? (conn.syncCalendarIds as unknown[]).filter((x): x is string => typeof x === "string") : null;
      const selected = stored ?? calendars.filter((c2) => c2.primary).map((c2) => c2.id);
      return c.json({ available: true, connected: true, calendars, selected });
    } catch {
      return c.json({ available: true, connected: true, calendars: [], selected: [], detail: "カレンダーの一覧を取得できませんでした" });
    }
  });

  // 取り込む/表示するカレンダーの選択を保存し、その場で取り込み直す。
  app.put("/api/relationship/google-calendars", async (c) => {
    if (!google) return c.json({ error: "unavailable", detail: "Google 連携は準備中です" }, 503);
    const conn = await prisma.googleConnection.findUnique({ where: { ownerUid: c.get("ownerUid") } });
    if (!conn) return c.json({ error: "not_connected", detail: "先に設定から Google とつないでください" }, 400);
    const b = (await c.req.json<{ ids?: unknown }>().catch(() => ({}))) as { ids?: unknown };
    const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()).slice(0, 30) : [];
    await prisma.googleConnection.update({
      where: { ownerUid: c.get("ownerUid") },
      data: { syncCalendarIds: ids as never },
    });
    let imported = 0;
    try {
      const accessToken = await google.refreshAccessToken(conn.refreshToken);
      imported = await syncGoogleBusy(c.get("ownerUid"), accessToken, ids.length ? ids : ["primary"]);
    } catch {
      // 保存はできたので、取り込み直しに失敗しても選択自体は反映済み
    }
    return c.json({ saved: true, selected: ids, imported });
  });

  // 二者空き重なり → 面談候補 (busy → 各自の free → 積集合)。自分側は空き時間の設定を反映する
  app.get("/api/contacts/:id/meeting-slots", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    const days = Math.min(30, Math.max(1, Number(c.req.query("days")) || 14));
    const now = new Date();
    const [{ free, hasMyCalendar, avail }, theirs] = await Promise.all([
      myFreeIntervals(c.get("ownerUid"), {
        from: now,
        periodStart: now,
        periodEnd: new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
      }),
      prisma.calendarLink.findUnique({
        where: { ownerUid_contactId: { ownerUid: c.get("ownerUid"), contactId: contact.id } },
      }),
    ]);
    const theirFree = freeSlots(parseIsoIntervals(theirs?.busySlots), { from: now, days, minMinutes: avail.minMinutes });
    const proposals = intersectSlots(free, theirFree, avail.minMinutes).slice(0, 5);
    return c.json({
      proposals: toIso(proposals),
      hasMyCalendar,
      hasTheirCalendar: !!theirs,
    });
  });

  // 空き時間をメール本文に貼れるテキストで返す (発信のお便りに自分の候補日時をそのまま添える)。
  // 相手のカレンダーもあれば双方の空き重なりを、無ければ自分の空きを、日本語の文面にして返す。
  // カレンダー未連携なら空き根拠が無いので count 0 で返し、勝手に「全部空き」を出さない。
  app.get("/api/contacts/:id/free-slots-text", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    const days = Math.min(30, Math.max(1, Number(c.req.query("days")) || 14));
    const max = Math.min(8, Math.max(1, Number(c.req.query("max")) || 5));
    const [mine, theirs] = await Promise.all([
      prisma.calendarLink.findUnique({
        where: { ownerUid_contactId: { ownerUid: c.get("ownerUid"), contactId: SELF_CALENDAR } },
      }),
      prisma.calendarLink.findUnique({
        where: { ownerUid_contactId: { ownerUid: c.get("ownerUid"), contactId: contact.id } },
      }),
    ]);
    if (!mine) {
      return c.json({ text: "", count: 0, basis: "none", hasMyCalendar: false });
    }
    const now = new Date();
    const { free, avail } = await myFreeIntervals(c.get("ownerUid"), {
      from: now,
      periodStart: now,
      periodEnd: new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
    });
    let slots;
    let basis: "overlap" | "mine";
    if (theirs) {
      const theirFree = freeSlots(parseIsoIntervals(theirs.busySlots), { from: now, days, minMinutes: avail.minMinutes });
      slots = intersectSlots(free, theirFree, avail.minMinutes).slice(0, max);
      basis = "overlap";
    } else {
      slots = free.slice(0, max);
      basis = "mine";
    }
    return c.json({ text: formatFreeSlotText(slots), count: slots.length, basis, hasMyCalendar: true });
  });

  // 自分の空き時間をそのままテキストで返す (timeshare 踏襲: メール/LINE に貼れる形)。
  // 相手アカウント不要で「この時間どうですか」を送れる。予定の中身は出さない。
  app.get("/api/relationship/free-slots-text", async (c) => {
    const days = Math.min(30, Math.max(1, Number(c.req.query("days")) || 14));
    const max = Math.min(20, Math.max(1, Number(c.req.query("max")) || 12));
    const now = new Date();
    const { free } = await myFreeIntervals(c.get("ownerUid"), {
      from: now,
      periodStart: now,
      periodEnd: new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
    });
    const slots = free.slice(0, max);
    return c.json({ text: formatFreeSlotText(slots), count: slots.length });
  });

  // ---------------- 日程調整の共有リンクと時間の出品 (timeshare の概念の新規実装) ----------------
  // 共有リンク: 推測不能な URL を相手に送る → 相手が空き枠から候補を提案 → ユーザーが承認して確定
  // (下書き→承認→実行の原則)。ページに出すのは空き枠と名乗りだけで、予定の中身は出さない。
  // 時間の出品: 空き枠を相談メニューとして公開し、予約 + Stripe 決済 (BMP-LP 方式) で受ける。

  // 公開ページの土台 URL (共有 URL・Stripe の戻り先)。env 優先、無ければ許可 Origin の先頭。
  const publicWebUrl = (process.env.PUBLIC_WEB_URL ?? allowedOrigins[0] ?? "http://localhost:3000").replace(/\/$/, "");

  // 空き時間の設定の閲覧・保存
  app.get("/api/relationship/availability", async (c) => {
    const avail = await loadAvailability(c.get("ownerUid"));
    return c.json(avail);
  });

  app.put("/api/relationship/availability", async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const avail = parseAvailability(body);
    await prisma.availabilitySetting.upsert({
      where: { ownerUid: c.get("ownerUid") },
      update: { days: availabilityToJson(avail) as never, bufferMinutes: avail.bufferMinutes, minMinutes: avail.minMinutes },
      create: {
        ownerUid: c.get("ownerUid"),
        days: availabilityToJson(avail) as never,
        bufferMinutes: avail.bufferMinutes,
        minMinutes: avail.minMinutes,
      },
    });
    return c.json(avail);
  });

  // カレンダーをドラッグしてなぞる明示の空き枠 (timeshare の free_times の踏襲)。
  // なぞった日はその枠がそのまま空きになり、なぞっていない日は曜日別の受付時間が使われる。
  app.get("/api/relationship/availability-slots", async (c) => {
    const from = new Date(c.req.query("from") ?? "");
    const to = new Date(c.req.query("to") ?? "");
    const start = Number.isNaN(from.getTime()) ? new Date() : from;
    const end = Number.isNaN(to.getTime()) ? new Date(start.getTime() + 90 * 86_400_000) : to;
    const rows = await prisma.availabilitySlot.findMany({
      where: { ownerUid: c.get("ownerUid"), endAt: { gte: start }, startAt: { lte: end } },
      orderBy: { startAt: "asc" },
    });
    return c.json({ slots: rows.map((r) => ({ id: r.id, start: r.startAt, end: r.endAt })) });
  });

  app.post("/api/relationship/availability-slots", async (c) => {
    const b = await c.req.json<{ start?: string; end?: string }>().catch(() => ({}) as { start?: string; end?: string });
    const start = new Date(b.start ?? "");
    const end = new Date(b.end ?? "");
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return c.json({ error: "invalid_input", detail: "時間の指定が読めませんでした" }, 400);
    }
    if (end.getTime() - start.getTime() > 24 * 60 * 60 * 1000) {
      return c.json({ error: "invalid_input", detail: "ひとつの枠は 24 時間までにしてください" }, 400);
    }
    if (end < new Date()) return c.json({ error: "invalid_input", detail: "過ぎた時間はなぞれません" }, 400);
    if (start.getTime() > Date.now() + 366 * 86_400_000) {
      return c.json({ error: "invalid_input", detail: "1 年より先の枠はまだ受け付けられません" }, 400);
    }
    const count = await prisma.availabilitySlot.count({ where: { ownerUid: c.get("ownerUid") } });
    if (count >= 500) return c.json({ error: "too_many", detail: "枠が多すぎます。古い枠を消してください" }, 400);
    const row = await prisma.availabilitySlot.create({
      data: { ownerUid: c.get("ownerUid"), startAt: start, endAt: end },
    });
    return c.json({ slot: { id: row.id, start: row.startAt, end: row.endAt } });
  });

  app.delete("/api/relationship/availability-slots/:id", async (c) => {
    const row = await prisma.availabilitySlot.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!row) return c.json({ error: "not_found" }, 404);
    await prisma.availabilitySlot.delete({ where: { id: row.id } });
    return c.json({ deleted: true });
  });

  // ------- 申し出カタログ (あなたが力になれること) と、相手のニーズとのマッチング -------
  // gift の「give/lend/teach/do/advise」の概念を bonds のミッション「貢献のためのアクション」
  // に絞って新規実装。マーケットプレイス・ポイント経済は移植しない。マッチングは AI 不要
  // (毎回無料・決定的) — 蓄積した相手の記録 (facets/プロフィール/メモ) との語の重なりで挙げる。
  const serializeOffering = (row: {
    id: string;
    kind: string;
    title: string;
    description: string | null;
    category: string | null;
    situations: string | null;
    logistics: string | null;
    maxDistance: number | null;
    active: boolean;
    published: boolean;
    updatedAt: Date;
  }) => ({
    id: row.id,
    kind: row.kind,
    kindLabel: OFFERING_KIND_LABEL[row.kind] ?? row.kind,
    title: row.title,
    description: row.description,
    category: row.category,
    situations: row.situations ? (JSON.parse(row.situations) as string[]) : [],
    logistics: row.logistics ? (JSON.parse(row.logistics) as string[]) : [],
    maxDistance: row.maxDistance,
    active: row.active,
    published: row.published,
    marketUrl: row.published ? `${publicWebUrl}/market` : null,
    updatedAt: row.updatedAt,
  });

  app.get("/api/offerings", async (c) => {
    const rows = await prisma.offering.findMany({
      where: { ownerUid: c.get("ownerUid") },
      orderBy: { createdAt: "desc" },
    });
    return c.json({
      offerings: rows.map(serializeOffering),
      kinds: OFFERING_KINDS.map((k) => ({ value: k, label: OFFERING_KIND_LABEL[k] })),
      logisticsOptions: LOGISTICS_OPTIONS,
    });
  });

  app.post("/api/offerings", async (c) => {
    const raw = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>;
    const parsed = parseOfferingInput(raw);
    if ("error" in parsed) return c.json(parsed, 400);
    const count = await prisma.offering.count({ where: { ownerUid: c.get("ownerUid") } });
    if (count >= 200) return c.json({ error: "too_many", detail: "申し出が多すぎます。使わないものを消してください" }, 400);
    const row = await prisma.offering.create({
      data: {
        ownerUid: c.get("ownerUid"),
        kind: parsed.kind,
        title: parsed.title,
        description: parsed.description,
        category: parsed.category,
        situations: parsed.situations.length ? JSON.stringify(parsed.situations) : null,
        logistics: parsed.logistics.length ? JSON.stringify(parsed.logistics) : null,
        maxDistance: parsed.maxDistance,
        published: raw.published === true,
      },
    });
    return c.json({ offering: serializeOffering(row) });
  });

  // 「提供できるもの」を貼り付け / CSV でまとめて取り込み、種類に自動分類して登録する。
  // タイムシェア等のスプレッドシートを書き出して貼るだけ = 提案 (マッチング) に載せやすくする。
  app.post("/api/offerings/import", async (c) => {
    const raw = (await c.req.json<{ text?: unknown }>().catch(() => ({}))) as { text?: unknown };
    const text = typeof raw.text === "string" ? raw.text : "";
    if (!text.trim()) return c.json({ error: "empty", detail: "取り込む内容を貼り付けてください" }, 400);
    const ownerUid = c.get("ownerUid");
    const existing = await prisma.offering.findMany({ where: { ownerUid }, select: { title: true } });
    const have = new Set(existing.map((e) => e.title.trim().toLowerCase()));
    const room = Math.max(0, 200 - existing.length);
    if (room === 0) return c.json({ error: "too_many", detail: "申し出が多すぎます。使わないものを消してください" }, 400);

    const parsed = parseOfferingsBulk(text, 100).filter((p) => !have.has(p.title.toLowerCase())).slice(0, room);
    let added = 0;
    const perKind: Record<string, number> = {};
    for (const p of parsed) {
      await prisma.offering.create({
        data: { ownerUid, kind: p.kind, title: p.title, description: p.description, category: null },
      });
      added++;
      perKind[p.kind] = (perKind[p.kind] ?? 0) + 1;
    }
    return c.json({
      added,
      skipped: 0,
      byKind: OFFERING_KINDS.filter((k) => perKind[k]).map((k) => ({ kind: k, label: OFFERING_KIND_LABEL[k], count: perKind[k] })),
    });
  });

  app.put("/api/offerings/:id", async (c) => {
    const existing = await prisma.offering.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!existing) return c.json({ error: "not_found" }, 404);
    const raw = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>;
    // active / published だけの切り替えも許す (title 必須の全体検証を回避)
    const keys = Object.keys(raw);
    if (keys.length >= 1 && keys.every((k) => k === "active" || k === "published")) {
      const data: { active?: boolean; published?: boolean } = {};
      if (typeof raw.active === "boolean") data.active = raw.active;
      if (typeof raw.published === "boolean") data.published = raw.published;
      const row = await prisma.offering.update({ where: { id: existing.id }, data });
      return c.json({ offering: serializeOffering(row) });
    }
    const parsed = parseOfferingInput(raw);
    if ("error" in parsed) return c.json(parsed, 400);
    const row = await prisma.offering.update({
      where: { id: existing.id },
      data: {
        kind: parsed.kind,
        title: parsed.title,
        description: parsed.description,
        category: parsed.category,
        situations: parsed.situations.length ? JSON.stringify(parsed.situations) : null,
        logistics: parsed.logistics.length ? JSON.stringify(parsed.logistics) : null,
        maxDistance: parsed.maxDistance,
        active: typeof raw.active === "boolean" ? raw.active : existing.active,
        published: typeof raw.published === "boolean" ? raw.published : existing.published,
      },
    });
    return c.json({ offering: serializeOffering(row) });
  });

  app.delete("/api/offerings/:id", async (c) => {
    const row = await prisma.offering.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!row) return c.json({ error: "not_found" }, 404);
    await prisma.offering.delete({ where: { id: row.id } });
    return c.json({ deleted: true });
  });

  // 有効な申し出それぞれについて、ニーズが重なる連絡先を根拠つきで挙げる (AI 不要・毎回無料)。
  // ニーズ源は蓄積した相手の記録のみ (facets の悩み/目標/機会/仕事 + プロフィール + メモ)。
  // web 検索はしない = 相手の尊厳。距離ゲート (maxDistance) を尊重する。
  app.get("/api/relationship/offering-matches", async (c) => {
    const ownerUid = c.get("ownerUid");
    const offerings = await prisma.offering.findMany({
      where: { ownerUid, active: true },
      orderBy: { createdAt: "desc" },
    });
    if (offerings.length === 0) return c.json({ matches: [] });
    const contacts = await prisma.contact.findMany({ where: { ownerUid, state: "active" } });
    const needs: ContactNeed[] = contacts.map((ct) => {
      const texts: string[] = [];
      if (ct.profileFacets) {
        try {
          const f = JSON.parse(ct.profileFacets) as Record<string, unknown>;
          if (typeof f.work === "string") texts.push(f.work);
          for (const key of ["goals", "opportunities", "concerns"]) {
            const arr = f[key];
            if (Array.isArray(arr)) for (const v of arr) if (typeof v === "string") texts.push(v);
          }
        } catch {
          // 壊れた facets は無視
        }
      }
      if (ct.personalProfile) texts.push(ct.personalProfile);
      if (ct.valuesProfile) texts.push(ct.valuesProfile);
      if (ct.notes) texts.push(ct.notes);
      return { id: ct.id, name: ct.name, distance: ct.distance, needTexts: texts };
    });
    const matches = offerings
      .map((o) => {
        const like: OfferingLike = {
          id: o.id,
          kind: o.kind,
          title: o.title,
          description: o.description,
          category: o.category,
          situations: o.situations ? (JSON.parse(o.situations) as string[]) : [],
          maxDistance: o.maxDistance,
        };
        return {
          offeringId: o.id,
          title: o.title,
          kind: o.kind,
          kindLabel: OFFERING_KIND_LABEL[o.kind] ?? o.kind,
          contacts: matchOfferingToContacts(like, needs, 5),
        };
      })
      .filter((m) => m.contacts.length > 0);
    return c.json({ matches });
  });

  // 関係を育てるとよい方々 + それぞれの距離の縮め方 (AI 不要・毎回無料)。
  // 伸びしろ (距離を縮める余地)・手がかりの厚み・機会 (目標・申し出の一致・間合い) で選び、
  // キャッチアップ / モノやサービスの提示 / 空いた時間で会う などの具体的な一手を添える。
  // web 側が見送り (✖️ kind=growth) を除いて先頭を出す。
  app.get("/api/relationship/growth", async (c) => {
    const ownerUid = c.get("ownerUid");
    const contacts = await prisma.contact.findMany({ where: { ownerUid, state: "active" } });
    if (contacts.length === 0) return c.json({ items: [] });
    const ids = contacts.map((x) => x.id);
    const [interactions, offerings] = await Promise.all([
      prisma.contactInteraction.groupBy({
        by: ["contactId"],
        where: { contactId: { in: ids } },
        _count: { contactId: true },
        _max: { occurredAt: true },
      }),
      prisma.offering.findMany({ where: { ownerUid, active: true } }),
    ]);
    const inter = new Map(interactions.map((x) => [x.contactId, { count: x._count.contactId, lastAt: x._max.occurredAt }]));

    // この方のニーズに刺さる「あなたの申し出」を 1 つ結びつける (モノ・サービスの提示の一手に使う)。
    const needs: ContactNeed[] = contacts.map((ct) => {
      const texts: string[] = [];
      if (ct.profileFacets) {
        try {
          const f = JSON.parse(ct.profileFacets) as Record<string, unknown>;
          if (typeof f.work === "string") texts.push(f.work);
          for (const key of ["goals", "opportunities", "concerns"]) {
            const arr = f[key];
            if (Array.isArray(arr)) for (const v of arr) if (typeof v === "string") texts.push(v);
          }
        } catch {
          // 壊れた facets は無視
        }
      }
      if (ct.personalProfile) texts.push(ct.personalProfile);
      if (ct.valuesProfile) texts.push(ct.valuesProfile);
      if (ct.notes) texts.push(ct.notes);
      return { id: ct.id, name: ct.name, distance: ct.distance, needTexts: texts };
    });
    const offeringByContact = new Map<string, string>();
    for (const o of offerings) {
      const like: OfferingLike = {
        id: o.id,
        kind: o.kind,
        title: o.title,
        description: o.description,
        category: o.category,
        situations: o.situations ? (JSON.parse(o.situations) as string[]) : [],
        maxDistance: o.maxDistance,
      };
      for (const m of matchOfferingToContacts(like, needs, 50)) {
        if (!offeringByContact.has(m.contactId)) offeringByContact.set(m.contactId, o.title);
      }
    }

    const now = Date.now();
    const people: GrowthInput[] = contacts.map((ct) => {
      const it = inter.get(ct.id);
      const goal = parseGoalField(ct.goal);
      return {
        id: ct.id,
        name: ct.name,
        company: ct.company,
        title: ct.title,
        distance: ct.distance,
        hasEmail: !!ct.email,
        hasPhone: !!ct.phone,
        interactionCount: it?.count ?? 0,
        lastContactDays: it?.lastAt ? Math.floor((now - it.lastAt.getTime()) / 86_400_000) : null,
        hasFacets: !!ct.profileFacets,
        hasDigest: !!ct.profileDigest,
        hasGoal: !!goal,
        goalTargetDistance: goal?.targetDistance ?? null,
        sourceHits: ct.sourceHits,
        focusPreference: ct.focusPreference,
        offeringTitle: offeringByContact.get(ct.id) ?? null,
      };
    });
    const emailById = new Map(contacts.map((ct) => [ct.id, ct.email]));
    const items = pickGrowthContacts(people, 16).map((p) => ({ ...p, email: emailById.get(p.contactId) ?? null }));
    return c.json({ items });
  });

  // ---------------- 一斉配信 (メールのお便り) ----------------
  // 1 通の文面を、選んだ相手にまとめて送る。文面はテンプレ + お名前差し込み (AI 費用ゼロ)。
  // 送信は少しずつ (日次上限) + 配信停止リンク + 送信者表示を必ず付ける (到達性と法の順守)。
  const campaignSecret = () => process.env.DATA_ENCRYPTION_KEY ?? "bonds-campaign-secret";
  const parseSegment = (raw: unknown): Segment => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const seg: Segment = {};
    if (s.all === true) seg.all = true;
    if (typeof s.distanceMax === "number" && s.distanceMax >= 1 && s.distanceMax <= 5) seg.distanceMax = Math.floor(s.distanceMax);
    if (typeof s.lastContactDaysMin === "number" && s.lastContactDaysMin >= 0) seg.lastContactDaysMin = Math.floor(s.lastContactDaysMin);
    if (typeof s.company === "string" && s.company.trim()) seg.company = s.company.trim().slice(0, 80);
    if (s.pinnedOnly === true) seg.pinnedOnly = true;
    return seg;
  };
  // セグメントに合う連絡先を、配信停止・メール無し・重複を除いて解決する。
  const resolveCampaignRecipients = async (ownerUid: string, seg: Segment) => {
    const [contacts, interactions, suppressions] = await Promise.all([
      prisma.contact.findMany({ where: { ownerUid, state: "active" } }),
      prisma.contactInteraction.groupBy({ by: ["contactId"], _max: { occurredAt: true }, where: { contact: { ownerUid } } }),
      prisma.emailSuppression.findMany({ where: { ownerUid }, select: { emailHash: true } }),
    ]);
    const lastById = new Map(interactions.map((x) => [x.contactId, x._max.occurredAt]));
    const suppressed = new Set(suppressions.map((s) => s.emailHash));
    const now = Date.now();
    const seenEmail = new Set<string>();
    const out: { contactId: string; email: string }[] = [];
    for (const ct of contacts) {
      const last = lastById.get(ct.id) ?? null;
      const cc: CampaignContact = {
        id: ct.id,
        name: ct.name,
        company: ct.company,
        email: ct.email,
        distance: ct.distance,
        lastContactDays: last ? Math.floor((now - last.getTime()) / 86_400_000) : null,
        focusPreference: ct.focusPreference,
      };
      if (!matchesSegment(cc, seg)) continue;
      const email = normalizeEmail(ct.email as string);
      if (suppressed.has(emailHash(email, campaignSecret()))) continue; // 配信停止済み
      if (seenEmail.has(email)) continue; // 同じメールは 1 通だけ
      seenEmail.add(email);
      out.push({ contactId: ct.id, email });
    }
    return out;
  };

  const serializeCampaign = (row: {
    id: string; subject: string; body: string; segment: unknown; fromName: string | null;
    status: string; dailyLimit: number; total: number; sent: number; failed: number; skipped: number;
    createdAt: Date; approvedAt: Date | null;
  }) => ({
    id: row.id,
    subject: row.subject,
    body: row.body,
    segment: row.segment,
    fromName: row.fromName,
    status: row.status,
    dailyLimit: row.dailyLimit,
    total: row.total,
    sent: row.sent,
    failed: row.failed,
    skipped: row.skipped,
    createdAt: row.createdAt,
    approvedAt: row.approvedAt,
  });

  app.get("/api/campaigns", async (c) => {
    const rows = await prisma.emailCampaign.findMany({
      where: { ownerUid: c.get("ownerUid") },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return c.json({ campaigns: rows.map(serializeCampaign), mailerReady: !!mailer });
  });

  app.post("/api/campaigns", async (c) => {
    const b = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>;
    const subject = typeof b.subject === "string" ? b.subject.trim().slice(0, 200) : "";
    const body = typeof b.body === "string" ? b.body.trim().slice(0, 8000) : "";
    if (!subject || !body) return c.json({ error: "invalid_input", detail: "件名と本文を入力してください" }, 400);
    const dailyLimit = Number.isInteger(b.dailyLimit) ? Math.min(Math.max(Number(b.dailyLimit), 1), 1000) : 200;
    const row = await prisma.emailCampaign.create({
      data: {
        ownerUid: c.get("ownerUid"),
        subject,
        body,
        segment: parseSegment(b.segment) as never,
        fromName: typeof b.fromName === "string" && b.fromName.trim() ? b.fromName.trim().slice(0, 120) : null,
        dailyLimit,
      },
    });
    return c.json({ campaign: serializeCampaign(row) });
  });

  const findCampaign = async (c: Context) =>
    prisma.emailCampaign.findFirst({ where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") } });

  app.get("/api/campaigns/:id", async (c) => {
    const row = await findCampaign(c);
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ campaign: serializeCampaign(row) });
  });

  // 宛先の人数と、差し込み後の見本を返す (送る前に確かめる)。
  app.post("/api/campaigns/:id/preview", async (c) => {
    const row = await findCampaign(c);
    if (!row) return c.json({ error: "not_found" }, 404);
    const recips = await resolveCampaignRecipients(c.get("ownerUid"), parseSegment(row.segment));
    const sampleIds = recips.slice(0, 3).map((r) => r.contactId);
    const sampleContacts = await prisma.contact.findMany({ where: { id: { in: sampleIds } } });
    const samples = sampleContacts.map((ct) => ({
      name: ct.name,
      subject: renderTemplate(row.subject, { name: ct.name, company: ct.company }),
      body: renderTemplate(row.body, { name: ct.name, company: ct.company }),
    }));
    return c.json({ audience: recips.length, samples });
  });

  // 承認: セグメントを受信者に確定する (配信停止・メール無し・重複を除く)。以後 sweep が送る。
  app.post("/api/campaigns/:id/approve", async (c) => {
    const row = await findCampaign(c);
    if (!row) return c.json({ error: "not_found" }, 404);
    if (row.status === "sending" || row.status === "sent") {
      return c.json({ error: "already", detail: "この配信はすでに送信を始めています" }, 400);
    }
    const recips = await resolveCampaignRecipients(c.get("ownerUid"), parseSegment(row.segment));
    await prisma.emailCampaignRecipient.deleteMany({ where: { campaignId: row.id } });
    if (recips.length > 0) {
      await prisma.emailCampaignRecipient.createMany({
        data: recips.map((r) => ({ campaignId: row.id, contactId: r.contactId })),
        skipDuplicates: true,
      });
    }
    const updated = await prisma.emailCampaign.update({
      where: { id: row.id },
      data: { status: "approved", approvedAt: new Date(), total: recips.length, sent: 0, failed: 0, skipped: 0 },
    });
    return c.json({ campaign: serializeCampaign(updated), audience: recips.length });
  });

  // テスト送信: 差し込みの見本を、指定のアドレス (自分宛て) に 1 通だけ送る。
  app.post("/api/campaigns/:id/send-test", async (c) => {
    const row = await findCampaign(c);
    if (!row) return c.json({ error: "not_found" }, 404);
    const b = (await c.req.json<{ to?: string }>().catch(() => ({}))) as { to?: string };
    const to = typeof b.to === "string" ? b.to.trim() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return c.json({ error: "invalid_email", detail: "送信先アドレスを確かめてください" }, 400);
    if (!mailer) return c.json({ error: "unavailable", detail: "メール送信の準備がまだです" }, 503);
    const sample = { name: "（宛名の例）", company: "（会社名）" };
    const identity = row.fromName?.trim() || process.env.OUTREACH_SENDER_IDENTITY?.trim() || "bonds";
    const unsubUrl = `${webBaseUrl()}/unsubscribe?t=${signUnsub(c.get("ownerUid"), to, campaignSecret())}`;
    try {
      await mailer({
        to,
        subject: `[テスト] ${renderTemplate(row.subject, sample)}`,
        body: `${renderTemplate(row.body, sample)}\n${buildCampaignFooter(identity, unsubUrl)}`,
      });
      return c.json({ sent: true });
    } catch (e) {
      return c.json({ error: "send_failed", detail: (e instanceof Error ? e.message : String(e)).slice(0, 200) }, 502);
    }
  });

  app.post("/api/campaigns/:id/cancel", async (c) => {
    const row = await findCampaign(c);
    if (!row) return c.json({ error: "not_found" }, 404);
    const updated = await prisma.emailCampaign.update({ where: { id: row.id }, data: { status: "canceled" } });
    return c.json({ campaign: serializeCampaign(updated) });
  });

  app.delete("/api/campaigns/:id", async (c) => {
    const row = await findCampaign(c);
    if (!row) return c.json({ error: "not_found" }, 404);
    await prisma.emailCampaign.delete({ where: { id: row.id } });
    return c.json({ deleted: true });
  });

  // 毎時 sweep: 承認済みの配信を、日次上限の範囲で少しずつ送る。配信停止・メール無しは skip。
  app.post("/api/admin/campaigns/process", async (c) => {
    const batch = Math.min(Math.max(parseInt(c.req.query("batch") ?? "50", 10) || 50, 1), 500);
    if (!mailer) return c.json({ sent: 0, note: "メール送信が未設定のため保留 (設定後に送ります)" });
    const campaigns = await prisma.emailCampaign.findMany({
      where: { status: { in: ["approved", "sending"] } },
      orderBy: { approvedAt: "asc" },
      take: 10,
    });
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    let globalBudget = batch;
    let totalSent = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    for (const camp of campaigns) {
      if (globalBudget <= 0) break;
      const sentToday = await prisma.emailCampaignRecipient.count({
        where: { campaignId: camp.id, status: "sent", sentAt: { gte: startOfDay } },
      });
      const room = Math.min(camp.dailyLimit - sentToday, globalBudget);
      if (room <= 0) continue;
      const queued = await prisma.emailCampaignRecipient.findMany({
        where: { campaignId: camp.id, status: "queued" },
        take: room,
      });
      if (queued.length === 0) {
        // 残りが無い = 送り切った
        await prisma.emailCampaign.update({ where: { id: camp.id }, data: { status: "sent" } });
        continue;
      }
      if (camp.status !== "sending") {
        await prisma.emailCampaign.update({ where: { id: camp.id }, data: { status: "sending" } });
      }
      const identity = camp.fromName?.trim() || process.env.OUTREACH_SENDER_IDENTITY?.trim() || "bonds";
      const suppressions = await prisma.emailSuppression.findMany({ where: { ownerUid: camp.ownerUid }, select: { emailHash: true } });
      const suppressed = new Set(suppressions.map((s) => s.emailHash));
      for (const r of queued) {
        if (globalBudget <= 0) break;
        const contact = await prisma.contact.findFirst({ where: { id: r.contactId, ownerUid: camp.ownerUid } });
        const email = contact?.email ? normalizeEmail(contact.email) : "";
        if (!contact || !email || contact.state !== "active" || suppressed.has(emailHash(email, campaignSecret()))) {
          await prisma.emailCampaignRecipient.update({ where: { id: r.id }, data: { status: "skipped" } });
          await prisma.emailCampaign.update({ where: { id: camp.id }, data: { skipped: { increment: 1 } } });
          totalSkipped++;
          continue;
        }
        const unsubUrl = `${webBaseUrl()}/unsubscribe?t=${signUnsub(camp.ownerUid, email, campaignSecret())}`;
        const vars = { name: contact.name, company: contact.company };
        try {
          await mailer({
            to: contact.email as string,
            subject: renderTemplate(camp.subject, vars),
            body: `${renderTemplate(camp.body, vars)}\n${buildCampaignFooter(identity, unsubUrl)}`,
          });
          await prisma.emailCampaignRecipient.update({ where: { id: r.id }, data: { status: "sent", sentAt: new Date() } });
          await prisma.emailCampaign.update({ where: { id: camp.id }, data: { sent: { increment: 1 } } });
          await prisma.contactInteraction.create({
            data: { contactId: contact.id, type: "message", occurredAt: new Date(), notes: "一斉配信のお便りを送りました" },
          });
          totalSent++;
        } catch (e) {
          await prisma.emailCampaignRecipient.update({
            where: { id: r.id },
            data: { status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 200) },
          });
          await prisma.emailCampaign.update({ where: { id: camp.id }, data: { failed: { increment: 1 } } });
          totalFailed++;
        }
        globalBudget--;
      }
      // 全部さばけたら sent に
      const remaining = await prisma.emailCampaignRecipient.count({ where: { campaignId: camp.id, status: "queued" } });
      if (remaining === 0) await prisma.emailCampaign.update({ where: { id: camp.id }, data: { status: "sent" } });
    }
    return c.json({ sent: totalSent, failed: totalFailed, skipped: totalSkipped });
  });

  // 配信停止 (公開・未認証)。メールのリンクから叩かれる。HMAC 署名トークンで本人性を担保。
  app.get("/api/public/unsubscribe/:token", async (c) => {
    const decoded = verifyUnsub(c.req.param("token"), campaignSecret());
    if (!decoded) return c.json({ error: "invalid_token", detail: "リンクが正しくありません" }, 400);
    await prisma.emailSuppression.upsert({
      where: { ownerUid_emailHash: { ownerUid: decoded.ownerUid, emailHash: emailHash(decoded.email, campaignSecret()) } },
      update: {},
      create: { ownerUid: decoded.ownerUid, emailHash: emailHash(decoded.email, campaignSecret()), reason: "unsubscribe" },
    });
    return c.json({ ok: true });
  });

  // ---------------- 軸検索 (影響力・専門性・価値観・誠実さ/評判) ----------------
  // 蓄積した記録と、公人リンク先の評価スコアだけで採点する (AI 不要・毎回無料・web 検索なし)。
  app.get("/api/relationship/axis-search", async (c) => {
    const axis = c.req.query("axis") as Axis;
    if (!AXES.includes(axis)) return c.json({ error: "invalid_axis", detail: "軸を指定してください" }, 400);
    const ownerUid = c.get("ownerUid");
    const contacts = await prisma.contact.findMany({ where: { ownerUid, state: "active" } });
    if (contacts.length === 0) return c.json({ axis, label: AXIS_LABEL[axis], items: [] });
    // 公人リンク → 最新 completed 評価の moduleScore (10 段階)
    const links = await prisma.personLink.findMany({ where: { ownerUid }, select: { contactId: true, subjectId: true } });
    const subjectIds = [...new Set(links.map((l) => l.subjectId))];
    const runs = subjectIds.length
      ? await prisma.personDueDiligence.findMany({
          where: { subjectId: { in: subjectIds }, status: "completed" },
          orderBy: { createdAt: "desc" },
          select: { subjectId: true, ddType: true, moduleScore: true },
        })
      : [];
    const scoreBySubject = new Map<string, { dd7: number | null; svc: number | null }>();
    for (const r of runs) {
      const cur = scoreBySubject.get(r.subjectId) ?? { dd7: null, svc: null };
      if (r.ddType === "consciousness_7d" && cur.dd7 == null) cur.dd7 = r.moduleScore;
      if (r.ddType === "social_value_creation" && cur.svc == null) cur.svc = r.moduleScore;
      scoreBySubject.set(r.subjectId, cur);
    }
    const ddByContact = new Map<string, { dd7: number | null; svc: number | null }>();
    for (const l of links) {
      const s = scoreBySubject.get(l.subjectId);
      if (s && !ddByContact.has(l.contactId)) ddByContact.set(l.contactId, s);
    }
    const people: AxisInput[] = contacts.map((ct) => {
      let facetsSkills: string[] = [];
      let facetsValues: string | null = null;
      if (ct.profileFacets) {
        try {
          const f = JSON.parse(ct.profileFacets) as { skills?: unknown; values?: unknown };
          if (Array.isArray(f.skills)) facetsSkills = f.skills.filter((x): x is string => typeof x === "string");
          if (typeof f.values === "string") facetsValues = f.values;
        } catch {
          // 壊れた facets は無視
        }
      }
      const dd = ddByContact.get(ct.id);
      return {
        id: ct.id,
        name: ct.name,
        company: ct.company,
        title: ct.title,
        distance: ct.distance,
        sourceHits: ct.sourceHits,
        valuesProfile: ct.valuesProfile,
        notes: ct.notes,
        digest: ct.profileDigest,
        facetsSkills,
        facetsValues,
        hasGoal: !!ct.goal,
        ddScore7d: dd?.dd7 ?? null,
        ddScoreSvc: dd?.svc ?? null,
      };
    });
    return c.json({ axis, label: AXIS_LABEL[axis], items: searchByAxis(axis, people, 30) });
  });

  // ---------------- 公人評価の自動下ごしらえ (dd-scan) ----------------
  // 公人らしい肩書きの連絡先を候補確認 (identify) にかけ、一意に特定できた方は評価対象に
  // 自動登録して順に評価する。特定不能・候補多数は保留にし、ユーザーが候補から選ぶ
  // (最終判断はユーザー・人物DD の倫理は不変 = 公人のみ・私人は評価しない)。
  const createSubjectWithHint = async (name: string, profileHint: string | null) => {
    const base = slugify(name);
    let slug = base;
    for (let i = 2; await prisma.ddSubject.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
    return prisma.ddSubject.create({
      data: { slug, name, subjectType: "other", profileHint: clampProfileHint(profileHint ?? undefined) },
    });
  };

  app.post("/api/admin/contacts/dd-scan", async (c) => {
    const batch = Math.min(Math.max(parseInt(c.req.query("batch") ?? "2", 10) || 2, 0), 5);
    // フェーズ1: 未確認の公人らしい方を identify にかける
    const [existingSug, linked] = await Promise.all([
      prisma.ddSuggestion.findMany({ select: { ownerUid: true, contactId: true } }),
      prisma.personLink.findMany({ select: { contactId: true } }),
    ]);
    const sugKey = new Set(existingSug.map((s) => `${s.ownerUid}:${s.contactId}`));
    const linkedIds = new Set(linked.map((l) => l.contactId));
    const pool = await prisma.contact.findMany({
      where: { state: "active" },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const targets = pool
      .filter(
        (ct) =>
          ct.focusPreference !== "excluded" &&
          !linkedIds.has(ct.id) &&
          !sugKey.has(`${ct.ownerUid}:${ct.id}`) &&
          looksLikePublicFigure(ct),
      )
      .slice(0, batch);
    let identified = 0;
    let held = 0;
    for (const ct of targets) {
      const r = await identifyPersonByName(ct.name);
      if (!r.ok) {
        if (r.status === 422 || r.status === 503) break; // キャップ/未設定: 今回はここまで
        continue; // 一時失敗は次回また
      }
      if (r.candidates.length === 1) {
        // 一意に特定 → 評価対象に自動登録 + 連絡先とリンク (評価はフェーズ2 が順に実施)
        const subject = await createSubjectWithHint(r.candidates[0]!.name, r.candidates[0]!.description);
        await prisma.personLink.create({ data: { ownerUid: ct.ownerUid, contactId: ct.id, subjectId: subject.id } });
        await prisma.ddSuggestion.create({
          data: { ownerUid: ct.ownerUid, contactId: ct.id, status: "resolved", subjectId: subject.id, candidates: JSON.stringify(r.candidates) },
        });
        identified++;
      } else {
        // 特定できない (0件) / 候補が多い (2件以上) → 保留してユーザーが選ぶ
        await prisma.ddSuggestion.create({
          data: { ownerUid: ct.ownerUid, contactId: ct.id, status: "pending", candidates: JSON.stringify(r.candidates) },
        });
        held++;
      }
    }
    // フェーズ2: 登録済みでまだ評価が無い対象を 1 件だけ評価する (コストを抑えて順に)
    let evaluated = 0;
    const ng = await preflight();
    if (!ng) {
      const resolved = await prisma.ddSuggestion.findMany({
        where: { status: "resolved", subjectId: { not: null } },
        orderBy: { updatedAt: "asc" },
        take: 20,
      });
      for (const sug of resolved) {
        const runCount = await prisma.personDueDiligence.count({ where: { subjectId: sug.subjectId! } });
        if (runCount > 0) continue; // 実施済み (失敗含む。無限再試行しない)
        const model = await resolveModel();
        await Promise.allSettled(
          DD_TYPES.map((ddType) =>
            runPersonDd({ prisma, generate: generate!, search: ddSearch }, { subjectId: sug.subjectId!, ddType, model, locale: "ja" }),
          ),
        );
        evaluated++;
        break; // 1 sweep に 1 人 (評価は重い)
      }
    }
    return c.json({ scanned: targets.length, identified, held, evaluated });
  });

  // 公人評価の確認待ち (保留) の一覧。連絡先名と候補を返し、ユーザーが選ぶ。
  app.get("/api/relationship/dd-suggestions", async (c) => {
    const rows = await prisma.ddSuggestion.findMany({
      where: { ownerUid: c.get("ownerUid"), status: "pending" },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    if (rows.length === 0) return c.json({ items: [] });
    const contacts = await prisma.contact.findMany({
      where: { id: { in: rows.map((r) => r.contactId) } },
      select: { id: true, name: true, company: true, title: true },
    });
    const byId = new Map(contacts.map((ct) => [ct.id, ct]));
    return c.json({
      items: rows
        .filter((r) => byId.has(r.contactId))
        .map((r) => {
          let candidates: IdentifyCandidate[] = [];
          try {
            candidates = r.candidates ? (JSON.parse(r.candidates) as IdentifyCandidate[]) : [];
          } catch {
            candidates = [];
          }
          const ct = byId.get(r.contactId)!;
          return { id: r.id, contactId: ct.id, name: ct.name, company: ct.company, title: ct.title, candidates };
        }),
    });
  });

  // 保留の解決: ユーザーが候補を選ぶ (candidateIndex)。省略時は連絡先の名前のまま登録。
  // 評価そのものは次の毎時 sweep (dd-scan フェーズ2) が順に実施する。
  app.post("/api/relationship/dd-suggestions/:id/resolve", async (c) => {
    const sug = await prisma.ddSuggestion.findFirst({ where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") } });
    if (!sug || sug.status !== "pending") return c.json({ error: "not_found" }, 404);
    const contact = await prisma.contact.findFirst({ where: { id: sug.contactId, ownerUid: c.get("ownerUid") } });
    if (!contact) return c.json({ error: "not_found" }, 404);
    const b = (await c.req.json<{ candidateIndex?: number }>().catch(() => ({}))) as { candidateIndex?: number };
    let candidates: IdentifyCandidate[] = [];
    try {
      candidates = sug.candidates ? (JSON.parse(sug.candidates) as IdentifyCandidate[]) : [];
    } catch {
      candidates = [];
    }
    const chosen =
      typeof b.candidateIndex === "number" && b.candidateIndex >= 0 && b.candidateIndex < candidates.length
        ? candidates[b.candidateIndex]!
        : { name: contact.name, description: "" };
    const subject = await createSubjectWithHint(chosen.name, chosen.description || null);
    await prisma.personLink.upsert({
      where: { ownerUid_contactId_subjectId: { ownerUid: contact.ownerUid, contactId: contact.id, subjectId: subject.id } },
      update: {},
      create: { ownerUid: contact.ownerUid, contactId: contact.id, subjectId: subject.id },
    });
    await prisma.ddSuggestion.update({ where: { id: sug.id }, data: { status: "resolved", subjectId: subject.id } });
    return c.json({ resolved: true, subjectSlug: subject.slug });
  });

  app.post("/api/relationship/dd-suggestions/:id/dismiss", async (c) => {
    const sug = await prisma.ddSuggestion.findFirst({ where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") } });
    if (!sug) return c.json({ error: "not_found" }, 404);
    await prisma.ddSuggestion.update({ where: { id: sug.id }, data: { status: "dismissed" } });
    return c.json({ dismissed: true });
  });

  // 公開掲示板 (/market) への問い合わせ (受け箱)。訪問者からの反応を一覧し、承認で

  // 公開掲示板 (/market) への問い合わせ (受け箱)。訪問者からの反応を一覧し、承認で
  // 新しい連絡先として取り込む (収集の入口)。名乗り・連絡先・本文は復号して返す = オーナーのみ。
  app.get("/api/relationship/offering-interests", async (c) => {
    const rows = await prisma.offeringInterest.findMany({
      where: { ownerUid: c.get("ownerUid"), status: "new" },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    // 暗号化列 (offering.title) は relation include では復号されないため、別 findMany で引く
    const offs = rows.length
      ? await prisma.offering.findMany({
          where: { id: { in: [...new Set(rows.map((r) => r.offeringId))] } },
          select: { id: true, title: true, kind: true },
        })
      : [];
    const offById = new Map(offs.map((o) => [o.id, o]));
    return c.json({
      interests: rows.map((r) => {
        const off = offById.get(r.offeringId);
        return {
          id: r.id,
          offeringTitle: off?.title ?? "",
          offeringKindLabel: off ? OFFERING_KIND_LABEL[off.kind] ?? off.kind : "",
          guestName: r.guestName,
          guestContact: r.guestContact,
          message: r.message,
          createdAt: r.createdAt,
        };
      }),
    });
  });

  // 問い合わせを承認 → 新しい連絡先を作り、接触記録に還流。以後は連絡先画面から対応する。
  app.post("/api/relationship/offering-interests/:id/approve", async (c) => {
    const ownerUid = c.get("ownerUid");
    const interest = await prisma.offeringInterest.findFirst({
      where: { id: c.req.param("id"), ownerUid, status: "new" },
    });
    if (!interest) return c.json({ error: "not_found" }, 404);
    // offering.title は暗号化列 = 別引きで復号する
    const off = await prisma.offering.findUnique({
      where: { id: interest.offeringId },
      select: { title: true },
    });
    const offerTitle = off?.title ?? "掲示板";
    const email = interest.guestContact && /@/.test(interest.guestContact) ? interest.guestContact.trim() : null;
    const contact = await prisma.contact.create({
      data: {
        ownerUid,
        name: interest.guestName,
        email,
        distance: 5, // 出会ったばかりの遠い距離から
        source: "market",
        notes: interest.message ? `掲示板「${offerTitle}」への問い合わせ: ${interest.message}` : null,
      },
    });
    await prisma.contactInteraction.create({
      data: {
        contactId: contact.id,
        type: "market_interest",
        occurredAt: new Date(),
        notes: `掲示板「${offerTitle}」から問い合わせ`,
      },
    });
    await prisma.offeringInterest.update({
      where: { id: interest.id },
      data: { status: "approved", contactId: contact.id },
    });
    return c.json({ approved: true, contactId: contact.id });
  });

  app.post("/api/relationship/offering-interests/:id/dismiss", async (c) => {
    const interest = await prisma.offeringInterest.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid"), status: "new" },
    });
    if (!interest) return c.json({ error: "not_found" }, 404);
    await prisma.offeringInterest.update({ where: { id: interest.id }, data: { status: "dismissed" } });
    return c.json({ dismissed: true });
  });

  // 共有リンクの作成
  app.post("/api/schedule/shares", async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const input = parseShareInput(body);
    let contactId: string | null = null;
    if (typeof body.contactId === "string" && body.contactId) {
      const contact = await prisma.contact.findFirst({
        where: { id: body.contactId, ownerUid: c.get("ownerUid") },
      });
      if (!contact) return c.json({ error: "not_found", detail: "この方が見つかりませんでした" }, 404);
      contactId = contact.id;
    }
    const share = await prisma.scheduleShare.create({
      data: {
        ownerUid: c.get("ownerUid"),
        contactId,
        shareKey: randomUUID(),
        title: input.title,
        displayName: input.displayName,
        method: input.method,
        note: input.note,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        slotMinutes: input.slotMinutes,
        passwordHash: input.password ? hashSharePassword(input.password) : null,
        expiresAt: input.expiresAt,
      },
    });
    return c.json({ id: share.id, shareKey: share.shareKey, url: `${publicWebUrl}/s/${share.shareKey}` }, 201);
  });

  // 共有リンクの一覧 (待っている提案の数つき)
  app.get("/api/schedule/shares", async (c) => {
    const shares = await prisma.scheduleShare.findMany({
      where: { ownerUid: c.get("ownerUid"), state: "active" },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { proposals: { select: { status: true } } },
    });
    return c.json({
      shares: shares.map((s) => ({
        id: s.id,
        shareKey: s.shareKey,
        url: `${publicWebUrl}/s/${s.shareKey}`,
        title: s.title,
        contactId: s.contactId,
        method: s.method,
        periodStart: s.periodStart,
        periodEnd: s.periodEnd,
        slotMinutes: s.slotMinutes,
        hasPassword: !!s.passwordHash,
        expiresAt: s.expiresAt,
        pendingProposals: s.proposals.filter((p) => p.status === "proposed").length,
        acceptedProposals: s.proposals.filter((p) => p.status === "accepted").length,
      })),
    });
  });

  // 共有リンクの詳細 (提案の中身は復号して返す = オーナーのみ)。
  // 提案は include でなく別クエリで読む (暗号化の復号はモデル直のクエリにだけ効く)。
  app.get("/api/schedule/shares/:id", async (c) => {
    const share = await prisma.scheduleShare.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!share) return c.json({ error: "not_found" }, 404);
    const [proposals, participants] = await Promise.all([
      prisma.scheduleShareProposal.findMany({
        where: { shareId: share.id },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.scheduleShareParticipant.findMany({
        where: { shareId: share.id },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    const { passwordHash: _ph, ...rest } = share;
    return c.json({
      ...rest,
      proposals,
      participants: participants.map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt })),
      hasPassword: !!share.passwordHash,
      url: `${publicWebUrl}/s/${share.shareKey}`,
    });
  });

  // 共有リンクの更新 (ひとこと・期間・パスワード・期限・閉じる)
  app.put("/api/schedule/shares/:id", async (c) => {
    const share = await prisma.scheduleShare.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!share) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const data: Record<string, unknown> = {};
    if (body.title !== undefined || body.note !== undefined || body.displayName !== undefined ||
        body.method !== undefined || body.slotMinutes !== undefined ||
        body.periodStart !== undefined || body.periodEnd !== undefined || body.periodDays !== undefined ||
        body.expiresAt !== undefined) {
      const input = parseShareInput({
        title: body.title ?? share.title,
        displayName: body.displayName ?? share.displayName,
        method: body.method ?? share.method,
        note: body.note ?? share.note,
        periodStart: body.periodStart ?? share.periodStart.toISOString(),
        periodEnd: body.periodEnd ?? share.periodEnd.toISOString(),
        slotMinutes: body.slotMinutes ?? share.slotMinutes,
        expiresAt: body.expiresAt !== undefined ? body.expiresAt : (share.expiresAt?.toISOString() ?? null),
      });
      Object.assign(data, {
        title: input.title,
        displayName: input.displayName,
        method: input.method,
        note: input.note,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        slotMinutes: input.slotMinutes,
        expiresAt: input.expiresAt,
      });
    }
    // パスワード: 文字列 = 設定し直し、null = 外す、未指定 = そのまま
    if (typeof body.password === "string" && body.password.trim()) {
      data.passwordHash = hashSharePassword(body.password.trim().slice(0, 100));
    } else if (body.password === null) {
      data.passwordHash = null;
    }
    if (body.state === "archived" || body.state === "active") data.state = body.state;
    const updated = await prisma.scheduleShare.update({ where: { id: share.id }, data: data as never });
    return c.json({ id: updated.id, state: updated.state });
  });

  // 共有リンクの削除 (提案ごと消える = 1 件単位の削除の導線)
  app.delete("/api/schedule/shares/:id", async (c) => {
    const share = await prisma.scheduleShare.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!share) return c.json({ error: "not_found" }, 404);
    await prisma.scheduleShare.delete({ where: { id: share.id } });
    return c.json({ deleted: true });
  });

  // 提案の承認: 候補のひとつを選んで確定。相手が紐づいていれば接触記録へ還流する
  app.post("/api/schedule/shares/:id/proposals/:pid/accept", async (c) => {
    const share = await prisma.scheduleShare.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!share) return c.json({ error: "not_found" }, 404);
    const proposal = await prisma.scheduleShareProposal.findFirst({
      where: { id: c.req.param("pid"), shareId: share.id },
    });
    if (!proposal) return c.json({ error: "not_found" }, 404);
    if (proposal.status !== "proposed") {
      return c.json({ error: "already_decided", detail: "この提案はすでにお返事済みです" }, 409);
    }
    const body = await c.req.json<{ start?: string }>().catch(() => ({}) as { start?: string });
    const candidates = parseIsoIntervals(proposal.candidates);
    const chosen = body.start
      ? candidates.find((x) => x.start.toISOString() === new Date(body.start!).toISOString())
      : candidates[0];
    if (!chosen) return c.json({ error: "invalid_candidate", detail: "候補の時間を読み取れませんでした" }, 400);
    const decidedSlot = { start: chosen.start.toISOString(), end: chosen.end.toISOString() };
    await prisma.scheduleShareProposal.update({
      where: { id: proposal.id },
      data: { status: "accepted", decidedSlot: decidedSlot as never },
    });
    if (share.contactId) {
      const d = chosen.start;
      await prisma.contactInteraction.create({
        data: {
          contactId: share.contactId,
          type: "meeting",
          occurredAt: chosen.start,
          notes: `日程調整で面談が決まりました (${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}時${d.getMinutes() === 0 ? "" : `${d.getMinutes()}分`}から)`,
        },
      });
    }
    const ics = buildMeetingInviteIcs({
      title: proposal.guestName ? `${proposal.guestName}様と面談` : "面談",
      start: chosen.start,
      end: chosen.end,
      description: "bonds の日程調整で確定",
    });
    return c.json({ accepted: true, decidedSlot, ics });
  });

  // 提案の見送り
  app.post("/api/schedule/shares/:id/proposals/:pid/decline", async (c) => {
    const share = await prisma.scheduleShare.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!share) return c.json({ error: "not_found" }, 404);
    const proposal = await prisma.scheduleShareProposal.findFirst({
      where: { id: c.req.param("pid"), shareId: share.id, status: "proposed" },
    });
    if (!proposal) return c.json({ error: "not_found" }, 404);
    await prisma.scheduleShareProposal.update({ where: { id: proposal.id }, data: { status: "declined" } });
    return c.json({ declined: true });
  });

  // ---- 公開側 (認証なし。shareKey が唯一のスコープ) ----

  // 公開ページから見える共有の骨格。パスワードつきで未解錠なら locked だけ返す
  const loadVisibleShare = async (shareKey: string) => {
    const share = await prisma.scheduleShare.findUnique({ where: { shareKey } });
    if (!share || !shareIsVisible(share)) return null;
    return share;
  };

  const shareUnlocked = (share: { shareKey: string; passwordHash: string | null }, proof: string | undefined): boolean => {
    if (!share.passwordHash) return true;
    return !!proof && verifyShareProof(share.shareKey, share.passwordHash, proof);
  };

  app.get("/api/public/schedule/:shareKey", async (c) => {
    const share = await loadVisibleShare(c.req.param("shareKey"));
    if (!share) return c.json({ error: "not_found", detail: "このページは終了したか、見つかりませんでした" }, 404);
    const locked = !shareUnlocked(share, c.req.query("proof"));
    const participants = locked
      ? []
      : await prisma.scheduleShareParticipant.findMany({
          where: { shareId: share.id },
          orderBy: { createdAt: "asc" },
          select: { name: true },
        });
    return c.json({
      locked,
      // あいことばで保護中は、解錠前に中身 (面談タイトル・主催者の表示名=実名になり得る)
      // を出さない。解錠して初めて title / displayName を返す。
      ...(locked
        ? {}
        : {
            title: share.title,
            displayName: share.displayName,
            method: share.method,
            methodLabel: SHARE_METHOD_LABEL[share.method as ShareMethod] ?? share.method,
            note: share.note,
            periodStart: share.periodStart,
            periodEnd: share.periodEnd,
            slotMinutes: share.slotMinutes,
            participants: participants.map((p) => p.name),
            // ゲストが Google で予定表を重ねられるか (OAuth 未設定なら ICS だけ出す)
            googleReady: !!google,
          }),
    });
  });

  app.post("/api/public/schedule/:shareKey/unlock", async (c) => {
    // あいことばのオンライン総当り対策 (IP あたり窓内の試行数を制限)
    if (!unlockLimiter.take(clientKey(c.req.raw.headers))) return tooMany(c);
    const share = await loadVisibleShare(c.req.param("shareKey"));
    if (!share) return c.json({ error: "not_found" }, 404);
    if (!share.passwordHash) return c.json({ proof: "" });
    const body = await c.req.json<{ password?: string }>().catch(() => ({}) as { password?: string });
    if (!body.password || !verifySharePassword(body.password, share.passwordHash)) {
      return c.json({ error: "wrong_password", detail: "あいことばが違うようです" }, 403);
    }
    return c.json({ proof: shareProof(share.shareKey, share.passwordHash) });
  });

  // 相手に見せる選択肢 (空き枠を面談時間で刻んだ開始時刻)。予定の中身は一切出さない。
  // 参加者 (同じ URL に入って予定表を重ねた方) がいれば、全員の共通の空きに絞る
  // (timeshare の重なり表示の踏襲)。
  const shareStartOptions = async (share: {
    id: string;
    ownerUid: string;
    periodStart: Date;
    periodEnd: Date;
    slotMinutes: number;
  }): Promise<{ options: Interval[]; participantNames: string[] }> => {
    const period = { from: new Date(), periodStart: share.periodStart, periodEnd: share.periodEnd };
    const [{ free, avail }, participants] = await Promise.all([
      myFreeIntervals(share.ownerUid, period),
      prisma.scheduleShareParticipant.findMany({ where: { shareId: share.id }, orderBy: { createdAt: "asc" } }),
    ]);
    let common = free;
    for (const p of participants) {
      // 参加者の空き = 期間内の busy の補集合 (終日)。時間帯の制約は主催者の空きが担う
      const pFree = freeIntervalsByAvailability(
        parseIsoIntervals(p.busySlots),
        period,
        fullDayAvailability(avail.minMinutes),
      );
      common = intersectSlots(common, pFree, avail.minMinutes);
    }
    return { options: startOptions(common, share.slotMinutes), participantNames: participants.map((p) => p.name) };
  };

  app.get("/api/public/schedule/:shareKey/slots", async (c) => {
    const share = await loadVisibleShare(c.req.param("shareKey"));
    if (!share) return c.json({ error: "not_found" }, 404);
    if (!shareUnlocked(share, c.req.query("proof"))) return c.json({ error: "locked" }, 403);
    const { options, participantNames } = await shareStartOptions(share);
    return c.json({
      options: intervalsToIso(options),
      slotMinutes: share.slotMinutes,
      participants: participantNames,
      basis: participantNames.length > 0 ? "common" : "owner",
    });
  });

  // 参加者の予定表の受け取り (ICS の URL / 貼り付け / 枠の配列)。予定の中身は保存せず
  // busy の枠 (時刻) だけを預かる。名乗りと ICS URL は暗号化。
  const MAX_PARTICIPANTS_PER_SHARE = 10;
  const MAX_PARTICIPANT_BUSY = 2000;

  const parseParticipantBusy = async (
    body: Record<string, unknown>,
  ): Promise<{ busy: ReturnType<typeof toIso>; icsUrl: string | null } | { error: string; detail: string }> => {
    if (typeof body.icsUrl === "string" && body.icsUrl.trim()) {
      const url = body.icsUrl.trim();
      if (!/^https:\/\//.test(url)) return { error: "invalid_url", detail: "https の予定表アドレスを入れてください" };
      if (!fetchText) return { error: "unavailable", detail: "いまは予定表を取得できません" };
      let content: string;
      try {
        content = await fetchText(url);
      } catch {
        return { error: "ics_fetch_failed", detail: "予定表を取得できませんでした。アドレスを確かめてください" };
      }
      if (!looksLikeIcs(content)) return { error: "not_ics", detail: "予定表の形式を読み取れませんでした" };
      return { busy: parseIcsBusy(content).slice(0, MAX_PARTICIPANT_BUSY), icsUrl: url };
    }
    if (typeof body.ics === "string" && body.ics.trim()) {
      if (!looksLikeIcs(body.ics)) return { error: "not_ics", detail: "予定表の形式を読み取れませんでした" };
      return { busy: parseIcsBusy(body.ics).slice(0, MAX_PARTICIPANT_BUSY), icsUrl: null };
    }
    return { busy: toIso(parseIsoIntervals(body.busySlots)).slice(0, MAX_PARTICIPANT_BUSY), icsUrl: null };
  };

  app.post("/api/public/schedule/:shareKey/participants", async (c) => {
    if (!publicWriteLimiter.take(clientKey(c.req.raw.headers))) return tooMany(c);
    const share = await loadVisibleShare(c.req.param("shareKey"));
    if (!share) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    if (!shareUnlocked(share, typeof body.proof === "string" ? body.proof : undefined)) {
      return c.json({ error: "locked" }, 403);
    }
    const name = sanitizeProse(typeof body.name === "string" ? body.name : "").trim().slice(0, 60);
    if (!name) return c.json({ error: "name_required", detail: "お名前を入れてください" }, 400);
    const count = await prisma.scheduleShareParticipant.count({ where: { shareId: share.id } });
    if (count >= MAX_PARTICIPANTS_PER_SHARE) {
      return c.json({ error: "too_many", detail: "重ねられる人数がいっぱいです" }, 429);
    }
    const parsed = await parseParticipantBusy(body);
    if ("error" in parsed) return c.json(parsed, 400);
    const participant = await prisma.scheduleShareParticipant.create({
      data: {
        shareId: share.id,
        participantKey: randomUUID(),
        name,
        icsUrl: parsed.icsUrl,
        busySlots: parsed.busy as never,
      },
    });
    return c.json({ joined: true, participantKey: participant.participantKey }, 201);
  });

  // 自分の分の更新 (最新の予定表を入れ直す)。participantKey が本人の鍵
  app.put("/api/public/schedule/:shareKey/participants/:participantKey", async (c) => {
    if (!publicWriteLimiter.take(clientKey(c.req.raw.headers))) return tooMany(c);
    const share = await loadVisibleShare(c.req.param("shareKey"));
    if (!share) return c.json({ error: "not_found" }, 404);
    const participant = await prisma.scheduleShareParticipant.findFirst({
      where: { participantKey: c.req.param("participantKey"), shareId: share.id },
    });
    if (!participant) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const parsed = await parseParticipantBusy(body);
    if ("error" in parsed) return c.json(parsed, 400);
    await prisma.scheduleShareParticipant.update({
      where: { id: participant.id },
      data: { busySlots: parsed.busy as never, ...(parsed.icsUrl ? { icsUrl: parsed.icsUrl } : {}) },
    });
    return c.json({ updated: true });
  });

  // 自分の分を外す (1 件単位の削除の導線はゲストにも用意する = データ主権)
  app.delete("/api/public/schedule/:shareKey/participants/:participantKey", async (c) => {
    const share = await loadVisibleShare(c.req.param("shareKey"));
    if (!share) return c.json({ error: "not_found" }, 404);
    const participant = await prisma.scheduleShareParticipant.findFirst({
      where: { participantKey: c.req.param("participantKey"), shareId: share.id },
    });
    if (!participant) return c.json({ error: "not_found" }, 404);
    await prisma.scheduleShareParticipant.delete({ where: { id: participant.id } });
    return c.json({ deleted: true });
  });

  const MAX_OPEN_PROPOSALS_PER_SHARE = 30;

  app.post("/api/public/schedule/:shareKey/proposals", async (c) => {
    if (!publicWriteLimiter.take(clientKey(c.req.raw.headers))) return tooMany(c);
    const share = await loadVisibleShare(c.req.param("shareKey"));
    if (!share) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    if (!shareUnlocked(share, typeof body.proof === "string" ? body.proof : undefined)) {
      return c.json({ error: "locked" }, 403);
    }
    const input = parseProposalInput(body);
    if ("error" in input) return c.json(input, 400);
    const open = await prisma.scheduleShareProposal.count({
      where: { shareId: share.id, status: "proposed" },
    });
    if (open >= MAX_OPEN_PROPOSALS_PER_SHARE) {
      return c.json({ error: "too_many", detail: "受け付けがいっぱいです。しばらくしてからお試しください" }, 429);
    }
    // サーバ側の最終検証: いま本当に空いている選択肢 (参加者がいれば共通の空き) に一致する候補だけ通す
    const { options } = await shareStartOptions(share);
    const valid = filterValidCandidates(input.candidates, options);
    if (valid.length === 0) {
      return c.json(
        { error: "slots_taken", detail: "選ばれた時間はうまりました。お手数ですが別の時間をお選びください" },
        409,
      );
    }
    const proposal = await prisma.scheduleShareProposal.create({
      data: {
        shareId: share.id,
        guestName: input.guestName,
        guestContact: input.guestContact || null,
        message: input.message || null,
        candidates: intervalsToIso(valid) as never,
      },
    });
    return c.json({ received: true, id: proposal.id, candidates: intervalsToIso(valid) }, 201);
  });

  // ---- 時間の出品 (オーナー側) ----

  app.post("/api/schedule/offers", async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const input = parseOfferInput(body);
    if ("error" in input) return c.json(input, 400);
    const window = parseOfferWindow(body.availabilityWindow);
    const offer = await prisma.timeOffer.create({
      data: {
        ownerUid: c.get("ownerUid"),
        offerKey: randomUUID(),
        ...input,
        availabilityWindow: window ? JSON.stringify(window) : null,
      },
    });
    return c.json({ id: offer.id, offerKey: offer.offerKey, url: `${publicWebUrl}/b/${offer.offerKey}` }, 201);
  });

  app.get("/api/schedule/offers", async (c) => {
    const offers = await prisma.timeOffer.findMany({
      where: { ownerUid: c.get("ownerUid") },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { bookings: { select: { status: true } } },
    });
    return c.json({
      offers: offers.map((o) => ({
        id: o.id,
        offerKey: o.offerKey,
        url: `${publicWebUrl}/b/${o.offerKey}`,
        title: o.title,
        description: o.description,
        displayName: o.displayName,
        method: o.method,
        minutes: o.minutes,
        priceJpy: o.priceJpy,
        active: o.active,
        listed: o.listed,
        availabilityWindow: o.availabilityWindow ? parseOfferWindow(JSON.parse(o.availabilityWindow)) : null,
        confirmedBookings: o.bookings.filter((b) => b.status === "confirmed").length,
      })),
      paymentsReady: !!stripe,
      // 決済の mode。test の鍵ではテスト用カードしか通らない (実際の支払いは live 鍵が要る)。
      stripeMode: stripe ? ((process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live") ? "live" : "test") : null,
      marketUrl: `${publicWebUrl}/market`,
    });
  });

  app.put("/api/schedule/offers/:id", async (c) => {
    const offer = await prisma.timeOffer.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!offer) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const input = parseOfferInput({
      title: body.title ?? offer.title,
      description: body.description ?? offer.description,
      displayName: body.displayName ?? offer.displayName,
      method: body.method ?? offer.method,
      minutes: body.minutes ?? offer.minutes,
      priceJpy: body.priceJpy ?? offer.priceJpy,
      active: body.active ?? offer.active,
      listed: body.listed ?? offer.listed,
    });
    if ("error" in input) return c.json(input, 400);
    // 受付枠: body に availabilityWindow があれば更新 (null 明示で解除)。キー無しは据え置き。
    const data: typeof input & { availabilityWindow?: string | null } = { ...input };
    if ("availabilityWindow" in body) {
      const w = parseOfferWindow(body.availabilityWindow);
      data.availabilityWindow = w ? JSON.stringify(w) : null;
    }
    await prisma.timeOffer.update({ where: { id: offer.id }, data });
    return c.json({ updated: true });
  });

  app.delete("/api/schedule/offers/:id", async (c) => {
    const offer = await prisma.timeOffer.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!offer) return c.json({ error: "not_found" }, 404);
    await prisma.timeOffer.delete({ where: { id: offer.id } });
    return c.json({ deleted: true });
  });

  // 予約の一覧 (ゲストの中身は復号して返す = オーナーのみ)
  app.get("/api/schedule/bookings", async (c) => {
    const bookings = await prisma.timeBooking.findMany({
      where: { ownerUid: c.get("ownerUid") },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { offer: { select: { title: true, priceJpy: true } } },
    });
    return c.json({ bookings });
  });

  // 予約の取り消し (オーナー側。返金は Stripe の管理画面から = OWNER-SETUP.md)
  app.post("/api/schedule/bookings/:id/cancel", async (c) => {
    const booking = await prisma.timeBooking.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!booking) return c.json({ error: "not_found" }, 404);
    if (booking.status === "canceled") return c.json({ canceled: true });
    await prisma.timeBooking.update({ where: { id: booking.id }, data: { status: "canceled" } });
    return c.json({ canceled: true });
  });

  // ---- 時間の出品 (公開側) ----

  app.get("/api/public/offers/:offerKey", async (c) => {
    const offer = await prisma.timeOffer.findUnique({ where: { offerKey: c.req.param("offerKey") } });
    if (!offer || !offer.active) {
      return c.json({ error: "not_found", detail: "このページは終了したか、見つかりませんでした" }, 404);
    }
    return c.json({
      title: offer.title,
      description: offer.description,
      displayName: offer.displayName,
      method: offer.method,
      methodLabel: SHARE_METHOD_LABEL[offer.method as ShareMethod] ?? offer.method,
      minutes: offer.minutes,
      priceJpy: offer.priceJpy,
      // 有料なのに決済が未設定なら、予約に進めないことを先に伝える
      acceptingBookings: offer.priceJpy === 0 || !!stripe,
    });
  });

  app.get("/api/public/offers/:offerKey/slots", async (c) => {
    const offer = await prisma.timeOffer.findUnique({ where: { offerKey: c.req.param("offerKey") } });
    if (!offer || !offer.active) return c.json({ error: "not_found" }, 404);
    const now = new Date();
    const { free } = await myFreeIntervals(offer.ownerUid, {
      from: now,
      periodStart: now,
      periodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    });
    // 出品ごとに受付枠 (曜日・時間帯) が指定されていれば、空き時間をその中だけに絞る。
    const window = offer.availabilityWindow ? parseOfferWindow(JSON.parse(offer.availabilityWindow)) : null;
    const usable = window ? restrictToOfferWindow(free, window) : free;
    return c.json({ options: intervalsToIso(startOptions(usable, offer.minutes)), minutes: offer.minutes });
  });

  app.post("/api/public/offers/:offerKey/book", async (c) => {
    if (!publicWriteLimiter.take(clientKey(c.req.raw.headers))) return tooMany(c);
    const offer = await prisma.timeOffer.findUnique({ where: { offerKey: c.req.param("offerKey") } });
    if (!offer || !offer.active) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const input = parseProposalInput({ ...body, candidates: [body.slot] });
    if ("error" in input) return c.json(input, 400);
    // 有料枠の「枠の空押さえ」対策: 支払い前の pending が溜まりすぎたら新規を断る
    // (未払いのまま全枠を 48 時間ブロックする DoS を防ぐ)。期限切れ pending は sweep が開放する。
    if (offer.priceJpy > 0) {
      const pendingHold = new Date(Date.now() - PENDING_BOOKING_TTL_MS);
      const pending = await prisma.timeBooking.count({
        where: { offerId: offer.id, status: "pending_payment", createdAt: { gte: pendingHold } },
      });
      if (pending >= MAX_PENDING_BOOKINGS_PER_OFFER) {
        return c.json({ error: "too_many_pending", detail: "ただいま予約が混み合っています。少し時間をおいてお試しください" }, 429);
      }
    }
    if (offer.priceJpy > 0 && !stripe) {
      return c.json({ error: "unavailable", detail: "お支払いの受け付けを準備中です" }, 503);
    }
    // サーバ側の最終検証: いま本当に空いている枠か
    const now = new Date();
    const { free } = await myFreeIntervals(offer.ownerUid, {
      from: now,
      periodStart: now,
      periodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    });
    const valid = filterValidCandidates(input.candidates, startOptions(free, offer.minutes));
    const slot = valid[0];
    if (!slot) {
      return c.json({ error: "slots_taken", detail: "この時間はうまりました。別の時間をお選びください" }, 409);
    }
    const booking = await prisma.timeBooking.create({
      data: {
        offerId: offer.id,
        ownerUid: offer.ownerUid,
        guestName: input.guestName,
        guestContact: input.guestContact || null,
        message: input.message || null,
        slot: { start: slot.start.toISOString(), end: slot.end.toISOString() } as never,
        status: offer.priceJpy === 0 ? "confirmed" : "pending_payment",
        amountJpy: offer.priceJpy,
      },
    });
    if (offer.priceJpy === 0) {
      return c.json({ confirmed: true, bookingId: booking.id }, 201);
    }
    // Stripe Checkout へ (戻ってきたら booking-status で照合して確定する)
    try {
      const session = await stripe!.createCheckoutSession({
        amountJpy: offer.priceJpy,
        productName: offer.title,
        successUrl: `${publicWebUrl}/b/${offer.offerKey}/thanks?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${publicWebUrl}/b/${offer.offerKey}`,
        bookingId: booking.id,
      });
      await prisma.timeBooking.update({ where: { id: booking.id }, data: { stripeSessionId: session.id } });
      return c.json({ confirmed: false, bookingId: booking.id, checkoutUrl: session.url }, 201);
    } catch (err) {
      // 決済セッションが作れなければ予約を残さない (枠の空押さえを防ぐ)
      await prisma.timeBooking.delete({ where: { id: booking.id } }).catch(() => {});
      console.error(JSON.stringify({ event: "stripe_checkout_failed", detail: err instanceof Error ? err.message : String(err) }));
      return c.json({ error: "payment_failed", detail: "お支払いページを開けませんでした。時間をおいてお試しください" }, 502);
    }
  });

  // 決済からの戻りで照合して確定する (BMP-LP verify-session と同じ検証 = paid のみ通す)
  app.get("/api/public/offers/:offerKey/booking-status", async (c) => {
    const offer = await prisma.timeOffer.findUnique({ where: { offerKey: c.req.param("offerKey") } });
    if (!offer) return c.json({ error: "not_found" }, 404);
    const sessionId = c.req.query("session_id") ?? "";
    const booking = await prisma.timeBooking.findFirst({
      where: { offerId: offer.id, stripeSessionId: sessionId },
    });
    if (!booking) return c.json({ error: "not_found" }, 404);
    if (booking.status === "confirmed") return c.json({ status: "confirmed" });
    if (booking.status !== "pending_payment" || !stripe) return c.json({ status: booking.status });
    const session = await stripe.getSession(sessionId).catch(() => null);
    // paid かつ、支払われた金額が予約額と一致していることを確かめる (防御的な金額突合)。
    // 金額はサーバ側でセッション生成時に固定しているが、確定時にも念のため照合する。
    const amountOk =
      session?.amount_total == null || session.amount_total === booking.amountJpy;
    if (session?.payment_status === "paid" && amountOk) {
      await prisma.timeBooking.update({
        where: { id: booking.id },
        data: { status: "confirmed", paidAt: new Date() },
      });
      return c.json({ status: "confirmed" });
    }
    return c.json({ status: "pending_payment" });
  });

  // ---- 公開掲示板 (/market) ----
  // 単一オーナーの「時間の出品」と「力になれること (申し出)」を、アカウント不要の訪問者が
  // 一覧して問い合わせ・予約できる公開ページ。PII は出さない (訪問者が名乗って初めて記録)。
  // 将来「ユーザーが互いに持ち寄るマーケットプレイス」に拡張する際の主な差し替え点:
  // ここは今 published/listed を ownerUid を跨いで拾う (単一オーナーなので実質1バケツ)。
  // 多者化では per-owner スコープ + visibility (private/contacts/public/marketplace) +
  // 距離/同意ゲートに置き換える。設計は docs/FUTURE-MARKETPLACE.md。
  app.get("/api/public/market", async (c) => {
    const [offers, offerings] = await Promise.all([
      prisma.timeOffer.findMany({
        where: { listed: true, active: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.offering.findMany({
        where: { published: true, active: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);
    return c.json({
      timeOffers: offers.map((o) => ({
        offerKey: o.offerKey,
        title: o.title,
        description: o.description,
        displayName: o.displayName,
        methodLabel: SHARE_METHOD_LABEL[o.method as ShareMethod] ?? o.method,
        minutes: o.minutes,
        priceJpy: o.priceJpy,
        acceptingBookings: o.priceJpy === 0 || !!stripe,
      })),
      offerings: offerings.map((o) => ({
        id: o.id,
        kind: o.kind,
        kindLabel: OFFERING_KIND_LABEL[o.kind] ?? o.kind,
        title: o.title,
        description: o.description,
        category: o.category,
      })),
    });
  });

  // 申し出への問い合わせ (アカウント不要)。オーナーの受け箱に「新規」で入り、承認で連絡先へ。
  app.post("/api/public/market/offerings/:id/interest", async (c) => {
    if (!publicWriteLimiter.take(clientKey(c.req.raw.headers))) return tooMany(c);
    const offering = await prisma.offering.findFirst({
      where: { id: c.req.param("id"), published: true, active: true },
    });
    if (!offering) return c.json({ error: "not_found", detail: "この申し出は見つかりませんでした" }, 404);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const clamp = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
    const guestName = clamp(body.guestName, 60);
    if (!guestName) return c.json({ error: "name_required", detail: "お名前を入れてください" }, 400);
    const message = clamp(body.message, 500);
    if (!message) return c.json({ error: "message_required", detail: "ひとことメッセージを入れてください" }, 400);
    // 受け箱の詰まり防止 (未対応が多すぎる申し出は新規受付を止める)
    const open = await prisma.offeringInterest.count({ where: { offeringId: offering.id, status: "new" } });
    if (open >= 50) return c.json({ error: "too_many", detail: "受け付けがいっぱいです。しばらくしてお試しください" }, 429);
    await prisma.offeringInterest.create({
      data: {
        offeringId: offering.id,
        ownerUid: offering.ownerUid,
        guestName,
        guestContact: clamp(body.guestContact, 200) || null,
        message,
      },
    });
    return c.json({ received: true }, 201);
  });

  // 毎時 sweep: 支払い待ちの取りこぼしを Stripe に再照合し、期限切れは枠を開放する
  app.post("/api/admin/schedule/reconcile-bookings", async (c) => {
    const batch = Math.min(50, Math.max(1, Number(c.req.query("batch")) || 20));
    const pending = await prisma.timeBooking.findMany({
      where: { status: "pending_payment" },
      orderBy: { createdAt: "asc" },
      take: batch,
    });
    let confirmed = 0;
    let expired = 0;
    for (const b of pending) {
      if (stripe && b.stripeSessionId) {
        const session = await stripe.getSession(b.stripeSessionId).catch(() => null);
        if (session?.payment_status === "paid") {
          await prisma.timeBooking.update({ where: { id: b.id }, data: { status: "confirmed", paidAt: new Date() } });
          confirmed++;
          continue;
        }
      }
      if (Date.now() - b.createdAt.getTime() > PENDING_BOOKING_TTL_MS) {
        await prisma.timeBooking.update({ where: { id: b.id }, data: { status: "expired" } });
        expired++;
      }
    }
    return c.json({ checked: pending.length, confirmed, expired });
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
      (() => {
        // 関係の目標を接地する。「対応を考える」や発信文面が目標に向かって一貫する
        const goal = parseGoalField(contact.goal);
        if (!goal) return "";
        return `この関係の目標 (ユーザーが設定): ${PURPOSE_LABEL[goal.purpose]}の間柄として距離感 ${goal.targetDistance} を目指す (いまは ${contact.distance})${goal.note ? `。ねらい: ${goal.note}` : ""}。提案はこの目標に沿わせ、相手の気持ちとペースを尊重した進め方にすること`;
      })(),
      contact.profileDigest ? `いまのこの方 (蓄積した記録からの見立て): ${contact.profileDigest}` : "",
      (() => {
        const accounts = parseSnsField(contact.sns);
        return accounts.length > 0
          ? `公開アカウント: ${accounts.map((e) => `${snsPlatformLabel(e.platform)}(${e.url || e.handle})`).join(" / ")}`
          : "";
      })(),
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

  // AI 実行の共通ラッパ (キャップ確認 → 生成 → 使用記録)。
  // images を渡すと Vision (名刺・名簿の読み取り) になる。
  // 利用者にかける月次上限 (円)。オーナー本人は全体で無制限 (ownerMonthlyCapJpy)、
  // それ以外は app_config の設定値 (既定 AI_USER_CAP_DEFAULT_JPY) を各自の消費に効かせる。
  const resolveUserCap = async (): Promise<number> => {
    const row = await prisma.appConfig.findUnique({ where: { key: AI_USER_CAP_CONFIG_KEY } });
    return resolveUserCapJpy(row?.value);
  };

  const runRelationshipAi = async (
    promptKey: string,
    extraSystem: string,
    userMessage: string,
    purpose: string,
    locale: string,
    opts?: {
      images?: Array<{ base64: string; mediaType: string }>;
      maxContinuations?: number;
      // 消費の帰属先。未指定 = オーナー (管理系・sweep からの呼び出しは無制限)。
      actor?: { ownerUid: string; isOwner: boolean };
    },
  ): Promise<{ ok: true; text: string } | { ok: false; status: 422 | 503 | 502; body: unknown }> => {
    if (!generate) {
      return { ok: false, status: 503, body: { error: "unavailable", detail: "いまは文章の下書きを作れません" } };
    }
    const actor = opts?.actor ?? { ownerUid: "owner", isOwner: true };
    // オーナーは全体合計に無制限キャップ、それ以外は本人の当月消費に設定値のキャップ。
    const cost = actor.isOwner
      ? await getMonthlyCostJpy(prisma)
      : await getMonthlyCostJpyForUser(prisma, actor.ownerUid);
    const cap = actor.isOwner ? ownerMonthlyCapJpy() : await resolveUserCap();
    if (cost >= cap) {
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
        images: opts?.images,
        maxContinuations: opts?.maxContinuations,
      });
      const canonical = canonicalizeModelId(gen.model) ?? model;
      await prisma.aiUsageLog.create({
        data: {
          ownerUid: actor.ownerUid,
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

  // AI の people JSON を検証・サニタイズして applyImport 形へ (テキスト/画像で共用)。
  const parseExtractedPeople = (
    text: string,
    source: string,
  ): { contacts: ParsedContact[]; interactions: ParsedInteraction[] } => {
    const parsed = extractJson(text) as { people?: unknown } | null;
    const raw = Array.isArray(parsed?.people) ? (parsed.people as Array<Record<string, unknown>>) : [];
    const str = (v: unknown, max = 200) =>
      typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
    const isoDay = (v: unknown) =>
      typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : undefined;
    const today = new Date().toISOString().slice(0, 10);
    const contacts: ParsedContact[] = [];
    const interactions: ParsedInteraction[] = [];
    for (const p of raw.slice(0, 200)) {
      const name = stripHonorific(clampName(p?.name));
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
        source,
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
    return { contacts, interactions };
  };

  type AiActor = { ownerUid: string; isOwner: boolean };
  // requireUser を通ったリクエストの消費主体。オーナーは無制限、それ以外は設定値の月次上限。
  const actorOf = (c: Context): AiActor => ({ ownerUid: c.get("ownerUid"), isOwner: c.get("isOwner") });

  // 大きく雑多な入力でも取りこぼさないよう、本文を塊に分けて順に AI 抽出し、まとめる。
  // 1 塊あたりの文字数と塊数の上限でコストを守る (オーナーは月次無制限だが青天井にはしない)。
  const EXTRACT_CHUNK_CHARS = 15000;
  const EXTRACT_MAX_CHUNKS = 12;

  const buildExtractChunks = (texts: Array<{ file: string; kind: string; text: string }>): string[] => {
    const chunks: string[] = [];
    let cur = "";
    const flush = () => {
      if (cur.trim()) chunks.push(cur);
      cur = "";
    };
    for (const t of texts) {
      if (chunks.length >= EXTRACT_MAX_CHUNKS) break;
      const header = `ファイル ${t.file} (${t.kind}) の内容:\n`;
      if (header.length + t.text.length > EXTRACT_CHUNK_CHARS) {
        // 大きいファイルは分割 (見出しを各塊の頭に付けて文脈を保つ)
        flush();
        for (let i = 0; i < t.text.length && chunks.length < EXTRACT_MAX_CHUNKS; i += EXTRACT_CHUNK_CHARS) {
          chunks.push(header + t.text.slice(i, i + EXTRACT_CHUNK_CHARS));
        }
      } else if (cur.length + header.length + t.text.length > EXTRACT_CHUNK_CHARS) {
        flush();
        cur = header + t.text + "\n\n----\n\n";
      } else {
        cur += header + t.text + "\n\n----\n\n";
      }
    }
    flush();
    return chunks.slice(0, EXTRACT_MAX_CHUNKS);
  };

  const extractPeopleFromTexts = async (
    texts: Array<{ file: string; kind: string; text: string }>,
    locale: string,
    actor: AiActor,
  ): Promise<
    | { ok: true; contacts: ParsedContact[]; interactions: ParsedInteraction[] }
    | { ok: false; status: 422 | 503 | 502; body: unknown }
  > => {
    const chunks = buildExtractChunks(texts);
    if (chunks.length === 0) return { ok: true, contacts: [], interactions: [] };
    const contacts: ParsedContact[] = [];
    const interactions: ParsedInteraction[] = [];
    let anyOk = false;
    let firstError: { ok: false; status: 422 | 503 | 502; body: unknown } | null = null;
    // 塊ごとに抽出。1 塊が失敗しても他は続ける (途中の 1 ファイルで全滅させない)。
    // ただし月次上限 (422) に当たったらそれ以上は回さない。
    for (const chunk of chunks) {
      const r = await runRelationshipAi("import_extract", IMPORT_EXTRACT_INSTRUCTION, chunk, "import_extract", locale, {
        maxContinuations: 2,
        actor,
      });
      if (!r.ok) {
        firstError ??= r;
        if (r.status === 422) break;
        continue;
      }
      anyOk = true;
      const parsed = parseExtractedPeople(r.text, "file");
      contacts.push(...parsed.contacts);
      interactions.push(...parsed.interactions);
    }
    // 一度も成功していない (キー無し・全塊失敗) ときはエラーを伝える。applyImport 側の
    // 冪等化で同名は 1 件にまとまるため、塊をまたいだ重複はここで消さなくてよい。
    if (!anyOk && firstError) return firstError;
    return { ok: true, contacts, interactions };
  };

  // 画像 (名刺・名簿・スクショ) から Vision で人物を読み取る。
  const IMPORT_VISION_HINT =
    "これは名刺・名簿・年賀状・住所録・連絡先やトーク画面のスクリーンショットなど、人物の情報が写った画像です。写っている人物 (差出人・登録者・参加者) を一人ずつ読み取り、次の指示どおり整理してください。手書きや小さな文字も丁寧に読み、判読できない項目は空にしてください。写っていない情報は創作しないでください。";
  const extractPeopleFromImages = async (
    images: Array<{ file: string; base64: string; mediaType: string }>,
    locale: string,
    actor: AiActor,
  ): Promise<
    | { ok: true; contacts: ParsedContact[]; interactions: ParsedInteraction[] }
    | { ok: false; status: 422 | 503 | 502; body: unknown }
  > => {
    const r = await runRelationshipAi(
      "import_extract",
      `${IMPORT_VISION_HINT}\n\n${IMPORT_EXTRACT_INSTRUCTION}`,
      "添えた画像から人物を読み取って JSON で返してください。",
      "import_extract_vision",
      locale,
      { images: images.map((i) => ({ base64: i.base64, mediaType: i.mediaType })), maxContinuations: 2, actor },
    );
    if (!r.ok) return r;
    return { ok: true, ...parseExtractedPeople(r.text, "photo") };
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
      { actor: actorOf(c) },
    );
    if (!r.ok) return c.json(r.body as never, r.status);
    const parsed = extractJson(r.text) as { draft?: unknown } | null;
    const draft = typeof parsed?.draft === "string" ? parsed.draft.trim() : r.text.trim();
    return c.json({ draft });
  });

  // 贈り物 (Gift): 相手に合わせた贈り物の提案。人物像・関係・過去の贈答・行事・予算をふまえ、
  // 具体的な候補と「どう探すか」を返す (実在しない店名は作らない。BR-09 記号なし)。
  app.post("/api/contacts/:id/gift-suggest", async (c) => {
    const ctx = await buildContactContext(c.get("ownerUid"), c.req.param("id"));
    if (!ctx) return c.json({ error: "not_found" }, 404);
    const b = await c.req
      .json<{ occasion?: string; budget?: string; locale?: string }>()
      .catch(() => ({}) as { occasion?: string; budget?: string; locale?: string });
    const occasion = typeof b.occasion === "string" ? b.occasion.trim().slice(0, 40) : "";
    const budget = typeof b.budget === "string" ? b.budget.trim().slice(0, 40) : "";
    // 既出リスト (something new の構造化): 過去に出した提案の要旨を渡し、繰り返しを禁止する
    const priors = await prisma.outputHistory.findMany({
      where: { ownerUid: c.get("ownerUid"), contactId: ctx.contact.id, kind: "gift_suggest" },
      orderBy: { createdAt: "desc" },
      take: 8,
    });
    const userMessage = [
      "相手の情報:",
      ctx.context,
      occasion ? `贈る場面: ${occasion}` : "贈る場面: 特に指定なし (関係を温める贈り物を)",
      budget ? `予算の目安: ${budget}` : "予算の目安: 指定なし (関係の距離感に見合う範囲で)",
      buildPriorBlock(priors),
      `今日の日付: ${new Date().toISOString().slice(0, 10)}`,
    ].filter(Boolean).join("\n");
    const r = await runRelationshipAi(
      "gift_suggest",
      '出力は JSON オブジェクト 1 個だけ: {"suggestions": [{"idea": "", "why": "", "priceRange": "", "howToFind": ""}], "note": ""}',
      userMessage,
      "gift_suggest",
      normalizeLocale(b.locale),
      { actor: actorOf(c) },
    );
    if (!r.ok) return c.json(r.body as never, r.status);
    const parsed = extractJson(r.text) as { suggestions?: unknown; note?: unknown } | null;
    const rawList = Array.isArray(parsed?.suggestions) ? (parsed.suggestions as Array<Record<string, unknown>>) : [];
    const clean = (v: unknown, max = 400) => sanitizeProse(typeof v === "string" ? v : "").trim().slice(0, max);
    const suggestions = rawList
      .slice(0, 5)
      .map((s) => ({
        idea: clean(s.idea, 120),
        why: clean(s.why),
        priceRange: clean(s.priceRange, 80),
        howToFind: clean(s.howToFind),
      }))
      .filter((s) => s.idea);
    if (suggestions.length === 0) {
      return c.json({ error: "invalid_output", detail: "うまく提案を作れませんでした。もう一度お試しください" }, 502);
    }
    // 出した提案の要旨を履歴へ (次回の既出リストになる)
    await prisma.outputHistory.create({
      data: {
        ownerUid: c.get("ownerUid"),
        contactId: ctx.contact.id,
        kind: "gift_suggest",
        summary: summarizeForHistory(suggestions.map((s) => s.idea)),
      },
    });
    return c.json({ suggestions, note: clean(parsed?.note) });
  });

  // 対応の提案 (playbook) — 相手の状況・二人の関係 (距離感/深さ/のびしろ)・仕事や私的な交点を
  // ふまえ、いまできる具体的な対応と新しい関わり方を返す。3軸ミッションの「打ち手」の要。
  // 関係スコアと論点整理 (facets) を AI に接地して、当人同士では見えにくい一手を示す。
  app.post("/api/contacts/:id/playbook", async (c) => {
    const ctx = await buildContactContext(c.get("ownerUid"), c.req.param("id"));
    if (!ctx) return c.json({ error: "not_found" }, 404);
    const b = await c.req.json<{ locale?: string }>().catch(() => ({}) as { locale?: string });
    const score = await computeRelationshipScore(ctx.contact.id, {
      distance: ctx.contact.distance,
      profileFacets: ctx.contact.profileFacets,
      profileDigest: ctx.contact.profileDigest,
    });
    // 論点整理 (facets) を人が読める形で添える。交点の推論のもとになる。
    const facetLines: string[] = [];
    try {
      const f = ctx.contact.profileFacets
        ? (JSON.parse(ctx.contact.profileFacets) as Record<string, unknown>)
        : null;
      if (f) {
        const strMap: Record<string, string> = {
          work: "仕事・役割", status: "いまの状況", family: "家族・大切な人", values: "価値観",
        };
        for (const [k, label] of Object.entries(strMap)) {
          if (typeof f[k] === "string" && (f[k] as string).trim()) facetLines.push(`${label}: ${f[k]}`);
        }
        const arrMap: Record<string, string> = {
          skills: "得意なこと", concerns: "悩み・課題", goals: "目標・夢", opportunities: "こちらから貢献できそうなこと",
        };
        for (const [k, label] of Object.entries(arrMap)) {
          if (Array.isArray(f[k]) && (f[k] as unknown[]).length) facetLines.push(`${label}: ${(f[k] as unknown[]).join("、")}`);
        }
      }
    } catch {
      // facets が壊れていても対応提案は出す
    }
    // 既出リスト (something new の構造化): 過去に出した打ち手の要旨を渡し、繰り返しを禁止する
    const priors = await prisma.outputHistory.findMany({
      where: { ownerUid: c.get("ownerUid"), contactId: ctx.contact.id, kind: "playbook" },
      orderBy: { createdAt: "desc" },
      take: 8,
    });
    const userMessage = [
      "相手の情報:",
      ctx.context,
      facetLines.length ? `整理された論点:\n${facetLines.join("\n")}` : "",
      `二人の関係の見立て: 距離感 ${score.distance}(1=毎日会う親しさ〜5=年に一度) / これまでの深さ ${score.depth}点(100点満点・${score.depthBand}) / これから伸ばせる余地 ${score.potential}点(100点満点・${score.potentialBand})`,
      buildPriorBlock(priors),
      `今日の日付: ${new Date().toISOString().slice(0, 10)}`,
    ].filter(Boolean).join("\n");
    const r = await runRelationshipAi(
      "contact_playbook",
      '出力は JSON オブジェクト 1 個だけ: {"relationship": "", "intersections": [{"area": "仕事 か 私的", "point": ""}], "actions": [{"title": "", "detail": "", "why": ""}], "somethingNew": "", "caution": ""}',
      userMessage,
      "contact_playbook",
      normalizeLocale(b.locale),
      { actor: actorOf(c) },
    );
    if (!r.ok) return c.json(r.body as never, r.status);
    const parsed = extractJson(r.text) as {
      relationship?: unknown; intersections?: unknown; actions?: unknown; somethingNew?: unknown; caution?: unknown;
    } | null;
    const clean = (v: unknown, max = 400) => sanitizeProse(typeof v === "string" ? v : "").trim().slice(0, max);
    const intersections = (Array.isArray(parsed?.intersections) ? (parsed.intersections as Array<Record<string, unknown>>) : [])
      .slice(0, 6)
      .map((x) => ({ area: clean(x.area, 20), point: clean(x.point, 200) }))
      .filter((x) => x.point);
    const actions = (Array.isArray(parsed?.actions) ? (parsed.actions as Array<Record<string, unknown>>) : [])
      .slice(0, 5)
      .map((x) => ({ title: clean(x.title, 80), detail: clean(x.detail), why: clean(x.why, 200) }))
      .filter((x) => x.title || x.detail);
    if (actions.length === 0 && !clean(parsed?.relationship)) {
      return c.json({ error: "invalid_output", detail: "うまく提案を作れませんでした。もう一度お試しください" }, 502);
    }
    // 出した打ち手の要旨を履歴へ (次回の既出リストになる)
    await prisma.outputHistory.create({
      data: {
        ownerUid: c.get("ownerUid"),
        contactId: ctx.contact.id,
        kind: "playbook",
        summary: summarizeForHistory([
          ...actions.map((x) => x.title || x.detail),
          clean(parsed?.somethingNew, 80),
        ]),
      },
    });
    return c.json({
      relationship: clean(parsed?.relationship),
      intersections,
      actions,
      somethingNew: clean(parsed?.somethingNew),
      caution: clean(parsed?.caution),
      score,
    });
  });

  // 相手の論点整理 — 蓄積した記録から、その人を多面的な観点 (連絡先・状況・スキル・悩み・
  // 家族構成・仕事・健康・価値観・目標・関心・注意点・貢献余地) に整えて保存する。
  const FACET_STR_KEYS = ["summary", "contact", "status", "work", "family", "health", "values"] as const;
  const FACET_ARR_KEYS = ["skills", "concerns", "goals", "likes", "cautions", "opportunities"] as const;
  const FACETS_JSON_INSTRUCTION =
    '出力は JSON オブジェクト 1 個だけ: {"summary":"","contact":"","status":"","work":"","family":"","health":"","values":"","skills":[],"concerns":[],"goals":[],"likes":[],"cautions":[],"opportunities":[]}。分からない項目は空文字か空配列にする。';
  const sanitizeFacets = (parsed: Record<string, unknown> | null): Record<string, unknown> => {
    const p = parsed ?? {};
    const clean = (v: unknown, max = 500) => sanitizeProse(typeof v === "string" ? v : "").trim().slice(0, max);
    const cleanArr = (v: unknown) =>
      Array.isArray(v) ? v.map((x) => clean(x, 200)).filter(Boolean).slice(0, 12) : [];
    const out: Record<string, unknown> = {};
    for (const k of FACET_STR_KEYS) out[k] = clean(p[k]);
    for (const k of FACET_ARR_KEYS) out[k] = cleanArr(p[k]);
    return out;
  };

  // 論点整理の生成と保存 (ルートと毎時スイープで共用)。
  const generateAndSaveFacets = async (
    ownerUid: string,
    contactId: string,
    locale: string,
    actor: AiActor,
  ): Promise<{ ok: true; facets: Record<string, unknown>; facetsAt: Date | null } | { ok: false; status: 404 | 422 | 503 | 502; body: unknown }> => {
    const ctx = await buildContactContext(ownerUid, contactId);
    if (!ctx) return { ok: false, status: 404, body: { error: "not_found" } };
    const r = await runRelationshipAi("contact_facets", FACETS_JSON_INSTRUCTION, ctx.context, "contact_facets", locale, { actor });
    if (!r.ok) return r;
    const facets = sanitizeFacets(extractJson(r.text) as Record<string, unknown> | null);
    const updated = await prisma.contact.update({
      where: { id: ctx.contact.id },
      data: { profileFacets: JSON.stringify(facets), profileFacetsAt: new Date() },
    });
    return { ok: true, facets, facetsAt: updated.profileFacetsAt };
  };

  app.post("/api/contacts/:id/facets", async (c) => {
    const b = await c.req.json<{ locale?: string }>().catch(() => ({}) as { locale?: string });
    const r = await generateAndSaveFacets(c.get("ownerUid"), c.req.param("id"), normalizeLocale(b.locale), actorOf(c));
    if (!r.ok) return c.json(r.body as never, r.status);
    return c.json({ facets: r.facets, facetsAt: r.facetsAt });
  });

  // 取り込んだばかりの方の論点整理を自動で進める (毎時スイープから呼ぶ)。
  // 「取り込んだら、その方の状況が自動でまとまっていく」の要。web 検索はしない (相手の尊厳)。
  // 対象: 30日以内に取り込まれ、まだ論点が無く、整理する材料 (所属/役職/メモ/近況) がある方。
  // 少数ずつ・月次キャップ到達で停止 (refresh-digests と同じ規律)。
  app.post("/api/admin/contacts/enrich-imports", async (c) => {
    if (!generate) return c.json({ error: "unavailable", detail: "AI が設定されていません" }, 503);
    const batch = Math.min(Math.max(parseInt(c.req.query("batch") ?? "5", 10) || 5, 1), 20);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const candidates = await prisma.contact.findMany({
      where: { state: "active", profileFacets: null, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    let enriched = 0;
    let skipped = 0;
    for (const ct of candidates) {
      if (enriched >= batch) break;
      // 整理する材料が何も無い人は AI を呼ばない (空の論点を量産しない)
      const hasMaterial = !!(ct.company || ct.title || ct.notes || ct.personalProfile || ct.profileDigest);
      if (!hasMaterial) {
        skipped++;
        continue;
      }
      const r = await generateAndSaveFacets(ct.ownerUid, ct.id, "ja", { ownerUid: ct.ownerUid, isOwner: true });
      if (!r.ok) {
        if (r.status === 422) break; // 月次キャップ到達: これ以上回さない
        skipped++;
        continue;
      }
      enriched++;
    }
    return c.json({ enriched, skipped, candidates: candidates.length });
  });

  // 優先度に基づく自動ケア (毎時 sweep)。優先リスト上位の方について、
  // ①「次の一手」の提案を受け箱に置く (AI 不要・無料。実行は常にユーザーが選ぶ)
  // ② 論点整理がまだ無い方の材料を AI で整える (蓄積した記録のみ・web 検索なし =
  //    相手の尊厳。月次キャップ 422 で停止・少数ずつ)。
  app.post("/api/admin/relationship/priority-care", async (c) => {
    // batch = AI で材料を整える人数の上限。0 なら提案だけ (AI なし・数秒で返る。監査や
    // 動作確認はこちらを使う。本番の実データでは AI 整理を含むと数分かかりうるため)。
    const rawBatch = parseInt(c.req.query("batch") ?? "5", 10);
    const batch = Math.min(Math.max(Number.isNaN(rawBatch) ? 5 : rawBatch, 0), 20);
    const owners = await prisma.contact.groupBy({ by: ["ownerUid"], where: { state: "active" } });
    let suggested = 0;
    let enriched = 0;
    let capped = false;
    for (const o of owners) {
      const { byId, inter, picks } = await buildFocusPicks(o.ownerUid);
      for (const pick of picks) {
        const ct = byId.get(pick.contactId)!;
        const it = inter.get(ct.id);
        const lastAt = it?.lastAt ?? null;
        const input: CarePlanInput = {
          contactId: ct.id,
          name: ct.name,
          distance: ct.distance,
          hasGoal: !!ct.goal,
          interactionCount: it?.count ?? 0,
          lastContactDays: lastAt ? Math.floor((Date.now() - lastAt.getTime()) / 86_400_000) : null,
          hasEmailOrPhone: !!(ct.email || ct.phone),
          hasDigest: !!ct.profileDigest,
          hasFacets: !!ct.profileFacets,
        };
        for (const action of planCareActions(input)) {
          // 同じ提案の出し直しは、見送り/済みから一定期間そっとしておく (しつこくしない)
          const prev = await prisma.careSuggestion.findFirst({
            where: { contactId: ct.id, kind: action.kind },
            orderBy: { updatedAt: "desc" },
            select: { status: true, updatedAt: true },
          });
          if (!shouldSuggestAgain(prev)) continue;
          await prisma.careSuggestion.create({
            data: { ownerUid: o.ownerUid, contactId: ct.id, kind: action.kind, body: action.body },
          });
          suggested++;
        }
        // 材料の自動更新 (優先リストの方だけ・蓄積データのみ・web 検索なし)
        if (batch > 0 && generate && !capped && enriched < batch && !ct.profileFacets) {
          const hasMaterial = !!(ct.company || ct.title || ct.notes || ct.personalProfile || ct.profileDigest);
          if (hasMaterial) {
            const r = await generateAndSaveFacets(ct.ownerUid, ct.id, "ja", { ownerUid: ct.ownerUid, isOwner: true });
            if (r.ok) enriched++;
            else if (r.status === 422) capped = true;
          }
        }
      }
    }
    return c.json({ suggested, enriched, owners: owners.length, capped });
  });

  // 近況メモ・いただいた返信のワンタップ還流。書けば接触記録になり、論点整理にも
  // 自動で反映される。返信と会った直後のひとことは、いちばん新鮮で深い情報源。
  app.post("/api/contacts/:id/note", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    const b = await c.req
      .json<{ text?: string; kind?: string; locale?: string }>()
      .catch(() => ({}) as { text?: string; kind?: string; locale?: string });
    const text = typeof b.text === "string" ? b.text.trim() : "";
    if (!text) return c.json({ error: "text_required", detail: "内容がありません" }, 400);
    const type = b.kind === "reply" ? "message" : "note";
    const interaction = await prisma.contactInteraction.create({
      data: { contactId: contact.id, type, occurredAt: new Date(), notes: text.slice(0, 4000) },
    });
    // 論点整理へ自動反映 (AI 未設定・失敗でも記録そのものは残る)
    let facetsUpdated = false;
    if (generate) {
      const r = await generateAndSaveFacets(contact.ownerUid, contact.id, normalizeLocale(b.locale), actorOf(c));
      facetsUpdated = r.ok;
    }
    return c.json(
      { interaction: { id: interaction.id, type: interaction.type, occurredAt: interaction.occurredAt }, facetsUpdated },
      201,
    );
  });

  // 関係の目標 — 「この方とはどこまで近づきたいか」を用途 (お仕事・友人・恋活婚活・家族・
  // 地域) とあわせて設定し、現状との差から接触ペースと次の一手を出す。進捗は設定時の
  // 距離を基準に測る。最終判断は常にユーザー (目標はいつでも変更・削除できる)。
  app.put("/api/contacts/:id/goal", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const input = validateGoalInput(b);
    if (!input) {
      return c.json({ error: "invalid_goal", detail: "用途と目標の距離感 (1〜5) を選んでください" }, 400);
    }
    // 進捗の基準 (設定時の距離) は、目標を微調整しても引き継ぐ
    const existing = parseGoalField(contact.goal);
    const goal = {
      ...input,
      setAt: existing?.setAt || new Date().toISOString(),
      startDistance: existing?.startDistance ?? contact.distance,
    };
    await prisma.contact.update({ where: { id: contact.id }, data: { goal: serializeGoal(goal) } });
    const last = await prisma.contactInteraction.findFirst({
      where: { contactId: contact.id },
      orderBy: { occurredAt: "desc" },
    });
    const lastContactDays = last ? Math.floor((Date.now() - last.occurredAt.getTime()) / 86_400_000) : null;
    return c.json({ goal, plan: goalPlan(goal, { distance: contact.distance, lastContactDays }) });
  });

  app.delete("/api/contacts/:id/goal", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    await prisma.contact.update({ where: { id: contact.id }, data: { goal: null } });
    return c.json({ ok: true });
  });

  // 目標を持つ関係の一覧 — 現状との差・接触ペースの遅れ・次の一手を毎回無料で出す。
  app.get("/api/relationship/goals", async (c) => {
    const contacts = await prisma.contact.findMany({
      where: { ownerUid: c.get("ownerUid"), state: "active", goal: { not: null } },
      take: 100,
    });
    if (contacts.length === 0) return c.json({ items: [] });
    const lastByContact = await prisma.contactInteraction.groupBy({
      by: ["contactId"],
      where: { contactId: { in: contacts.map((x) => x.id) } },
      _max: { occurredAt: true },
    });
    const lastMap = new Map(lastByContact.map((x) => [x.contactId, x._max.occurredAt]));
    const items = contacts
      .map((ct) => {
        const goal = parseGoalField(ct.goal);
        if (!goal) return null;
        const lastAt = lastMap.get(ct.id) ?? null;
        const lastContactDays = lastAt ? Math.floor((Date.now() - lastAt.getTime()) / 86_400_000) : null;
        const plan = goalPlan(goal, { distance: ct.distance, lastContactDays });
        return {
          contactId: ct.id,
          name: ct.name,
          purpose: goal.purpose,
          purposeLabel: PURPOSE_LABEL[goal.purpose],
          current: ct.distance,
          target: goal.targetDistance,
          note: goal.note,
          plan,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      // 間が空いている方 → 差が大きい方、の順で気づけるように
      .sort((a, b) => Number(b.plan.overdue) - Number(a.plan.overdue) || b.plan.gap - a.plan.gap)
      .slice(0, 20);
    return c.json({ items });
  });

  // 会社の最近の動き — 相手個人ではなく所属先の公開ニュースを検索して要約し、
  // 自然な連絡のきっかけを添える。個人を自動で web 検索しない原則はそのまま
  // (会社は公開の企業情報であり、仕事上の連絡の口実として最も使いやすい)。
  const COMPANY_NEWS_INSTRUCTION =
    '出力は JSON オブジェクト 1 個だけ: {"news": "会社の最近の動きの散文 (無ければ空文字)", "hook": "連絡のきっかけの一文 (無ければ空文字)"}';
  app.post("/api/contacts/:id/company-news", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    const company = (contact.company ?? "").trim();
    if (!company) {
      return c.json(
        { error: "no_company", detail: "所属 (会社) が登録されていない方です。プロフィールに所属を書き足すと調べられます" },
        422,
      );
    }
    if (!ddSearch) {
      return c.json({ error: "search_unavailable", detail: "いまは会社の動きを調べられません (検索の準備中です)" }, 503);
    }
    const b = await c.req.json<{ locale?: string }>().catch(() => ({}) as { locale?: string });
    const results: SearchResult[] = [];
    try {
      const batches = await Promise.all([
        ddSearch(`${company} 最新 ニュース`),
        ddSearch(`${company} 発表 プレスリリース`),
      ]);
      const seen = new Set<string>();
      for (const item of batches.flat()) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        results.push(item);
      }
    } catch {
      // 検索の一時失敗は「見つからなかった」として下で丁寧に返す
    }
    if (results.length === 0) {
      return c.json({ news: "", hook: "", sources: [], detail: "最近の公開ニュースは見つかりませんでした" });
    }
    const digest = results
      .slice(0, 8)
      .map((r) => `出典 ${r.url} : ${r.title} ${r.snippet.slice(0, 300)}`)
      .join("\n");
    const r = await runRelationshipAi(
      "company_news",
      COMPANY_NEWS_INSTRUCTION,
      `会社名: ${company}\nお相手: ${contact.name}${contact.title ? ` (${contact.title})` : ""}\n\nWeb 検索の抜粋:\n${digest}`,
      "company_news",
      normalizeLocale(b.locale),
      { actor: actorOf(c) },
    );
    if (!r.ok) return c.json(r.body as never, r.status);
    const parsed = extractJson(r.text) as { news?: unknown; hook?: unknown } | null;
    const news = sanitizeProse(typeof parsed?.news === "string" ? parsed.news : "").trim().slice(0, 1500);
    const hook = sanitizeProse(typeof parsed?.hook === "string" ? parsed.hook : "").trim().slice(0, 300);
    return c.json({ news, hook, sources: results.slice(0, 5).map((x) => x.url) });
  });

  // 相手ノート (見立て) の生成 — 蓄積した記録に根拠を置き、希望があれば公開情報の検索を足す。
  // 検索はユーザーが明示的に頼んだときだけ (相手の尊厳: 自動巡回で私人を web 検索しない)。
  const generateDigest = async (
    contact: { id: string; name: string; company: string | null; sns: string | null },
    context: string,
    includePublic: boolean,
    locale: string,
    actor: AiActor,
  ): Promise<
    | { ok: true; digest: string; searched: boolean; snsCandidates: SnsEntry[] }
    | { ok: false; status: 422 | 503 | 502; body: unknown }
  > => {
    const snsEntries = parseSnsField(contact.sns);
    const snsNote =
      snsEntries.length > 0
        ? `この方の公開アカウント:\n${snsEntries
            .map((e) => `- ${snsPlatformLabel(e.platform)}: ${e.url || e.handle}`)
            .join("\n")}`
        : "";
    let searchNote = "";
    let searched = false;
    let snsCandidates: SnsEntry[] = [];
    // 公開情報の検索はユーザーが明示的に頼んだときだけ。SNS ハンドルを軸に本人を特定し、
    // 近況 (最近の公開の発信) を優先して集める (相手の尊厳: 私生活の過剰詮索はしない)。
    if (includePublic && ddSearch && (snsEntries.length > 0 || contact.company)) {
      try {
        const queries = snsSearchQueries(contact.name, snsEntries, contact.company);
        const batches = await Promise.all(
          queries.map((q) => ddSearch(q).catch(() => [])),
        );
        const seen = new Set<string>();
        const allItems = batches.flat().filter((r) => r.url && !seen.has(r.url) && seen.add(r.url));
        const items = allItems.slice(0, 6);
        if (items.length > 0) {
          searchNote = items.map((r) => `出典 ${r.url} : ${r.title} ${r.snippet.slice(0, 300)}`).join("\n");
          searched = true;
        }
        // 本人と思われる SNS プロフィール URL を「候補 (未確認)」として決定的に抽出する。
        // 登録は仮置き = 承認/削除は必ずユーザー (最終判断はユーザー)。
        snsCandidates = extractSnsCandidates(allItems, snsEntries);
      } catch {
        // 検索の失敗で全体を止めない (記録のみで続行)
      }
    }
    const userMessage = [
      "これまでの記録:",
      context,
      snsNote ? `\n${snsNote}` : "",
      searchNote
        ? `\n公開情報の検索結果 (同姓同名に注意。本人と確信できるものだけ使う。相手の不利益になる詮索はしない):\n${searchNote}`
        : "",
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
      { actor },
    );
    if (!r.ok) return r;
    const parsed = extractJson(r.text) as { digest?: unknown } | null;
    const digest = sanitizeProse(typeof parsed?.digest === "string" ? parsed.digest : r.text).trim();
    if (!digest) {
      return { ok: false, status: 502, body: { error: "invalid_output", detail: "まとめづくりに失敗しました" } };
    }
    return { ok: true, digest, searched, snsCandidates };
  };

  // 見つかった SNS 候補 (未確認) を連絡先に仮置きする。ユーザーが以前に削除 (見送り) した
  // 候補は再提示しない。既存の登録・既存の候補と重ねない。
  const saveSnsCandidates = async (ownerUid: string, contactId: string, found: SnsEntry[]): Promise<number> => {
    if (found.length === 0) return 0;
    const [contact, dismissals] = await Promise.all([
      prisma.contact.findFirst({ where: { id: contactId, ownerUid }, select: { sns: true, snsCandidates: true } }),
      prisma.suggestionDismissal.findMany({ where: { ownerUid, kind: "sns_candidate" }, select: { key: true } }),
    ]);
    if (!contact) return 0;
    const dismissed = new Set(dismissals.map((d) => d.key));
    const existing = parseSnsField(contact.sns);
    const current = parseSnsCandidates(contact.snsCandidates);
    const known = new Set([...existing, ...current].map((e) => `${e.platform}:${e.handle.toLowerCase()}`));
    const fresh = found.filter(
      (e) => !known.has(`${e.platform}:${e.handle.toLowerCase()}`) && !dismissed.has(`${contactId}:${e.platform}:${e.handle.toLowerCase()}`),
    );
    if (fresh.length === 0) return 0;
    await prisma.contact.update({
      where: { id: contactId },
      data: { snsCandidates: JSON.stringify([...current, ...fresh].slice(0, 8)) },
    });
    return fresh.length;
  };

  // 相手ノートの更新 (個別)。includePublic を付けたときだけ公開情報も調べる。
  app.post("/api/contacts/:id/refresh-digest", async (c) => {
    const ctx = await buildContactContext(c.get("ownerUid"), c.req.param("id"));
    if (!ctx) return c.json({ error: "not_found" }, 404);
    const b = await c.req
      .json<{ includePublic?: boolean; locale?: string }>()
      .catch(() => ({}) as { includePublic?: boolean; locale?: string });
    const r = await generateDigest(
      ctx.contact,
      ctx.context,
      b.includePublic === true,
      normalizeLocale(b.locale),
      actorOf(c),
    );
    if (!r.ok) return c.json(r.body as never, r.status);
    const updated = await prisma.contact.update({
      where: { id: ctx.contact.id },
      data: { profileDigest: r.digest, profileDigestAt: new Date() },
    });
    const snsFound = await saveSnsCandidates(c.get("ownerUid"), ctx.contact.id, r.snsCandidates);
    return c.json({ digest: updated.profileDigest, digestAt: updated.profileDigestAt, searched: r.searched, snsFound });
  });

  // SNS アカウントの参照。暗号化された自由記述 sns を「platform ごとの公開アカウント」に
  // 構造化して返す (公開プロフィール URL つき)。近況把握・文面への接地に使う。
  app.get("/api/contacts/:id/sns", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
      select: { id: true, sns: true, snsCandidates: true },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    return c.json({ accounts: parseSnsField(contact.sns), candidates: parseSnsCandidates(contact.snsCandidates) });
  });

  // SNS 候補 (未確認) の承認/削除。承認で正式な登録 (sns) に移り、削除は二度と提示しない。
  // 最終判断はユーザー = 自動では本人と断定しない。
  app.post("/api/contacts/:id/sns-candidates", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
      select: { id: true, sns: true, snsCandidates: true },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    const b = (await c.req.json<{ action?: string; platform?: string; handle?: string }>().catch(() => ({}))) as {
      action?: string;
      platform?: string;
      handle?: string;
    };
    const candidates = parseSnsCandidates(contact.snsCandidates);
    const idx = candidates.findIndex(
      (e) => e.platform === b.platform && e.handle.toLowerCase() === (b.handle ?? "").toLowerCase(),
    );
    if (idx < 0 || (b.action !== "approve" && b.action !== "reject")) {
      return c.json({ error: "invalid_input", detail: "候補が見つかりませんでした" }, 400);
    }
    const [entry] = candidates.splice(idx, 1);
    const data: { snsCandidates: string | null; sns?: string } = {
      snsCandidates: candidates.length ? JSON.stringify(candidates) : null,
    };
    if (b.action === "approve") {
      // 本人として承認 → 正式な登録に追記
      data.sns = serializeSnsEntries([...parseSnsField(contact.sns), entry!]);
    } else {
      // 削除 → 見送りを記録し、以後の自動巡回でも再提示しない
      await prisma.suggestionDismissal.upsert({
        where: {
          ownerUid_kind_key: {
            ownerUid: c.get("ownerUid"),
            kind: "sns_candidate",
            key: `${contact.id}:${entry!.platform}:${entry!.handle.toLowerCase()}`,
          },
        },
        update: {},
        create: {
          ownerUid: c.get("ownerUid"),
          kind: "sns_candidate",
          key: `${contact.id}:${entry!.platform}:${entry!.handle.toLowerCase()}`,
        },
      });
    }
    const updated = await prisma.contact.update({ where: { id: contact.id }, data });
    return c.json({ accounts: parseSnsField(updated.sns), candidates: parseSnsCandidates(updated.snsCandidates) });
  });

  // SNS アカウントの保存。ユーザーが知っている公開アカウント (URL / "platform: handle") を
  // 記録する。読めた分だけ正規化して sns に上書き保存する (暗号化は透過拡張が担う)。
  app.put("/api/contacts/:id/sns", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
      select: { id: true },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    const b = await c.req
      .json<{ accounts?: unknown; raw?: unknown }>()
      .catch(() => ({}) as { accounts?: unknown; raw?: unknown });
    // accounts (構造化配列) か raw (自由記述) のどちらでも受ける
    let entries: SnsEntry[];
    if (Array.isArray(b.accounts)) {
      entries = parseSnsField(
        b.accounts
          .map((a) => (a && typeof a === "object" ? ((a as { url?: string; handle?: string }).url ?? (a as { handle?: string }).handle ?? "") : String(a)))
          .join("\n"),
      );
    } else {
      entries = parseSnsField(typeof b.raw === "string" ? b.raw : "");
    }
    const serialized = serializeSnsEntries(entries);
    const updated = await prisma.contact.update({
      where: { id: contact.id },
      data: { sns: serialized || null },
    });
    return c.json({ accounts: parseSnsField(updated.sns) });
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
      // 毎時 sweep はオーナー運用のバッチ。無制限 (isOwner) で回し、消費は各データ主に計上する。
      const r = await generateDigest(ctx.contact, ctx.context, false, "ja", {
        ownerUid: t.ownerUid,
        isOwner: true,
      });
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

  // 相手の SNS・公開情報を自律的に探して、相手ノート (見立て) を定期更新する (毎時 sweep)。
  // オーナー指示 (2026-07-19): 明示押下だけでなく、SNS/所属先という本人特定の手がかりのある方に
  // 限って、少数ずつ・7日空け・月次キャップの範囲で自動巡回する。手がかりの無い方 (同姓同名で
  // 別人を巻き込む恐れがある方) は自動検索しない・リストから外した方 (excluded) も対象にしない
  // = 相手の尊厳を制約として守る。Tavily 未設定なら 503 に縮退。
  const PUBLIC_REFRESH_MIN_DAYS = 7;
  app.post("/api/admin/contacts/refresh-public", async (c) => {
    if (!generate) return c.json({ error: "unavailable", detail: "AI が設定されていません" }, 503);
    if (!ddSearch) return c.json({ error: "search_unavailable", detail: "公開情報の検索が設定されていません" }, 503);
    const batch = Math.min(Math.max(parseInt(c.req.query("batch") ?? "3", 10) || 3, 1), 10);
    const cutoff = new Date(Date.now() - PUBLIC_REFRESH_MIN_DAYS * 86_400_000);
    // 暗号化列 (sns/company) は where で判定できないため、非暗号の条件で広めに引いてから
    // 復号済みの行で「本人特定の手がかりがある方」に絞る。
    const pool = await prisma.contact.findMany({
      where: {
        state: "active",
        OR: [{ profileDigestAt: null }, { profileDigestAt: { lt: cutoff } }], // 直近に更新済みは空ける
      },
      orderBy: { profileDigestAt: { sort: "asc", nulls: "first" } },
      select: { id: true, ownerUid: true, sns: true, company: true, focusPreference: true },
      take: batch * 20,
    });
    // リストから外した方 (excluded) は自動検索しない。本人特定の手がかり (SNS/所属先) のある方だけ。
    // ※ focusPreference は暗号化されていないが null 行を where の not で落とさないよう JS で絞る。
    const candidates = pool.filter((ct) => ct.focusPreference !== "excluded" && !!(ct.sns || ct.company)).slice(0, batch);
    let refreshed = 0;
    let searched = 0;
    const failures: string[] = [];
    for (const t of candidates) {
      const ctx = await buildContactContext(t.ownerUid, t.id);
      if (!ctx) continue;
      // 公開検索つき (includePublic=true)。無制限 (isOwner) で回し、消費は各データ主に計上する。
      const r = await generateDigest(ctx.contact, ctx.context, true, "ja", { ownerUid: t.ownerUid, isOwner: true });
      if (!r.ok) {
        failures.push(t.id);
        if (r.status === 422) break; // 月次キャップ到達: これ以上回さない
        continue;
      }
      if (r.searched) searched++;
      await prisma.contact.update({
        where: { id: t.id },
        data: { profileDigest: r.digest, profileDigestAt: new Date() },
      });
      await saveSnsCandidates(t.ownerUid, t.id, r.snsCandidates); // 本人らしき SNS は候補として仮置き
      refreshed++;
    }
    return c.json({ refreshed, searched, candidates: candidates.length, failed: failures.length });
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
      { actor: actorOf(c) },
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
      { actor: actorOf(c) },
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
    // draft に加えて failed も承認できる = 送信に失敗した文面を、そのまま (または直して)
    // もう一度送れる。従来は failed が行き止まりで、下書きを作り直すしかなかった。
    if (m.status !== "draft" && m.status !== "failed") {
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
      data: { subject, body, status: "approved", errorDetail: null },
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
      // 設定起因 (鍵の誤り・差出人ドメイン未認証など) は「待てば直る」ものではないので、
      // 原因の向き先が分かる言い方にする。詳細は reason で返し、画面で開ける。
      const raw = r.detail ?? "";
      const configIssue = /401|403|unauthorized|forbidden|api key|domain|verify|testing emails/i.test(raw);
      return c.json(
        {
          error: "send_failed",
          detail: configIssue
            ? "送信の設定 (鍵または差出人アドレス) に問題があるようです。設定を確認してください"
            : "送信できませんでした。しばらくしてからお試しください",
          reason: raw.slice(0, 300),
        },
        502,
      );
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
  // 自分の Google カレンダーの予定 (busy) を freeBusy で取得し、SELF_GOOGLE に保存する。
  // 空き時間カレンダーに「予定あり」を重ねて、空きが見やすくなる。件名は取らない。
  const GOOGLE_BUSY_LOOKAHEAD_DAYS = 60;
  // 取り込む/表示するカレンダー。未設定なら primary のみ (従来どおり)。
  const parseCalendarIds = (raw: unknown): string[] => {
    if (!Array.isArray(raw)) return ["primary"];
    const ids = raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()).slice(0, 30);
    return ids.length ? ids : ["primary"];
  };

  const syncGoogleBusy = async (ownerUid: string, accessToken: string, calendarIds?: string[]): Promise<number> => {
    if (!google) return 0;
    const ids = calendarIds && calendarIds.length ? calendarIds : ["primary"];
    const now = Date.now();
    const timeMin = new Date(now).toISOString();
    const timeMax = new Date(now + GOOGLE_BUSY_LOOKAHEAD_DAYS * 86_400_000).toISOString();
    // freeBusy (時間帯だけ) ではなく events を引き、予定の件名も取る。件名はオーナー自身の
    // カレンダーで、本人にだけ表示する (第三者の予定の中身は従来どおり保存しない)。終日予定
    // (date のみ) と「予定なし (transparent)」は busy に数えない = freeBusy と同じ意味を保つ。
    // ユーザーが分けている複数カレンダーのうち、選んだものだけを重ねて取り込む。
    const events: IsoEvent[] = [];
    for (const calId of ids) {
      const res = (await google.apiGet(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?singleEvents=true&orderBy=startTime&maxResults=250&fields=items(start,end,summary,transparency,status)&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
        accessToken,
      ).catch(() => ({}))) as {
        items?: Array<{
          start?: { dateTime?: string };
          end?: { dateTime?: string };
          summary?: string;
          transparency?: string;
          status?: string;
        }>;
      };
      for (const it of res.items ?? []) {
        if (it.status === "cancelled" || it.transparency === "transparent") continue;
        const s = it.start?.dateTime;
        const e = it.end?.dateTime;
        if (!s || !e) continue; // 終日予定 (date のみ) は空き計算に含めない
        const start = new Date(s);
        const end = new Date(e);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) continue;
        const title = (it.summary ?? "").trim().slice(0, 120);
        events.push(title ? { start: start.toISOString(), end: end.toISOString(), title } : { start: start.toISOString(), end: end.toISOString() });
      }
    }
    await prisma.calendarLink.upsert({
      where: { ownerUid_contactId: { ownerUid, contactId: SELF_GOOGLE } },
      update: { busySlots: events as never, provider: "google" },
      create: { ownerUid, contactId: SELF_GOOGLE, provider: "google", busySlots: events as never },
    });
    return events.length;
  };

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

    // 自分の Google カレンダーの予定を件名つきで取り込み、空き時間カレンダーに重ねられるようにする。
    // ユーザーが選んだカレンダー (未設定なら primary) だけを重ねる。失敗しても取込は続ける。
    try {
      await syncGoogleBusy(ownerUid, accessToken, parseCalendarIds(conn.syncCalendarIds));
    } catch {
      // カレンダーの busy 取込に失敗しても、連絡先の取込は止めない
    }

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
    // 追加の許可 (extended) が済んでいる接続だけ。無ければ静かに飛ばす (403 ノイズを出さない)
    const extended = hasExtendedScopes(conn.scopes);
    const gmailMessages: GmailHeaderMessage[] = [];
    for (const label of extended ? (["SENT", "INBOX"] as const) : []) {
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

    // Drive (共有されているファイルの持ち主・最終更新者) — 追加の許可が済んでいる接続だけ
    const drive: { files?: DriveFile[] } = extended
      ? ((await google
          .apiGet(
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("sharedWithMe=true")}&orderBy=modifiedTime%20desc&pageSize=${DRIVE_MAX_FILES}&fields=files(owners(displayName,emailAddress,me),lastModifyingUser(displayName,emailAddress,me))`,
            accessToken,
          )
          .catch(() => ({}))) as { files?: DriveFile[] })
      : {};

    // Google 連絡先 (アドレス帳) — 最も確実な取込元。氏名・メール・電話・所属を直接持つ。
    const connectionsResp = await google
      .apiGet(
        `https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers,organizations&pageSize=${CONTACTS_MAX}`,
        accessToken,
      )
      .catch(() => ({}));
    const addressBook = parseGoogleConnections(connectionsResp);

    const collected = collectGooglePeople({
      selfEmails: conn.email ? [conn.email] : [],
      calendarEvents,
      gmailMessages,
      driveFiles: drive.files ?? [],
    });
    // アドレス帳の連絡先を先頭に足す (applyImport は同名スキップの冪等なので重複しない)
    collected.contacts.unshift(...addressBook);

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
      select: { email: true, lastSyncAt: true, lastSyncNote: true, scopes: true },
    });
    return c.json({
      available: true,
      connected: !!conn,
      email: conn?.email ?? null,
      lastSyncAt: conn?.lastSyncAt ?? null,
      lastSyncNote: conn?.lastSyncNote ?? null,
      // 追加の許可 (メール・ドライブ) まで済んでいるか。web はこれで導線を出し分ける
      extended: hasExtendedScopes(conn?.scopes),
      // 録音メモ (メール添付) まで読める許可が済んでいるか
      mailRead: hasMailReadScope(conn?.scopes),
    });
  });

  // 既定はカレンダー + 連絡先だけ (審査の軽いセンシティブ区分のみ = 警告を消しやすい)。
  // ?scope=extended でメール・ドライブの追加の許可 (制限付き区分。希望者だけ)。
  app.get("/api/google/auth-url", async (c) => {
    if (!google) {
      return c.json({ error: "unavailable", detail: "Google 連携は準備中です" }, 503);
    }
    const state = signState(c.get("ownerUid"), Math.floor(Date.now() / 1000) + 600);
    if (!state) {
      return c.json({ error: "unavailable", detail: "サーバの設定が未完了です" }, 503);
    }
    const scopeParam = c.req.query("scope");
    const scopes =
      scopeParam === "mailread"
        ? GOOGLE_SCOPES_MAIL_READ // 録音メモ (メール添付) の読み取りまで (制限付き区分。希望者だけ)
        : scopeParam === "extended"
          ? GOOGLE_SCOPES_EXTENDED
          : GOOGLE_SCOPES_BASE;
    return c.json({ url: google.authUrl(state, googleRedirectUri(), scopes) });
  });

  // ---------------- 録音メモ (Plaud) のメール添付テキスト → タスクと課題 ----------------
  // 録音サービスから届くメールの「添付テキストファイル」を開いて読み (本文ではなく添付が正)、
  // タスク (やること) と課題を整理して連絡帳に表示する。gmail.readonly の明示オプトインが前提。
  // 読むのは from:plaud のメールに限る。1 回の同期で新規は少数ずつ (AI キャップにも従う)。
  const PLAUD_QUERY = "from:plaud has:attachment newer_than:90d";
  const PLAUD_MAX_NEW_PER_RUN = 5;

  // 文字起こし 1 本をタスクと課題に整理する (AI 未設定/失敗は null。capped=月次キャップ 422)。
  // Gmail 経路と ZenTrack 経路の両方が使う共通の整理口。
  const digestPlaudContent = async (
    ownerUid: string,
    content: string,
  ): Promise<{ summary: string | null; tasks: PlaudTask[] | null; capped: boolean }> => {
    if (!generate) return { summary: null, tasks: null, capped: false };
    const r = await runRelationshipAi(
      "plaud_tasks",
      '出力は JSON オブジェクト 1 個だけ: {"summary": "...", "tasks": [{"text": "...", "kind": "task|issue"}]}',
      content.slice(0, 12000),
      "plaud_tasks",
      "ja",
      { actor: { ownerUid, isOwner: true } },
    );
    if (!r.ok) return { summary: null, tasks: null, capped: r.status === 422 };
    const digest = validatePlaudDigest(extractJson(r.text));
    return { summary: digest.summary || null, tasks: digest.tasks, capped: false };
  };

  // ハッシュ未計上の既存メモに本文ハッシュを付ける (経路またぎの二重取り込み防止の下ごしらえ)。
  // 同じ内容が既にハッシュ済みなら unique 違反になるが、それは重複行そのものなので静かに残す。
  const backfillMemoHashes = async (ownerUid: string): Promise<void> => {
    const rows = await prisma.voiceMemo.findMany({ where: { ownerUid, contentHash: null }, take: 100 });
    for (const m of rows) {
      try {
        await prisma.voiceMemo.update({ where: { id: m.id }, data: { contentHash: transcriptHash(m.content) } });
      } catch {
        // unique 違反 = 同じ内容のメモが既にある。ここでは消さない (1 件単位の削除はユーザーの手で)
      }
    }
  };
  // Gmail はアクセストークンに gmail.metadata が同居していると検索 (q) を 403 で拒否する。
  // 検索を使うこの経路だけ、readonly スコープに絞ったトークンを取り直す (再同意は不要)。
  const GMAIL_SEARCH_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
  const runPlaudSync = async (
    ownerUid: string,
  ): Promise<
    | { ok: true; found: number; imported: number; digested: number }
    | { ok: false; status: 400 | 503; error: string; detail: string }
  > => {
    if (!google) return { ok: false, status: 503, error: "unavailable", detail: "Google 連携は準備中です" };
    const conn = await prisma.googleConnection.findUnique({ where: { ownerUid } });
    if (!conn) return { ok: false, status: 400, error: "not_connected", detail: "先に設定から Google とつないでください" };
    if (!hasMailReadScope(conn.scopes)) {
      return {
        ok: false,
        status: 400,
        error: "scope_missing",
        detail: "録音メモの読み取りには、メールを読む追加の許可が必要です。ボタンからもう一度 Google の同意を進めてください",
      };
    }
    await backfillMemoHashes(ownerUid); // 経路またぎの重複判定の下ごしらえ
    const accessToken = await google.refreshAccessToken(conn.refreshToken, GMAIL_SEARCH_SCOPE);
    const list = (await google
      .apiGet(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=${encodeURIComponent(PLAUD_QUERY)}`,
        accessToken,
      )
      .catch(() => ({}))) as { messages?: Array<{ id: string }> };
    const ids = (list.messages ?? []).map((m) => m.id);
    if (ids.length === 0) return { ok: true, found: 0, imported: 0, digested: 0 };
    const existing = await prisma.voiceMemo.findMany({
      where: { ownerUid, gmailMessageId: { in: ids } },
      select: { gmailMessageId: true },
    });
    const known = new Set(existing.map((x) => x.gmailMessageId));
    const fresh = ids.filter((id) => !known.has(id)).slice(0, PLAUD_MAX_NEW_PER_RUN);
    let imported = 0;
    let digested = 0;
    let aiStopped = false; // 月次キャップ 422 に当たったら以後の整理はやめる (取込は続ける)
    for (const id of fresh) {
      const msg = (await google
        .apiGet(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, accessToken)
        .catch(() => null)) as {
        payload?: GmailPart & { headers?: Array<{ name?: string; value?: string }> };
        internalDate?: string;
      } | null;
      if (!msg?.payload) continue;
      // 本文ではなく、添付のテキストファイルを開いて読む (オーナー指示)
      const atts = findTextAttachments(msg.payload);
      if (atts.length === 0) continue;
      const texts: string[] = [];
      for (const att of atts.slice(0, 3)) {
        let data = att.inlineData;
        if (!data && att.attachmentId) {
          const body = (await google
            .apiGet(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/attachments/${att.attachmentId}`,
              accessToken,
            )
            .catch(() => null)) as { data?: string } | null;
          data = body?.data ?? null;
        }
        const text = decodeGmailData(data);
        if (text) texts.push(text);
      }
      const content = texts.join("\n\n").slice(0, 20000);
      if (!content.trim()) continue;
      // 同じ文字起こしを ZenTrack 経由などで既に取り込んでいれば二重にしない
      const hash = transcriptHash(content);
      const dupe = await prisma.voiceMemo.findFirst({ where: { ownerUid, contentHash: hash }, select: { id: true } });
      if (dupe) continue;
      const subject = headerValue(msg.payload.headers, "Subject").slice(0, 200) || null;
      const receivedAt = msg.internalDate ? new Date(Number(msg.internalDate)) : null;

      // タスクと課題の整理 (AI)。使えない/キャップ到達でも、メモ自体は残す (あとで整理し直せる)
      let summary: string | null = null;
      let tasks: PlaudTask[] | null = null;
      if (!aiStopped) {
        const d = await digestPlaudContent(ownerUid, content);
        if (d.capped) aiStopped = true;
        else if (d.summary !== null || d.tasks !== null) {
          summary = d.summary;
          tasks = d.tasks;
          digested++;
        }
      }
      try {
        await prisma.voiceMemo.create({
          data: {
            ownerUid,
            gmailMessageId: id,
            source: "gmail",
            contentHash: hash,
            subject,
            receivedAt,
            content,
            summary,
            tasks: tasks ? JSON.stringify(tasks) : null,
          },
        });
      } catch {
        continue; // 同時取り込みの競合 (unique 違反) = 既に入っている
      }
      imported++;
    }
    return { ok: true, found: ids.length, imported, digested };
  };

  app.post("/api/relationship/sync-plaud", async (c) => {
    try {
      const r = await runPlaudSync(c.get("ownerUid"));
      if (!r.ok) return c.json({ error: r.error, detail: r.detail }, r.status);
      return c.json(r);
    } catch {
      return c.json({ error: "sync_failed", detail: "いまは読み込めませんでした。時間をおいてお試しください" }, 502);
    }
  });

  const parseMemoTasks = (raw: string | null): PlaudTask[] => {
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw) as unknown;
      return Array.isArray(arr) ? (arr as PlaudTask[]) : [];
    } catch {
      return [];
    }
  };

  app.get("/api/relationship/voice-memos", async (c) => {
    const rows = await prisma.voiceMemo.findMany({
      where: { ownerUid: c.get("ownerUid"), status: { not: "dismissed" } },
      orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
      take: 30,
    });
    return c.json({
      memos: rows.map((m) => ({
        id: m.id,
        subject: m.subject,
        receivedAt: m.receivedAt,
        summary: m.summary,
        tasks: parseMemoTasks(m.tasks),
        excerpt: m.summary ? null : m.content.slice(0, 300), // 整理前はさわりだけ見せる
        status: m.status,
      })),
    });
  });

  // 録音メモの手動追加 — Plaud 以外の取り込み口。どのレコーダー・文字起こしアプリの
  // テキストでも、貼り付ければ同じ「タスクと課題」パイプラインに乗る (AI 不可でもメモは残る)。
  app.post("/api/relationship/voice-memos", async (c) => {
    const ownerUid = c.get("ownerUid");
    const b = await c.req.json<{ subject?: string; text?: string }>().catch(() => ({}) as { subject?: string; text?: string });
    const text = (typeof b.text === "string" ? b.text : "").trim().slice(0, 20000);
    if (!text) return c.json({ error: "text_required", detail: "文字起こしの本文を貼り付けてください" }, 400);
    const subject = (typeof b.subject === "string" ? b.subject : "").trim().slice(0, 200) || null;

    // 経路またぎの冪等 (同じ文字起こしが Gmail/ZenTrack/デバイス経由で既にあれば増やさない)
    await backfillMemoHashes(ownerUid);
    const hash = transcriptHash(text);
    const dup = await prisma.voiceMemo.findFirst({ where: { ownerUid, contentHash: hash }, select: { id: true } });
    if (dup) return c.json({ id: dup.id, duplicate: true, digested: false });

    const d = await digestPlaudContent(ownerUid, text);
    const memo = await prisma.voiceMemo.create({
      data: {
        ownerUid,
        gmailMessageId: `manual:${randomUUID()}`,
        source: "manual",
        contentHash: hash,
        subject,
        receivedAt: new Date(),
        content: text,
        summary: d.summary,
        tasks: d.tasks ? JSON.stringify(d.tasks) : null,
      },
    });
    return c.json({ id: memo.id, digested: d.summary !== null || d.tasks !== null });
  });

  // タスクの済み印・メモの片付け (done / dismissed / new)。1 件単位で操作できる = データ主権。
  app.put("/api/relationship/voice-memos/:id", async (c) => {
    const memo = await prisma.voiceMemo.findFirst({ where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") } });
    if (!memo) return c.json({ error: "not_found" }, 404);
    const b = (await c.req.json<{ status?: string; taskIndex?: number; done?: boolean }>().catch(() => ({}))) as {
      status?: string;
      taskIndex?: number;
      done?: boolean;
    };
    const data: { status?: string; tasks?: string } = {};
    if (b.status === "done" || b.status === "dismissed" || b.status === "new") data.status = b.status;
    if (typeof b.taskIndex === "number" && typeof b.done === "boolean") {
      const tasks = parseMemoTasks(memo.tasks);
      if (b.taskIndex >= 0 && b.taskIndex < tasks.length) {
        tasks[b.taskIndex]!.done = b.done;
        data.tasks = JSON.stringify(tasks);
      }
    }
    if (Object.keys(data).length === 0) return c.json({ error: "invalid_input" }, 400);
    const updated = await prisma.voiceMemo.update({ where: { id: memo.id }, data });
    return c.json({ memo: { id: updated.id, status: updated.status, tasks: parseMemoTasks(updated.tasks) } });
  });

  // 整理し直す (取込時に AI が使えなかったメモの救済)
  app.post("/api/relationship/voice-memos/:id/digest", async (c) => {
    const memo = await prisma.voiceMemo.findFirst({ where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") } });
    if (!memo) return c.json({ error: "not_found" }, 404);
    const r = await runRelationshipAi(
      "plaud_tasks",
      '出力は JSON オブジェクト 1 個だけ: {"summary": "...", "tasks": [{"text": "...", "kind": "task|issue"}]}',
      memo.content.slice(0, 12000),
      "plaud_tasks",
      "ja",
      { actor: actorOf(c) },
    );
    if (!r.ok) return c.json(r.body as never, r.status);
    const digest = validatePlaudDigest(extractJson(r.text));
    const updated = await prisma.voiceMemo.update({
      where: { id: memo.id },
      data: { summary: digest.summary || null, tasks: JSON.stringify(digest.tasks) },
    });
    return c.json({ memo: { id: updated.id, summary: updated.summary, tasks: parseMemoTasks(updated.tasks) } });
  });

  // 毎時 sweep: メール読み取りの許可がある接続を順に同期 (新着だけ・少数ずつ)
  app.post("/api/admin/plaud/sync", async (c) => {
    if (!google) return c.json({ synced: 0, note: "Google 連携は準備中" });
    const conns = await prisma.googleConnection.findMany({ select: { ownerUid: true, scopes: true }, take: 50 });
    let synced = 0;
    let imported = 0;
    for (const conn of conns) {
      if (!hasMailReadScope(conn.scopes)) continue;
      try {
        const r = await runPlaudSync(conn.ownerUid);
        if (r.ok) {
          synced++;
          imported += r.imported;
        }
      } catch {
        // 1 接続の失敗で全体を止めない
      }
    }
    return c.json({ synced, imported });
  });

  // 日程調整の公開ページ用: 相手 (アカウント不要) が Google で空きを重ねるための同意 URL。
  // 求めるのは空き情報 (freeBusy) と名乗りだけの最小権限。state に共有キーを署名して持ち回る。
  app.get("/api/public/schedule/:shareKey/google-auth-url", async (c) => {
    const share = await loadVisibleShare(c.req.param("shareKey"));
    if (!share) return c.json({ error: "not_found" }, 404);
    if (!shareUnlocked(share, c.req.query("proof"))) return c.json({ error: "locked" }, 403);
    if (!google) return c.json({ error: "unavailable", detail: "Google での重ね合わせは準備中です" }, 503);
    const participantKey = c.req.query("participantKey") || "-";
    const state = signState(`share|${share.shareKey}|${participantKey}`, Math.floor(Date.now() / 1000) + 600);
    if (!state) return c.json({ error: "unavailable", detail: "サーバの設定が未完了です" }, 503);
    return c.json({ url: google.authUrl(state, googleRedirectUri(), GOOGLE_SCOPES_GUEST, { offline: false }) });
  });

  // 共有ページのゲスト同意の戻り: その場で期間内の空き情報 (freeBusy) を一度だけ照会して
  // 参加者として保存する。トークンは保存しない (立ち入った鍵を持たない)。
  const handleShareGoogleCallback = async (subject: string, code: string): Promise<string> => {
    const [, shareKey, participantKeyRaw] = subject.split("|");
    const backTo = (q: string) => `${webBaseUrl()}/s/${shareKey}?google=${q}`;
    const share = await loadVisibleShare(shareKey ?? "");
    if (!share || !google) return backTo("error");
    const t = await google.exchangeCode(code, googleRedirectUri());
    const fb = (await google.apiPost("https://www.googleapis.com/calendar/v3/freeBusy", t.accessToken, {
      timeMin: new Date(Math.max(Date.now(), share.periodStart.getTime())).toISOString(),
      timeMax: share.periodEnd.toISOString(),
      items: [{ id: "primary" }],
    })) as { calendars?: { primary?: { busy?: Array<{ start: string; end: string }> } } };
    const busy = toIso(parseIsoIntervals(fb.calendars?.primary?.busy ?? []));
    const name =
      sanitizeProse(t.name ?? "").trim().slice(0, 60) || (t.email ? t.email.split("@")[0]! : "参加者");
    const existing =
      participantKeyRaw && participantKeyRaw !== "-"
        ? await prisma.scheduleShareParticipant.findFirst({
            where: { participantKey: participantKeyRaw, shareId: share.id },
          })
        : null;
    if (existing) {
      await prisma.scheduleShareParticipant.update({
        where: { id: existing.id },
        data: { busySlots: busy as never, name },
      });
      return backTo(`joined&participant=${existing.participantKey}`);
    }
    const count = await prisma.scheduleShareParticipant.count({ where: { shareId: share.id } });
    if (count >= MAX_PARTICIPANTS_PER_SHARE) return backTo("full");
    const participant = await prisma.scheduleShareParticipant.create({
      data: {
        shareId: share.id,
        participantKey: randomUUID(),
        name,
        icsUrl: null,
        busySlots: busy as never,
      },
    });
    return backTo(`joined&participant=${participant.participantKey}`);
  };

  // OAuth コールバック (未認証)。state の署名で「誰の接続か / どの共有ページか」を確かめてから保存する。
  app.get("/api/google/callback", async (c) => {
    const back = (q: string) => c.redirect(`${webBaseUrl()}/contacts?google=${q}`, 302);
    if (!google) return back("error");
    const subject = verifyState(c.req.query("state"), Math.floor(Date.now() / 1000));
    const code = c.req.query("code");
    if (!subject || !code) return back("error");
    // 共有ページのゲスト (subject = "share|<shareKey>|<participantKey|->")
    if (subject.startsWith("share|")) {
      try {
        return c.redirect(await handleShareGoogleCallback(subject, code), 302);
      } catch (err) {
        console.error(
          JSON.stringify({
            event: "google_share_callback_failed",
            detail: err instanceof Error ? err.message : String(err),
          }),
        );
        return c.redirect(`${webBaseUrl()}/s/${subject.split("|")[1] ?? ""}?google=error`, 302);
      }
    }
    const ownerUid = subject;
    try {
      const t = await google.exchangeCode(code, googleRedirectUri());
      const existing = await prisma.googleConnection.findUnique({ where: { ownerUid } });
      const refreshToken = t.refreshToken ?? existing?.refreshToken;
      if (!refreshToken) return back("error");
      // 許可スコープは Google の申告値を保存する (追加の許可は include_granted_scopes で合算される)
      const scopes = t.grantedScopes ?? existing?.scopes ?? GOOGLE_SCOPES_BASE.join(" ");
      await prisma.googleConnection.upsert({
        where: { ownerUid },
        create: { ownerUid, email: t.email, refreshToken, scopes },
        update: { email: t.email ?? existing?.email, refreshToken, scopes },
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

  // ============ デバイス連携 (Oura / Withings) — 共通取り込み基盤 (LMS 構想) ============
  // 接続とデータの正本は bonds。読み手は cares / LMS (GET /api/health/metrics)。
  // env 未設定のプロバイダは「準備中」。健康データは要配慮情報のため payload を暗号化。

  const DEVICE_SYNC_LOOKBACK_DAYS = 14;

  const dayString = (d: Date) => {
    // TZ (Asia/Tokyo) のローカル日付で YYYY-MM-DD
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };

  const runDeviceSync = async (
    ownerUid: string,
    provider: DeviceProvider,
  ): Promise<{ ok: true; fetched: number; saved: number } | { ok: false; status: 400 | 502 | 503; error: string; detail: string }> => {
    if (!devices || !devices.ready(provider)) {
      return { ok: false, status: 503, error: "unavailable", detail: "この連携は準備中です" };
    }
    const conn = await prisma.deviceConnection.findUnique({
      where: { ownerUid_provider: { ownerUid, provider } },
    });
    if (!conn) return { ok: false, status: 400, error: "not_connected", detail: "先に設定からつないでください" };
    try {
      const tokens = await devices.refreshAccessToken(provider, conn.refreshToken);
      const end = new Date();
      const start = new Date(end.getTime() - DEVICE_SYNC_LOOKBACK_DAYS * 24 * 3600 * 1000);
      const metrics = await devices.fetchDaily(provider, tokens, dayString(start), dayString(end));
      let saved = 0;
      for (const m of metrics) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(m.day)) continue; // 形式の壊れた日付は捨てる
        const day = new Date(`${m.day}T00:00:00Z`);
        await prisma.healthMetric.upsert({
          where: { ownerUid_provider_kind_day: { ownerUid, provider, kind: m.kind, day } },
          create: { ownerUid, provider, kind: m.kind, day, payload: JSON.stringify(m.payload) },
          update: { payload: JSON.stringify(m.payload) },
        });
        saved++;
      }
      await prisma.deviceConnection.update({
        where: { id: conn.id },
        data: {
          refreshToken: tokens.refreshToken,
          accessToken: tokens.accessToken,
          externalUserId: tokens.externalUserId ?? conn.externalUserId,
          lastSyncAt: new Date(),
          lastSyncNote: `${saved}件`,
        },
      });
      return { ok: true, fetched: metrics.length, saved };
    } catch (err) {
      console.error(
        JSON.stringify({ event: "device_sync_failed", provider, detail: err instanceof Error ? err.message : String(err) }),
      );
      return { ok: false, status: 502, error: "sync_failed", detail: "いまは取り込めませんでした。時間をおいてお試しください" };
    }
  };

  app.get("/api/devices/status", async (c) => {
    const ownerUid = c.get("ownerUid");
    const conns = await prisma.deviceConnection.findMany({ where: { ownerUid } });
    return c.json({
      providers: DEVICE_PROVIDERS.map((p) => {
        const conn = conns.find((x) => x.provider === p);
        return {
          provider: p,
          ready: Boolean(devices?.ready(p)),
          connected: Boolean(conn),
          lastSyncAt: conn?.lastSyncAt ?? null,
          lastSyncNote: conn?.lastSyncNote ?? null,
        };
      }),
    });
  });

  app.get("/api/devices/:provider/auth-url", async (c) => {
    const provider = c.req.param("provider");
    if (!isDeviceProvider(provider)) return c.json({ error: "unknown_provider" }, 404);
    if (!devices || !devices.ready(provider)) {
      return c.json({ error: "unavailable", detail: "この連携は準備中です" }, 503);
    }
    const state = signDeviceState(`${c.get("ownerUid")}|${provider}`, Math.floor(Date.now() / 1000));
    if (!state) return c.json({ error: "unavailable", detail: "この連携は準備中です" }, 503);
    return c.json({ url: devices.authUrl(provider, state) });
  });

  // OAuth コールバック (未認証)。state の署名で「誰の・どのプロバイダの接続か」を確かめてから保存。
  app.get("/api/devices/callback", async (c) => {
    const back = (q: string) => c.redirect(`${webBaseUrl()}/settings?device=${q}`, 302);
    if (!devices) return back("error");
    const subject = verifyDeviceState(c.req.query("state"), Math.floor(Date.now() / 1000));
    const code = c.req.query("code");
    if (!subject || !code) return back("error");
    const sep = subject.lastIndexOf("|");
    const ownerUid = subject.slice(0, sep);
    const provider = subject.slice(sep + 1);
    if (!ownerUid || !isDeviceProvider(provider)) return back("error");
    try {
      const t = await devices.exchangeCode(provider, code);
      await prisma.deviceConnection.upsert({
        where: { ownerUid_provider: { ownerUid, provider } },
        create: {
          ownerUid,
          provider,
          refreshToken: t.refreshToken,
          accessToken: t.accessToken,
          externalUserId: t.externalUserId ?? null,
          scopes: t.scopes ?? null,
        },
        update: {
          refreshToken: t.refreshToken,
          accessToken: t.accessToken,
          externalUserId: t.externalUserId ?? null,
          scopes: t.scopes ?? null,
        },
      });
      return back("connected");
    } catch (err) {
      console.error(
        JSON.stringify({ event: "device_callback_failed", provider, detail: err instanceof Error ? err.message : String(err) }),
      );
      return back("error");
    }
  });

  app.post("/api/devices/:provider/sync", async (c) => {
    const provider = c.req.param("provider");
    if (!isDeviceProvider(provider)) return c.json({ error: "unknown_provider" }, 404);
    const r = await runDeviceSync(c.get("ownerUid"), provider);
    if (!r.ok) return c.json({ error: r.error, detail: r.detail }, r.status);
    return c.json(r);
  });

  app.post("/api/devices/:provider/disconnect", async (c) => {
    const provider = c.req.param("provider");
    if (!isDeviceProvider(provider)) return c.json({ error: "unknown_provider" }, 404);
    await prisma.deviceConnection.deleteMany({ where: { ownerUid: c.get("ownerUid"), provider } });
    return c.json({ disconnected: true }); // 蓄積済みの health_metrics は残す (データ主権: 消すのは本人の明示操作で)
  });

  // 蓄積した健康データの読み出し (cares / LMS がここを読む。復号して返す)
  app.get("/api/health/metrics", async (c) => {
    const ownerUid = c.get("ownerUid");
    const from = c.req.query("from");
    const to = c.req.query("to");
    const provider = c.req.query("provider");
    const kind = c.req.query("kind");
    const where: Record<string, unknown> = { ownerUid };
    if (provider) where.provider = provider;
    if (kind) where.kind = kind;
    if (from || to) {
      where.day = {
        ...(from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? { gte: new Date(`${from}T00:00:00Z`) } : {}),
        ...(to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? { lte: new Date(`${to}T00:00:00Z`) } : {}),
      };
    }
    const rows = await prisma.healthMetric.findMany({
      where: where as never,
      orderBy: [{ day: "desc" }],
      take: 400,
    });
    return c.json({
      metrics: rows.map((r) => ({
        provider: r.provider,
        kind: r.kind,
        day: r.day.toISOString().slice(0, 10),
        payload: JSON.parse(r.payload) as unknown,
      })),
    });
  });

  // 毎時 sweep: 全接続を順に同期 (少数ずつ・古い順)
  app.post("/api/admin/devices/sync-all", async (c) => {
    if (!devices) return c.json({ picked: 0, synced: 0, failed: 0, note: "not_configured" });
    const batch = Math.min(20, Math.max(1, Number(c.req.query("batch")) || 5));
    const conns = await prisma.deviceConnection.findMany({
      orderBy: [{ lastSyncAt: { sort: "asc", nulls: "first" } }],
      take: batch,
    });
    let synced = 0;
    let failed = 0;
    for (const conn of conns) {
      if (!isDeviceProvider(conn.provider)) continue;
      const r = await runDeviceSync(conn.ownerUid, conn.provider);
      if (r.ok) synced++;
      else failed++;
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


  // ============ 時間・知恵・モノのシェア (旧 gift の進化) ============
  // give/lend/teach/do/advise → kind(time/wisdom/thing)。相手は非ユーザーの第三者なので
  // 二者間 handshake は取らず、オーナー主導 + 公開トークンによる相手の応答で双方向にする。

  // 資源カタログ: オーナーが差し出せる時間・知恵・モノ
  app.get("/api/resources", async (c) => {
    const resources = await prisma.sharedResource.findMany({
      where: { ownerUid: c.get("ownerUid"), status: { not: "archived" } },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    return c.json({ resources });
  });

  app.post("/api/resources", async (c) => {
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const title = typeof b.title === "string" ? b.title.trim() : "";
    if (!title) return c.json({ error: "title_required", detail: "何をシェアできるか入力してください" }, 400);
    const resource = await prisma.sharedResource.create({
      data: {
        ownerUid: c.get("ownerUid"),
        kind: normalizeKind(b.kind),
        title,
        description: typeof b.description === "string" ? b.description.trim() || null : null,
        availability: typeof b.availability === "string" ? b.availability.trim() || null : null,
      },
    });
    return c.json({ resource }, 201);
  });

  app.put("/api/resources/:id", async (c) => {
    const r = await prisma.sharedResource.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!r) return c.json({ error: "not_found" }, 404);
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const data: Record<string, unknown> = {};
    if (typeof b.title === "string" && b.title.trim()) data.title = b.title.trim();
    if (typeof b.kind === "string") data.kind = normalizeKind(b.kind);
    if (typeof b.description === "string") data.description = b.description.trim() || null;
    if (typeof b.availability === "string") data.availability = b.availability.trim() || null;
    if (b.status === "active" || b.status === "paused" || b.status === "archived") data.status = b.status;
    const updated = await prisma.sharedResource.update({ where: { id: r.id }, data });
    return c.json({ resource: updated });
  });

  app.delete("/api/resources/:id", async (c) => {
    const r = await prisma.sharedResource.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!r) return c.json({ error: "not_found" }, 404);
    // データ主権: ソフト削除 (archived)。履歴のシェアは残す。
    await prisma.sharedResource.update({ where: { id: r.id }, data: { status: "archived" } });
    return c.json({ ok: true });
  });

  // 連絡先へシェアを差し出す (offer) / 頼む (request) / 受け取り記録 (inbound)
  app.post("/api/contacts/:id/shares", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const direction = normalizeDirection(b.direction);
    const elig = shareEligibility(direction, contact.distance);
    if (!elig.eligible) return c.json({ error: "not_eligible", detail: elig.reason }, 409);

    let kind = normalizeKind(b.kind);
    let title = typeof b.title === "string" ? b.title.trim() : "";
    let resourceId: string | null = null;
    if (typeof b.resourceId === "string" && b.resourceId) {
      const res = await prisma.sharedResource.findFirst({
        where: { id: b.resourceId, ownerUid: c.get("ownerUid") },
      });
      if (!res) return c.json({ error: "resource_not_found" }, 404);
      resourceId = res.id;
      kind = normalizeKind(res.kind);
      if (!title) title = res.title;
    }
    if (!title) return c.json({ error: "title_required", detail: "何をシェアするか入力してください" }, 400);

    const share = await prisma.resourceShare.create({
      data: {
        ownerUid: c.get("ownerUid"),
        contactId: contact.id,
        resourceId,
        kind,
        direction,
        title,
        message: typeof b.message === "string" ? b.message.trim() || null : null,
        status: initialStatus(direction),
      },
    });
    // inbound (相手から受け取った) は往復不要 = 即座に接触として還流する
    if (direction === "inbound") {
      await prisma.contactInteraction.create({
        data: { contactId: contact.id, type: "share_received", occurredAt: new Date(), notes: title },
      });
    }
    return c.json({ share, eligibility: elig }, 201);
  });

  app.get("/api/shares", async (c) => {
    const contactId = c.req.query("contactId");
    const shares = await prisma.resourceShare.findMany({
      where: { ownerUid: c.get("ownerUid"), ...(contactId ? { contactId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return c.json({ shares });
  });

  // 送信: proposed → sent。公開トークンを発行し、相手にリンクを送る (メール設定があれば)。
  // メール未設定/アドレス無しでも sent にはする (オフライン手渡しでもリンクを使える)。
  app.post("/api/shares/:id/send", async (c) => {
    const share = await prisma.resourceShare.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!share) return c.json({ error: "not_found" }, 404);
    if (!canTransition(share.status as ShareStatus, "sent")) {
      return c.json({ error: "invalid_status", detail: `status=${share.status} は送信できません` }, 409);
    }
    const token = share.shareToken ?? randomBytes(24).toString("base64url");
    const updated = await prisma.resourceShare.update({
      where: { id: share.id },
      data: { status: "sent", shareToken: token },
    });
    const base = process.env.PUBLIC_WEB_ORIGIN ?? "";
    const shareUrl = `${base}/share/${token}`;
    const contact = await prisma.contact.findFirst({ where: { id: share.contactId } });
    let delivered = false;
    if (mailer && contact?.email) {
      const verb = share.direction === "request" ? "お願いしたいこと" : "お渡ししたいもの";
      const body = [
        `${contact.name} 様`,
        "",
        `${verb}があります。${share.title}`,
        share.message ? `\n${share.message}` : "",
        "",
        `お返事はこちらから。ログインは要りません。 ${shareUrl}`,
      ].filter(Boolean).join("\n");
      try {
        await mailer({ to: contact.email, subject: `${share.title} のご案内`, body });
        delivered = true;
      } catch {
        delivered = false;
      }
    }
    await prisma.contactInteraction.create({
      data: {
        contactId: share.contactId,
        type: share.direction === "request" ? "share_request" : "share_offer",
        occurredAt: new Date(),
        notes: share.title,
      },
    });
    return c.json({ share: { id: updated.id, status: updated.status }, shareUrl, delivered });
  });

  // オーナーによる状態更新 (オフラインで受諾/辞退/完了/取消を反映)。遷移は状態機械で検証。
  app.post("/api/shares/:id/status", async (c) => {
    const share = await prisma.resourceShare.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!share) return c.json({ error: "not_found" }, 404);
    const b = await c.req.json<{ status?: string }>().catch(() => ({}) as { status?: string });
    const to = b.status as ShareStatus;
    if (!SHARE_STATUSES.includes(to)) {
      return c.json({ error: "bad_status", detail: "不正な状態です" }, 400);
    }
    if (!canTransition(share.status as ShareStatus, to)) {
      return c.json({ error: "invalid_transition", detail: `status=${share.status} から ${to} へは変えられません` }, 409);
    }
    const updated = await prisma.resourceShare.update({
      where: { id: share.id },
      data: { status: to, ...(to === "fulfilled" ? { fulfilledAt: new Date() } : {}) },
    });
    // 完了は「貢献が実際に起きた」= 検証の還流。接触として記録する。
    if (to === "fulfilled") {
      await prisma.contactInteraction.create({
        data: { contactId: share.contactId, type: "share_fulfilled", occurredAt: new Date(), notes: share.title },
      });
    }
    return c.json({ share: { id: updated.id, status: updated.status } });
  });

  // ---- 相手 (第三者) 向けの公開エンドポイント。認証不要・トークンでのみ引ける ----
  // 双方向連絡: 相手はアカウント無しでリンクを開き、受諾/辞退と一言を返せる。

  app.get("/api/share/:token", async (c) => {
    const share = await prisma.resourceShare.findUnique({
      where: { shareToken: c.req.param("token") },
    });
    if (!share || !share.shareToken) return c.json({ error: "not_found" }, 404);
    let description: string | null = null;
    if (share.resourceId) {
      const res = await prisma.sharedResource.findFirst({ where: { id: share.resourceId } });
      description = res?.description ?? null;
    }
    // PII は最小限。連絡先本人の情報・オーナー識別子・相手の過去の返答は返さない。
    return c.json({
      share: {
        kind: share.kind,
        direction: share.direction,
        title: share.title,
        message: share.message,
        description,
        status: share.status,
        respondable: canCounterpartRespond(share.status as ShareStatus, "accept"),
      },
    });
  });

  app.post("/api/share/:token/respond", async (c) => {
    const share = await prisma.resourceShare.findUnique({
      where: { shareToken: c.req.param("token") },
    });
    if (!share || !share.shareToken) return c.json({ error: "not_found" }, 404);
    const b = await c.req.json<{ response?: string; note?: string }>().catch(() => ({}) as { response?: string; note?: string });
    const resp: CounterpartResponse | null =
      b.response === "accept" || b.response === "decline" ? b.response : null;
    if (!resp) return c.json({ error: "bad_response", detail: "accept または decline を指定してください" }, 400);
    if (!canCounterpartRespond(share.status as ShareStatus, resp)) {
      return c.json({ error: "not_respondable", detail: "この共有には今は応答できません" }, 409);
    }
    const target = counterpartTargetStatus(resp);
    const note = typeof b.note === "string" ? b.note.trim() || null : null;
    const updated = await prisma.resourceShare.update({
      where: { id: share.id },
      data: { status: target, respondedAt: new Date(), responseNote: note },
    });
    // 双方向の還流: 相手の応答を接触記録に残す (距離スコア・打ち手の材料になる)
    await prisma.contactInteraction.create({
      data: {
        contactId: share.contactId,
        type: "share_response",
        occurredAt: new Date(),
        notes: `${resp === "accept" ? "受諾" : "辞退"}${note ? `: ${note}` : ""}`,
      },
    });
    return c.json({ ok: true, status: updated.status });
  });

  // ============ 統合ハブ: 知り合い/リストの集約 + 双方向メッセージ ============
  // integration-architecture.md §3。他プロダクト(cares/vm/zentrack)の人物を uid スコープで
  // bonds contacts に集約し、メッセージ(往復)を1基盤に束ねる。

  // 他プロダクトから人物を冪等 upsert (外部参照つき)。同じ (product, externalId) は再取込しても重複しない。
  app.post("/api/contacts/upsert-external", async (c) => {
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const product = normalizeProduct(b.product);
    const externalId = typeof b.externalId === "string" ? b.externalId.trim() : "";
    if (!product || !externalId) {
      return c.json({ error: "product_external_required", detail: "product と externalId は必須です" }, 400);
    }
    const ownerUid = c.get("ownerUid");
    const kind = typeof b.kind === "string" && b.kind.trim() ? b.kind.trim() : "person";
    const existing = await prisma.contactExternalRef.findUnique({
      where: { ownerUid_product_externalId: { ownerUid, product, externalId } },
    });
    if (existing) {
      const contact = await prisma.contact.findFirst({ where: { id: existing.contactId, ownerUid } });
      return c.json({ contact, ref: existing, created: false });
    }
    const name = clampName(b.name);
    if (!name) return c.json({ error: "name_required", detail: "お名前が必要です" }, 400);
    const contact = await prisma.contact.create({
      data: { ownerUid, name, source: product, ...contactData(b) },
    });
    const ref = await prisma.contactExternalRef.create({
      data: { ownerUid, contactId: contact.id, product, externalId, kind },
    });
    return c.json({ contact, ref, created: true }, 201);
  });

  // ある連絡先の外部参照 (どの製品のどのレコードと繋がっているか)
  app.get("/api/contacts/:id/external-refs", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    const refs = await prisma.contactExternalRef.findMany({ where: { contactId: contact.id } });
    return c.json({ refs });
  });

  // 連絡先へメッセージを送る/記録する (outbound)。スレッドが無ければ作る。
  // 第三者への実送信は send=true かつメール設定ありのときだけ。既定は下書き記録 (承認前提)。
  app.post("/api/contacts/:id/messages", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const body = typeof b.body === "string" ? b.body.trim() : "";
    if (!body) return c.json({ error: "body_required", detail: "本文を入力してください" }, 400);
    const channel = typeof b.channel === "string" && b.channel.trim() ? b.channel.trim() : "email";
    const subject = typeof b.subject === "string" ? b.subject.trim() || null : null;
    const wantSend = b.send === true;

    let thread = await prisma.messageThread.findFirst({
      where: { ownerUid: c.get("ownerUid"), contactId: contact.id, channel },
    });
    if (!thread) {
      thread = await prisma.messageThread.create({
        data: { ownerUid: c.get("ownerUid"), contactId: contact.id, channel, subject },
      });
    }

    let status: "draft" | "sent" | "failed" = "draft";
    let externalId: string | null = null;
    if (wantSend && channel === "email" && mailer && contact.email) {
      try {
        const r = await mailer({ to: contact.email, subject: subject ?? "メッセージ", body });
        status = "sent";
        externalId = r.messageId;
      } catch {
        status = "failed";
      }
    }
    const message = await prisma.message.create({
      data: { threadId: thread.id, direction: "outbound", body, status, externalId },
    });
    await prisma.messageThread.update({ where: { id: thread.id }, data: { lastAt: new Date() } });
    if (status === "sent") {
      await prisma.contactInteraction.create({
        data: { contactId: contact.id, type: "message", occurredAt: new Date(), notes: subject ?? null },
      });
    }
    return c.json({ thread: { id: thread.id, channel }, message }, 201);
  });

  // 連絡先のスレッドとメッセージ (往復) を読む
  app.get("/api/contacts/:id/messages", async (c) => {
    const contact = await prisma.contact.findFirst({
      where: { id: c.req.param("id"), ownerUid: c.get("ownerUid") },
    });
    if (!contact) return c.json({ error: "not_found" }, 404);
    const threads = await prisma.messageThread.findMany({
      where: { ownerUid: c.get("ownerUid"), contactId: contact.id },
      orderBy: { lastAt: "desc" },
    });
    const messages = await prisma.message.findMany({
      where: { threadId: { in: threads.map((t) => t.id) } },
      orderBy: { createdAt: "asc" },
    });
    return c.json({
      threads: threads.map((t) => ({ ...t, messages: messages.filter((m) => m.threadId === t.id) })),
    });
  });

  // 受信 webhook (双方向の inbound)。SendGrid Inbound Parse 等が叩く。認証はガードでなく
  // 共有シークレット (INBOUND_WEBHOOK_SECRET) で行う。未設定なら fail closed (503)。
  // SendGrid はカスタムヘッダを付けられないため、シークレットは URL クエリ (?secret=) でも受ける。
  // ボディも SendGrid は multipart フォームで送るため、JSON / フォームの両方を受け付ける。
  // 送信元メール → 連絡先を突合し、スレッドに inbound メッセージを積む → 接触記録へ還流。
  app.post("/api/inbound/email", async (c) => {
    const secret = process.env.INBOUND_WEBHOOK_SECRET;
    if (!secret) return c.json({ error: "unavailable", detail: "受信の設定が未完了です" }, 503);
    const provided = c.req.header("x-inbound-secret") ?? c.req.query("secret");
    if (!secretMatches(provided, secret)) return c.json({ error: "unauthorized" }, 401);

    // ボディの取り出し: JSON も multipart/x-www-form-urlencoded も受ける。
    const contentType = c.req.header("content-type") ?? "";
    let field: (k: string) => string;
    if (contentType.includes("application/json")) {
      const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
      field = (k) => (typeof b[k] === "string" ? (b[k] as string) : "");
    } else {
      const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
      field = (k) => {
        const v = (form as Record<string, unknown>)[k];
        return typeof v === "string" ? v : "";
      };
    }
    // SendGrid: from は "名前 <addr>"、text は本文、envelope は {"from":"addr",...}。
    let from = normalizeFromAddress(field("from"));
    if (!from) {
      const env = field("envelope");
      if (env) {
        try {
          from = normalizeFromAddress((JSON.parse(env) as { from?: string }).from);
        } catch {
          // envelope が壊れていても from 無しとして扱う
        }
      }
    }
    const text = field("text") || field("body");
    if (!from || !text.trim()) return c.json({ error: "from_text_required" }, 400);
    // 単一オーナー前提 (ownerUid="owner")。将来は to のエイリアスで owner を解決する。
    const ownerUid = "owner";
    // email は暗号化列で where 検索できないため、復号済みの連絡先をアプリ層で突合する。
    const contacts = await prisma.contact.findMany({ where: { ownerUid, state: "active" } });
    const contact = matchByEmail(contacts, from);
    if (!contact) return c.json({ matched: false }); // 未知の送信元は静かに無視 (ノイズを作らない)
    const channel = "email";
    let thread = await prisma.messageThread.findFirst({ where: { ownerUid, contactId: contact.id, channel } });
    if (!thread) {
      thread = await prisma.messageThread.create({ data: { ownerUid, contactId: contact.id, channel } });
    }
    await prisma.message.create({
      data: { threadId: thread.id, direction: "inbound", body: text.trim(), status: "received" },
    });
    await prisma.messageThread.update({ where: { id: thread.id }, data: { lastAt: new Date() } });
    await prisma.contactInteraction.create({
      data: { contactId: contact.id, type: "message", occurredAt: new Date(), notes: "返信あり" },
    });
    return c.json({ matched: true, threadId: thread.id });
  });

  // 録音デバイス汎用の受信口 (Omi 等の会話ウェアラブルが webhook で文字起こしを送る)。
  // 認証は inbound/email と同じ共有シークレット。届いた会話は Plaud と同じ「録音メモ」
  // として保存し、同じ plaud_tasks でタスクと課題を整理する (AI 不可でもメモは残る)。
  // 冪等: 外部 id (無ければ本文ハッシュ) を voice_memos.gmailMessageId に "ext:" 接頭辞で
  // 入れて一意制約に乗せる (スキーマ変更なし。gmail の実 id と接頭辞で衝突しない)。
  app.post("/api/inbound/conversation", async (c) => {
    const secret = process.env.INBOUND_WEBHOOK_SECRET;
    if (!secret) return c.json({ error: "unavailable", detail: "受信の設定が未完了です" }, 503);
    const provided = c.req.header("x-inbound-secret") ?? c.req.query("secret");
    if (!secretMatches(provided, secret)) return c.json({ error: "unauthorized" }, 401);

    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    // 本文: text をそのまま、無ければ Omi 形式 (transcript_segments) を平文に落とす
    let text = str(b.text) || str(b.transcript);
    if (!text) {
      const segs = Array.isArray(b.transcript_segments) ? b.transcript_segments : [];
      text = segs
        .map((s) => {
          const seg = s as { text?: unknown; speaker?: unknown };
          const line = str(seg.text).trim();
          if (!line) return "";
          const speaker = str(seg.speaker).trim();
          return speaker ? `${speaker}: ${line}` : line;
        })
        .filter(Boolean)
        .join("\n");
    }
    text = text.trim().slice(0, 20000);
    if (!text) return c.json({ error: "text_required" }, 400);

    const source = (c.req.query("source") || "device").replace(/[^a-z0-9_-]/gi, "").slice(0, 20) || "device";
    const structured = (b.structured ?? {}) as { title?: unknown; overview?: unknown };
    const subject = (str(b.title) || str(structured.title)).trim().slice(0, 200) || null;
    const externalId = str(b.id).trim().slice(0, 100) || createHash("sha256").update(text).digest("hex").slice(0, 32);
    const memoKey = `ext:${source}:${externalId}`;
    const createdAtRaw = str(b.occurredAt) || str(b.created_at);
    const receivedAt = createdAtRaw && !Number.isNaN(Date.parse(createdAtRaw)) ? new Date(createdAtRaw) : new Date();

    const ownerUid = "owner"; // 単一オーナー前提 (inbound/email と同じ)
    // 冪等は二段: 外部 id (同じデバイスの再送) と本文ハッシュ (経路またぎ = Gmail/ZenTrack と同内容)
    await backfillMemoHashes(ownerUid);
    const hash = transcriptHash(text);
    const existing = await prisma.voiceMemo.findFirst({
      where: { ownerUid, OR: [{ gmailMessageId: memoKey }, { contentHash: hash }] },
      select: { id: true },
    });
    if (existing) return c.json({ stored: false, duplicate: true, id: existing.id });

    // タスクと課題の整理 (AI)。使えない/キャップ到達でもメモ自体は残す (あとで整理し直せる)
    const d = await digestPlaudContent(ownerUid, text);
    const memo = await prisma.voiceMemo.create({
      data: {
        ownerUid,
        gmailMessageId: memoKey,
        source,
        contentHash: hash,
        subject,
        receivedAt,
        content: text,
        summary: d.summary,
        tasks: d.tasks ? JSON.stringify(d.tasks) : null,
      },
    });
    return c.json({ stored: true, id: memo.id, digested: d.summary !== null || d.tasks !== null });
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
