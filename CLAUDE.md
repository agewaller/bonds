# CLAUDE.md — agewaller/bonds 開発ガイド

このファイルは Claude Code が読むためのガイド。すべての実装・文言・提案・優先順位の
判断は、下のミッションへの貢献で測る。

## このリポジトリ

人間関係エージェント bonds。人物DD（公人評価）と関係性マネジメントの2つの半分で
できたプロダクト（設計原本: [`docs/DESIGN-HANDOVER.md`](docs/DESIGN-HANDOVER.md)、
実装計画: [`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md)）。

## ミッション（最上位の目的・2026-07-04 オーナー宣言）

**bonds は、ユーザーが素晴らしい人生を送るためのエージェントツールである。**

ユーザーの人生の following 分野— **健康力強化・時間の最適利用・仕事の生産性向上・
他者や社会への貢献・楽しみの共有・コラボレーションによる創造・寄り添い・取引の推進・
資産の形成** — において、ネットワークを拡充し、一人ひとりとの関係を最適化し、
ストレスを減らし、**人間の共創を促進する**。

そのために bonds（と Claude Code）は次を主体的に実施する:

1. **最適なコミュニケーションの実施** — 相手・目的・状況・季節に合わせた文面の生成と発信
2. **距離感の調整** — 距離 1〜5 の設計と、適正な接触間隔の維持（近すぎず、途絶えさせず）
3. **貢献のためのアクション** — 相手の悩み・課題・夢に対して、ユーザーができる貢献の提案と実行
4. **人間関係問題の解決** — こじれ・疎遠・誤解の検知と、修復の打ち手の提示

実現の骨格は「**収集 → 把握 → 解析 → 打ち手 → 実行/提案 → 検証**」の循環:

1. **収集** — ユーザーの人間関係の把握（連絡先リスト: SNS・名刺・年賀状・CSV/vCard・
   カレンダー・メールから取込。入力の手間は最小化し受動的にも集める）
2. **把握** — 相手の状況の常時把握。**健康・家族友人関係・仕事・悩み・課題・夢・
   目標/目的・価値観**など、人生に関するありとあらゆる分野を `contacts` の
   プロフィール（personal_profile / social_position / values_profile）と対話記録に蓄積する
3. **解析** — 距離感スコア・接触間隔・誕生日/慶事・関係の健全度から「いま何が最適か」を判断
4. **打ち手** — 連絡・面談調整・贈り物・紹介・コラボ提案・修復メッセージなど、
   目的最適化された具体的アクションを生成する（毎回 something new を 1 つ）
5. **実行/提案** — 自律実行できるものは実行し、ユーザーの判断が要るものは促す（下記の自律性の段階）
6. **検証** — 実行結果を `contact_interactions` に還流し、距離スコアと打ち手の質を更新する

この循環のどこかを強くする変更は歓迎し、循環を断ち切る変更（収集を減らす・根拠のない
断定・検証できない提案）は行わない。

## ミッションの核（2026-07-09 オーナー宣言・恒久。上記を貫く最上位の定義）

**bonds は、①相手の状況、②ユーザー自身のリテラシーとリソース、③二人の関係——この 3 つを
冷静に、俯瞰的にみながら、本人たちが気づいていない方法を示唆し、人々の関係を最適化して
人生を豊かにするプロダクトである。**

「本人たちが気づかない方法」を出せることが bonds の存在理由。だから 3 軸を必ずそろえて見る:

1. **相手の状況** — 健康・仕事・家族・悩み・課題・夢・価値観・いまの近況（`contacts` の
   プロフィール／`profile_digest`／`profile_facets`／SNS・公開の発信／対話記録）。
2. **ユーザー自身のリテラシーとリソース** — その人にできること・持っているもの・使える時間や
   お金・人脈・知識・体力・気力。打ち手は必ず「このユーザーが現実に実行できる」水準まで下ろす
   （相手に最適でも、ユーザーが実行できない助言は打ち手にしない）。
3. **関係** — 距離感（1〜5）・接触間隔・健全度・貸し借りや貢献の履歴・こじれや疎遠の兆候。

この 3 軸を突き合わせて、当人同士では見えていない一手（引き合わせ・貢献・修復・間合いの調整・
新しい関わり方）を、冷静で俯瞰的な第三者の目で示唆する。押しつけず、最終判断はユーザーに委ねる。

### Claude（あなた）の恒常任務（オーナー委任・2026-07-09・自律行動の指針）

このミッションを完遂するため、Claude は指示を待つだけでなく自ら考えて、次の 4 つに注力し続ける。
迷ったとき・自律的に次の一手を選ぶときは、この 4 つへの貢献で優先順位を決める:

1. **プロダクトを進化させ続ける** — 上の循環（収集→把握→解析→打ち手→実行/提案→検証）の
   弱い環を自分で見つけ、洞察し、実装し、テストゲートを通してデプロイへ届ける。体感品質
   （速度・わかりやすさ・迷わなさ）も機能と同格に扱う。
2. **ユーザーを集め続ける** — bonds を必要とする人へ品位あるかたちで届け、迷わず価値に
   たどり着く導線（お試し→登録→オンボード→毎日の価値→紹介）を磨き続ける。
3. **ユーザーの情報を集め続ける** — 3 軸（相手の状況・ユーザーのリテラシー/リソース・関係）を
   高解像度で把握するための収集を、入力の手間を最小化しつつ受動的にも増やし続ける
   （SNS 連携・各種取込・受動同期・会話抽出）。データ主権と相手の尊厳を制約として守る。
4. **ユーザー間・ユーザーと周囲の関係をよりよくし続ける** — 距離感の最適化・適正な間合い・
   貢献と引き合わせ・こじれの修復まで、関係そのものが良くなる打ち手を出し・検証し続ける。

制約は常にこの任務に優先する: **相手（第三者）の尊厳とプライバシー**、**データ主権と鍵の絶対原則**、
**外に出る行動は下書き→承認→送信**、**最終判断はユーザー**、**コスト規律**（下の各節）。
これらを守ったうえで、領域を狭めず、本人たちの気づかない一手を出し続ける。

## エージェントの自律性の段階（安全の最上位制約）

bonds が扱う「相手」はユーザー本人ではなく**第三者**である。誤った発信・過剰な詮索は
相手との関係そのものを壊し、不可逆である。よって:

- **外に出る行動（メール送信・面談打診・贈り物手配など）は、既定で「下書き生成 →
  ユーザー承認 → 送信」**。cares outreach の status フロー
  (draft / approved / sent / failed / replied) を踏襲する
- **自動送信はユーザーが明示的に許可した範囲のみ**（例:「誕生日祝いは自動でよい」）。
  許可は channel × 目的の粒度で管理し、一括の包括許可を既定にしない
- **相手の尊厳とプライバシーを守る** — 相手の情報はユーザーとの関係の最適化のためだけに
  使い、相手の不利益になる利用（弱みの利用・操作的な文面）は生成しない
- **人間関係の最終判断は常にユーザー** — bonds は最良の選択肢と根拠を出すが、
  関係を定義するのはユーザー自身
- 分野に**取引・資産形成**を含むが、金融・法務の断定的助言はせず、専門家への接続を促す

## 共通プロダクト原則（cares から継承・全プロダクト適用）

1. **寄り添い** — すべての文言はまずユーザー（と相手）の気持ちを受け止めるところから。
   機械的な定型文にしない。「AI」等の技術語をユーザー画面に出さない（BR-09 相当）。
   記号装飾（※ ** 等）を出さず、強調は言葉で行う
2. **ゲーミフィケーション** — つながりスコア・連続記録・前進の可視化で継続を仕組みで支える
3. **シンプルさ** — ホームは「今日連絡してみませんか」と「つながりの状態」に集中。
   長い出力は折りたたみ。専門用語ゼロ（65 歳ペルソナ）

## データ主権と鍵の絶対原則（cares / data-sovereignty-journaling スキル準拠）

- **すべて格納する** — 連絡先・対話・贈り物・発信履歴は DB に永続化（localStorage は正本でない）
- **1 件単位の閲覧・編集・削除**の導線を必ず用意（「全消し」しかない状態は不可）
- **エクスポート可能** — ベンダーロックインしない
- **PII の項目暗号化** — `contacts.{email,phone,address,personal_profile,social_position,values_profile,notes,sns}`、`contact_interactions.notes`、`contact_gifts.notes`、`outreach_messages.body` は
  アプリ層 AES-256-GCM（封筒形式 `enc:v1:`、`packages/db/src/encryption.ts`）。
  **暗号化列は where/order by に使えない**
- **AI 鍵はサーバ側のみ** — BYOK 不可・ブラウザ/リポジトリに置かない・フォールバック連鎖禁止・
  月次円建てキャップ + 422 拒否（`ai_usage_logs` で集計）
- **管理者をロックアウトしない** — 三段フェイルセーフ実装済み（`lib/auth.ts`）: ①Firebase custom claim `admin:true` ②`OWNER_EMAIL`×password provider ③break-glass token。どれも未設定なら fail closed
- **モデル ID は canonical alias のみ**（datestamped 禁止。`lib/cost.ts` の canonicalizeModelId）
- **プロンプトは DB 駆動**（`prompts` テーブル、起動時 seed は冪等、管理画面で版管理へ）

## 文体規約（BR-09・2026-07-05 オーナー指示）

**AI っぽい出力にしない。記号は極力使わない。** cares の分析の表現方法
（`PLAIN_STYLE_GUIDE` / `sanitizeProse`）にしたがう:

- ユーザー向けの散文（人物評価の総括・推計、発信文面、価値観下書きなど）に
  アスタリスク（* ＊ **）・シャープ（#）・箇条書き記号（- +）・※・表（|）・絵文字を出さない。
  強調は記号でなく言葉で行い、見出しを付けずふつうの文章でやわらかくつなげる
- 担保は二段構え: ①プロンプトで記号禁止を指示（`dd-spec.ts` の COMMON_JSON_RULES、
  各プロンプトの禁止則）②取りこぼしに備えた **サニタイザの最終防衛線**
  （`apps/api/src/lib/plain-text.ts` の `sanitizeProse` を検証段階で適用。
  プロトタイプ `index.html` も表示直前に同じ規則で除去）
- 新しい AI 出力経路を作るときは必ずこの二段構えを通すこと

## 人物DD の倫理（公人評価）

公人（政治家・経営者等）のみ評価する。私人・特定不能は `identified:false` で評価を出さない。
人格攻撃・病気/心理の診断・根拠なき疑惑・陰謀論・私生活の過剰詮索・党派的断定の禁止。
批判は必ず公的行為と根拠に紐付け、断定でなく **confidence（A〜D）つき推計**で出す。
スコアは AI の申告値でなく **DdResultSpec で再計算**する（`lib/dd-spec.ts`）。

## 技術スタック・構成

案B（cares 踏襲）で確定: pnpm workspace / Node 22 / TypeScript。

```
apps/api      Hono API（人物DD + 関係性 + 発信）。テストは app.request() で直接叩く
apps/web      Next.js（BFF プロキシ /api/bff/* で管理トークンをサーバ側に閉じ込め）
packages/db   Prisma + AES-256-GCM 透過暗号化（ENCRYPTED_FIELDS に対象列を登録）
e2e           Playwright（ユーザー目線監査 + AI 実機スモーク）
```

- ローカル: `docker compose up -d`（bonds-db:5432 / api:8080 / web:3000）。
  Docker が使えない環境ではローカル Postgres 16 直結でも可（`scripts/setup-test-db.sh` が両対応）
- AI キー: リポジトリ root の `.env` に `ANTHROPIC_API_KEY=`（本番は Secret Manager）。
  未設定なら実行系は 503 に縮退（フォールバックしない）

## テスト規約（cares CLAUDE.md を踏襲・必ず 1 セットで合否報告）

「テストしてください」と指示されたら以下を必ず全部実施する:

1. `pnpm test` — ユニット → 結合（実 Postgres `bonds_test`。`scripts/setup-test-db.sh` が冪等に準備）
2. `pnpm test:e2e` — **ユーザー目線監査**（`post-login-audit`）+ **リンク切れ監査**
   （`link-audit`＝主要画面の内部リンク先が 404/5xx でない ＋ 外部リンク先＝SNS の取り出し方・
   データDLページ・翻訳リンク等がすべて到達可能）。全画面が 5xx/エラーバナー/JS エラー無しで
   開くか・リンク切れ・主要ボタン（プリインストール Chromium 環境では
   `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium` を付ける）。実機は `e2e-audit` ワークフロー
   （`base_url` に staging/本番 web を指定）で走らせる
3. **AI 実機スモーク**（`e2e/tests/ai-answers.spec.ts`）— 「渋沢栄一 → 2 評価が返る」を
   実 LLM で確認。**モック（vitest）は常に成功する偽 AI なので、この層を必ず実機で通す**。
   実行は既定 ON、API キーの無い環境だけ `E2E_INCLUDE_AI=0` で明示的に止める
   （黙って skip して緑に見せない）
4. ユニット/結合だけで OK とせず、**ユーザー目線監査までを 1 セットとして合否と件数を報告**する。
   失敗は `ファイル:行` / 壊れた画面・リンク・ボタンを具体的に添える

デプロイ（フェーズ5 で整備）は cares と同じ **2 ゲート**: テスト全緑 + ユーザーの明示承認。
デプロイスクリプトは cares `infra/scripts/05〜08` を `bonds-*` リソース名で複製する。
**本番反映の前に staging（`-staging` 接尾辞リソース・ADR-0015 踏襲）で e2e-audit
（ユーザー目線監査 + リンク切れ監査〔内部/外部の全リンク先〕+ AI 実機スモーク）を通す**
（`deploy-staging` → `e2e-audit(base_url=staging)` → 緑を確認 → `deploy-gcp`。詳細は
`infra/scripts/README.md` の「staging 環境」）。

## 参照リポジトリ早見表

| リポ | 何を参照するか |
|---|---|
| agewaller/cares | 暗号化・認証・AI 呼び出し・outreach・デプロイの複製元（プロトタイプ AI 口も cares） |
| shares-dev/vm-suite | 企業DD パイプライン（人物DD の構造原本）・DdResultSpec 検証 |
| agewaller/lms | 関係性ロジック（距離スコア・SNS 取込・カレンダー）の移植元 |
| agewaller/stock-screener | 参照のみ（旧健康日記）。AI リレーは壊れているため使わない |

## ステータス

- フェーズP: 静的プロトタイプ（`index.html` → GitHub Pages、cares の公開 AI 口を利用）— 稼働中
- フェーズ0: モノレポ骨格 + 暗号化基盤 — 完了
- フェーズ1: 人物DD MVP（dd_subjects / DD ランナー / DdResultSpec / web 画面）— 完了
- フェーズ2: 関係性基盤（contacts 暗号化スキーマ・距離スコア・「今日連絡してみませんか」・CSV/vCard 取込・連絡帳・エクスポート）— 完了
- フェーズ3: カレンダー & キープアップ（空き時間計算・二者空き重なり・面談候補・Eight/年賀状取込・values_profile AI 下書き）— 完了（ライブカレンダー同期はフェーズ5）
- フェーズ4: 発信（draft→承認→送信の強制フロー・複数文面候補生成・SendGrid mailer・接触記録への還流）— 完了（贈り物/年賀状チャネル・一括配信キューは今後）
- フェーズ5: 認証三段フェイルセーフ・監査ログ・本番 Dockerfile・デプロイスクリプト（cares 同一プロジェクト / ANTHROPIC_API_KEY Secret 共有）— 実装済み。web の Google ログイン（Firebase 共用・ownerUid 分離）・多言語 UI 辞書 (ja/en)・一括配信キュー・ICS 購読ライブ同期も実装済み
- 機能の積み残し掃討（2026-07-06）— 実装済み: 贈り物/年賀状チャネル + 手配済み記録・予約送信 UI・面談招待 .ics 生成・ゲーミフィケーション（連続記録/バッジ/次の節目）・SNS 取込（LinkedIn/Facebook/Instagram/X アーカイブ）・人物DD 検索ステップ（Tavily、キー無しは知識ベースに縮退）・管理画面（プロンプト版管理/モデル設定）・person_links（公人⇔連絡先）・404 画面
- 取込の抜本強化 + 他サービス連携（2026-07-06、設計は [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md)）— 実装済み: SNS の「データをダウンロード」ZIP をそのまま放り込める `import-file`（中身のファイルを自動発見）・LINE/WhatsApp トーク履歴からの相手 + 日別接触記録の復元・Google 連絡先 CSV・lms エクスポート JSON 取込・再取込に耐える冪等化（同名スキップ/同日重複なし）・会話/文字起こし（Plaud/ZenTrack）からの人物・近況抽出（提案 → 承認で反映）・取り出し方ガイド付きドラッグ&ドロップ UI。**SNS の OAuth 連携で友人リストを取る案は採用しない**（API 非公開のため。理由は INTEGRATIONS.md）
- プロフィール自動充実（2026-07-06）— 実装済み: `contacts.profile_digest`（暗号化）に「いまのこの方」ノートを自動生成。個別更新（公開情報の検索はユーザーが明示的に押したときだけ = 相手の尊厳）と、毎時 sweep のバッチ更新（新しい記録が積まれた人だけ・少数ずつ・月次キャップ到達で停止・web 検索なし）。ユーザーが書いた項目は上書きしない（ノートは別枠）
- 同姓同名の特定（2026-07-07）— 実装済み: 人物DD は追加時に候補を簡単なプロフィール付きで列挙しユーザーが特定（`/api/dd/identify` → `dd_subjects.profile_hint` に保存 → 評価・検索プロンプトに接地して別人との混同を禁止。キー無しは候補なしで名前のみ登録に縮退）。プロトタイプも同じ二段フロー（cares `/api/trial/person-eval` の `mode:"identify"` + `profileHint`。未対応サーバへは自動縮退）。連絡帳は同名追加時に 409 + 既存者のプロフィール提示 →「同じ人（開いて追記）/別の人として追加（confirmNew）」をユーザーが特定。一括取込は冪等（同名スキップ）のまま、見送った同名を `sameName` で知らせて追加欄から特定してもらう
- 提携先への自動メール連絡（2026-07-07、cares ADR-0022 移植）— 実装済み: `partner_targets`（contact_email 暗号化・candidate→queued→contacted→replied→partner のファネル・suppressed=送信除外）+ `partner_messages`（body 暗号化・draft→approved→sent）。候補の発見（`partner_discover`、Tavily があれば実在確認の材料付き）→ 個別連絡文の下書き（`partner_outreach_draft`）→ **承認送信が既定**（`PARTNER_AUTO_SEND=1` の明示許可時のみ下書き直後に自動送信。その場合も送信除外・日次上限 `PARTNER_DAILY_LIMIT`（既定20）・送信者明示＋配信停止フッタは必ず効く）→ 返信記録→返事下書き（`partner_reply_draft`）→ 公開ディレクトリ `/partners`（is_public のみ・PII なし）。管理画面 `/admin/partners`。毎時 sweep が承認済み（送信基盤未設定時の保留分含む）を送る。プロンプトは DB 駆動 seed（計9本）
- GCP 初回デプロイ（2026-07-08）— 完了: Cloud Run `bonds-api`（https://bonds-api-xj6szhutkq-an.a.run.app、healthz 緑）+ `bonds-web`。deploy-gcp ワークフロー（テストゲート→migrate→build→deploy→healthz）で運用。初回に踏んだ実障害と対策は各スクリプト/Dockerfile のコメントに記録（SQL edition 明示・SendGrid 番兵値・共有 AI キー名 cares-anthropic-api-key・api/web イメージは cares 方式）
- Google 連携による人物データの受動収集（2026-07-08）— 実装済み: OAuth（読み取り専用の最小権限・Gmail は gmail.metadata でヘッダのみ＝本文を読まない）で `google_connections`（refresh_token 暗号化）に接続し、カレンダー同席者（過去分は meeting 記録）・メールの相手（送った相手は1通で採用、受信のみは2通以上。no-reply/配信ドメインはノイズ除外）・Drive 共有相手を `applyImport`（冪等）で連絡帳へ。既存連絡先とはメールアドレスで突き合わせ表記ゆれの二重登録を防ぐ。接続はユーザーごと（`/api/google/auth-url`→同意→callback は HMAC 署名 state で本人性担保）。毎時 sweep が `sync-all` で受動同期。env `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`（Secret: BONDS_GOOGLE_OAUTH_CLIENT_SECRET）未設定なら「準備中」に縮退
- あらゆるファイル形式からの人物情報の抽出・整理格納（2026-07-08）— 実装済み: 連絡帳の取込を「読めない形式をなくす」方向に抜本強化。`lib/file-text.ts` が Word(docx)・Excel(xlsx)・PowerPoint(pptx)・PDF・HTML・メール(.eml/MIME・RFC2047・quoted-printable/base64)・RTF・テキスト全般を本文へ落とし、文字化けは UTF-8→Shift_JIS 自動判定（外部ライブラリは既存の fflate のみ・失敗は null に静かに縮退・画像/音声/動画は対象外）。既知の構造化形式（CSV/vCard/SNS アーカイブ/トーク履歴）で拾えないものは AI（プロンプト `import_extract`）で氏名・よみがな・連絡先・所属・役職・誕生日・関係種別・近況メモ・会った日を整理抽出し、同じ冪等取込 `applyImport` で連絡帳へ格納（出力は必ずサーバ側で検証・サニタイズ＝AI 申告のまま入れない・未来日は接触にしない・BR-09 記号除去）。`applyImport` は既存の方（同名 1 人）には空欄の補完とメモの書き足しだけ行い、ユーザーが書いた値は上書きしない。web はドロップ/選択に加え **フォルダごと取込**（webkitdirectory + ドロップの再帰走査・最大200ファイル・写真等はスキップ・逐次 POST で進捗表示）。AI キー未設定なら書類は `extract_unavailable` 422 に縮退し、構造化 CSV 等は従来どおり通る。デプロイの Google シークレット参照は存在時のみ配線（未作成でもデプロイが落ちない・準備中で入る）
- スマホ Google ログイン修正・人物DD の途中停止と直近情報重視（2026-07-08）— 実装済み: ①スマホのログイン不具合を cares の firebase-client 構造を移植して根治。`signInWithRedirect` の後に `getRedirectResult`（`completeGoogleRedirect`）を呼んでいなかったのが根因。popup 先行 → popup 不可コードで redirect フォールバック（UA 判定でなくエラーコード判定）・`indexedDBLocalPersistence` をサインイン前に設定・login ページのマウントで戻り処理。②人物DD の途中停止を根治: `PERSON_DD_MAX_TOKENS` 8000→16000、`createMessageResilient` が `stop_reason` を拾い、`max_tokens` で切れたら直前までの出力を assistant 発話として渡して続きを生成し文字列連結する継続ループ（`maxContinuations`、DD は 3 回）を generate に追加（JSON もそのまま繋がる）。③直近情報重視（リアルタイム更新の思想）: 今日の日付を接地し「固定的な結論でなく今日時点の最新像」を返す `PERSON_EVAL_RECENCY` を system に付帯、主要事実に時点を添える・知識カットオフ以降の変化を注記、Tavily 検索を recency バイアス（最新/直近クエリ + topic:news + days:365）にし digest も新しい順を優先と明示
- 取込の全方法化（2026-07-08・オーナー指示「第一歩=関係者取込をありとあらゆる方法で」）— 実装済み: ①名刺・名簿・年賀状・手書き名簿・連絡先/LINE のスクショなどの**写真から AI Vision で人物を読み取る**（`anthropic` generate に画像ブロック対応、`import-file` が画像を受けて `extractPeopleFromImages`＝import_extract に Vision ヒント付きで送る→検証・サニタイズ→applyImport）。web はドロップ/選択に加え「名刺や名簿を撮って取り込む」カメラ入力（capture=environment）。画像は base64 化してサーバ側でのみ AI に渡す（鍵はブラウザに出さない）。1 取込あたり画像 10 枚・各 5MB 上限。②**Google 連絡先（アドレス帳）を People API（contacts.readonly）で直接取込**（既存の Google 連携に scope 追加。`parseGoogleConnections` で氏名・メール・電話・所属→ `runGoogleSync` が connections を先頭に足す。冪等）。③連絡帳の取込 UI を全方法のオンボード導線として整理（写真・フォルダ・ZIP・書類・SNS・トーク履歴・Google 連携を一箇所に）。cares/zentrack/vm の統合を見据え、抽出ハブ `import_extract` を汎用に保つ（テキストも画像も同じ people JSON 契約で applyImport へ）
- Gift 機能の bonds 統合（2026-07-08・旧 Gift を捨てて全機能を bonds へ、オーナー「すべて」）— 実装済み: 既存の贈答履歴（contact_gifts）+ 贈り物/年賀状 outreach（添え状）を土台に、①**贈り物の提案**（`gift_suggest` プロンプト・`/api/contacts/:id/gift-suggest`。人物像/関係/距離/過去の贈答/行事/予算をふまえ具体候補＋値ごろ感＋「どう探すか」を返す。実在しない店名は作らない・BR-09 記号なし・サニタイズ）②**行事リマインド**（`lib/gifts.ts` の `computeGiftOccasions`＝純粋関数・`/api/gifts/occasions`。誕生日・記念日・季節の贈答＝お中元/お歳暮/年賀/母の日/父の日/敬老の日/バレンタイン/ホワイトデー/クリスマス〔時期に幅を持たせ grace 14日〕・未返礼のお返し督促を算出、未返礼を先頭に）③**贈答の履歴と収支・お返し管理**（`summarizeGiftLedger`・`/api/gifts`。相手ごとに贈った/いただいた件数金額と needsReturn を集計）④**手配**（提案の「探し方」＋既存の贈り物/年賀状 outreach で添え状。連絡先に direction=贈った/いただいた を記録）。schema に `contacts.anniversary` 追加（migration 20260708150000）。web は連絡帳トップに「いま贈るとよい方・行事」パネル、連絡先詳細に「贈り物を選ぶ」（提案）と direction 付き記録。抽出/提案ハブは汎用のまま（cares/zentrack/vm 統合を見据える）
- 人物DD 途中停止の根治と結果共有（2026-07-08）— 実装済み: ①長い評価（社会価値創造）が最後まで出ない件を根治。`buildAnthropicGenerate` の継続を「max_tokens のときだけ」から「クリーン終了（end_turn/stop_sequence）以外は全部継続」に拡張し、接続断（premature_close）や自前タイムアウトで救済した部分（incomplete）も続きを生成して繋ぐ。`PERSON_DD_TIMEOUT_MS` 120s→180s（各継続ぶんも確保）・`PERSON_DD_MAX_CONTINUATIONS` 3→4・Cloud Run api `--timeout=600`（評価は SSE 並列で DB に保存されるため、途中で instance が切られると invalid_output のまま保存されるのを防ぐ）。②結果の共有。subjects 画面に「この評価を共有する」ボタン（Web Share API、無ければクリップボード）。公人評価なので PII を含まず、氏名＋スコア＋ランクに **bonds の公開の入口（`https://agewaller.github.io/bonds/`）を添えて誘導**（受け取った人も試せる紹介ループ）。③AI 実機スモークを強化: 「前回の評価は完了しませんでした」が出たら失敗にし、二つ目（長い方）の途中停止をデプロイゲートで捕まえる
- 人物評価が最後まで出ない件の真因特定と解消（2026-07-08）— 本番実機監査（`e2e-audit` を新設: GitHub ランナーから本番 web に対し `ai-answers`＋`post-login-audit` を実行。サンドボックスは egress 制限で本番に届かないため）で判明: 直接原因は途中停止ではなく **月次 AI コストキャップ（¥3000）の枯渇による即時 422**（全 AI 機能の当月合計に効くため機能追加と検証で枯渇）。対応: `PERSON_DD_MONTHLY_CAP_JPY` の意味を拡張し **0=上限なし**（cares の AI_MONTHLY_CAP_OWNER_JPY=0 と同思想）、bonds web は管理トークン経由の単一オーナー専用（公開の入口はプロトタイプ→cares 側で別キャップ）のため本番既定を 0 にして 07 deploy env に配線。キャップ解消後の実機監査で **意識の七次元・社会価値創造の二評価がともに完走**（スコア見出し・「10段階で N」チップ・総括の散文が描画）を確認。あわせて途中停止そのものの根治（継続を非クリーン終了全般に拡張・timeout 180s・継続4回・Cloud Run api --timeout=600）も反映済み。実機スモークのセレクタ（Next の空 route-announcer 誤検知・散文の部分一致）も修正
- やり取り台帳・SNS 情報・連携ボタン・距離感の自動レーティング（2026-07-09）— 実装済み: ①**やり取り台帳**（`exchanges`。Gift を一般化し贈与だけでなく貢献/貸し借り/取引/約束を状態＋期日つきで記録。改ざん検知のハッシュチェーン＝ブロックチェーンは使わない・`lib/exchanges.ts`。連絡帳トップに督促「そろそろ区切りをつけたいこと」）。あわせて `/api/exchanges`・`/api/gifts` の requireUser 欠落（未認証で他人の台帳が読めた潜在バグ）を修正。②**各人の SNS 情報の取得**（`contacts.sns` を platform 別に構造化＝`lib/sns.ts`。記録 UI＋公開の発信の近況把握は refresh-digest の公開検索を SNS ハンドル軸に強化。公開検索は明示押下時のみ＝相手の尊厳）。③**SNS・サービス連携ボタン**（連絡帳上部に LINE/X/Instagram/Facebook/LinkedIn の「〜とつなぐ」＝各社公式のデータDLページを開き取り込みへ誘導。友だち一覧を直接くれる SNS API は無いため公式書き出し経由が正直・INTEGRATIONS.md 維持。Google は本物の読み取り OAuth を別枠で維持）。④**距離感 1〜5 の自動レーティング**（`suggestDistance` 純粋関数＝やりとりの延べ日数/回数/新しさ/贈り物から推定。`/api/relationship/distance-suggestions`＋`apply-distances`。連絡帳トップ「距離感の見直し」で理由つき提案→個別/一括適用。手がかり不足は confident=false で上書きしない・最終判断はユーザー）
- staging 環境と本番前の実機監査（2026-07-09）— 実装済み: cares ADR-0015 踏襲の staging（`-staging` 接尾辞リソース・本番と同一プロジェクト共存・DB 分離で本番データに触れない）を配線。`infra/scripts/_env.staging.sh`（差分オーバーレイ・`BONDS_ENV=staging` で有効）＋`10-create-staging.sh`（一度だけの provisioning: `bonds-db-staging`/`bonds-images-staging`/`bonds-db-password-staging`。暗号鍵・breakglass・AI キー・SendGrid は prod と共有）＋`deploy-staging.yml`（テストゲート→SQL 起動→migrate→build→deploy→healthz、`environment: staging` で承認ゲート化可）＋`stop-staging-sql.yml`。**リンク切れ監査 `e2e/tests/link-audit.spec.ts`（内部リンク先が 404/5xx でない ＋ 外部リンク先＝SNS の取り出し方・データDL 等がすべて到達可能。bot ブロック 401/403/405/429 は生存扱い、真の死活 404/410/5xx/接続不能のみ落とす）を新設し `e2e-audit` に追加**。本番前フロー: `deploy-staging` → `e2e-audit(base_url=staging web)` でユーザー目線監査＋リンク切れ監査＋AI 実機スモークが緑 → `deploy-gcp`（詳細は `infra/scripts/README.md`「staging 環境」）
- 取り込み直後の自動把握＋はじめの一手（2026-07-15・オーナー依頼「連絡先を取り込んだらその相手の状況などを自動的に取り込んで、動いたほうがよい方を確認できたらよい」）— 実装済み: ①**自動把握** = 毎時 sweep に `POST /api/admin/contacts/enrich-imports`（30日以内に取り込まれ・論点整理が未作成・材料〔所属/役職/メモ/近況〕のある方だけを少数ずつ `contact_facets` で整理。web 検索はしない＝相手の尊厳・月次キャップ 422 で停止・材料の無い方は AI を呼ばない）。facets ルートは `generateAndSaveFacets` として sweep と共用化。②**はじめの一手** = `GET /api/relationship/first-moves`（`lib/onboarding.ts` の純粋関数 `firstMoves`。取り込んだきり〔やりとりゼロ・30日以内〕の方から、仕事の接点あり > 挨拶がまだ > 情報を足すと動ける、の順に理由つきで最大8名。AI 不要で毎回無料）。連絡帳トップに「新しく迎えた方へ、はじめの一手」パネル（自動表示・各行から連絡先詳細へ。深い対応は「この方への対応を考える」に接続）
- 残（外部設定が前提のもの）: **staging の一度だけの GCP provisioning（オーナーが `10-create-staging.sh` を実行 + GitHub Environment `staging` 作成）**・Google OAuth クライアントの作成と設定（People API の contacts.readonly も同意画面に含める・People API を有効化）・Google/Outlook 予定の書き込み同期（ICS 招待で代替中）・多言語辞書の詳細ページ展開

## オーナー設定の記録（外部設定は OWNER-SETUP.md に、UI が変わっても迷わない粒度で書く）

オーナー（非エンジニア）にしかできない外部設定（API 鍵・OAuth・デプロイ・決済など）は、
[`docs/OWNER-SETUP.md`](docs/OWNER-SETUP.md) に「気力・体力が無くても上から順にやれば終わる」粒度で書く。
各社の管理画面はボタン名・配置を頻繁に変えるため、オーナーは**指示と実画面が食い違うと混乱する**。
これを避けるため、オーナー向け手順は必ず次を守る（全プロダクト共通の原則）:

1. 各手順の先頭に「▼ ねらい（この操作で何を達成したいか）」を1行。名前でなく目的で探せるようにする。
2. ボタン名は「（または〜/英語名）」で別名を併記する（例: 認証情報＝Credentials＝APIとサービス）。
3. 迷ったとき用に【検索キーワード】と直リンク URL を添える。
4. 各手順に「画面が違うとき」の注記を付け、最後は必ず「分からなければ止めて画面の写真を送って相談」に逃がす。
5. 秘密の値（Secret）と公開値（Variables/環境変数）のどちらに入れるかを明示し、取り違えを防ぐ。
6. 「終わるまで機能は準備中で縮退し、アプリは壊れない」ことを明記して不安を取り除く。

Claude はオーナー設定が要る機能を作ったら、同じ回で `docs/OWNER-SETUP.md` にこの粒度で追記し、
その URL をオーナーに伝える。UI が指示と違うという申告があれば、実画面に合わせて手順を書き直す。

**bonds のオーナー設定（詳細は OWNER-SETUP.md）**: ①Resend 鍵を `BONDS_SENDGRID_API_KEY` に + `OUTREACH_FROM_EMAIL`
変数（メール送信。SendGrid 契約は不要・cares の Resend を流用）②Google OAuth クライアント + People/Gmail/
Calendar/Drive API + `BONDS_GOOGLE_OAUTH_CLIENT_SECRET`/`GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_REDIRECT_URL`
（受動収集・ライブカレンダー）③staging の一度きり provisioning（`10-create-staging.sh` + GitHub Environment）
④（任意）Tavily。ANTHROPIC 鍵は cares と共有済み。
