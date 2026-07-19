# CLAUDE.md — agewaller/bonds 開発ガイド

このファイルは Claude Code が読むためのガイド。すべての実装・文言・提案・優先順位の
判断は、下のミッションへの貢献で測る。

## このリポジトリ

人間関係エージェント bonds。人物DD（公人評価）と関係性マネジメントの2つの半分で
できたプロダクト（設計原本: [`docs/DESIGN-HANDOVER.md`](docs/DESIGN-HANDOVER.md)、
実装計画: [`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md)）。

**将来構想の指針**: 「ユーザーが互いに持ち寄れるマーケットプレイス」は
[`docs/FUTURE-MARKETPLACE.md`](docs/FUTURE-MARKETPLACE.md) に設計を記録済み（未着手）。
公開範囲・マルチテナント化・距離/同意ゲート・モデレーションを扱う。**当面の各実装は
この未来を塞がないよう**、ownerUid をスコープキーとして扱い・公開範囲は将来 visibility へ
拡張する含みを持たせ・マッチング/距離/取引/暗号化の部品を汎用に保つ（詳細は同ドキュメント末尾）。

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
- 相手情報の収集強化フルセット（2026-07-16・オーナー依頼「なかなかユーザーの関係者の個人的・仕事的な情報を得るのは難しい→すべてお願いします」）— 実装済み。設計思想は「情報を掘りに行くのではなく、やりとりの副産物として自然に溜まる仕組みを作り、取りこぼしをゼロにする」: ①**近況メモ・返信の還流** = `POST /api/contacts/:id/note`（書けば接触記録になり、論点整理 facets も自動更新。連絡先詳細に「近況メモ・いただいた返信を残す」枠）②**会った直後のひとこと伺い** = `GET /api/relationship/recent-meetings`（`lib/capture.ts` の純粋関数。直近3日に会った方でその後のメモが無い方を挙げ、連絡帳トップの一行入力から還流。AI 不要）③**1日1問** = `GET /api/relationship/daily-question`（純粋関数 `pickDailyQuestion`。毎日ひとりについて足りない論点をひとつだけ定型で聞く。日付 seed で決定的・近しい方優先・答えた日は出ない・AI 不要で毎回無料）④**トーク履歴の中身からの近況整理** = 取込 (貼り付け/ファイル/ZIP) で LINE/WhatsApp を検出すると、接触日に加えて中身から相手の近況を `talk_digest` プロンプトで短い散文に整理しメモへ自動追記（ユーザーが自分で持ち込んだ会話のみ・web 検索なし・AI 未設定なら静かにスキップで取込は通る・キャップ 422 で停止・`import-file.ts` が talks を返す）⑤**会社の最近の動き** = `POST /api/contacts/:id/company-news`（相手個人でなく**所属先**の公開ニュースを Tavily で検索→`company_news` プロンプトで要約＋連絡のきっかけ一文＋出典。個人を自動 web 検索しない原則は不変。会社なし 422・検索なし 503 縮退。連絡先詳細に「調べる」ボタン）。プロンプト seed は計16本
- 関係の目標（2026-07-16・オーナー依頼「相手とのやり取りから関係値の目標や距離感のスコアリング・次の打ち手→お願いします。ビジネス、プライベート、婚活、恋活、家族関係など様々な用途」）— 実装済み: 相手ごとに**用途**（business/friend/romance/family/community/other）と**目標の距離感**（1〜5）を設定（`contacts.goal` 暗号化 JSON。恋活婚活等の要配慮情報を含みうるため暗号化・migration 20260716100000）。`lib/goals.ts` の純粋関数 `goalPlan` が現状との差から **接触ペースの目安**（目標/次の段階の距離に応じ数日おき〜年一、二度）と **用途別の段階の一手**（closing ladder。例: business=近況伺い→関心の情報→小さな貢献と面談→定例の場、romance=雑談→関心を聞く→負担の小さい二人の誘い→無理のないペースで）を出す。間が空けば「まずは一報」、目標どおりなら keep、**間合いを取りたい方向（target>current）も支援**（角の立たない引き方＋節目の挨拶は保つ）。進捗は設定時の距離 startDistance を基準に測る（目標微調整でも引き継ぐ）。API: `PUT/DELETE /api/contacts/:id/goal`・`GET /api/relationship/goals`（間が空いた方→差が大きい方の順・毎回無料）・詳細 GET に goal/goalPlan 同梱・**buildContactContext に目標を接地**（「対応を考える」playbook・発信文面・facets が目標に沿う）。web: 連絡先詳細「この関係の目標」カード（設定/変更/外す＋次の一手表示）・連絡帳トップ「目標に向かっている関係」パネル。尊厳の制約: どの用途でも相手の気持ちとペースを尊重する言い方に固定・操作的な駆け引きは提案しない（ladder 文言は静的テンプレート）
- 重要人物フォーカス＋名寄せ自動化（2026-07-16・オーナー方針「連絡先データはほとんど死んでいる。重要な人をピックアップして打ち手を。名寄せは自動化しユーザーの手を煩わせない」）— 実装済み: ①**大切にしたい方々** = `lib/priority.ts` の純粋関数 `pickFocusContacts`（やりとりの積み重ね・新しさ・贈答/台帳・ユーザーの意思〔目標設定/近い距離/手入力〕・材料の厚みで採点。閾値未満の「死んだ名簿」は選ばず消しもしない）。`GET /api/relationship/focus`（毎回無料）。連絡帳トップに「大切にしたい方々」パネル、**全員一覧は 30 名超で既定折りたたみ**（名前/会社の検索ボックスでいつでも探せる・すべて表示トグルあり）②**名寄せの自動実行** = マージ実体を `mergeContactGroup` に共用化し `POST /api/admin/contacts/auto-merge`（メール/電話一致の「同じ人」を情報の厚い方へ黙って統合・記録は付け替え・薄い方はアーカイブ。**名前だけの一致は同姓同名の別人がいるため自動化せず**従来の画面提案のまま。ownerUid をまたがない）を毎時 sweep に追加。取込時の強一致統合（applyImport）は従来どおり
- timeshare の概念の新規実装＝日程調整の共有リンク・空き時間の設定・時間の出品（2026-07-16・オーナー指示「概念とデータモデルだけすべてまったく新しく実装」「時間販売は Stripe で実装可能。設定は BMP-LP にある」。flagship-llc/timeshare〔Rails 4.2・EOL〕のコードは一切使わず概念のみ移植）— 実装済み: ①**空き時間の設定**（`availability_settings`＝曜日別の受け付け時間窓・予定の前後の余白・最低連続時間。`lib/availability.ts` 純粋関数。既存の面談候補・空き時間テキストにも反映。余白は「busy の膨張」で表現し窓の端は削らない）②**日程調整の共有リンク**（`schedule_shares`＝推測不能 share_key の公開 URL を相手〔アカウント不要の第三者〕に送る→相手はこちらの空き枠だけを見て候補を最大3つ提案〔`schedule_share_proposals`・ゲストの名乗り/連絡先/メッセージは暗号化〕→ユーザーが承認して確定＝下書き→承認→実行の原則。承認で contact_interactions へ還流 + .ics。確定枠は以後 busy 扱いで二重の約束を防ぐ。任意のあいことば〔scrypt + HMAC proof の無状態解錠〕・既定で期間終了+1か月で失効・期間は最長90日。web は `/s/[key]` 公開ページ + 連絡先詳細「この方に選んでいただくページを作る」+ `/schedule` 管理画面）③**時間の出品**（`time_offers`/`time_bookings`＝空き枠を相談メニューとして `/b/[key]` で公開し予約を受ける。0円は決済なしで即確定。有料は **Stripe Checkout を BMP-LP 方式**〔SDK 無しの REST 直・鍵は Secret Manager `BONDS_STRIPE_SECRET_KEY` のみ・webhook 不使用＝戻りで照合 + 毎時 sweep `reconcile-bookings` が取りこぼし再照合と期限切れ開放〕で受ける。鍵未設定は有料のみ「準備中」503 に縮退。返金は Stripe 管理画面から＝OWNER-SETUP.md タスク5）。時間請求マーケットプレイス（企業×個人の Project/Activity）は bonds のミッション外のため見送り
- e2e 監査の既存退行の修正（2026-07-16・上記と同セッション）— 全項目折りたたみ化（bec6533）で Fold の見出しが h2 でなくなり、`post-login-audit` の heading 断言と「追加」等のボタン部分一致が壊れていた（12件赤。デプロイゲートは unit/integration のみのため未検出）。**Fold を「h2 の中のボタン」に改修**（見出しセマンティクスと読み上げを回復）+ 監査セレクタの exact 化 + 取込フローの断言を非同期ジョブ型（2026-07-09 の import-jobs 化）に追随 + **503 は意図した縮退（準備中）として 5xx 監査から除外**。日程調整・時間の出品の一周監査 2 本を追加し、ローカル実機（本番ビルド）で post-login-audit + smoke 23/23・内部リンク監査 緑を確認（外部リンク監査と AI 実機はサンドボックス egress 制限のため従来どおり `e2e-audit` ワークフローで）
- timeshare の多者重なりの踏襲（2026-07-17・オーナー指示「インターフェイスも含めてできるだけ踏襲。とくに空き時間カレンダーの URL シェアと、他のユーザーが同じ URL で共通の空き時間を見られる部分」）— 実装済み: ①**週間カレンダー表示**（`/s/[key]` に timeshare 風のグリッド。色つきのマスが空き・タップで候補選択・横スクロール・開始時刻は常に30分グリッド固定〔now 由来の半端な開始を出す特例を廃止＝重ね合わせ前後で選択肢が揺れない〕）②**予定表の重ね合わせ**（`schedule_share_participants`＝同じ URL に入った相手が自分の ICS〔URL か貼り付け〕を重ねると、以降は**全員の共通の空き時間だけ**が表示され提案もそこから。参加者の空き＝期間内 busy の補集合〔終日〕で、時間帯の制約は主催者の空きとの積集合が担う。名乗り・ICS URL は暗号化・busy は枠のみで予定の中身は保存しない・participantKey で本人が入れ直し/取り消し〔ゲストにも1件単位の削除＝データ主権〕・上限10名）。オーナー詳細と公開ページに「重ねている方」を表示。提案のサーバ検証も共通の空きに従う（消えた枠は 409）
- 関係性強化のプライオリティと自動ケア（2026-07-16・オーナー依頼「何回も出てくる・情報が多い・直近の連絡の痕跡から優先度をつけ、ユーザーがカスタム→あとは自動で裏で動く」）— 実装済み: ①**優先度の採点強化** = `contacts.source_hits`（取込・名寄せで同じ方に行き当たった延べ回数。applyImport の強一致/同名補完と auto-merge で加算）を新設し、`pickFocusContacts` に「くり返し登場」「pinned/excluded（ユーザーの意思が自動判定より常に強い）」を追加。②**優先リストのその場カスタム** = 連絡帳トップ「大切にしたい方々」で距離感・関係の目標（用途×目指す距離感）・大切と印を付ける/リストから外す（excluded は記録を消さずいつでも戻せる・未対応の提案も片付く）を直接編集（`PUT /api/contacts/:id/focus-preference`・focus API に distance/goal/preference 同梱）。③**優先度に基づく自動ケア** = `care_suggestions`（あなたへの提案の受け箱・本文暗号化）+ 毎時 sweep `POST /api/admin/relationship/priority-care`。優先リスト上位の方に `lib/care.ts` の純粋関数 `planCareActions` が「間が空いた方への一報・トーク履歴取込の促し・目標決め・日程調整で会う約束・ひとことメモ」を最大2件/人で提案（AI 不要・無料）。論点整理が未作成で材料のある方は AI で自動整理（**蓄積した記録のみ・web 検索なし＝相手の尊厳の原則は不変**・月次キャップ 422 で停止）。出し直しは見送り/済みから30日そっとしておく（`shouldSuggestAgain`）。web は「あなたへの提案」パネル（やりました/今回は見送る・kind 別の実行導線）。実行は常にユーザーが選ぶ＝最終判断はユーザー
- Google OAuth の権限分割 + アプリ確認（審査）の下準備（2026-07-17・オーナー質問「Google の『危険なページです』警告を回避できますか？」→「お願いします」「基本は OAuth、ICS は一般向けの代替」）— 実装済み: ①**権限の三段化**（`GOOGLE_SCOPES_BASE`=openid/email/calendar.readonly/contacts.readonly〔sensitive 区分のみ＝審査が軽く警告を消しやすい〕を既定に、`GOOGLE_SCOPES_EXTENDED`=+gmail.metadata/drive.metadata.readonly〔restricted 区分=CASA 重審査〕は連絡帳の「メール・共有ファイルの相手も拾えるようにする」ボタンで明示オプトインした人だけ、`GOOGLE_SCOPES_GUEST`=openid/email/profile/calendar.freebusy〔最小〕。`include_granted_scopes` で増分許可・`runGoogleSync` は付与スコープを見て Gmail/Drive を静かにスキップ・status に extended フラグ）②**共有ページのゲストも OAuth が基本**（`/api/public/schedule/:shareKey/google-auth-url` → state に `share|<key>|<participantKey>` を HMAC 署名 → callback でその場一度だけ freeBusy を照会し参加者として保存。**access_type=offline を付けず refresh token を発行させない＝トークン非保存**。名乗りは Google プロフィール由来。`/s/[key]` は「Google でカレンダーをつなぐ」を主ボタンに、ICS 貼り付けは「Google をお使いでない方はこちら」の代替に格下げ〔OAuth 未設定環境では従来どおり ICS が直接出る縮退〕）③**審査の下準備**（公開の `/privacy` ページ新設〔Google API Limited Use 準拠の明記・ランディングにフッタリンク〕+ OWNER-SETUP.md タスク6=独自ドメイン→同意画面の本番公開→sensitive 2 スコープだけ登録して確認申請、restricted は申請に含めないのがコツ、という粒度の手順）。テスト: google unit 11 + integration 9（base 接続で Gmail/Drive を呼ばない・ゲスト callback で googleConnection が増えない・googleReady フラグ）+ post-login-audit 25/25・link-audit 緑
- FullCalendar 現行版の導入＝timeshare の空き時間カレンダーそのもののインターフェイス（2026-07-17・オーナー指示「FullCalendar 現行版の導入」。timeshare は同ライブラリの v2 jQuery 版＋CoffeeScript で EOL のためコードは持ち込まず、v6 の公式 React 対応で再現）— 実装済み: ①**オーナーの空き時間ドラッグ登録**（`availability_slots` テーブル＝timeshare の free_times の踏襲・migration 20260717100000。`/schedule` の FullCalendar timeGridWeek をドラッグでなぞると空き枠になり、枠タップで削除。`components/AvailabilityCalendar.tsx`）②**日単位の優先規則**（`freeIntervalsWithExplicitSlots` 純粋関数: なぞった日はその枠だけが空きのもと・なぞっていない日は従来の曜日別受付時間・busy 膨張と最低時間は共通・なぞった枠が過去に流れた日は曜日窓へ戻さない・受けない曜日でもなぞれば空く。`myFreeIntervals` に配線し面談候補・共有ページ・出品すべてに効く）③**公開ページ `/s/[key]` のカレンダーを FullCalendar に置換**（`components/ShareSlotCalendar.tsx`。30分グリッドのマスとして開始時刻を敷き詰め、タップで候補選択・選択は青・共通の空きは緑・validRange で期間外グレーアウト・slotMin/MaxTime を選択肢から自動圧縮。自作グリッドは撤去）。API: GET/POST/DELETE `/api/relationship/availability-slots`（24h 上限・過去不可・1 年先まで・総数 500 個で 400）。依存は @fullcalendar/{core,react,daygrid,timegrid,interaction}＝標準機能 MIT。テスト: availability unit 16（明示枠の優先・busy 減算・過去流れ・無効曜日）+ schedule integration 11（なぞった日は 19:00/19:30/20:00 だけ・翌日は曜日窓）+ post-login-audit 25/25（.fc-event クリックで提案一周）+ link-audit 緑
- オーナーの AI 利用枠の撤廃（2026-07-17・オーナー指示「私 (agewaller@gmail.com) は管理者なので AI 利用枠を設けないでください」・恒久）— 実装済み: オーナーの月次キャップの**コード既定を「上限なし」に変更**（従来は env 未設定だと ¥3000 が既定 → ローカル/staging や env の配線漏れでもオーナーが 422 になり得た）。`PERSON_DD_MONTHLY_CAP_JPY` 定数を廃止し、呼び出し時に env を読む `ownerMonthlyCapJpy()` に変更（0/未設定/不正 = 上限なし・正の数を明示したときだけ効く）。**オーナー以外の利用者のキャップ（app_config `ai_monthly_cap_user_jpy`・既定 ¥500）は不変**。コスト規律は上限でなく透明性で担保（/api/admin/ai-usage で実支出が常に見える）。キャップ機構そのもののテストは env 明示で駆動（dd/outreach の 422 → env を外すと同じ消費でも通ることまで検証）
- 設定ページ + 提案の見送り ✖️（2026-07-17・オーナー指示「設定ボタンを作って。連絡先の様々な提案の横にすべて ✖️ を付けて見送れるように」）— 実装済み: ①**設定ページ `/settings`**（Google 連携のつなぐ/追加の許可・空き時間と日程調整への導線・表示の言語・データの書き出し〔全件 JSON〕・見送った提案をすべて戻す・管理画面・プライバシーポリシーを一箇所に）+ 主要画面（連絡帳/日程調整/人物/ランディング）のヘッダに「設定」リンク。②**提案の見送り** = `suggestion_dismissals` テーブル（ownerUid×kind×key 一意・migration 20260717150000）+ `GET/POST/DELETE /api/relationship/dismissals`。連絡帳トップの全提案パネル（行事・台帳の督促・距離感の見直し・そっと気にかけたい関係・目標の知らせ・ひとこと伺い・1日1問の「今日はやめておく」・はじめの一手）の各行に ✖️（aria-label「…を見送る」）。見送りはサーバに記録され再読み込み後も出ない。**key に年や日付を含む提案（行事・1日1問・ひとこと伺い）は次の機会に自然にまた出る**＝ユーザーの意思を尊重しつつ提案は続ける。first-moves はサーバが 24 名返し web が見送り除外後に 8 名表示（見送ると次の方が繰り上がる）。取り消しは設定の「すべて戻す」（記録そのものは何も消さない）。テスト: integration 4（冪等・400・全戻し・ownerUid 分離）+ post-login-audit 27/27（✖️ 永続と設定ページ一周を含む）
- 包括セキュリティ点検と修正（2026-07-18・オーナー依頼「エラー・バグ・プライバシー流出・ハッキングのリスクを包括的にチェック」→「全部」直す）— 5 観点（認証/認可・暗号化/PII・注入/XSS・SSRF/公開経路・鍵）を並行監査し、見つかった全件を修正:
  - **CRITICAL: BFF の匿名フォールバック廃止**（`apps/web/app/api/bff/[...path]/route.ts`・`contacts/receive/route.ts`）。未ログインの訪問者に管理トークンを自動付与していたため、URL を知る匿名の第三者がオーナーの全復号 PII と管理 API に到達できていた。**匿名にトークンを付けない**ようにし（ローカル開発のみ `ALLOW_DEV_ADMIN_FALLBACK=1` で明示的に有効化・本番は未設定）、`lib/auth.ts` で **OWNER_EMAIL 本人（Firebase ログイン・provider 不問）を `owner` スコープ + 管理者にマップ**（既存の owner バケツのデータにログインで到達／custom claim・break-glass の三段は不変）。`OWNER_EMAIL` を prod デプロイに配線（`_env.sh`/`07-deploy`）。**オーナーは Google ログインが必須**になる（未ログインは 401）。subjects 画面の生 fetch を apiFetch 化（Bearer 転送）。web の Web Share Target 取込は認証を運べないため本番では無効化（通常のファイル取込は不変）
  - **HIGH: SSRF/DoS**（`lib/safe-fetch.ts` 新設）。ICS 購読 URL 取得を https のみ・DNS 解決後の private/loopback/link-local/ULA/メタデータ IP 拒否・リダイレクト手動再検証・5MB サイズ上限・タイムアウトに堅牢化。公開の参加者経路から到達する未認証 SSRF を封鎖
  - **HIGH: export の他ユーザー混入**（`app.ts` `/api/contacts/export`）。interaction/gift を `where:{contact:{ownerUid}}` に絞り、テナント越境を修正（回帰テスト付き）
  - **MEDIUM**: `GET /api/dd/*` を requireAdmin 化（下書き/失敗評価/内部エラーの公開を停止・共有は `/api/public/subjects/:slug` のみ）／有料出品の未認証「枠の空押さえ」DoS に per-offer pending 上限（`MAX_PENDING_BOOKINGS_PER_OFFER=5`）／公開経路（解錠・参加・提案・予約）に IP レートリミッタ（`lib/rate-limit.ts`・解錠は総当り対策で厳しめ）／`.env.example` の実鍵をプレースホルダ化 + `OWNER_EMAIL` 追記
  - **LOW**: 全シークレット比較を `timingSafeEqual`（`secretEquals`）に／zip の総展開量・エントリ数の合算上限／外部 URL の href をスキーム検証（`lib/safe-url.ts`・javascript: 等を弾く）／あいことばロック中は title/displayName を出さない／Stripe 確定時に amount_total を突合／取込は Content-Length で早期に 413
  - テスト追加: safe-fetch 11・rate-limit/secretEquals 8・export 非混入・dd GET 認可・全体で unit 368 / integration 205 + post-login-audit 27 + link-audit 全緑。**本番の匿名アクセスが 401 になることを実測確認**（公開経路は素通り）
- 既存カレンダーの取込＆表示（2026-07-18・オーナー依頼「Google カレンダー・Outlook から既存の予定を取り込んで表示（空き時間が見えやすく）」）— 実装済み: ①**Google カレンダーの予定取込**（`syncGoogleBusy`＝既存 OAuth の freeBusy を 60 日先まで取得し `self:google` の calendar_link に保存。件名は取らず時間帯だけ＝予定の中身は保存しない。`POST /api/relationship/import-google-calendar` の軽い専用経路＋毎時の Google 同期でも自動更新）②**Outlook 等の取込**（予定表の公開 ICS アドレスを貼る＝既存 `PUT /api/relationship/my-busy` の icsUrl 経由・`self` に保存。SSRF 対策済み safe-fetch を通る）③**空き時間カレンダーに重ねて表示**（`myFreeIntervals` を `self` + `self:google` の busy を union するよう変更＝両ソース同時可。`GET /api/relationship/my-busy` で期間の busy を返し、`/schedule` の FullCalendar に灰色の背景帯で「予定あり」を表示＝白い時間が空きとひと目で分かる。取込済みは Google/予定表アドレスのフラグで表示）。取り込んだ busy は共有ページ・面談候補・出品の空き計算にも反映（予定と重なる枠は出さない）。テスト: google integration +1（busy 取込→my-busy→共有の空きから除外）・全体で integration 206 + post-login-audit 27 緑
- gift の貢献マッチング（2026-07-18・オーナー依頼「リポジトリ gift のシステムを解析し、timeshare 同様に bonds へ新規実装できるか検証」→「マッチング + 付随を厚めに」）— 解析の結論: gift（Rails 3.2・EOL の P2P 譲り合い/相談掲示板。give/lend/teach/do/advise の申し出とニーズを距離ゲートで結ぶ）の中核はすでに bonds にある（やり取り台帳 exchanges・贈り物提案 gift_suggest・距離スコア・引き合わせ）。**ポイント経済・公開マーケットプレイス・Facebook 認証はミッション外で不採用**。**新しく価値になるのは「あなたが力になれること（申し出）の登録 ↔ 相手のニーズの自動マッチング」だけ**なので、そこに絞って新規実装: ①**申し出カタログ**（`offerings` テーブル＝譲る/貸す/教える/手伝う/相談にのる/その他・title/description は暗号化・受け渡し方法・お声がけ範囲=距離ゲート。migration 20260718150000）②**マッチング**（`lib/offerings.ts` の純粋関数 `matchOfferingToContacts`＝AI 不要・毎回無料・決定的。言語非依存の文字 2-gram + 語の重なりで、蓄積した相手の記録〔profile_facets の悩み/目標/機会/仕事・personal_profile・values_profile・メモ〕とニーズが重なる方を根拠つきで挙げる。**web 検索はしない＝相手の尊厳**・距離ゲートを尊重）③**申し出る**（マッチした方へ「この方に申し出る」→ 既存のやり取り台帳に favor・status=open で下書き控え＝外に出る行動は下書き→承認→送信の原則。実際の連絡は連絡先画面から）。API: `GET/POST/PUT/DELETE /api/offerings`（owner スコープ・title 必須・上限200）+ `GET /api/relationship/offering-matches`。web は連絡帳トップに「あなたが力になれること」パネル（申し出の登録/削除・力になれそうな方の一覧・✕削除＝データ主権）。テスト: offerings unit 10 + integration 5（CRUD・暗号化・距離ゲート・無効は対象外・ownerUid 分離）・全体で unit 378 / integration 211 緑。post-login-audit に申し出の登録・削除の一周を追加（ローカル実機で panel 表示・登録→表示・matches 200・console/page エラー無しを直接 Playwright で確認。フル runner はサンドボックスのブラウザ版差のため e2e-audit ワークフローで）
- 公開掲示板（timeshare/gift のマーケットプレイスの踏襲・2026-07-18・オーナー依頼「timeshare や gift のマーケットプレイスも実装しておく必要がありそう。新しい関係性の構築に有効かもしれない」→ 公開範囲は「公開掲示板（現構成に沿う）」を選択）— 実装済み: **マルチテナント化はせず、単一オーナーの「時間の出品」と「力になれること（申し出）」を、アカウント不要の訪問者が見て問い合わせ・予約できる公開ページ**にした（既存の鍵付き公開経路 /s /b /partners と同じ方式・先日固めた認証/データ分離はそのまま）。gift の公開マーケット/ポイント経済/FB 認証は不採用の判断を維持しつつ、「新しい関係性の入口＝収集の環」だけを足す設計: ①**公開フラグ**（`offerings.published` / `time_offers.listed`。既定は非公開。連絡帳の「あなたが力になれること」パネルの「掲示板に載せる」チェック・日程調整の各出品の同トグルで切替。migration 20260718170000）②**公開ページ `/market`**（`GET /api/public/market`＝published/listed かつ active のものだけ・PII は出さない。申し出は「ひとこと送る」、時間の出品は `/b/[key]` の予約へ）③**問い合わせ→承認で新しい連絡先**（`offering_interests`＝訪問者の名乗り/連絡先/本文は暗号化・`POST /api/public/market/offerings/:id/interest` はレート制限＋名前/本文必須＋未対応50件で受付停止 → オーナーの受け箱 `GET /api/relationship/offering-interests` に「新規」で入り、`approve` で distance=5・source=market の連絡先＋接触記録に還流／`dismiss` で見送り。**外に出る行動でなく受け取り側なので即時取り込みでよいが、迎えるかはオーナーが選ぶ**＝最終判断はユーザー）。暗号化列 offering.title は relation include で復号されないため受け箱・承認は別 findMany で引く。web は `/market` 公開ページ＋連絡帳パネルに公開トグル・公開 URL 導線・問い合わせ受け箱、設定に公開ページの案内。テスト: offerings integration +3（公開の出し分け・問い合わせ→承認で連絡先・暗号化・名前/本文必須・ownerUid 分離）・全体で unit 378 / integration 214 緑。link-audit に `/market` 追加・post-login-audit に「公開→訪問者問い合わせ→承認で連絡先に迎える」の一周を追加（API 一気通貫〔guest interest 201→受け箱→承認で source=market の連絡先生成〕とローカル実機の個別操作で確認。フル runner はサンドボックスのブラウザ版差のため e2e-audit ワークフローで）
- ホーム俯瞰・名寄せの操作性・カレンダー内容表示・時刻ずれの修正（2026-07-18・オーナー依頼「ホームを開いたときはすべて閉じていた方が全体が見やすい」「一件にまとめるボタンの反応が良くない・別人として扱うボタンも隣に」「Google/Outlook の予定を内容も含めてカレンダー表示」「空き時間テキストが埋まっている部分を反映していない」）— 実装済み: ①**ホームの俯瞰化** = 連絡帳トップの全 Fold パネル（21 枚）を `defaultOpen={false}` に。開いた瞬間は見出しだけが並ぶ。開閉はこの端末に記憶（Fold の記憶キーを v2 に更新）。e2e は閉じた既定に追随して `expandAll` ヘルパー（section > h2 > button[aria-expanded=false] を各1回開く）を goto/reload 直後に呼ぶ。②**名寄せパネルの操作性** = 「1件にまとめる」を**楽観更新**にし（押した瞬間に行が消える・数千件の全再読込を待たせない・失敗時のみ戻す）、隣に**「別の方として扱う」**を追加（`suggestion_dismissals` の kind=dupe に組キー〔メンバー id を並べ替えて FNV ハッシュ〕を記録 → duplicates 検出時に見送り済みの組を除外＝二度と出さない。メンバー増減で別キー＝再確認）。③**時刻ずれの根治（TZ=Asia/Tokyo）** = Cloud Run api/web に `TZ=Asia/Tokyo` を配線（07-deploy の env、`APP_TZ` で上書き可）。サーバが UTC 実行で `getHours/getDay` が 9h ずれ、曜日別の受付時間窓・空き時間テキストが JST とずれて「busy が反映されていない」ように見えていた。TZ で全 Date 演算・整形が JST になり、取り込んだ busy が正しい時刻でテキスト・カレンダーに反映される（空き計算は元々 myFreeIntervals で self+google busy を減算済み）。④**カレンダーの内容表示** = オーナー自身のカレンダーは件名も持ち、本人にだけ見せる（**第三者〔相手〕の予定の中身は従来どおり保存しない原則は不変**。ICS は `parseIcsEvents`＝SUMMARY 取得、Google は freeBusy でなく events〔summary/end 取得・終日と transparent は busy に数えない〕。SELF ソースのみ件名保存＝`saveBusy` が SELF 判定で分岐）。`GET /api/relationship/my-events?from&to`（SELF の予定を件名つきで返す・owner 認証）→ `/schedule` の FullCalendar に青いブロックで件名つき表示（灰色の busy 帯に重ねる）。相手に選んでいただくページ〔/s〕は従来どおり空き枠だけで中身は出ない。テスト: ics unit +3（parseIcsEvents 件名/エスケープ/件名なし）+ contacts integration +1（別人見送りで組が二度と出ない）+ schedule integration +1（自分の ICS は件名つき my-events、相手の予定表は件名を持たない）・全体で unit 384 / integration 220 緑
- 提供できるものの一括取込＋分類・Google カレンダーの表示選択（2026-07-19・オーナー依頼「提供できるものをタイムシェアの Google sheet の情報から分類して提案しやすく」「Google カレンダーはいくつかに分けているので表示を選べるように」）— 実装済み: ①**提供できるものの一括取込＋自動分類** = `lib/offerings.ts` の純粋関数 `classifyOffering`（キーワードで 譲る/貸す/教える/手伝う/相談にのる/その他 に振り分け・AI 不要）+ `parseOfferingsBulk`（貼り付け/CSV/TSV を 1 行 1 件に分解・ヘッダ行/空行/箇条書き記号/重複を除去・1 列目=見出し 残り=説明）。`POST /api/offerings/import`（既存 title と重ねない・上限200 まで）で申し出カタログに登録 → 既存のマッチングで「この方に申し出る」提案に載る。web は連絡帳「あなたが力になれること」パネルに「一覧からまとめて取り込む」欄（貼り付け → 分類して登録）。②**Google カレンダーの表示選択** = ユーザーが分けている複数カレンダーを一覧（`GET /api/relationship/google-calendars`＝calendarList を取得・未設定は primary を既定選択）し、取り込む/表示するものをチェックで選ぶ（`PUT` で `google_connections.sync_calendar_ids`〔JSONB・migration 20260719100000〕に保存 → その場で取り込み直し）。`syncGoogleBusy` を「選んだ複数カレンダーを順に events 取得して union」に拡張（`parseCalendarIds`・未設定は primary のみ＝従来どおり・件名つき表示は前回実装のまま）。web は `/schedule` に「表示するカレンダーを選ぶ」チェックリスト（2 つ以上あるときだけ出す・チェックで即反映）。テスト: offerings unit +3（分類・分解・タブ区切り）+ offerings integration +2（一括取込で分類・重複は重ねない・空は400）+ google integration +1（一覧→選択保存→取り込み直し）・全体で unit 387 / integration 223 緑
- 残（外部設定が前提のもの）: **staging の一度だけの GCP provisioning（オーナーが `10-create-staging.sh` を実行 + GitHub Environment `staging` 作成）**・Google OAuth クライアントの作成と設定（People API の contacts.readonly も同意画面に含める・People API を有効化）・**Stripe 鍵の登録（OWNER-SETUP.md タスク5。済むまで有料の出品のみ準備中）**・Google/Outlook 予定の書き込み同期（ICS 招待で代替中）・多言語辞書の詳細ページ展開・**Google アプリ確認の申請そのもの（OWNER-SETUP.md タスク6。独自ドメインの割り当てが前提）**

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
④（任意）Tavily ⑤Stripe 鍵を `BONDS_STRIPE_SECRET_KEY` に（時間の出品の有料受け付け。BMP-LP と同じ
Stripe アカウント）。ANTHROPIC 鍵は cares と共有済み。
