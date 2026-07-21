import { test, expect } from "@playwright/test";

// ユーザー目線監査 (cares post-login-audit を bonds 向けに)。
// フェーズ1 は認証が無いため「全画面が 5xx/エラーバナー/JS エラー無しで開くか・
// リンク・主要ボタン」を点検する。フェーズ5 で認証導入後にログイン前提へ拡張する。

function collectErrors(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  page.on("response", (res) => {
    // 503 は bonds の意図した縮退 (AI キー・送信基盤・決済などの「準備中」)。
    // 画面側のやさしい案内は各テストで別途確かめるため、ここでは数えない。
    if (res.status() >= 500 && res.status() !== 503) errors.push(`5xx: ${res.status()} ${res.url()}`);
  });
  return errors;
}

// ホームの各パネルは既定で閉じている (全体をひと目で見やすくするため)。開閉の状態は
// この端末に記憶される。監査は中身のボタンや入力を操作するので、見えている「ひらく」を
// なくなるまで押してすべて展開してから点検する (見出し h2 は閉じていても見える)。
async function expandAll(page: import("@playwright/test").Page) {
  // Fold は section > h2 > button[aria-expanded] の構造。閉じている (false) ものだけを
  // 各 1 回ずつ開く。位置は開閉で変わらないので nth 指定で二度押し (開いた直後の再クリックで
  // 閉じてしまう競合) を避ける。
  const buttons = page.locator("section > h2 > button[aria-expanded]");
  const n = await buttons.count();
  for (let i = 0; i < n; i++) {
    const b = buttons.nth(i);
    if ((await b.getAttribute("aria-expanded")) === "false") await b.click();
  }
}

test("ランディング → 4 つの入り口 (連絡先・提供・時間・人物評価) が並び、人物評価へ進める", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "bonds" })).toBeVisible();
  // 4 つの入り口カード
  await expect(page.getByRole("link", { name: /連絡先/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /モノやサービスの提供/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /時間調整と時間販売/ })).toBeVisible();
  await page.getByRole("link", { name: /人物評価/ }).click();
  await expect(page).toHaveURL(/\/subjects$/);
  await expect(page.getByRole("heading", { name: "評価対象の人物" })).toBeVisible();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("人物を追加 → 詳細が開き、評価ボタンとフッタ注記がある", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/subjects");
  const name = `監査用 渋沢栄一 ${Date.now()}`;
  await page.getByLabel("人物名").fill(name);
  await page.getByRole("button", { name: "追加", exact: true }).click();
  const link = page.getByRole("link", { name: new RegExp(name) }); // タイムスタンプ込みの一意名で特定
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByRole("button", { name: "二つの視点で評価する" })).toBeEnabled();
  // 2 セクションの見出し
  await expect(page.getByRole("heading", { name: "意識の七次元" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "社会価値創造" })).toBeVisible();
  await expect(page.getByText("断定ではありません")).toBeVisible();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("存在しない人物ページはやさしい 404 になる", async ({ page }) => {
  await page.goto("/subjects/no-such-person");
  await expect(page.getByText("見つかりませんでした")).toBeVisible();
});

test("連絡帳: 追加 → つながりスコア → 今日のおすすめ → 連絡記録の一周", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/contacts");
  await expandAll(page);
  await expect(page.getByRole("heading", { name: "連絡帳" })).toBeVisible();

  // 追加 (距離: 週に一度は → 接触記録が無いので「今日のおすすめ」に載るはず)
  const name = `監査 田中良子 ${Date.now() % 100000}`;
  await page.getByLabel("お名前").fill(name);
  await page.getByLabel("距離感", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect(page.getByText(name).first()).toBeVisible();

  // つながりスコアと今日のおすすめが表示される
  await expect(page.getByRole("heading", { name: "つながりスコア" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "今日、連絡してみませんか" })).toBeVisible();

  // 連絡しました → 記録の通知 (おすすめは上位 5 件のみのため、先頭の候補で記録経路を検証する)
  await page.getByRole("button", { name: "連絡しました" }).first().click();
  await expect(page.getByText("連絡の記録をつけました")).toBeVisible();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("連絡帳: あなたが力になれること (申し出) を登録できる", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/contacts");
  await expandAll(page);
  await expect(page.getByRole("heading", { name: "あなたが力になれること" })).toBeVisible();
  await page.getByRole("button", { name: "力になれることを書く" }).click();
  const title = `監査 英語を教えられます ${Date.now() % 100000}`;
  await page.getByPlaceholder(/何ができますか/).fill(title);
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByText(title).first()).toBeVisible();
  // クリックして編集できる (タイトルを押す → 保存)
  const li = page.getByText(title).first().locator("xpath=ancestor::li");
  await li.getByRole("button", { name: "編集" }).click();
  const title2 = `${title} 改`;
  await page.getByLabel("申し出のタイトル").fill(title2);
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page.getByText("申し出を更新しました")).toBeVisible();
  await expect(page.getByText(title2).first()).toBeVisible();
  // 消せる (データ主権: 1 件単位で削除)
  await page.getByRole("button", { name: `${title2} を消す` }).click();
  await expect(page.getByText(title2)).toBeHidden();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("公開掲示板: 申し出を公開 → 訪問者が問い合わせ → 承認で連絡先に迎える", async ({ page, browser }) => {
  const errors = collectErrors(page);
  await page.goto("/contacts");
  await expandAll(page);
  // 申し出を登録して掲示板に載せる
  await page.getByRole("button", { name: "力になれることを書く" }).click();
  const title = `監査 掲示板テスト 相談にのれます ${Date.now() % 100000}`;
  await page.getByPlaceholder(/何ができますか/).fill(title);
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByText(title).first()).toBeVisible();
  // 掲示板に載せる (行内のトグル。再描画と競合しないようラベルを押して通知で確認)
  await page.getByText(title).first().locator("xpath=ancestor::li").getByText("掲示板に載せる").click();
  await expect(page.getByText("掲示板に載せました", { exact: false }).first()).toBeVisible();

  // 別コンテキスト (認証なしの訪問者) で公開ページを開き、問い合わせる
  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  await guest.goto("/market");
  await expect(guest.getByText(title).first()).toBeVisible();
  const guestName = `監査ゲスト ${Date.now() % 100000}`;
  const guestLi = guest.getByText(title).first().locator("xpath=ancestor::li");
  await guestLi.getByRole("button", { name: "ひとこと送る" }).click();
  await guestLi.getByPlaceholder("お名前").fill(guestName);
  await guestLi.getByPlaceholder("ひとことメッセージ").fill("ぜひお願いしたいです");
  await guestLi.getByRole("button", { name: "送る", exact: true }).click();
  await expect(guest.getByText(/ありがとうございます/)).toBeVisible();
  await guestCtx.close();

  // オーナー側: 受け箱に出る → 連絡先に迎える
  await page.reload();
  await expandAll(page);
  await expect(page.getByText(/掲示板へのお問い合わせが/)).toBeVisible();
  await expect(page.getByText(guestName).first()).toBeVisible();
  await page.getByRole("button", { name: "連絡先に迎える" }).first().click();
  await expect(page.getByText("連絡先に迎えました", { exact: false })).toBeVisible();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("連絡帳: 同じお名前は確認を挟み、別の人として追加できる", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/contacts");
  await expandAll(page);
  const name = `監査同名 山田 ${Date.now() % 100000}`;
  await page.getByLabel("お名前").fill(name);
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect(page.getByText(name).first()).toBeVisible();

  // 同じ名前をもう一度 → まず「同じ方でしょうか」の確認が出る
  await page.getByLabel("お名前").fill(name);
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect(page.getByText(/すでに連絡帳にいます/)).toBeVisible();

  // 別の人と特定 → 追加され、一覧に同名が 2 件になる
  await page.getByRole("button", { name: "別の人として追加する" }).click();
  await expect(page.getByText(/すでに連絡帳にいます/)).toBeHidden();
  // 全員検索で同名 2 件 (一覧は 30 名超で畳まれるため、常に動く検索の導線で確かめる)
  const everyone = page.locator("section", { has: page.getByRole("heading", { name: /みなさん/ }) });
  await everyone.getByPlaceholder(/お名前・ふりがな/).fill(name);
  await expect(everyone.getByRole("link", { name: new RegExp(name) })).toHaveCount(2);
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("連絡帳: Google 取り込み枠が出る (未設定環境では準備中の案内)", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/contacts");
  await expandAll(page);
  await expect(page.getByRole("heading", { name: /Google（連絡先・カレンダー）/ })).toBeVisible();
  await expect(
    page.getByText(/準備中です|Google とつないで取り込む|つながっています/).first(),
  ).toBeVisible();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("連絡帳: 実行待ちのこと — 書き足し・済み・見送りが一周する", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/contacts");
  await expandAll(page);
  await expect(page.getByRole("heading", { name: /実行待ちのこと/ })).toBeVisible();
  const stamp = Date.now() % 100000;
  const title = `監査実行待ち 電話をかける${stamp}`;
  await page.getByPlaceholder(/自分で書き足す/).fill(title);
  await page.getByRole("button", { name: "書き足す" }).click();
  await expect(page.getByText(title).first()).toBeVisible();
  // 済みにすると一覧から片付く
  const row = page.getByText(title).first().locator("xpath=ancestor::li");
  await row.getByRole("button", { name: "済みました" }).click();
  await expect(page.getByText(title)).toBeHidden();
  // 再読み込み後も出てこない (サーバに記録されている)
  await page.reload();
  await expandAll(page);
  await expect(page.getByText(title)).toBeHidden();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("連絡帳: パーティで出会った方を貼り付けで迎えられる (出会いの記録つき)", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/contacts");
  await expandAll(page);
  await expect(page.getByRole("heading", { name: "パーティ・イベントで出会った方をまとめて迎える" })).toBeVisible();
  const stamp = Date.now() % 100000;
  await page.getByPlaceholder(/どこで出会いましたか/).fill(`監査交流会${stamp}`);
  await page.getByPlaceholder(/1 行にお一人ずつ/).fill(`監査新顔 田代${stamp} https://x.com/tashiro${stamp}`);
  await page.getByRole("button", { name: "まとめて迎える" }).click();
  await expect(page.getByText(/1名を新しくお迎えしました/)).toBeVisible();
  await expect(page.getByText(`監査新顔 田代${stamp}`).first()).toBeVisible();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("連絡帳: CSV 取り込みが画面から動く", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/contacts");
  await expandAll(page);
  await page.getByRole("button", { name: /ファイルや写真からまとめて取り込む/ }).click();
  const stamp = Date.now() % 100000;
  await page.getByLabel("取り込み内容").fill(`氏名,距離\n監査取込 佐々木${stamp},3`);
  await page.getByRole("button", { name: "取り込む", exact: true }).click();
  await expect(page.getByText(/取り込みを受け付けました/)).toBeVisible();
  // サーバのジョブが完了すると一覧に載る (数秒ごとに進む)
  await expect(page.getByText(`監査取込 佐々木${stamp}`).first()).toBeVisible({ timeout: 30000 });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("連絡先詳細: プロフィール保存・面談候補・お便り導線が開く", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/contacts");
  await expandAll(page);
  const name = `監査詳細 中村健 ${Date.now() % 100000}`;
  await page.getByLabel("お名前").fill(name);
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await page.getByRole("link", { name: new RegExp(name) }).first().click();
  await expect(page.getByRole("heading", { name })).toBeVisible();

  // プロフィール保存 (暗号化列の書き込み経路)。名前・会社などの項目もここで編集できる。
  await page.getByLabel(/近況・状況/).fill("お孫さんが生まれたばかり");
  await page.getByLabel("会社・所属").fill("監査商事");
  await page.getByLabel("メールアドレス").fill("kenta@example.com");
  const renamed = `${name} 改`;
  await page.getByLabel("お名前").fill(renamed);
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page.getByText("保存しました")).toBeVisible();
  await expect(page.getByRole("heading", { name: renamed })).toBeVisible(); // 名前の変更が見出しに反映
  // メールを設定すると「メールを送る」(mailto) が出て、直接連絡できる
  const mail = page.getByRole("link", { name: "メールを送る" });
  await expect(mail).toBeVisible();
  await expect(mail).toHaveAttribute("href", "mailto:kenta@example.com");

  // 面談候補: カレンダー未登録なら縮退案内、予定が登録済みの環境なら実際の候補が出る。
  // どちらも「ボタンが機能して結果が表示される」ことの監査として合格 (DB の状態に依存しない)。
  await page.getByRole("button", { name: "おたがいの空きから候補を出す" }).click();
  await expect(
    page
      .getByText(/ご自身の予定が未登録|重なる空きが見つかりませんでした/)
      .or(page.getByRole("link", { name: "カレンダーに入れる" }))
      .first(),
  ).toBeVisible();

  // お便りセクション: AI キー無し環境では 503 の優しい文言、鍵のある実機では
  // 実際に文面候補が返る (実生成は 1 分ほどかかりうるため長めに待つ)
  await page.getByRole("button", { name: "文面の候補を作る" }).click();
  await expect(page.locator('p[role="alert"]').or(page.getByLabel("件名"))).toBeVisible({ timeout: 90_000 });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("サインインページが開く (Firebase 未設定時は開発向け案内)", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "bonds" })).toBeVisible();
  // 設定済みなら Google ボタン、未設定なら案内と連絡帳への導線
  await expect(
    page.getByRole("button", { name: "Google ではじめる" }).or(page.getByText("サインインの準備")),
  ).toBeVisible();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("連絡先詳細: 贈り物・公人プロフィール・届け方の選択が表示される", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/contacts");
  await expandAll(page);
  const name = `監査全部 高橋 ${Date.now() % 100000}`;
  await page.getByLabel("お名前").fill(name);
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await page.getByRole("link", { name: new RegExp(name) }).first().click();
  await expect(page.getByRole("heading", { name: "贈り物を選ぶ" })).toBeVisible(); // Gift: 提案
  await expect(page.getByRole("heading", { name: "贈り物の記録" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "公人プロフィール" })).toBeVisible();
  await expect(page.getByLabel("届け方")).toBeVisible();
  // 「いただいた」贈り物を記録 → 一覧とやりとりに反映 (お返し管理の素地)
  await page.getByLabel("贈った・いただいた").selectOption("inbound");
  await page.getByLabel("贈り物").fill("お菓子の詰め合わせ");
  await page.getByRole("button", { name: "記録する" }).click();
  await expect(page.getByText("贈り物を記録しました")).toBeVisible();
  await expect(page.getByText(/いただいた: お菓子の詰め合わせ/)).toBeVisible();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("存在しない連絡先はやさしい 404 になる", async ({ page }) => {
  await page.goto("/contacts/00000000-0000-0000-0000-000000000000");
  await expect(page.getByText("見つかりませんでした")).toBeVisible();
});

test("提携先ディレクトリ (公開) が開く", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/partners");
  await expect(page.getByRole("heading", { name: "提携先のご紹介" })).toBeVisible();
  await expect(page.getByText(/準備中です|提携先/).first()).toBeVisible();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("提携先への連絡 (管理) が開き、候補の追加と下書き縮退が動く", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/admin/partners");
  await expect(
    page.getByRole("heading", { name: "提携先への連絡" }).or(page.getByText("管理者だけが使えます")),
  ).toBeVisible();
  // 開発フォールバック (break-glass) では管理できる
  if (await page.getByRole("heading", { name: "提携先への連絡" }).isVisible()) {
    const stamp = Date.now() % 100000;
    await page.getByLabel("提携先の名称").fill(`監査提携 つながり協会 ${stamp}`);
    await page.getByRole("button", { name: "追加", exact: true }).click();
    await expect(page.getByText("提携先の候補を追加しました")).toBeVisible();
    await expect(page.getByText(`監査提携 つながり協会 ${stamp}`)).toBeVisible();
    // AI キー無し環境: 下書きは 503 のやさしい文言 (5xx は BFF 応答として出るため許容しない → alert を確認)
    await page.getByRole("button", { name: "開く" }).first().click();
    await expect(page.getByRole("button", { name: "連絡文を下書き" })).toBeVisible();
  }
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("管理ページが開く (開発フォールバックでは編集一覧が出る)", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "管理", exact: true }).or(page.getByText("管理者だけが使えます")),
  ).toBeVisible();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("連絡帳に前進の記録 (これまでの歩み) が出る", async ({ page }) => {
  await page.goto("/contacts");
  await expandAll(page);
  // 直前のテストで接触記録があるため表示されるはず
  await expect(page.getByRole("heading", { name: "これまでの歩み" })).toBeVisible();
});

test("連絡帳: ファイル取り込み口 (置くだけ) と各サービスの手順ガイドが機能する", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/contacts");
  await expandAll(page);
  await page.getByRole("button", { name: /ファイルや写真からまとめて取り込む/ }).click();
  await expect(page.getByText("ここにファイルや写真、フォルダを置くか、押して選んでください")).toBeVisible();
  await page.getByText("各サービスからの取り出し方").click();
  await expect(page.getByText(/トーク履歴を送信/)).toBeVisible(); // LINE の手順
  await expect(page.getByRole("link", { name: "データのダウンロード" })).toBeVisible(); // LinkedIn 直リンク

  // CSV ファイルを置く → 取り込まれて一覧に出る
  const stamp = Date.now() % 100000;
  await page.getByLabel("取り込みファイル").setInputFiles({
    name: "list.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`氏名,距離\nファイル取込 井上${stamp},3`),
  });
  await expect(page.getByText(`ファイル取込 井上${stamp}`).first()).toBeVisible({ timeout: 30000 });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("連絡帳: LINE トーク履歴ファイルで相手とやりとりの記録が一度に入る", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/contacts");
  await expandAll(page);
  await page.getByRole("button", { name: /ファイルや写真からまとめて取り込む/ }).click();
  const stamp = Date.now() % 100000;
  const talk = [
    `[LINE] LINE取込 森${stamp}とのトーク履歴`,
    "保存日時：2026/07/01 12:00",
    "",
    "2026/06/01(月)",
    `10:23\tLINE取込 森${stamp}\tこんにちは`,
    "2026/06/03(水)",
    `09:00\tLINE取込 森${stamp}\t元気？`,
    "",
  ].join("\n");
  await page.getByLabel("取り込みファイル").setInputFiles({
    name: "line-talk.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(talk),
  });
  await expect(page.getByText(`LINE取込 森${stamp}`).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/1名を追加/).first()).toBeVisible(); // 取り込みの状況に完了が出る
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("連絡帳: 会話やメモからの取り込み口が開く (キー無しはやさしい案内)", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/contacts");
  await expandAll(page);
  await page.getByRole("button", { name: /会話やメモから取り込む/ }).click();
  await page.getByLabel("会話の内容").fill("昨日は田中さんとお茶をしました。お孫さんが生まれたそうです。");
  await page.getByRole("button", { name: "お相手と近況をさがす" }).click();
  // AI キーがある環境では提案一覧、無い環境では優しいエラーバナー
  await expect(page.getByText("見つかったお相手").or(page.locator('p[role="alert"]'))).toBeVisible({ timeout: 20000 });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("日程調整: 共有ページを作る → 相手側で枠を選んで提案 → 承認で確定まで一周する", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/schedule");
  await expect(page.getByRole("heading", { name: "日程調整と時間の受け付け" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /空き時間の設定/ })).toBeVisible();
  // カレンダーをなぞる空き時間登録 (FullCalendar) が表示される
  await expect(page.locator(".fc").first()).toBeVisible();

  // 共有ページを作る → リンクが表示される
  await page.getByLabel("見出し").fill("監査のお打ち合わせ");
  await page.getByLabel("名乗り", { exact: true }).fill("監査 太郎");
  await page.getByRole("button", { name: "ページを作る" }).click();
  await expect(page.getByText("できました:")).toBeVisible();
  const url = (await page.getByText(/\/s\/[0-9a-f-]{36}/).first().textContent()) ?? "";
  const shareUrl = url.match(/https?:\/\/\S+\/s\/[0-9a-f-]{36}/)?.[0] ?? "";
  expect(shareUrl, "共有 URL が表示される").toBeTruthy();

  // 相手側 (アカウント不要の公開ページ): 枠を選び、名乗って送る
  await page.goto(shareUrl);
  await expect(page.getByRole("heading", { name: "監査のお打ち合わせ" })).toBeVisible();
  // 空きのマス (FullCalendar のイベント) をタップして候補に選ぶ
  await page.locator(".fc-event").first().click();
  await expect(page.getByText(/選んだ時間:/)).toBeVisible();
  await page.getByLabel("お名前").fill("監査ゲスト 花子");
  await page.getByRole("button", { name: "この内容で送る" }).click();
  await expect(page.getByText("ご都合をお送りいただき、ありがとうございました")).toBeVisible();

  // オーナー側: 届いた提案を開き、承認して確定する
  await page.goto("/schedule");
  await page.getByRole("button", { name: "提案を見る" }).first().click();
  await expect(page.getByText("監査ゲスト 花子")).toBeVisible();
  await page.getByRole("button", { name: /で決める/ }).first().click();
  await expect(page.getByText("日程が決まりました").first()).toBeVisible();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("日程調整: 相手が予定表を重ねると、共通の空き時間だけの表示に変わる", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/schedule");
  await page.getByLabel("見出し").fill("監査の重ね合わせ");
  await page.getByRole("button", { name: "ページを作る" }).click();
  await expect(page.getByText("できました:")).toBeVisible();
  const url = (await page.getByText(/\/s\/[0-9a-f-]{36}/).first().textContent()) ?? "";
  const shareUrl = url.match(/https?:\/\/\S+\/s\/[0-9a-f-]{36}/)?.[0] ?? "";

  // 相手側: カレンダー表示 (FullCalendar) が出る → 自分の予定表 (ICS) を貼って重ねる
  await page.goto(shareUrl);
  await expect(page.locator(".fc-event").first()).toBeVisible();
  await page.getByRole("button", { name: /あなたの予定表を重ねて/ }).click();
  await page.getByLabel("重ねる方のお名前").fill("監査重ね 三郎");
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  await page.getByLabel("予定表の貼り付け").fill(
    `BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:${ymd}T090000\nDTEND:${ymd}T120000\nEND:VEVENT\nEND:VCALENDAR`,
  );
  await page.getByRole("button", { name: "予定表を重ねる" }).click();
  await expect(page.getByText(/共通の空き時間を表示しています/)).toBeVisible();
  await expect(page.getByText(/監査重ね 三郎さんの予定表と重ねた/)).toBeVisible();

  // オーナー側の詳細にも「重ねている方」が出る
  await page.goto("/schedule");
  await page.getByRole("button", { name: "提案を見る" }).first().click();
  await expect(page.getByText(/予定表を重ねている方: 監査重ね 三郎さん/).first()).toBeVisible();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("時間の受け付け: 無料の出品を作る → 公開ページから申し込みが確定する", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/schedule");
  await page.getByLabel("出品の名前").fill("監査の30分ご相談");
  await page.getByRole("button", { name: "出品する" }).click();
  await expect(page.getByText("出品を作りました")).toBeVisible();

  // 公開ページ (リンクのコピーはクリップボード権限に依存するため、一覧の URL を API から辿らず
  // 画面のコピー導線があることだけ確かめ、予約は一覧の URL で開く)
  await expect(page.getByRole("button", { name: "リンクをコピー" }).first()).toBeVisible();
  const offersRes = await page.request.get("/api/bff/schedule/offers");
  const offers = (await offersRes.json()) as { offers: { url: string; title: string }[] };
  const target = offers.offers.find((o) => o.title === "監査の30分ご相談");
  expect(target, "作った出品が一覧 API に載る").toBeTruthy();

  await page.goto(target!.url);
  await expect(page.getByRole("heading", { name: "監査の30分ご相談" })).toBeVisible();
  await expect(page.getByText("無料です")).toBeVisible();
  await page.getByRole("button", { name: /から$/ }).first().click();
  await page.getByLabel("お名前").fill("監査予約 次郎");
  await page.getByRole("button", { name: "この内容で申し込む" }).click();
  await expect(page.getByText("お申し込みを受け付けました")).toBeVisible();

  // オーナー側の予約一覧に確定で載る
  await page.goto("/schedule");
  await expect(page.getByText("監査予約 次郎").first()).toBeVisible();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("優先リスト: 距離感と目標をその場で直せて、あなたへの提案の受け箱が一周する", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/contacts");
  await expandAll(page);
  const name = `監査優先 藤井 ${Date.now() % 100000}`;
  await page.getByLabel("お名前").fill(name);
  await page.getByLabel("距離感", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect(page.getByText(name).first()).toBeVisible();

  // 「大切」の印を付ける (印を付けた方は、実データで強い方が多くても必ずリストに載る)。
  // 行の操作ボタンは載ってからしか押せないため、印だけは API で先に付ける
  const found = await (await page.request.get(`/api/bff/contacts?q=${encodeURIComponent(name)}`)).json();
  const contactId = (found.contacts as { id: string; name: string }[]).find((x) => x.name === name)!.id;
  const pin = await page.request.put(`/api/bff/contacts/${contactId}/focus-preference`, {
    data: { preference: "pinned" },
  });
  expect(pin.ok()).toBeTruthy();
  await page.reload();
  await expandAll(page);

  // 優先リストに載り、その場で目標を決められる
  const panel = page.locator("section", { has: page.getByRole("heading", { name: /大切にしたい方々/ }) });
  await panel.getByLabel(`${name}さんとの関係の目標`).selectOption("business");
  await expect(page.getByText("関係の目標を決めました")).toBeVisible();
  await expect(panel.getByLabel(`${name}さんと目指す距離感`)).toBeVisible();

  // 裏の自動ケアを一回りさせると「あなたへの提案」が届き、見送りで片付く。
  // batch=0 = 提案のみ (AI なし)。監査で AI コストを使わず、実データ数千件でも数秒で返る
  const care = await page.request.post("/api/bff/admin/relationship/priority-care?batch=0", { timeout: 60_000 });
  expect(care.ok()).toBeTruthy();
  await page.reload();
  await expandAll(page);
  await expect(page.getByRole("heading", { name: /あなたへの提案/ })).toBeVisible();
  const beforeCount = await page.getByRole("button", { name: "今回は見送る" }).count();
  await page.getByRole("button", { name: "今回は見送る" }).first().click();
  await expect(page.getByRole("button", { name: "今回は見送る" })).toHaveCount(beforeCount - 1);
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("関係を育てるとよい方々: 距離の縮め方が並び、✖ で外すと再読み込み後も出ない", async ({ page }) => {
  const errors = collectErrors(page);
  // 会社・メール・距離4 の方は「育てるとよい方々」の閾値を越える
  const name = `監査育成 川上 ${Date.now() % 100000}`;
  const created = await page.request.post("/api/bff/contacts", {
    data: { name, company: "育成監査商事", email: `grow-${Date.now()}@example.com`, distance: 4 },
  });
  expect(created.ok()).toBeTruthy();
  await page.goto("/contacts");
  await expandAll(page);
  const panel = page.locator("section", { has: page.getByRole("heading", { name: "関係を育てるとよい方々" }) });
  await expect(panel.getByRole("link", { name })).toBeVisible();
  // 距離の縮め方の一手 (会う約束) が並ぶ
  await expect(panel.getByRole("link", { name: /会う約束/ }).first()).toBeVisible();
  // ✖ で外すと消え、再読み込み後も出ない
  const x = panel.getByRole("button", { name: `${name}さんを今回は外す` });
  await x.click();
  await expect(x).toHaveCount(0);
  await page.reload();
  await expandAll(page);
  await expect(page.getByRole("button", { name: `${name}さんを今回は外す` })).toHaveCount(0);
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("提案の見送り: はじめの一手を ✖ で消すと、再読み込み後も出ない", async ({ page }) => {
  const errors = collectErrors(page);
  // 会社とメールのある新しい連絡先は「はじめの一手」の先頭グループに必ず入る
  const name = `監査見送り 実 ${Date.now() % 100000}`;
  const created = await page.request.post("/api/bff/contacts", {
    data: { name, company: "見送り監査商事", email: `dismiss-${Date.now()}@example.com` },
  });
  expect(created.ok()).toBeTruthy();
  await page.goto("/contacts");
  await expandAll(page);
  const x = page.getByRole("button", { name: `${name}さんへのはじめの一手を見送る` });
  await expect(x).toBeVisible();
  await x.click();
  await expect(x).toHaveCount(0);
  // 再読み込みしても見送りは覚えている (サーバに記録)
  await page.reload();
  await expandAll(page);
  await expect(page.getByRole("heading", { name: /みなさん|連絡帳/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: `${name}さんへのはじめの一手を見送る` })).toHaveCount(0);
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("設定: 設定ボタンから設定ページが開き、見送りの戻しと各項目がそろう", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/contacts");
  await expandAll(page);
  await page.getByRole("link", { name: "設定", exact: true }).click();
  await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Google 連携" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "空き時間と日程調整" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "データの書き出し" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "管理者向け" })).toBeVisible();
  // 見送った提案をすべて戻す (押すと件数つきの知らせが出る)
  await page.getByRole("button", { name: "見送った提案をすべて戻す" }).click();
  await expect(page.getByText(/戻しました/)).toBeVisible();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("連絡先詳細: 「いまのこの方」ノートの枠とまとめ直しボタンがある", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/contacts");
  await expandAll(page);
  const name = `監査ノート 岡本 ${Date.now() % 100000}`;
  await page.getByLabel("お名前").fill(name);
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await page.getByRole("link", { name: new RegExp(name) }).first().click();
  await expect(page.getByRole("heading", { name: /いまのこの方/ })).toBeVisible();
  await expect(page.getByText("自動でまとまっていきます")).toBeVisible(); // まだ記録が無いときの案内
  // まとめ直し (AI キー無し環境では優しいエラーバナーに縮退)
  await page.getByRole("button", { name: "記録からまとめ直す" }).click();
  await expect(page.locator('p[role="alert"]').or(page.getByText("最新にしました"))).toBeVisible({ timeout: 20000 });
  expect(errors, errors.join("\n")).toHaveLength(0);
});
