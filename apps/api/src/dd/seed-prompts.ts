// DB 駆動プロンプトの起動時 seed (冪等)。
// 原本は cares apps/api/src/extra-prompts.json の person_eval_7d / person_eval_svc。
// 各 seed は version を持てる (既定 1)。DB の最新版が seed の version 未満のときだけ
// 新しい版として追加する。これで:
//   - 未 seed の key は seed の version で作られる
//   - プロンプトを改良したら seed の version を上げるだけで本番にも新版が届く
//   - 管理者が UI で上げた版 (maxVersion+1) は seed version 以上なので触らない
//     (改良を届けたいときは seed version をそれより上に上げる = 明示的な意思)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { ExtendedPrismaClient } from "@bonds/db";

type PromptSeed = Record<string, { name: string; description: string; template: string; version?: number }>;

const here = dirname(fileURLToPath(import.meta.url));

export function loadDdPromptSeeds(): PromptSeed {
  return JSON.parse(readFileSync(resolve(here, "../dd-prompts.json"), "utf-8"));
}

export async function seedDdPrompts(prisma: ExtendedPrismaClient): Promise<string[]> {
  const seeds = loadDdPromptSeeds();
  const created: string[] = [];
  for (const [key, def] of Object.entries(seeds)) {
    const seedVersion = def.version ?? 1;
    const latest = await prisma.prompt.findFirst({ where: { key }, orderBy: { version: "desc" } });
    if (latest && latest.version >= seedVersion) continue; // 既に同等以上 (未改良・管理者編集) は触らない
    await prisma.prompt.create({
      data: { key, version: seedVersion, body: def.template, active: true },
    });
    created.push(key);
  }
  return created;
}
