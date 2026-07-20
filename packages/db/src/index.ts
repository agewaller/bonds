// @bonds/db — Prisma client + アプリ層フィールド暗号化 (AES-256-GCM)
// apps は @prisma/client を直接使わず本パッケージ経由で依存する。
// 暗号化設計: DESIGN-HANDOVER.md §4.1 / cares packages/db を踏襲。
import { PrismaClient, Prisma } from "@prisma/client";
import { encryptField, decryptField } from "./encryption.js";

export { PrismaClient } from "@prisma/client";
export type { Prisma } from "@prisma/client";
export {
  encryptField,
  decryptField,
  isEncrypted,
} from "./encryption.js";

// 暗号化対象: Prisma モデル名 → カラム名[] (DESIGN-HANDOVER.md §4.1)。
// フェーズ4 で outreachMessage.body を追加する。
const ENCRYPTED_FIELDS: Record<string, readonly string[]> = {
  contact: [
    "email",
    "phone",
    "address",
    "sns",
    "personalProfile",
    "socialPosition",
    "valuesProfile",
    "notes",
    // 記録から自動生成する相手ノート (見立て) も人物情報そのもの = 暗号化
    "profileDigest",
    // 記録から整理した論点 (JSON) も人物情報そのもの = 暗号化
    "profileFacets",
    // 関係の目標 (用途・目標距離感・ねらい)。恋活婚活など要配慮の意図を含みうる = 暗号化
    "goal",
    // 本人と思われる SNS の候補 (未確認)。本人性の推定そのもの = 暗号化
    "snsCandidates",
  ],
  contactInteraction: ["notes"],
  contactGift: ["notes"],
  // ICS 購読 URL は「秘密のアドレス」= 予定表への読み取りトークンなので暗号化する
  calendarLink: ["icsUrl"],
  // フェーズ4 発信: 承認本文と生成候補 (JSON 文字列) は文面そのもの = PII として暗号化
  outreachMessage: ["body", "candidates"],
  // 一斉配信: 件名と本文テンプレは文面そのもの = 暗号化
  emailCampaign: ["subject", "body"],
  // 録音メモ: 添付テキストの抜粋・要旨・タスク (JSON 文字列) は中身そのもの = 暗号化
  voiceMemo: ["content", "summary", "tasks"],
  actionItem: ["title", "note"],
  // 公人評価の下ごしらえ: 候補 (人物名+プロフィール) は連絡先の同定情報 = 暗号化
  ddSuggestion: ["candidates"],
  // 提携先アウトリーチ (ADR-0022 移植): 連絡先メールと本文は要配慮のため暗号化
  partnerTarget: ["contactEmail"],
  partnerMessage: ["body"],
  // Google 連携: refresh token は本人の Google データへの合鍵 = 暗号化
  googleConnection: ["refreshToken"],
  // 取り込みジョブの本文 (ファイル/貼り付けの中身) は PII = 暗号化
  importJob: ["payload"],
  // やり取り台帳の内容 (何を・メモ) は PII = 暗号化
  exchange: ["title", "notes"],
  // 日程調整の提案・時間の予約: 相手 (第三者) の名乗り・連絡先・メッセージは PII = 暗号化
  scheduleShareProposal: ["guestName", "guestContact", "message"],
  // 共有の参加者: 名乗りと予定表 URL (秘密のアドレス = 実質トークン) は暗号化
  scheduleShareParticipant: ["name", "icsUrl"],
  timeBooking: ["guestName", "guestContact", "message"],
  // あなたへの提案: 本文は相手の状況に触れうる = 暗号化
  careSuggestion: ["body"],
  offering: ["title", "description"],
  // 公開掲示板への問い合わせ: 訪問者 (第三者) の名乗り・連絡先・本文は PII = 暗号化
  offeringInterest: ["guestName", "guestContact", "message"],
};

// data ({ field: value } / { field: { set: value } } / 配列) を in-place で暗号化。
function encryptData(data: unknown, fields: readonly string[]): void {
  if (!data || typeof data !== "object") return;
  const rows = Array.isArray(data) ? data : [data];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const obj = row as Record<string, unknown>;
    for (const f of fields) {
      const v = obj[f];
      if (typeof v === "string") {
        obj[f] = encryptField(v);
      } else if (
        v &&
        typeof v === "object" &&
        typeof (v as { set?: unknown }).set === "string"
      ) {
        (v as { set: string }).set = encryptField((v as { set: string }).set);
      }
    }
  }
}

// 結果レコード (単一 / 配列 / null) を in-place で復号する。
function decryptResult<T>(result: T, fields: readonly string[]): T {
  if (!result || typeof result !== "object") return result;
  const rows = Array.isArray(result) ? result : [result];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const obj = row as Record<string, unknown>;
    for (const f of fields) {
      if (typeof obj[f] === "string") {
        obj[f] = decryptField(obj[f] as string);
      }
    }
  }
  return result;
}

// 透過暗号化 Prisma Client Extension。各対象モデルの write 系で args を暗号化、
// read/返却系で結果を復号する。
// 制限: 親モデル経由のネストした書き込みは query 拡張のフックが子モデルに発火しないため
// 未対応。対象カラムは直接 (prisma.contact.create 等) 書き込むこと。
function buildQueryExtension() {
  const query: Record<string, unknown> = {};
  for (const [model, fields] of Object.entries(ENCRYPTED_FIELDS)) {
    query[model] = {
      async create({ args, query }: { args: any; query: (a: any) => Promise<any> }) {
        encryptData(args.data, fields);
        return decryptResult(await query(args), fields);
      },
      async createMany({ args, query }: { args: any; query: (a: any) => Promise<any> }) {
        encryptData(args.data, fields);
        return query(args);
      },
      async update({ args, query }: { args: any; query: (a: any) => Promise<any> }) {
        encryptData(args.data, fields);
        return decryptResult(await query(args), fields);
      },
      async updateMany({ args, query }: { args: any; query: (a: any) => Promise<any> }) {
        encryptData(args.data, fields);
        return query(args);
      },
      async upsert({ args, query }: { args: any; query: (a: any) => Promise<any> }) {
        encryptData(args.create, fields);
        encryptData(args.update, fields);
        return decryptResult(await query(args), fields);
      },
      async findUnique({ args, query }: { args: any; query: (a: any) => Promise<any> }) {
        return decryptResult(await query(args), fields);
      },
      async findUniqueOrThrow({ args, query }: { args: any; query: (a: any) => Promise<any> }) {
        return decryptResult(await query(args), fields);
      },
      async findFirst({ args, query }: { args: any; query: (a: any) => Promise<any> }) {
        return decryptResult(await query(args), fields);
      },
      async findFirstOrThrow({ args, query }: { args: any; query: (a: any) => Promise<any> }) {
        return decryptResult(await query(args), fields);
      },
      async findMany({ args, query }: { args: any; query: (a: any) => Promise<any> }) {
        return decryptResult(await query(args), fields);
      },
      async delete({ args, query }: { args: any; query: (a: any) => Promise<any> }) {
        return decryptResult(await query(args), fields);
      },
    };
  }
  return Prisma.defineExtension({ name: "field-encryption", query: query as never });
}

export const fieldEncryptionExtension = buildQueryExtension();

/**
 * フィールド暗号化を適用した PrismaClient を生成する。
 * apps は `new PrismaClient()` ではなく本ファクトリを使うこと。
 */
export function createPrismaClient(
  options?: ConstructorParameters<typeof PrismaClient>[0],
) {
  return new PrismaClient(options).$extends(fieldEncryptionExtension);
}

export type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;
