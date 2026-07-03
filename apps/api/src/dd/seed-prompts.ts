// DB 駆動プロンプトの起動時 seed (冪等)。
// 原本は cares apps/api/src/extra-prompts.json の person_eval_7d / person_eval_svc。
// 既に同 key があれば何もしない (管理者の編集・版上げを上書きしない)。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { ExtendedPrismaClient } from "@bonds/db";

type PromptSeed = Record<string, { name: string; description: string; template: string }>;

const here = dirname(fileURLToPath(import.meta.url));

export function loadDdPromptSeeds(): PromptSeed {
  return JSON.parse(readFileSync(resolve(here, "../dd-prompts.json"), "utf-8"));
}

export async function seedDdPrompts(prisma: ExtendedPrismaClient): Promise<string[]> {
  const seeds = loadDdPromptSeeds();
  const created: string[] = [];
  for (const [key, def] of Object.entries(seeds)) {
    const exists = await prisma.prompt.findFirst({ where: { key } });
    if (exists) continue;
    await prisma.prompt.create({
      data: { key, version: 1, body: def.template, active: true },
    });
    created.push(key);
  }
  return created;
}
