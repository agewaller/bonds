# 連携設計 — SNS 取込と自社サービス連携 (2026-07-06)

bonds ミッションの第一歩「収集」を圧倒的に楽にするための設計。判断の前提と実装の対応を
ここに固定する (実装計画: IMPLEMENTATION-PLAN.md、ミッション: CLAUDE.md)。

## 1. SNS からの友人リスト取込 — なぜ「エクスポート取込」が最適解か

**前提 (2026 時点の外部環境):**

| サービス | 友だち/つながり一覧の API | 現実的な取得経路 |
|---|---|---|
| LinkedIn | 一般アプリには非公開 (Connections API はパートナー限定) | 公式「データのダウンロード」の Connections.csv |
| Facebook | v2.0 (2014) 以降、friends は相互利用者のみで実質不可 | 公式「情報をダウンロード」の friends.json |
| Instagram | フォローリスト API は Business 向けのみ | 公式ダウンロードの following.json |
| X | v2 の followers/following は有料プラン + 制限が強い | 公式アーカイブの data/following.js |
| LINE | 友だちリストの API もエクスポートも存在しない | トーク履歴の送信 (.txt、1タップ) |
| Google 連絡先 | People API はあるが OAuth 審査・検証が必要 | contacts.google.com のエクスポート (CSV/vCard) |

つまり **OAuth 連携を作っても友人リストは取れない** (審査・パートナー契約・有料枠が壁)。
一方で各社とも GDPR 系の法令対応で**本人向けの完全なエクスポート**を必ず提供している。
そこで bonds は「エクスポートを 1 ファイルそのまま放り込めば終わり」に磨くことを選ぶ。

**実装 (ユーザー体験は3手: エクスポート申請 → 届いた ZIP を置く → 終わり):**

- `POST /api/contacts/import-file` — 生バイト受信 (30MB まで)。ZIP は fflate でサーバ側
  展開し、`friends.json` / `following.json` / `following.js` / `Connections.csv` /
  Google `contacts.csv`・`.vcf` / LINE トーク `.txt` を**自動発見** (`lib/import-file.ts`)。
  ユーザーに ZIP の中身を探させない。
- LINE / WhatsApp のトーク履歴は連絡先だけでなく**日別の接触記録**も復元し、
  距離スコア (収集 → 解析) に直結させる (`parseLineTalk` / `parseWhatsAppChat`)。
- 再取込に耐える冪等設計: 同名の連絡先はスキップ、同じ相手・同じ日の接触記録は重複登録しない。
- 画面は連絡帳の「ファイルからまとめて取り込む」— ドラッグ&ドロップ + 各サービスの
  取り出し方ガイド (公式エクスポート画面への直リンク付き)。
- 貼り付け取込 (`POST /api/contacts/import`) も同じ判別器 (`parseImportText`) を通る。

**採用しないもの (再提案時はここを確認):**

- 各 SNS の OAuth 連携で友人リストを取る案 — 上表のとおり API が存在しない/取れない。
  審査コストだけ払って何も得られない。
- スクレイピング — 各社規約違反。アカウント凍結リスクをユーザーに負わせない。
- LINE Messaging API (公式アカウント) — 取れるのは「ボットの友だち」であって
  ユーザー本人の友だちリストではない。

## 2. 自社サービスとの連携 (cares / lms / ZenTrack / vm-suite / 禅トラック)

方針: **アカウントは Firebase を共用して事実上の SSO、データは「エクスポート/共通形式の
取込」と「共通の受け口」で疎結合に**。サービス間の直接 DB 参照や専用 API 相互呼び出しは
作らない (どちらかの障害・変更がもう片方を壊す。cares の「フォールバック連鎖禁止」と同思想)。

| 相手 | いま動く連携 | 実装 |
|---|---|---|
| cares (健康日記) | 同一 Firebase プロジェクトで Google ログイン共用 = 同じアカウントで両方使える。プロトタイプの人物評価は cares の公開 AI 口を利用。本番 AI 鍵 (Secret Manager の ANTHROPIC_API_KEY) も共有 | 済 (フェーズ5) |
| lms (人生管理) | lms の「データを書き出す」JSON (`relationship_contacts` / `relationship_interactions`) をそのまま取込。連絡先と接触記録が bonds に移る | 済 (`parseLmsExport`) |
| ZenTrack / Plaud (音声記録) | 文字起こしテキストを「会話やメモから取り込む」に貼ると、登場人物・近況・会った日を読み取って**提案** (自動反映しない)。承認したものだけ連絡先/プロフィール/接触記録に反映 | 済 (`POST /api/contacts/extract-from-conversation`) |
| 禅トラック (意識の七層) | 人物DD の「意識の七次元」評価が同じ層モデルを共有 (構造互換) | 済 (dd-spec) |
| vm-suite (企業DD) | 人物DD パイプラインの構造原本。将来: 連絡先の会社 → vm の企業分析への参照リンク | 構想 |

**将来の発展 (外部設定がそろったら):**

- Gmail ライブ取込 (OAuth クライアント ID 取得後): メールのやりとりから接触記録を受動収集。
  会話取り込みと同じ「提案 → 承認」フローに流す。
- ZenTrack 側に「bonds へ送る」書き出しボタン (ZenTrack リポジトリ側の変更。
  受け口は既に上記 API がある)。
- cares の「家族・友人へのコミュニケーション支援」から bonds の連絡先/文面生成を参照。

## 3. この設計が守る原則

- 収集の手間を最小化する (ミッション「収集」) — ただし**外に出る行動や記録の書き換えは
  提案どまり**でユーザーが承認する (自律性の段階)。
- 取り込んだ PII は既存の項目暗号化 (AES-256-GCM) の対象列にそのまま乗る。
- パーサはすべて純関数 + 固定サンプルのユニットテスト (回帰資産)。ZIP・冪等性・
  暗号化は結合テスト (`tests/integration/import.test.ts`) で担保。
