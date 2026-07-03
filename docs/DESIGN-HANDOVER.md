# bonds 設計引き継ぎ書（人物DD + 関係性マネジメント）

> この文書は、bonds リポジトリで実装を始める人（または Claude Code セッション）への
> 引き継ぎ書。前提知識ゼロで読めるように、決定事項・現状・全体設計・参照資産の所在を
> すべてここに集約する。2026-07-03 時点。

---

## 1. プロダクト概要

**bonds** は2つの半分でできたプロダクト。

1. **人物DD（人物デューデリジェンス）** — 政治家・経営者などの**公人**を、
   「意識の七次元評価」と「社会価値創造評価」の2つの確定プロンプトで多面的・根拠ベースに
   スコアリングする。企業評価システム ValuationMatrix（shares-dev/vm-suite）の人物版。
2. **関係性マネジメント** — X / Facebook / LinkedIn / Eight（名刺）等から**自分の関係者**を
   取り込み、一人ひとりの状況（パーソナル・社会的位置づけ・価値観）を DB で管理。
   距離感スコア、カレンダーの空き重なりからのキープアップ面談調整、
   誕生日・慶事の贈り物・年賀状・プレス発表・オファーの発信で関係を育てる。

設計の親は3つ:
- **vm-suite**（企業評価の頭脳）→ 人物DDのパイプライン構造を複製
- **cares**（健康日記の生活サービス基盤）→ DB/認証/AI/暗号化/発信の流儀を踏襲
- **lms**（生活管理アプリ）→ 関係性ロジック（距離スコア・SNS取込・カレンダー）を移植

---

## 2. 確定済みの決定事項

| 項目 | 決定 |
|---|---|
| リポジトリ | 新規 `agewaller/bonds`（このリポ）。cares/vm-suite とは別 |
| 人物モデル | **分離** — 公人 `dd_subjects` と人脈 `contacts` は別テーブル・別ドメイン・別画面。将来は `person_links` 参照テーブルで任意リンク |
| 人物DDの初期評価モジュール | `consciousness_7d`（意識の七次元）と `social_value_creation`（社会価値創造）の2種で**確定**。プロンプト原本は cares の `apps/api/src/extra-prompts.json`（キー `person_eval_7d` / `person_eval_svc`、DB駆動・管理画面で編集可） |
| プロトタイプの評価UX | 1回の名前入力で**両評価を並列実行**、2セクション表示（所要1〜2分） |
| モデル | 管理者変更可・**既定 Sonnet**（cares の `app_config` キー `person_eval_model`） |
| 関係性ロジック | lms から**新スタックへ移植**（Firestore 併存はしない） |
| AI 基盤 | **cares を使う**（stock-screener の Cloudflare リレーは壊れているため不使用） |

### 未決定（最初に確定させること）

**技術スタック**が未決定。案A（vm踏襲: Rust/Axum/SeaORM + SolidStart + Atlas PG）と
案B（cares踏襲: TypeScript/Hono + Next.js + Prisma PG）の2案。

- 3軸評価の結論: **実装の簡易性=案B優位／堅牢性=わずかに案B／運用妥当性=案B優位**。
  理由: 関係性半分は PII 過多・UI/連携過多で cares の暗号化/認証/outreach 資産（TSにしか無い）が
  直接効く。人物DDも vm-suite の user-console に **TS版DDランナー**
  （`apps/user-console/src/routes/api/dd/stream.ts` + `@/server/dd/dd-runner`）が既存。
  lms のロジックは JS なので TS 移植はほぼコピペ、Rust は全面書き直し。
- **最終決定要因は主担当が誰か**: 矢野氏（cares/TS）が担える→案B。山中氏（vm/Rust）が
  担い DD の型安全最優先→案A も妥当。両名不可→外部採用前提で案B。
- 両名への質問（シンプル版）:
  - 共通:「主担当を引き受けられますか？」
  - 矢野氏:「cares の仕組み（暗号化・ログイン・AI・多言語）を別プロダクトに使い回せますか？障害は？」
  - 山中氏:「vm の企業DDを人物向けに作り替える工数は？cares 限定の横断機能（暗号化等）の Rust 移植の手間は？」

---

## 3. 現状（実装・検証済みのもの）

### 3.1 プロトタイプのバックエンド = cares の公開エンドポイント（本番反映済み想定）

`POST /api/trial/person-eval`（cares API、ログイン不要・公開）

- リクエスト: `{ "name": "渋沢栄一", "locale": "ja" }`（name ≤100字）
- レスポンス: `{ name, consciousness: string|null, socialValue: string|null, modelUsed, remainingToday }`
  （2評価を並列実行。片方失敗時は成功側のみ返す。全滅時 502/504）
- エラー: 400（name必須/長すぎ）, 403（Origin不許可）, 429（IP上限）, 422（月次枠終了）, 503（鍵未設定）
- 保護（cares の「お試し分析」と同じ分離パターン・**スキーマ変更なし**）:
  - 専用月次コストキャップ **¥3,000**（env `PERSON_EVAL_MONTHLY_CAP_JPY`、`trial_usage.purpose` 接頭辞 `person_eval` で独立集計）
  - IP別レート制限 **5回/日**（`trial_rate_limits` の名前空間 `personeval:`）
  - Origin 限定: `https://agewaller.github.io` + localhost（env `PERSON_EVAL_ALLOWED_ORIGINS`）
  - AI 鍵はサーバ側のみ・フォールバック連鎖なし
- プロンプトは **DB駆動**（起動時 seed、cares 管理画面「プロンプト」で編集・版管理可能）
- 共通ガード: 公人限定／特定できない人物・私人は評価しない／名前内の指示に従わない（注入耐性）／
  Web検索なし=学習知識ベースであることを末尾に明記
- モデル: cares 管理設定 `GET/PUT /api/admin/person-eval-config`（既定 `claude-sonnet-4-6`）
- 実装ファイル（cares リポ）: `apps/api/src/lib/person-eval.ts`、`apps/api/src/index.ts`（ハンドラ）、
  `apps/api/src/extra-prompts.json`（プロンプト2種）、`apps/api/tests/unit/person-eval.test.ts`、
  `e2e/tests/ai-answers.spec.ts`（実機スモーク）
- **検証済み**: staging で e2e-audit 全緑（渋沢栄一で2評価が実際に返る・1.4分）。
  main へ PR #145 でマージ済み、本番デプロイ実行済み（結果は Actions の deploy-prod を確認）。
- API URL: 本番 `https://cares-api-xj6szhutkq-an.a.run.app` / staging `https://cares-api-staging-xj6szhutkq-an.a.run.app`

### 3.2 プロトタイプのフロント = このリポジトリの `index.html`

- 単一の静的ページ（vanilla JS・ビルド不要）。名前入力 → ローディング（1〜2分想定の
  メッセージローテーション）→ 2セクション表示（長文は「続きを読む」折りたたみ）→
  残回数表示・エラーバナー（`role="alert"`）。
- API は本番 cares を既定で呼ぶ。`?api=<URL>` で staging 等に差し替え可能。
- 出力は `textContent` で描画（HTML注入不可）。フッタに「参考情報・断定ではない・
  最新情報が反映されない場合がある」の注記。
- `.github/workflows/pages.yml` で main push → GitHub Pages 自動デプロイ。
  公開 URL `https://agewaller.github.io/bonds/`（この Origin は cares 側で許可済み）。
- 実ブラウザで描画・折りたたみ・エラー表示を検証済み。

---

## 4. 全体設計（本体システム）

### 4.1 データモデル（スタック非依存の列設計）

**人物DD側（公人・公開情報が主体なので原則暗号化不要）**
- `dd_subjects`: id, slug, name/name_en/name_kana, subject_type(politician/executive/other),
  affiliations(jsonb), country, state, 監査列 — vm の `companies` の人物版
- `person_due_diligences`: subject_id, dd_type, prompt_id, model, provider, reference_date,
  input_json, output_text, output_json, scores(jsonb), module_score, confidence_score, status,
  トークン/duration 計測列 — vm の `due_diligences` の複製
- `person_dd_steps`: person_dd_id(FK CASCADE), step_key, step_type(search/extract/analyze),
  prompt_id, model, input_json, output_json, output_text, status — vm の `due_diligence_steps` の複製
- `prompts`: vm と同形（key+model、版管理、管理画面編集）

**関係性側（PII の塊 → cares 流の項目暗号化必須）**
- `contacts`: owner_uid, name/furigana, distance(1–5), relationship, birthday, phone, email,
  address, company, title, sns(jsonb), personal_profile / social_position / **values_profile**（新規）,
  notes, source(取込元)
- `contact_interactions`: contact_id, type(meeting/call/message/letter/email/gift_sent/...),
  quality(1–5), occurred_at, notes
- `contact_gifts`: contact_id, occasion(birthday/new_year/celebration/...), direction, item, amount, notes
- `contact_groups`: owner_uid, group_name, type, members(jsonb)
- `outreach` / `outreach_messages`: owner_uid, contact_id,
  channel(email/gift/nengajo/press/offer/meeting_invite), direction(outbound/inbound), subject,
  body(暗号化), candidates(jsonb=生成した文面候補), purpose, status(draft/approved/sent/failed/replied),
  provider_message_id, scheduled_at, sent_at — **cares の OutreachTarget/OutreachMessage を owner スコープ化**
- `calendar_links`: owner_uid, contact_id, provider, busy_slots(jsonb キャッシュ) — 二者空き重なり用

**暗号化**: `contacts.{email,phone,address,personal_profile,social_position,values_profile,notes,sns}`、
`contact_interactions.notes`、`contact_gifts.notes`、`outreach_messages.body` は
アプリ層 AES-256-GCM（cares の封筒形式 `enc:v1:` + `ENCRYPTED_FIELDS` マップ +
透過暗号/復号の Prisma 拡張を踏襲。実装: cares `packages/db/src/encryption.ts` と
`packages/db/src/index.ts`）。暗号化列は where/order by に使えない。

### 4.2 人物DDパイプライン（vm の企業DDを機械的に置換）

vm-suite の企業DDサブシステムが複製元:
- オーケストレータ: `apps/api/src/application/services/due_diligence.rs`
  （親 run + step 行を作成 → 実行 → Firestore 通知、resume 対応）
- LLM 抽象: 同 `due_diligence/llm.rs` — `DdLlmGateway`（Vertex Gemini/Anthropic・Claude SDK・
  Codex SDK の3実装）+ **DD種別ごとの JSON 出力スキーマ `DdResultSpec` と厳格バリデーション**
- ジョブ: `apps/api/src/bin/jobs/due_diligence.rs`、検索: Tavily ゲートウェイ
- 画面: user-console `api/dd/stream.ts`（SSE）+ `companies/[code]` 詳細タブ

置換マッピング: `companies`→`dd_subjects`、`DD_TYPES`→`consciousness_7d`/`social_value_creation`、
`DdResultSpec` を人物評価軸に再定義、step は `search`（一次/公式/報道/著作/発言/批判を分けて収集）→
`evaluate`（評価プロンプト実行）。エビデンスに `type` と `certainty(fact/estimate/unconfirmed)` を
型で強制し、「必ず推計しスコアは出す／根拠が弱ければ確信度を下げる」をバリデーションで担保。

**評価モジュールの出力スキーマ（DdResultSpec 化のガイド）**
- `consciousness_7d`: dimensions[1D..7D]{score:0–10, confidence:A–D, key_evidence[], risks[]}、
  意識配分(合計100%)、公的社会価値創造スコア(重み 1D10/2D12/3D15/4D18/5D15/6D20/7D10 で100点+ランク)、
  創造社会価値の推計、社会的コスト・負債、反実仮想、進化条件3つ
- `social_value_creation`: 8フレーム所見、10項目スコア{score, reason}+total_100+grade1–10、
  created_value{annual, cumulative, low/mid/high, assumptions, confidence}、反事実貢献率%、
  比較評価、総合判断、Something New、評価の限界/追加調査/変動条件

**安全制約（両モジュール共通・プロンプトヘッダ+出力検査で担保）**: 人格攻撃・病気/心理の診断・
根拠なき疑惑・陰謀論・私生活の過剰詮索・党派的断定の禁止。批判は必ず公的行為と根拠に紐付け。
特定できない人物・私人は評価しない。

**別途検討のまま**: 情報取得手段（Tavily / Perplexity / 一次情報クロールをどこまで）、
LLM の使用範囲（抽出のみ/評価まで/人手レビューの位置）。プロトタイプは検索なし=知識ベース。

### 4.3 関係性マネジメント

**lms から移植**（`/home/user/lms` = agewaller/lms）:
- 距離5段階 + 孤立/緊急度スコア: `js/relationship-features.js` の `calculateIsolationScore`
  （距離別適正間隔 {1:1日, 2:7日, 3:14日}、加重スコア0–100、「今日連絡すべき人」=超過上位+誕生日3日以内）
- SNS取込11種 + Gmail ライブOAuth: `js/sns-integrations.js`（`snsImport`/`importFile`/`zipImport`）
- CSV/vCard 取込: `js/app.js` の `importContacts`
- カレンダー読取（Google/Outlook）: `js/calendar.js` / `js/integrations.js`、
  自分の空きスロット計算: `js/time-marketplace.js` の `calculateFreeSlots`
- AI エンリッチ: `app.enrichContacts()`（公開情報からプロフィール下書き）

**新規開発（lms に無いギャップ）**:
1. Eight（名刺）取込・年賀状リスト取込（lms は宣言のみ未実装）
2. **二者カレンダー空き重なり**（lms は自分の空きだけ。相手の busy との積集合 → 面談打診・確定）
3. 価値観プロファイル `values_profile`（AI下書き→ユーザー編集確定）
4. 一括送信のキュー/ワーカー（Cloud Tasks 等。cares は同期送信のみ）

### 4.4 中核機能: 取込 → 目的最適化メッセージ生成 → 送信

要件: あらゆる関係者リストの読み込み口を1つに用意し、DB から相手との関係・状況、
当方の状況・目的・伝えたいことを解析して、**目的を最適化した文面候補を複数自動生成**し、
メール等で送信する。

**cares に実装済みの outreach スタック（ADR-0022）をほぼ流用できる**:
| 機能 | cares の資産 | bonds での差分 |
|---|---|---|
| メール送信 | `apps/api/src/lib/mailer.ts`（SendGrid、サーバ側鍵、未設定時 graceful degrade） | ほぼそのまま |
| 送信記録/暗号化 | `OutreachTarget`/`OutreachMessage`/`SentMessage` + ENCRYPTED_FIELDS | **owner_uid スコープ追加**（cares は admin グローバル） |
| 文面生成 | `/api/admin/outreach/targets/:id/draft`（AIで相手に合わせた下書き） | プロンプトを DB駆動化・**複数候補**{件名,本文,トーン,狙い}・DB解析入力を拡張（距離・価値観・履歴・過去スレッド・季節・目的・伝えたいこと） |
| フッタ/オプトアウト/レート/監査 | `performOutreachSend`/`buildOutreachFooter`（特定電子メール法対応、suppressed で送信ブロック、承認優先） | per-user キャップに調整 |
| 返信取込・AI返信下書き | `/outreach/inbound`・`/reply-draft` | そのまま |
| UI | `apps/web/components/OutreachConsole.tsx`（下書き・Gmail/自動送信・返信貼付） | 個人向けに再構成、連絡帳と統合 |
| 一括送信 | 無し（同期） | キュー/ワーカーで新規 |

送信結果は `contact_interactions` に還流して距離感スコアを自動更新する。

---

## 5. ロードマップ

- **フェーズP（完了）**: 先行プロトタイプ — cares に person-eval エンドポイント + この静的ページ
- **フェーズ0**: スタック確定（案A/案B、上記質問を両名へ）& 本体リポ立ち上げ
- **フェーズ1**: 人物DD MVP — dd_subjects/person_due_diligences/person_dd_steps スキーマ、
  DD ジョブ複製、DdResultSpec 定義、subjects 管理画面、人物詳細+DDストリーム画面
- **フェーズ2**: 関係性基盤 — contacts 系スキーマ（暗号化）、lms 取込・距離スコア移植、
  連絡帳・距離感ダッシュボード
- **フェーズ3**: カレンダー & キープアップ — 二者空き重なり、面談打診/確定、Eight/年賀状取込、
  values_profile エンリッチ
- **フェーズ4**: 発信 — cares outreach 移設（owner スコープ化）、統一インレット、
  `outreach_message_gen` プロンプト（複数候補）、贈り物/年賀状、一括配信キュー
- **フェーズ5**: 仕上げ — 多言語（languageDirective）、監査ログ、権限、E2E、デプロイ

---

## 6. 必ず守る設計法（cares の設計法を継承）

- **データ主権**: 全格納・1件単位の編集/削除・エクスポート可能・ロックインしない
- **AI 鍵はサーバ側のみ**: BYOK 不可、ブラウザ/リポジトリに鍵を置かない、フォールバック連鎖禁止、
  月次円建てキャップ + 422 拒否、公開エンドポイントは IP レート制限 + Origin 限定
- **PII の項目暗号化**: 上記 4.1 の列は AES-256-GCM（cares 封筒形式と互換に）
- **管理者をロックアウトしない**: cares の三段フェイルセーフ（custom claim / OWNER×password / break-glass token）を踏襲
- **プロンプトは DB 駆動**: 固定せず、管理画面で版管理しながら反応と最新知見で更新し続ける
- **多言語**: 散文プロンプトに languageDirective を付与。**構造化JSON/分類プロンプトには付けない**
- **モデルIDは canonical alias のみ**（datestamped ID のハードコード禁止、MODEL_MAP/canonicalize で解決）
- **長い散文は折りたたみ**・記号装飾を出さない等の cares 文体原則は、ユーザー向け画面に適用
- **人物評価の倫理**: 公的行為と根拠に限定。私人は評価しない。断定でなく確信度つき推計

## 7. テスト方針

- ユニット: 定数/クランプ/スコア計算/スキーマ検証を厚く（cares は vitest、vm は cargo test）
- **AI 実機スモーク必須**: モックは常に成功する偽AIなので、実LLM で「渋沢栄一→2評価が返る」級の
  スモークをデプロイゲートに入れる（cares の `e2e/tests/ai-answers.spec.ts` の
  「人物評価 (公開 API)」ブロックが実例。E2E_API_URL で対象APIを指定）
- 取込パーサ: 各SNS/CSV/vCard/名刺/年賀状のサンプルを固定資産にして回帰テスト
- 二者カレンダー重なり: 双方の busy → 積集合スロットのユニット検証

## 8. 参照リポジトリ早見表

| リポ | 何を参照するか |
|---|---|
| agewaller/cares | person-eval 実装一式（プロトタイプの正本）、暗号化 `packages/db/src/`、認証、AI呼び出し（`lib/cost.ts`/`lib/ai-provider.ts`/`prompt-runtime.ts`/`lib/locale.ts`）、outreach 一式、deploy-staging/prod ワークフロー |
| shares-dev/vm-suite | 企業DDパイプライン（`application/services/due_diligence*`）、`DdResultSpec` 検証、TS版DDランナー（user-console `api/dd/stream.ts`）、Atlas HCL スキーマ、prompts テーブル設計 |
| agewaller/lms | 関係性ロジック（`js/relationship-features.js`）、SNS取込（`js/sns-integrations.js`）、カレンダー（`js/calendar.js`/`js/integrations.js`/`js/time-marketplace.js`） |
| agewaller/stock-screener | 参照のみ（旧健康日記）。**AI リレーは壊れているため使わない** |

## 9. 運用メモ（プロトタイプ）

- 公開ページ: `https://agewaller.github.io/bonds/`（Pages: Settings→Pages→Source=GitHub Actions）
- 評価が返らないときの確認順: ①cares 本番 API の health `GET /api/healthz`
  ②429/422 はレート/月次枠（仕様どおり）③cares 管理画面でプロンプト `person_eval_7d`/`person_eval_svc` が
  active か ④モデル設定 `GET /api/admin/person-eval-config`
- コスト: 1回の評価 = Sonnet 長文2本。月次 ¥3,000 で自動停止（枠は env で調整可）
- プロンプト改訂: cares 管理画面「プロンプト」から（コード変更不要）
