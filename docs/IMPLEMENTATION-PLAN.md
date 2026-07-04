# bonds 実装計画（案B / TypeScript スタック）

> [`docs/DESIGN-HANDOVER.md`](./DESIGN-HANDOVER.md) の設計に基づく実装計画。
> 技術スタックは **案B（cares 踏襲: TypeScript）** で確定（2026-07-03、オーナー決定）。
> 各フェーズは cares の `CLAUDE.md` テスト規約（ユニット→結合→**ログイン後ユーザー監査**→**AI実機スモーク**）を
> 硬いゲートとして通す。

---

## 0. 確定した土台

| 項目 | 決定 |
|---|---|
| スタック | **cares 完全踏襲**: pnpm workspace モノレポ / `apps/api`(Hono) / `apps/web`(Next.js) / `packages/db`(Prisma + AES-256-GCM) / `e2e`(Playwright) / `infra/scripts`(Cloud Run) |
| 移植戦略 | **cares からの構造コピー＋改名**を最優先。lms(JS)→TS はほぼ機械移植。vm-suite の DD は **TS版ランナー**（`apps/user-console/src/server/dd/dd-runner.ts`）を複製元にする（Rust ではなく TS 側） |
| テストゲート | 全フェーズで「ユニット→結合→ログイン後ユーザー監査(E2E)→AI実機スモーク」を1セットで合否判定。AI モックは緑でも実機で必ず通す |

cares 構造をそのまま使う理由：暗号化・認証・月次キャップ・outreach・多言語が **cares の TS 資産にしか無く**、
bonds の関係性半分は PII・連携過多でこれらが直接効くため（設計書 §2 の結論と一致）。

---

## 1. リポジトリ構成（フェーズ0で作る骨格）

```
bonds/
├── index.html                     # 既存プロトタイプ（Pages。当面残す）
├── apps/
│   ├── api/                        # Hono API（cares apps/api を骨格複製）
│   │   ├── src/index.ts            # ルータ
│   │   ├── src/lib/{cost,ai-provider,locale,mailer}.ts  # cares からコピー
│   │   ├── src/prompt-runtime.ts   # cares からコピー（DB駆動プロンプト）
│   │   ├── src/server/dd/          # vm TS版DDランナーを移植
│   │   └── tests/unit/*.test.ts
│   └── web/                        # Next.js（cares apps/web を骨格複製）
├── packages/
│   └── db/
│       ├── prisma/schema.prisma    # 後述のデータモデル
│       └── src/{encryption,index}.ts  # cares からコピー（封筒形式 enc:v1:）
├── e2e/tests/                      # post-login-audit / ai-answers（cares 流）
├── infra/scripts/                  # Cloud Run デプロイ（cares 05〜08 を複製）
└── docs/                           # DESIGN-HANDOVER.md ＋ ADR
```

---

## 2. データモデル（Prisma / 設計書 §4.1 を TS 化）

**人物DD側（公開情報主体＝原則暗号化なし）**
- `dd_subjects`（vm `companies` の人物版）: slug, name/name_en/name_kana, subject_type, affiliations(jsonb), country, state, 監査列
- `person_due_diligences`（vm `due_diligences` 複製）: subject_id, dd_type, prompt_id, model, provider, reference_date, input_json, output_text, output_json, scores(jsonb), module_score, confidence_score, status, tokens/duration
- `person_dd_steps`（vm `due_diligence_steps` 複製）: person_dd_id(FK CASCADE), step_key, step_type(search/evaluate), prompt_id, model, input_json, output_json, output_text, status
- `prompts`（key+model＋版管理、管理画面編集）

**関係性側（PII の塊＝cares 流の項目暗号化必須）**
- `contacts`: owner_uid, name/furigana, distance(1–5), relationship, birthday, phone, email, address, company, title, sns(jsonb), personal_profile/social_position/**values_profile**, notes, source
- `contact_interactions`: contact_id, type, quality(1–5), occurred_at, notes
- `contact_gifts`: contact_id, occasion, direction, item, amount, notes
- `contact_groups`: owner_uid, group_name, type, members(jsonb)
- `outreach` / `outreach_messages`（cares `OutreachTarget/Message` を **owner_uid スコープ化**）: channel, direction, subject, body(暗号化), candidates(jsonb), purpose, status, provider_message_id, scheduled_at, sent_at
- `calendar_links`: owner_uid, contact_id, provider, busy_slots(jsonb)

**暗号化対象**（cares `ENCRYPTED_FIELDS` に追記）: `contacts.{email,phone,address,personal_profile,social_position,values_profile,notes,sns}`、`contact_interactions.notes`、`contact_gifts.notes`、`outreach_messages.body`。
透過暗号/復号の Prisma 拡張を `packages/db/src/index.ts` から踏襲（暗号化列は where/order 不可の制約も継承）。

---

## 3. フェーズ別実装計画

各フェーズは **実装 → テストゲート（cares流4層）→ ステージング e2e-audit 緑 → 受け入れ** で1単位。

### フェーズ0 — スタック確定 & 骨格立ち上げ
- **タスク**: pnpm workspace / Docker Compose（bonds-db:5432 / api:8080 / web:3000）/ `packages/db` に encryption.ts・index.ts をコピー / cares の `05〜08` デプロイスクリプトを `bonds-*` リソース名で複製 / `.nvmrc`(Node22) / ADR-0001（データ主権）・ADR-0006（AI鍵サーバ側）を bonds 向けに起こす。
- **移植元**: cares `packages/db/src/`、`infra/scripts/`、`docker-compose.yml`。
- **ゲート**: `docker compose up` で3サービス healthy、`/api/healthz` = ok、暗号化ラウンドトリップのユニット。
- **受け入れ**: 「テスト環境を起動して」でローカル一式が上がる。

### フェーズ1 — 人物DD MVP
- **タスク**: 上記3テーブル＋prompts の Prisma スキーマ / vm TS版DDランナー(`server/dd/dd-runner.ts`・`stream.ts`)を `dd_subjects` 向けに移植 / **`DdResultSpec` を人物評価軸で再定義**（`consciousness_7d`＝七次元 score 0–10 + confidence A–D + 意識配分100% + 社会価値100点ランク／`social_value_creation`＝8フレーム + 10項目 + created_value 推計 + 反事実貢献率）と**厳格 JSON バリデーション** / step = `search`→`evaluate` / subjects 管理画面＋人物詳細＋DDストリーム(SSE)画面。プロンプト原本は cares の `person_eval_7d`/`person_eval_svc` を DB seed。
- **安全制約**（設計書 §4.2）: 人格攻撃・病気診断・根拠なき疑惑・党派的断定の禁止をプロンプトヘッダ＋出力検査で担保。私人・特定不能は評価しない。
- **ゲート**: DdResultSpec バリデーションのユニット（合計100%・スコアクランプ）／**AI実機スモーク「渋沢栄一→2評価が返る」**（cares `e2e/tests/ai-answers.spec.ts` の人物評価ブロックを移植）／ログイン後監査で人物詳細・DDストリーム画面が5xx/JSエラーなし。

### フェーズ2 — 関係性基盤
- **タスク**: contacts 系スキーマ（暗号化）/ lms `relationship-features.js` の `calculateIsolationScore`（距離別適正間隔 {1:1日,2:7日,3:14日}・加重0–100・「今日連絡すべき人」）を TS 移植 / SNS取込11種＋Gmail OAuth（`sns-integrations.js`）/ CSV/vCard 取込（`app.js importContacts`）/ 連絡帳・距離感ダッシュボード。
- **ゲート**: 距離スコア/クランプのユニット厚め／取込パーサの回帰テスト（各SNS/CSV/vCard のサンプルを固定資産化）／ログイン後監査で連絡帳・ダッシュボードのリンク切れ・主要ボタン点検。

### フェーズ3 — カレンダー & キープアップ
- **タスク**: lms `calendar.js`/`time-marketplace.js`(`calculateFreeSlots`) 移植 / **新規: 二者カレンダー空き重なり**（相手 busy との積集合）/ Eight（名刺）・年賀状リスト取込（lms は未実装＝新規）/ `values_profile` AI エンリッチ（下書き→ユーザー確定）。
- **ゲート**: 二者重なりの積集合スロットのユニット／取込サンプル固定資産／監査。

### フェーズ4 — 発信（中核機能）
- **タスク**: cares outreach 一式（`lib/mailer.ts`・`performOutreachSend`・`buildOutreachFooter`）を **owner_uid スコープ化**して移設 / 統一取込インレット / **`outreach_message_gen` プロンプト（複数候補{件名,本文,トーン,狙い}）**を DB駆動化し、入力に距離・価値観・履歴・季節・目的を拡張 / 贈り物・年賀状・一括配信キュー（Cloud Tasks＝新規）。送信結果を `contact_interactions` に還流して距離スコア自動更新。
- **ゲート**: フッタ/オプトアウト/レートのユニット（特定電子メール法）／AI実機スモーク（実LLMで複数文面候補が返る）／監査で OutreachConsole 相当画面。

### フェーズ5 — 仕上げ
- 多言語（`languageDirective`。**構造化JSONには付けない**）/ 監査ログ / 権限 / E2E拡充 / 本番デプロイ（cares 流2ゲート：テスト全緑＋承認）。

---

## 4. テスト方針（cares `CLAUDE.md` 踏襲・必須）

各フェーズの合否は**必ず1セット**で報告する:
1. `pnpm test`（`test:unit` → `test:integration`、実 Postgres `bonds_test`）
2. **`pnpm test:e2e`（ログイン後ユーザー監査）** — ログイン後の全画面が 5xx/エラーバナー/JSエラーなしで開くか・**リンク切れ**・主要ボタン・AIアクション（"Premature close" 回帰）を点検
3. **AI実機スモーク**（`e2e/tests/ai-answers.spec.ts`）— 「渋沢栄一→2評価」級を**実LLMで**。モックは常に成功する偽AIなので実機で必ず通す
4. これを `deploy-staging` 末尾の**硬いゲート**（e2e-audit ワークフロー）に組み込み、赤ならデプロイを止める

ユニット/結合だけでOKとせず、**ユーザー目線監査までを1セット**として合否と件数を報告する
（失敗は `ファイル:行`／壊れた画面・リンク・ボタンを具体的に添える）。

---

## 5. 横断で守る設計法（cares 継承）

- **データ主権**: 全格納・1件単位の編集/削除・エクスポート可能・ロックインしない
- **AI鍵はサーバ側のみ**: BYOK不可・フォールバック連鎖禁止・月次円建てキャップ+422・公開EPは IP レート+Origin 限定
- **PII 項目暗号化**: §2 の列は AES-256-GCM（cares 封筒形式 `enc:v1:` と互換）
- **管理者をロックアウトしない**: cares の三段フェイルセーフを踏襲
- **プロンプトは DB 駆動**: 固定せず管理画面で版管理
- **多言語**: 散文プロンプトに languageDirective。**構造化JSON/分類には付けない**
- **モデルIDは canonical alias のみ**（datestamped ID のハードコード禁止）
- **文体**: 長文折りたたみ・記号装飾を出さない（ユーザー向け画面）
- **人物評価の倫理**: 公的行為と根拠に限定、私人は評価しない、断定でなく確信度つき推計

---

## 6. クリティカルパスと依存

```
フェーズ0（骨格・暗号化・デプロイ）
  ├→ フェーズ1（人物DD：vm TS版DD移植）… 独立して先行可
  └→ フェーズ2（contacts暗号化）→ フェーズ3（カレンダー）→ フェーズ4（発信）→ フェーズ5
```

人物DD（1）と関係性（2〜4）は**別ドメイン・別テーブル・別画面**（設計書の「分離」決定）なので、
0の後は並行可能。最短で価値が出るのはフェーズ1（プロンプト実在・プロトタイプ検証済み）。
