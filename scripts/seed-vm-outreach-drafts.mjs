// VM アウトリーチ第一陣のドラフトを bonds に積む冪等シード。
//   - vm-outreach-orgs.json の各社に、vm-outreach-drafts.json の文面を status=draft で作成
//   - 送信はしない (send を渡さない → 既定で下書き)。オーナーが承認画面で修正・承認して送る
//   - 同一本文の outbound が既にあればスキップ (再実行しても重複しない)
// 実行:
//   API_BASE=http://localhost:8080 ADMIN_TOKEN=... node scripts/seed-vm-outreach-drafts.mjs
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const API = process.env.API_BASE ?? "http://localhost:8080";
const TOKEN = process.env.ADMIN_TOKEN ?? "";
if (!TOKEN) {
  console.error("ADMIN_TOKEN を指定してください");
  process.exit(1);
}
const H = { "Content-Type": "application/json", "x-admin-token": TOKEN };

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "data");
const { orgs } = JSON.parse(await readFile(join(dataDir, "vm-outreach-orgs.json"), "utf-8"));
const { drafts } = JSON.parse(await readFile(join(dataDir, "vm-outreach-drafts.json"), "utf-8"));

async function api(path, init) {
  const res = await fetch(`${API}/api/${path}`, { headers: H, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

let created = 0;
let skipped = 0;
let missing = 0;
for (const org of orgs) {
  const draft = drafts[org.externalId];
  if (!draft) {
    missing++;
    console.warn(`draft なし: ${org.externalId} (${org.name})`);
    continue;
  }
  // 連絡先の解決 (シード済みなら created:false で既存が返る)
  const up = await api("contacts/upsert-external", {
    method: "POST",
    body: JSON.stringify({ product: "vm", externalId: org.externalId, name: org.name }),
  });
  const contactId = up.contact.id;
  // 冪等: 同一本文の outbound が既にあればスキップ
  const view = await api(`contacts/${contactId}/messages`);
  const already = (view.threads ?? []).some((t) =>
    (t.messages ?? []).some((m) => m.direction === "outbound" && m.body === draft.body),
  );
  if (already) {
    skipped++;
    continue;
  }
  await api(`contacts/${contactId}/messages`, {
    method: "POST",
    body: JSON.stringify({ subject: draft.subject, body: draft.body }),
  });
  created++;
}
console.log(`drafts: created=${created} skipped(既存)=${skipped} draft未定義=${missing} 対象=${orgs.length}社`);
