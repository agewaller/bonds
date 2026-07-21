// VM Next 提供先リストを bonds に投入する冪等シード。
//   - 連絡先を product=vm の外部参照つきで upsert (再実行しても重複しない)
//   - 資源「企業価値評価レポートを1本お作りします」を1件用意
//   - 各連絡先に proposed のシェア (提供残高) を積む (同題のシェアがあればスキップ)
// 実行:
//   API_BASE=http://localhost:8080 ADMIN_TOKEN=... node scripts/seed-vm-offers.mjs
// 本番でも同じ (API_BASE を Cloud Run の URL に)。
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
const { resource, people } = JSON.parse(await readFile(join(dataDir, "vm-next-people.json"), "utf-8"));
// メールは任意の gitignore 済みローカルファイルから合流する (リポジトリに PII を残さない):
//   scripts/data/vm-next-emails.local.json 形式: { "vmnext-kasahara-kenji": "kenji@example.com", ... }
let emails = {};
try {
  emails = JSON.parse(await readFile(join(dataDir, "vm-next-emails.local.json"), "utf-8"));
  console.log(`emails file: ${Object.keys(emails).length}件`);
} catch {
  // 無ければ氏名のみで投入 (メールは後から UI で貼り付け)
}

async function api(path, init) {
  const res = await fetch(`${API}/api/${path}`, { headers: H, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

// 1) 資源 (同題があれば再利用)
const existingResources = (await api("resources")).resources ?? [];
let res = existingResources.find((r) => r.title === resource.title);
if (!res) {
  res = (await api("resources", { method: "POST", body: JSON.stringify(resource) })).resource;
  console.log(`resource created: ${res.title}`);
} else {
  console.log(`resource exists: ${res.title}`);
}

// 2) 連絡先 upsert + 提供残高 (proposed シェア)
let created = 0;
let skipped = 0;
for (const p of people) {
  const up = await api("contacts/upsert-external", {
    method: "POST",
    body: JSON.stringify({
      product: "vm",
      externalId: p.externalId,
      kind: "investor",
      name: p.name,
      relationship: "work",
      distance: 3,
    }),
  });
  const contactId = up.contact.id;
  // メールの補完: ローカルファイルにあり、まだ未登録のときだけ書く (既存プロフィールは保持)
  const email = emails[p.externalId];
  if (email && !up.contact.email) {
    const c = up.contact;
    await api(`contacts/${contactId}`, {
      method: "PUT",
      body: JSON.stringify({
        name: c.name, furigana: c.furigana, distance: c.distance, relationship: c.relationship,
        birthday: c.birthday, phone: c.phone, address: c.address, company: c.company, title: c.title,
        sns: c.sns, personalProfile: c.personalProfile, socialPosition: c.socialPosition,
        valuesProfile: c.valuesProfile, notes: c.notes, email,
      }),
    });
  }
  const shares = (await api(`shares?contactId=${contactId}`)).shares ?? [];
  if (shares.some((s) => s.title === resource.title && s.status !== "cancelled")) {
    skipped++;
    continue;
  }
  await api(`contacts/${contactId}/shares`, {
    method: "POST",
    body: JSON.stringify({
      resourceId: res.id,
      direction: "offer",
      kind: resource.kind,
      title: resource.title,
      message:
        "ご関心をお持ちの銘柄を1社お知らせいただければ、開示の一次情報にもとづく企業価値評価レポートをお作りしてお渡しします。",
    }),
  });
  created++;
}
console.log(`shares: created=${created} skipped(既存)=${skipped} 対象=${people.length}名`);
