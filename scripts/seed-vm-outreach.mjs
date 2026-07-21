// VM アウトリーチ (Tier 2 法人) を bonds に投入する冪等シード。
//   - 法人を product=vm の外部参照つきで upsert (再実行しても重複しない)
//   - segment/tier/提案角度を notes に載せ、ドラフト生成時の文脈にする
//   - メールは gitignore 済みローカルファイルから合流 (リポジトリに残さない)
//   - 送信はしない。ここで作るのは「収集」まで。ドラフト生成→オーナー承認→送信は
//     bonds の outreach フロー (draft/approved/sent) 側で行う。
// 実行:
//   API_BASE=http://localhost:8080 ADMIN_TOKEN=... node scripts/seed-vm-outreach.mjs
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
const { segments, orgs } = JSON.parse(await readFile(join(dataDir, "vm-outreach-orgs.json"), "utf-8"));
// 公開窓口のメールを確認したら scripts/data/vm-outreach-emails.local.json に置く:
//   { "vmout-dalton": "info@example.com", ... }
let emails = {};
try {
  emails = JSON.parse(await readFile(join(dataDir, "vm-outreach-emails.local.json"), "utf-8"));
  console.log(`emails file: ${Object.keys(emails).length}件`);
} catch {
  // 無ければ法人名のみで投入 (窓口メールは後から UI か local ファイルで)
}

async function api(path, init) {
  const res = await fetch(`${API}/api/${path}`, { headers: H, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

let created = 0;
let existing = 0;
for (const org of orgs) {
  const segmentNote = segments[org.segment] ?? org.segment;
  const notes = [
    `VMアウトリーチ Tier2 (${org.country})`,
    `セグメント: ${segmentNote}`,
    org.note ? `メモ: ${org.note}` : null,
    "運用: ドラフト生成→オーナー承認→送信。全自動送信はしない。再送は最大1回。個人アドレス不可 (公開の法人窓口のみ)。",
  ]
    .filter(Boolean)
    .join("\n");
  const up = await api("contacts/upsert-external", {
    method: "POST",
    body: JSON.stringify({
      product: "vm",
      externalId: org.externalId,
      kind: "organization",
      name: org.name,
      company: org.name,
      relationship: "work",
      distance: 5,
      socialPosition: segmentNote,
      notes,
    }),
  });
  if (up.created) created++;
  else existing++;
  // メール補完: local ファイルにあり、未登録のときだけ書く
  const email = emails[org.externalId];
  if (email && !up.contact.email) {
    const c = up.contact;
    await api(`contacts/${c.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: c.name, furigana: c.furigana, distance: c.distance, relationship: c.relationship,
        birthday: c.birthday, phone: c.phone, address: c.address, company: c.company, title: c.title,
        sns: c.sns, personalProfile: c.personalProfile, socialPosition: c.socialPosition,
        valuesProfile: c.valuesProfile, notes: c.notes, email,
      }),
    });
  }
}
console.log(`orgs: created=${created} existing=${existing} 対象=${orgs.length}社`);
