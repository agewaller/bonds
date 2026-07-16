# オーナー設定メモ（bonds）— 気力・体力のあるときに、頭を使わずできるように

このメモは、オーナー（agewaller@gmail.com）にしかできない外部サービスの設定を、
**上から順にそのままやれば終わる**ように書いたものです。プログラミングの知識は要りません。
一度に全部やる必要はありません。**1 個ずつ、好きなときに**進めてください。

- ここに載っている設定が終わるまで、その機能は画面に「準備中」と出るだけで、**アプリは壊れません**。
- 各タスクは独立しています。順番は「効果の大きい順」に並べていますが、どれから始めてもかまいません。

---

## いちばん大事な心得（画面が説明と違って見えたとき）

各社の管理画面（Google Cloud、GitHub など）は、デザインやボタンの名前を**しょっちゅう変えます**。
このメモの手順と画面が違って見えても、**焦らなくて大丈夫**です。次のルールで乗り切れます。

1. **「ボタンの名前」ではなく「やりたいこと（ねらい）」で探す。** 各手順の先頭に
   「▼ ねらい」を書いてあります。名前が違っても、そのねらいを果たせる場所を探せば正解です。
2. **似た言葉に読み替える。** 例:「認証情報」＝「Credentials」＝「APIとサービス」。
   「変数」＝「Variables」＝「環境変数」。「シークレット」＝「Secret」＝「秘密の値」。
   このメモでは、想定される別名を「（または〜）」の形で併記しています。
3. **見つからないときは、画面上部の検索窓にキーワードを入れる。** たいていのサービスは
   管理画面に検索窓があります。手順中の【検索キーワード】をそのまま入れてください。
4. **それでも違ってどうしても分からないときは、ここで止めてかまいません。**
   「◯◯の画面で、△△というボタンが見つからない。画面にはこう出ている（写真）」と
   私（Claude）に伝えてください。**その時点の実際の画面に合わせて、やり直しの手順を書き直します。**
   無理に進めて壊すより、止めて聞くほうが安全です。

> このメモ自体の URL（ブックマーク推奨）:
> https://github.com/agewaller/bonds/blob/claude/bonds-file-expansion-lir14l/docs/OWNER-SETUP.md
> （本番に取り込まれたあとは `main` 版: https://github.com/agewaller/bonds/blob/main/docs/OWNER-SETUP.md ）

---

## 事前に一度だけ：本番へ反映する方法（各タスクの最後で使います）

いくつかのタスクは、最後に「本番へ反映（再デプロイ）」が必要です。やり方は毎回同じです。

- ▼ ねらい: 設定した値をアプリに読み込ませて有効にする。
- 手順:
  1. https://github.com/agewaller/bonds/actions を開く。
  2. 左の一覧から **「deploy-gcp」** を選ぶ。
  3. 右上の **「Run workflow」**（または「ワークフローを実行」）を押す。
  4. ブランチは **main** のまま **「Run workflow」** を押す。
  5. 緑のチェックが付けば完了（5〜8 分ほど）。
- もっと簡単な代わりの手段: 私（Claude）に「本番反映して」と言ってくれれば、こちらで実行します。
  **設定値そのものはオーナーしか入れられません**が、反映の実行は私が代われます。

---

## タスク1：メール送信を有効にする（Resend の鍵を使い回す）★おすすめ最初

これができると、bonds が作った連絡・お礼・面談打診のメールを、**実際に送れる**ようになります
（いまは下書きまで。送信ボタンが「準備中」）。**SendGrid の新規契約は不要**です。
cares で使っている **Resend** の鍵をそのまま使い回します。

- ▼ ねらい: ①Resend の鍵を bonds に渡す ②送信元メールアドレスを1つ決める ③本番反映。
- 事前に用意するもの:
  - cares で設定した **Resend の API キー**（`re_` で始まる文字列）。
    見つからなければ https://resend.com にログイン →【検索キーワード: API Keys】で作り直せます
    （無料枠で月3,000通）。
  - 送信元にするメールアドレス（例: `bonds@advisers.jp` など、**あなたが管理しているドメインの
    アドレス**）。Resend で「送信ドメインの認証（Verify a Domain）」を済ませたドメインが必要です。
    まだなら Resend の【検索キーワード: Domains】から追加できます。cares と同じドメインでよいです。

### 1-A. Resend の鍵を bonds のシークレットに入れる（Google Cloud）
- ▼ ねらい: 鍵という「秘密の値」を、bonds が読める金庫（Secret Manager）に更新版として入れる。
- 手順:
  1. https://console.cloud.google.com/security/secret-manager?project=arctic-anvil-497002-q2 を開く。
     （または上の検索窓で【Secret Manager】と入れる。日本語表示なら「シークレット マネージャー」）
  2. 一覧から **`BONDS_SENDGRID_API_KEY`** をクリック。
     - ※名前に「SENDGRID」とありますが、**中身は Resend の鍵で構いません**（bonds は鍵の形で
       自動判別します。`re_` なら Resend として送ります）。
  3. **「新しいバージョン」**（または「+ バージョンを追加」「Add version」）を押す。
  4. 「シークレットの値」欄に **Resend の `re_…` キーをそのまま貼り付け**て、**「追加」**を押す。
- 画面が違うとき: 一覧に `BONDS_SENDGRID_API_KEY` が見当たらない場合は、まだ作られていません。
  私に「BONDS_SENDGRID_API_KEY が無い」と伝えてください（作成手順を出します）。

### 1-B. 送信元アドレスを GitHub の変数に入れる
- ▼ ねらい: 「どのアドレスから送るか」をアプリに教える。
- 手順:
  1. https://github.com/agewaller/bonds/settings/variables/actions を開く。
     （または bonds リポジトリ →「Settings」→ 左メニュー「Secrets and variables」→「Actions」→
     上のタブ **「Variables」**）
  2. **「New repository variable」**（新しい変数）を押す。
  3. Name（名前）に **`OUTREACH_FROM_EMAIL`**、Value（値）に **送信元アドレス**（例 `bonds@advisers.jp`）
     を入れて保存。
  4. （任意）差出人の表示名も変えたいなら、同じ手順でもう1つ、Name **`OUTREACH_SENDER_IDENTITY`**、
     Value に表示名（例 `矢野`）。未設定なら「bonds」と表示されます。
- 画面が違うとき:「Variables」タブと「Secrets」タブを間違えやすいです。ここで入れるのは
  **秘密ではない値**なので、必ず **Variables**（変数）側に入れてください。

### 1-C. 本番へ反映
- 上の「本番へ反映する方法」を実行（または私に「本番反映して」）。
- 確認: 連絡先の「お便りを送る」で下書き→承認→送信し、相手に届けば成功。

---

## タスク2：Google 連携を有効にする（メール相手・カレンダー・連絡先の自動取り込み）

これができると、**ボタン一つで** Gmail のやり取り相手・Google カレンダーの同席者・
Drive の共有相手・Google 連絡先が bonds の連絡帳に入り、毎時自動で増えていきます。
先日入れた「空き時間のメール貼り付け」も、予定表アドレスを貼らずに自動で使えるようになります。

このタスクは少し長いので、**時間と気力のあるときに**。分からなくなったら途中で止めて私に聞いてください。

- ▼ ねらい: ①Google で「アプリの身分証（OAuth クライアント）」を作る ②必要な API を On にする
  ③戻り先アドレス（リダイレクト）を登録する ④できた ID と秘密を bonds に渡す ⑤本番反映。
- 作業する場所: Google Cloud Console（プロジェクトは **arctic-anvil-497002-q2**、cares と同じ）。
  画面右上のプロジェクト名が違っていたら、そこを押して **arctic-anvil-497002-q2** に切り替えてください。

### 2-A. 使う API を On にする
- ▼ ねらい: bonds が使う4つの窓口を有効化する。
- 手順（4回くり返す。各リンクを開いて「有効にする（Enable）」を押すだけ）:
  1. People API　https://console.cloud.google.com/apis/library/people.googleapis.com?project=arctic-anvil-497002-q2
  2. Gmail API　https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=arctic-anvil-497002-q2
  3. Google Calendar API　https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=arctic-anvil-497002-q2
  4. Google Drive API　https://console.cloud.google.com/apis/library/drive.googleapis.com?project=arctic-anvil-497002-q2
- 画面が違うとき: 「有効にする」がすでに「管理」に変わっていれば、それは**もう On** です（そのままでOK）。

### 2-B. 同意画面（アプリの説明ページ）を用意する
- ▼ ねらい: ユーザーが「bonds に連絡先の読み取りを許可しますか？」と聞かれる画面を用意する。
- 手順:
  1. https://console.cloud.google.com/apis/credentials/consent?project=arctic-anvil-497002-q2 を開く。
     （または【検索キーワード: OAuth 同意画面 / OAuth consent screen】）
  2. すでに cares 用に設定済みのはずです。**その場合はこの 2-B は飛ばして 2-C へ**。
  3. まだなら「外部（External）」を選び、アプリ名（例 bonds）・サポートメール（自分のメール）を入れて
     保存。スコープや公開申請は今はしなくて大丈夫（自分だけで使う分には「テスト」状態のまま、
     利用者に自分のメールを「テストユーザー」に足せば動きます）。
- 迷ったら: cares がすでに動いているので、**cares と同じ同意画面をそのまま使う**のがいちばん簡単です。

### 2-C. OAuth クライアント（アプリの身分証）を作る
- ▼ ねらい: bonds 専用の「クライアント ID」と「クライアント シークレット」を1組もらう。
- 手順:
  1. https://console.cloud.google.com/apis/credentials?project=arctic-anvil-497002-q2 を開く。
     （【検索キーワード: 認証情報 / Credentials】。左メニュー「APIとサービス」→「認証情報」でも可）
  2. 上の **「＋認証情報を作成」**（Create Credentials）→ **「OAuth クライアント ID」** を選ぶ。
  3. アプリケーションの種類（Application type）は **「ウェブ アプリケーション」（Web application）**。
  4. 名前は自由（例 `bonds-web`）。
  5. **「承認済みのリダイレクト URI」（Authorized redirect URIs）** に、次を**そのまま1行**追加:
     ```
     https://bonds-api-xj6szhutkq-an.a.run.app/api/google/callback
     ```
     - ※ここが1文字でも違うと連携が失敗します。**コピーして貼り付け**てください。
     - ※将来 bonds-api の URL が変わったら、この値も直す必要があります（その時は私が知らせます）。
  6. 「作成」を押すと、**クライアント ID** と **クライアント シークレット** が表示されます。
     この2つを**メモ**してください（次で使います）。閉じても後から見られます。
- 画面が違うとき: 「リダイレクト URI」欄が見当たらないのは、種類を「ウェブ アプリケーション」に
  していないときです。種類を選び直すと欄が出ます。

### 2-D. できた ID と秘密を bonds に渡す
- クライアント **シークレット**（秘密のほう）→ Google Cloud の Secret Manager に入れる:
  1. https://console.cloud.google.com/security/secret-manager?project=arctic-anvil-497002-q2 を開く。
  2. **`BONDS_GOOGLE_OAUTH_CLIENT_SECRET`** があればクリック→「新しいバージョン」で値を貼り付け→追加。
  3. **無ければ**「シークレットを作成」→ 名前 `BONDS_GOOGLE_OAUTH_CLIENT_SECRET` → 値にシークレットを
     貼り付け → 作成。
- クライアント **ID**（公開してよいほう）と **戻り先 URL** → GitHub の変数に入れる:
  1. https://github.com/agewaller/bonds/settings/variables/actions を開く（「Variables」タブ）。
  2. 「New repository variable」で、Name **`GOOGLE_OAUTH_CLIENT_ID`**、Value にクライアント ID。
  3. もう1つ、Name **`GOOGLE_OAUTH_REDIRECT_URL`**、Value に
     `https://bonds-api-xj6szhutkq-an.a.run.app/api/google/callback`（2-C の5と同じ文字列）。

### 2-E. 本番へ反映
- 上の「本番へ反映する方法」を実行（または私に「本番反映して」）。
- 確認: bonds にログイン →「連絡帳」→ Google 連携のボタンが「準備中」でなくなり、押すと Google の
  許可画面が出れば成功。許可すると相手が連絡帳に入ってきます。

---

## タスク3：staging（本番前のリハーサル環境）を一度だけ用意する

これができると、本番に出す前に「そっくりな別環境」で自動チェック（ユーザー目線監査・リンク切れ・
AI 実機）を通してから本番へ、という安全な流れになります。**本番のデータには一切触れません**。

- ▼ ねらい: ①gcloud にログイン ②用意スクリプトを1回実行 ③GitHub に staging という枠を作る。
- 手順:
  1. **gcloud にログイン**（自分のパソコンのターミナルで）。未インストールなら
     https://cloud.google.com/sdk/docs/install の案内に従う。
     ```
     gcloud auth login
     gcloud config set project arctic-anvil-497002-q2
     ```
  2. **用意スクリプトを実行**（bonds を clone したフォルダで1回だけ）:
     ```
     bash infra/scripts/10-create-staging.sh
     ```
     - これが staging 用の DB などを作ります（本番と別物）。
  3. **GitHub に「staging」という環境枠を作る**:
     - https://github.com/agewaller/bonds/settings/environments を開く。
     - 「New environment」→ 名前 **`staging`** → 「Configure environment」→ そのまま保存でOK
       （承認ゲートを付けたいときはここで設定できますが、必須ではありません）。
- 画面が違うとき: 「Environments」が左メニューに見当たらないときは、リポジトリの「Settings」内を
  【検索キーワード: Environments】で探してください。
- これは1回やれば済みます。以降は私が deploy-staging → 実機監査 → 本番、の順で回せます。

---

## いまは不要（将来やりたくなったら声をかけてください）

- **Tavily（人物評価や相手ノートの公開情報の実検索）**: 精度が上がりますが必須ではありません。
  希望があれば、まず私が「鍵を渡す配線」を用意してから、あなたが tavily.com で鍵を取る手順を出します。
- **Outlook のライブ連携（Microsoft）**: いまは Outlook の連絡先 CSV と予定表 ICS で十分動きます。
  ワンタップ連携まで欲しくなったら、Azure のアプリ登録が要るので、その時に手順を出します。
- **課金（Stripe / PayPal）**: 一般ユーザーに課金するときに。計測基盤は実装済みなので、
  プラン設計を決めてから進めます。

---

## 困ったときのひとこと（これだけ覚えておけば大丈夫）

- **画面が違って迷ったら、止めて写真を送って私に聞く。** その画面に合わせて手順を書き直します。
- **「準備中」と出ても壊れていません。** その設定がまだ、というだけです。
- **どの設定も、順番も、いつやってもかまいません。** 気力・体力のあるときに1つずつで大丈夫です。

---

## 今夜のチェックリスト（メール送信＝最短ルート。2026-07-15 追記）

DNSレコードとは: ドメイン (advisers.jp) という表札に紐づく住所録の1行。Resend が見せてくる
数行を、ドメインを契約している会社の管理画面にコピペで貼るだけ（「この持ち主が Resend からの
送信を公認しています」という証明の貼り紙）。

cares で使っているドメイン: cares.advisers.jp（サイト URL そのもの。送信元は noreply@cares.advisers.jp）。
すでに Resend で認証済みかは https://resend.com/domains で分かる（Verified と出ていれば DNS 作業は不要）。

- ステップ0: https://resend.com → Domains。Verified が「ある」→ DNS 不要、ステップ2へ。「ない」→ ステップ1へ
- ステップ1（無いときだけ）: Add Domain → cares.advisers.jp → 出てきた数行を advisers.jp の契約会社の
  DNS 設定【検索キーワード: DNS設定 / DNSレコード】にコピペ → Verified になるまで待つ（数分〜数時間）
- ステップ2: API Keys → 既存の re_… を控える（無ければ Create API Key。閉じると二度と見えないので必ずコピー）
- ステップ3: https://console.cloud.google.com/security/secret-manager?project=arctic-anvil-497002-q2 →
  BONDS_SENDGRID_API_KEY → 新しいバージョン → re_… を貼る（名前は SENDGRID だが中身は Resend で OK）
- ステップ4: https://github.com/agewaller/bonds/settings/variables/actions（Variables タブ）→
  OUTREACH_FROM_EMAIL に送信元（認証したドメインのアドレス。例 bonds@cares.advisers.jp）。
  任意で OUTREACH_SENDER_IDENTITY に表示名
- ステップ5: Claude に「本番反映」とひと言（反映と送信テストは Claude が見届ける）

迷ったら止めて、その画面の写真を送って相談してください。実画面に合わせて手順を書き直します。

---

## タスク4：Tavily（公開情報の実検索）を有効にする

これができると、人物評価（人物DD）・「いまのこの方」ノートの公開情報検索・提携先探しが、
知識だけでなく**最新のウェブ検索の裏付きき**で動くようになります。精度と最新性が上がります。
設定しなくてもアプリは壊れません（いまは知識ベースモードで動いています）。

- ▼ ねらい: ①Tavily の鍵をもらう ②bonds の金庫に入れる ③本番反映。3手で終わります。

### 4-A. Tavily の鍵をもらう
- ▼ ねらい: 検索サービス Tavily のアカウントを作り、API キーを1つもらう。
- 手順:
  1. https://app.tavily.com を開く。**Google アカウントでそのままログイン**できます（登録は無料。
     無料枠の回数はログイン後の画面に表示されます）。
  2. ログイン直後のホーム画面に **API Key**（`tvly-` で始まる文字列）が表示されます。
     右のコピーボタンでコピーしてください。【検索キーワード: API Key / Overview】
- 画面が違うとき: 見当たらなければ左メニューの「API Keys」か歯車（Settings）の中にあります。

### 4-B. 鍵を bonds の金庫に入れる（今回は「新規作成」です）
- ▼ ねらい: `BONDS_TAVILY_API_KEY` という名前のシークレットを**新しく作って**鍵を入れる。
- 手順:
  1. https://console.cloud.google.com/security/secret-manager?project=arctic-anvil-497002-q2 を開く。
  2. 上の **「＋シークレットを作成」**（Create Secret）を押す。
  3. 名前（Name）に **`BONDS_TAVILY_API_KEY`** と入力（コピペ推奨。1文字違うと読めません）。
  4. 「シークレットの値」に **`tvly-…` の鍵を貼り付け**る。
  5. ほかの項目はそのままで **「シークレットを作成」** を押す。
- 画面が違うとき: 「リージョン」等を聞かれたら「自動（Automatic）」のままでOKです。

### 4-C. 本番へ反映
- 私（Claude）に「本番反映」とひと言（または冒頭の「本番へ反映する方法」を実行）。
- 確認: 人物評価を新しく実行すると、評価の根拠に直近の出来事が反映されやすくなります。

## タスク5：Stripe（時間の受け付けのお支払い）を有効にする

これができると、「日程調整と時間の受け付け」画面から作った**有料の出品**（例: 30分のご相談 5,000円）で、
申し込んだ方がそのままカードでお支払いできるようになります。
設定しなくてもアプリは壊れません（無料の受け付けと日程調整はいまも使えます。有料だけ「準備中」表示）。

- ▼ ねらい: ①Stripe の秘密鍵をもらう ②bonds の金庫に入れる ③本番反映。3手で終わります。
- Stripe のアカウントは BMP-LP（山口道場）で使っているものと同じで大丈夫です。
  **agewaller@gmail.com** でログインできます。

### 5-A. Stripe の秘密鍵をもらう
- ▼ ねらい: Stripe の管理画面から「シークレットキー」（`sk_live_…` で始まる文字列）を1つコピーする。
- 手順:
  1. https://dashboard.stripe.com/apikeys を開く（ログインは agewaller@gmail.com）。
     【検索キーワード: 開発者 / Developers / API キー / API keys】
  2. 「標準キー」（Standard keys）の中の **シークレットキー（Secret key）** の行で
     「キーを表示」（Reveal key）を押し、表示された **`sk_live_…`** をコピーする。
  3. まず試したいときは、画面右上の「テストモード」（Test mode）をオンにして
     **`sk_test_…`** を使うこともできます（テストカード 4242 4242 4242 4242 で練習できます）。
- 画面が違うとき: 左メニューの「開発者」（Developers）→「API キー」です。
  分からなければ止めて、画面の写真を送って相談してください。

### 5-B. 鍵を bonds の金庫に入れる（今回は「新規作成」です）
- ▼ ねらい: `BONDS_STRIPE_SECRET_KEY` という名前のシークレットを**新しく作って**鍵を入れる。
- 手順:
  1. https://console.cloud.google.com/security/secret-manager?project=arctic-anvil-497002-q2 を開く。
  2. 上の **「＋シークレットを作成」**(Create Secret) を押す。
  3. 名前（Name）に **`BONDS_STRIPE_SECRET_KEY`** と入力（コピペ推奨。1文字違うと読めません）。
  4. 「シークレットの値」に **`sk_live_…`（または sk_test_…）の鍵を貼り付け**る。
  5. ほかの項目はそのままで **「シークレットを作成」** を押す。
- 注意: この鍵は**秘密の値**です。GitHub の Variables やメール・チャットには貼らないでください
  （この金庫＝Secret Manager だけに入れます）。

### 5-C. 本番へ反映
- 私（Claude）に「本番反映」とひと言（または冒頭の「本番へ反映する方法」を実行）。
- 確認: 「日程調整と時間の受け付け」画面の黄色い「準備中」の注意書きが消え、
  有料の出品のページで「お支払いに進む」からカード入力画面が開けば成功です。

### 返金・売上の確認について
- 予約の取り消しでお金を返すときは、Stripe の管理画面 → 「支払い」（Payments）から
  該当のお支払いを開いて「返金」（Refund）を押します（bonds からは返金しません）。
- 売上や入金予定も同じ Stripe の管理画面で確認できます。
