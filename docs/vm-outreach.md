# VM アウトリーチ設計：日米ターゲットリストとメッセージ設計

2026年7月15日／シェアーズ株式会社（内部用）

運用原則（確定事項）：全自動送信はしない。情報収集 → AI が相手に合わせてドラフト生成 → オーナー承認 → 送信。基盤は bonds（下書き→承認→送信の強制フロー実装済み）。cares の Resend は患者向け本番のため使わない。

法令順守（ドラフト生成の前提に組み込む）
- 日本：特定電子メール法はオプトイン原則。送信先は「公開されている法人・事業者の窓口アドレス」に限定（個人アドレスへの未承諾営業はしない）。送信者名・住所・オプトアウト導線を全メールに明記。
- 米国：CAN-SPAM 準拠（非欺瞞ヘッダ・実在住所・opt-out 10営業日以内処理）。
- 富裕層「個人」はリスト化・直接送信の対象にしない。ファミリーオフィス・FA という「法人の窓口」経由でのみ届ける。
- 返信のない相手への再送は最大1回まで。「送り続ける」はしない。

---

## 1. セグメント別の提供価値と提案（メッセージ・マトリクス）

各セグメントで「VM は何であるか」を言い換える。1メール1提案。全て「関心銘柄1社の無償レポート」か「15分デモ」のどちらかに着地させる。

| セグメント | 相手のペイン | VM の言い換え | 提案 |
|---|---|---|---|
| ネット証券・中堅証券 | 投資情報の差別化・リテール活性化 | 顧客向け銘柄分析コンテンツのエンジン | デモ15分＋OEM/ライセンスの示唆 |
| 独立系運用・バリュー系ファンド | リサーチ初動の工数・カバレッジ限界 | アナリストの下ごしらえを数十分に畳む道具 | 関心銘柄1社の無償レポート |
| 海外のJapan専業ファンド（米・英・星） | 日本語開示が読めない・翻訳が遅い | EDINET一次情報ネイティブの分析を英語で | 英語レポート1本無償（最強の刺さり所） |
| IFA・FA ネットワーク | 顧客への説明材料・提案根拠 | 顧客に見せられる一次情報ベースの評価書 | サンプル3本パック |
| ファミリーオフィス／MFO | 少人数で広い資産を見る・DD人手不足 | 社内アナリスト1人ぶんの下ごしらえ | 保有・検討銘柄1社の無償レポート |
| M&A・FAS・事業承継 | バリュエーション作業の反復 | DD・株価算定の初動自動化 | 実案件に近い1社の無償サンプル |
| 情報ベンダー・フィンテック | コンテンツ差別化・AI機能の内製コスト | 組み込み可能な評価エンジン（買収・OEM候補） | 資料（teaser）＋デモ |

英語圏向けの一行ポジショニング：Japan-disclosure-native equity analysis, in English, in under an hour.（外国人投資家は日本語開示を読めない。ここが最も競合の薄い刺さり所）

---

## 2. 日本ターゲット（Tier 1 は自動化対象外・1対1のみ）

### Tier 1（既存リストの通り・bonds のシーケンスに載せない）
マネックス（松本氏）／マネーフォワード（辻氏）／藤野氏／xenodata／QUICK／Finatext／SBI／楽天証券／日本M&Aセンター／大手FAS／Moody's corp dev。→ デモ先行・創業者1対1。

### Tier 2（承認付きシーケンスの対象：公開の法人窓口へ）

証券（中堅・ネット系）
- 岡三証券／東海東京／いちよし証券（中小型・リテールに強い）
- 松井証券／auカブコム／GMOクリック（ネット系。GMOクリックは旧シェアーズ売却先で歴史的接点あり）
- 岩井コスモ／丸三／東洋証券

独立系運用・バリュー系
- スパークス・グループ（日本株バリューの老舗）
- レオス（藤野氏退任後の新体制。藤野さん経由の温度次第で Tier 1 扱いに）
- コモンズ投信／鎌倉投信／セゾン投信（長期・対話型）
- みさき投資（エンゲージメント投資）
- ひびき・パース・アドバイザーズ／ストラテジックキャピタル（アクティビスト系）
- ベイビュー・アセット／アセットマネジメントOne 等の中小型チーム

IFA・FA
- GAIA／ファイナンシャルスタンダード／バリューアドバイザーズ（大手IFA法人）
- 日本IFA協会・IFA法人上位（公開リストから窓口収集）

ファミリーオフィス／MFO（法人窓口のみ）
- ウェルスパートナーズ／キャピタル・アセット・プランニング系
- 信託銀行系プライベートバンク部門（三井住友信託・三菱UFJ信託）は Tier 2.5（稟議重い）

M&A・事業承継
- M&Aキャピタルパートナーズ／ストライク／オンデック／fundbook
- 事業承継系税理士法人上位（山田コンサル、辻・本郷 等）

情報ベンダー・フィンテック
- ミンカブ・ジ・インフォノイド／フィスコ／モーニングスター日本（SBIグローバルアセット）
- ログミーファイナンス／シェアードリサーチ（レポート事業の親和性）

### 3. 米国・海外ターゲット（Tier 2、英語シーケンス）

Japan専業・日本株比重の高い運用（最優先。英語×一次情報が最も刺さる）
- Dalton Investments（LA、日本株バリュー・アクティビズム）
- Taiyo Pacific Partners（WA、日本株エンゲージメント）
- Kaname Capital（Boston、日本株バリュー）
- Verdad Advisers（Boston、日本小型バリューの発信多い）
- Indus Capital（NY、アジア・日本）
- Arcus Investment（英、日本株）／Zennor Asset Management（英）
- 3D Investment Partners／Effissimo／Oasis Management（星・港。アクティビスト）
- Hennessy Funds（Japan Fund をSPARXが助言。米販売網）

米国 RIA・マルチファミリーオフィス（国際分散でJapanエクスポージャあり）
- 大手RIAアグリゲータ（Hightower／Focus Financial 系列）は反応薄い想定→優先度低
- Japan配分を公言するRIA・MFOを個別に発見次第追加（収集フェーズで拡充）

情報ベンダー・リサーチ（買い手・提携候補を兼ねる）
- Morningstar／FactSet／S&P Global Market Intelligence／MSCI（product/BD 窓口）
- Smartkarma／SumZero／Substack系日本株リサーチ（配信面の提携）

注記：上記は公開情報に基づく候補仮説。メールアドレスは収集フェーズで「公開の法人窓口」から取得し、bonds の contacts に出典つきで登録する（購入リスト・スクレイピングによる個人アドレスは使わない）。

---

## 4. 運用フロー（bonds ベース・承認ゲート付き）

1. 収集：上記リストの各社について、公開窓口・キーパーソン・直近の文脈（新製品・決算・発信）を収集し、bonds `contacts` に upsert（product=vm、出典メモ付き）。
2. ドラフト生成：セグメント別テンプレート×相手の文脈で、AI が1通ずつ個別化ドラフトを生成（BR-09 準拠：記号装飾なし・売り込み臭を消す・150〜300字＋英語版は80〜120語）。
3. 承認：bonds の outreach 画面であなたが承認/修正/破棄。1日の送信上限は10〜20通（ドメイン評判の保全）。
4. 送信：bonds の SendGrid mailer（専用送信ドメイン。cares/zentrack のドメインは使わない）。オプトアウト文言を自動付与。
5. 還流：返信は inbound webhook で contact_interactions に記録。返信ありは Tier 1 扱いに昇格し、以後は1対1。無反応は1回だけ再送し、以後リストから外す。

必要な下準備（1回だけ）
- bonds 本番デプロイ（オーナーチェックリスト項目）
- 営業用送信サブドメイン（例 mail.valuationmatrix.com）の SPF/DKIM 設定とウォームアップ（低量から2〜3週間）
- 英語版 teaser・英語サンプルレポート1本（Japan専業ファンド向けの弾）

---

## 5. ドラフトの型（日本語・Tier 2 汎用）

件名：{会社名} の{文脈}を拝見して／企業価値評価の下ごしらえを数十分に

{担当者名 or ご担当者}様

{相手の文脈に触れる1文：直近の発信・注力領域など}。シェアーズの山口揚平と申します。企業価値評価の実務を20年続けてきた者として、有価証券報告書などの一次情報から、財務の実態分析・DCF三シナリオ・類似比較までを数十分で一続きのレポートにする道具を作りました。{セグメント別の言い換え1文}。もしご関心があれば、御社が今ご覧になっている銘柄を一社お知らせください。評価レポートを一本、無償でお作りしてお送りします。（配信停止はこちら／会社住所）

英語版の型（Japan専業ファンド向け）

Subject: Japan disclosure-native analysis on {ticker/sector} — in English, in an hour

{First line referencing their Japan exposure or recent letter.} I'm Yohei Yamaguchi, a 20-year practitioner of corporate valuation in Tokyo (sold my first analytics business to a brokerage). I built an engine that turns Japanese primary disclosures (EDINET filings) into full valuation reports — normalized financials, three-scenario DCF, peer comps — in under an hour, in English. If useful, name one Japanese company you hold or watch; I'll send you a full report at no cost. (Unsubscribe / address)
