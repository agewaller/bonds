import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { parseImportFile, isZip, MAX_IMPORT_FILE_BYTES } from "../../src/lib/import-file.js";

// SNS 各社の「データをダウンロード」ZIP を模した固定資産。
// 実際のアーカイブのディレクトリ構造 (2025-2026 時点) に合わせている。

function facebookZip(): Uint8Array {
  return zipSync({
    "your_facebook_activity/friends_and_followers/friends.json": strToU8(
      JSON.stringify({ friends_v2: [{ name: "FB友達 一号", timestamp: 1 }, { name: "FB友達 二号", timestamp: 2 }] }),
    ),
    "your_facebook_activity/posts/photo.txt": strToU8("not friends"),
  });
}

// Facebook の HTML 形式エクスポート (ダウンロード画面の既定。2026-07-16 実ファイル回帰)。
// 実物は connections/friends/ 配下に your_friends.html と、友だちでない人のページ
// (removed/requests/知り合いかも等)・ロゴ・プロフィール写真が同梱される。
function facebookHtmlZip(): Uint8Array {
  const friend = (id: string, name: string) =>
    `<section class="_a6-g" aria-labelledby="${id}"><h2 class="_2ph_ _a6-h _a6-i" id="${id}">${name}</h2><footer><div class="_a72d">7月 01, 2026 6:25:04 PM</div></footer></section>`;
  return zipSync({
    "start_here.html": strToU8("<html><h2>ここから</h2></html>"),
    "connections/friends/your_friends.html": strToU8(
      `<html><head><title>あなたの友達</title></head><body><h1>あなたの友達</h1>${friend("a", "新島 太郎")}${friend("b", "大空 花子")}</body></html>`,
    ),
    "connections/friends/removed_friends.html": strToU8(
      `<html><body>${"x"}<section class="_a6-g"><h2>削除 済人</h2></section></body></html>`,
    ),
    "connections/friends/people_you_may_know.html": strToU8(
      `<html><body><section class="_a6-g"><h2>知合 かも代</h2></section></body></html>`,
    ),
    "files/fb_logo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
  });
}

describe("parseImportFile (ZIP まるごと取込)", () => {
  it("Facebook の HTML 形式エクスポートから友だちだけを取り込み、ノイズは AI/Vision に回さない", () => {
    const r = parseImportFile(facebookHtmlZip(), "facebook-html.zip");
    expect(r.contacts.map((c) => c.name)).toEqual(["新島 太郎", "大空 花子"]);
    expect(r.contacts[0]?.source).toBe("facebook");
    // 削除した友だち・知り合いかも・ロゴ画像は、連絡帳にも AI 抽出 (texts) にも Vision (images) にも入らない
    expect(r.contacts.some((c) => c.name.includes("削除") || c.name.includes("知合"))).toBe(false);
    expect(r.texts).toEqual([]);
    expect(r.images).toEqual([]);
  });

  it("Facebook アーカイブから friends.json を自動発見する", () => {
    const bytes = facebookZip();
    expect(isZip(bytes)).toBe(true);
    const r = parseImportFile(bytes, "facebook-user.zip");
    expect(r.contacts.map((c) => c.name)).toEqual(["FB友達 一号", "FB友達 二号"]);
    expect(r.contacts[0]?.source).toBe("facebook");
    expect(r.foundIn[0]?.file).toContain("friends.json");
  });

  it("Instagram アーカイブから following.json を自動発見する", () => {
    const bytes = zipSync({
      "connections/followers_and_following/following.json": strToU8(
        JSON.stringify({
          relationships_following: [{ string_list_data: [{ value: "insta_friend", href: "https://instagram.com/insta_friend" }] }],
        }),
      ),
    });
    const r = parseImportFile(bytes);
    expect(r.contacts[0]).toMatchObject({ name: "insta_friend", source: "instagram" });
  });

  it("X アーカイブから data/following.js を自動発見する", () => {
    const bytes = zipSync({
      "data/following.js": strToU8('window.YTD.following.part0 = [{"following":{"accountId":"777","userLink":"https://x.com/i/user/777"}}]'),
    });
    const r = parseImportFile(bytes);
    expect(r.contacts[0]).toMatchObject({ name: "777", source: "twitter" });
  });

  it("LinkedIn アーカイブから Connections.csv を自動発見する", () => {
    const csv = [
      "Notes:",
      '"When exporting your connection data..."',
      "",
      "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
      "Taro,Rinku,https://www.linkedin.com/in/taro,taro@example.com,Linked Inc,Manager,01 Jan 2026",
    ].join("\n");
    const bytes = zipSync({ "Basic_LinkedInDataExport/Connections.csv": strToU8(csv) });
    const r = parseImportFile(bytes);
    expect(r.contacts[0]).toMatchObject({ name: "Taro Rinku", source: "linkedin", company: "Linked Inc" });
  });

  it("Google Takeout の contacts.csv と .vcf を取り込む", () => {
    const csv = "First Name,Last Name,E-mail 1 - Value\nHanako,Google,hanako@example.com";
    const vcf = "BEGIN:VCARD\nVERSION:3.0\nFN:名刺 三郎\nEND:VCARD";
    const r = parseImportFile(
      zipSync({ "Takeout/Contacts/My Contacts/contacts.csv": strToU8(csv), "Takeout/Contacts/All Contacts/All Contacts.vcf": strToU8(vcf) }),
    );
    expect(r.contacts.map((c) => c.name).sort()).toEqual(["Hanako Google", "名刺 三郎"]);
  });

  it("ZIP 内の LINE トーク履歴 .txt も接触履歴つきで取り込む", () => {
    const talk = "[LINE] 圧縮 太郎とのトーク履歴\n\n2026/06/01(月)\n10:00\t圧縮 太郎\tやあ\n";
    const r = parseImportFile(zipSync({ "talks/talk.txt": strToU8(talk) }));
    expect(r.contacts[0]?.name).toBe("圧縮 太郎");
    expect(r.interactions).toEqual([{ name: "圧縮 太郎", occurredAt: "2026-06-01", type: "message" }]);
  });

  it("ZIP でないテキストはそのまま統合判別に回す", () => {
    const r = parseImportFile(new TextEncoder().encode("氏名,距離\n生テキスト,4"), "list.csv");
    expect(r.contacts[0]?.name).toBe("生テキスト");
  });

  it("壊れた ZIP は空で返す (500 にしない)", () => {
    const broken = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    const r = parseImportFile(broken);
    expect(r.contacts).toEqual([]);
  });

  it("上限サイズが妥当な範囲で定義されている", () => {
    expect(MAX_IMPORT_FILE_BYTES).toBeGreaterThanOrEqual(10 * 1024 * 1024);
  });
});
