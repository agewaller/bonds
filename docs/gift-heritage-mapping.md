# gift（2015 Rails / gift2friends.com）→ bonds 継承マッピング

**作成**: 2026-07-07
**目的**: 旧 `sharesjp/gift`（友人間ギフト授受サービス、Rails、2015–2018、休止）を深くレビューし、
bonds に移植する価値のある**ドメイン概念**を特定する。**コードは移植しない（Rails/Mongoid/AASM → TS/Hono/Prisma で再利用ゼロ）。移すのは設計思想だけ。**

---

## gift のドメイン核（何を持っていたか）

| gift の資産 | 実装 | 本質 |
|---|---|---|
| `User#rdistance_number(user)` | FBの友人辺 + 共通友人数 → **関係距離 0–5 を計算** | 距離は「聞く」ものでなく「計算する」もの |
| `User#pdistance_number(user)` | 緯度経度 → km → **物理距離 1–5 を計算** | 対面可否という第二の距離軸 |
| `Item#negotiable?(target)` | requirement（距離閾値/特定個人/性別/共通友人数）で**贈与の適格性を判定** | 「この相手にこの行為は適切か」のルールエンジン |
| `situation`（機会） | 誕生日・慶事などを item にタグ付け | 機会 → 打ち手のトリガー分類 |
| `logistic`（配送手段） | 配送方法を再利用可能なカタログとして item に付与 | チャネルを第一級で持つ |
| `devotion`（思い入れ度） | 贈り物ごとの感情投資の度合い | 距離に応じた"手のかけ方"の強度 |
| `point`（出品で加点）+ `credit`（deal成立で加点） | **二種通貨**のゲーミフィケーション。`scope :ranking` | 「踏み出し」と「完遂」を別々に報酬化 |
| `giving_count` / `getting_count` | あげた数 / もらった数 | **相互性（reciprocity）**の可視化 |
| `application → item.aasm_state → deal → transaction` | 贈与ライフサイクルの状態機械 | 授受プロセスの段階管理 |

---

## bonds が「既に持っている」もの（重複実装するな）

- `Contact.distance`(1–5)・`relationship`・`ContactInteraction`(type/quality)・`ContactGift`(occasion/direction/item/amount)
- `OutreachMessage` の状態フロー `draft→approved→sent→replied`（＝gift の aasm_state/deal に相当。**bonds は既にある**）
- `calculateIsolationScore` / `todaySuggestions` / `upcomingBirthdays`（距離→適正間隔→今日連絡）
- `ContactGroup`（gift の共通友人集合に近い）・`CalendarLink`（面談調整）・`PersonLink`

## gift から「移す価値がある」もの（bonds に無い）

### ★1【最優先】distance を計算する — `computeDistance()`
**問題:** `Contact.distance` は既定 `4` の手入力。多くの連絡先が 4 のまま = `calculateIsolationScore` も「今日連絡」も**嘘の定数の上で動いている**。距離4–5は監視対象外なので、既定4の連絡先は事実上すべて無視される。
**gift の解法:** 距離をグラフ構造から計算する（rdistance_number）。
**bonds ネイティブ版（FB非依存）:** bonds は CSV/vCard/LINE/グループチャット/SNSアーカイブから取込済み。手元データだけで距離を導出できる:
- **接触の頻度・鮮度**（`ContactInteraction` は既にある）: 直近接触・平均間隔が短いほど距離が近い
- **相互性**（下記★2）: 双方向のやり取りがあるほど近い
- **共起**（`ContactGroup` メンバー重複・同一グループチャット登場回数）＝ gift の「共通友人数」に相当
- **source シグナル**（family/mentor は近め、csv一括は遠め初期値）

```ts
// apps/api/src/lib/relationship.ts に純粋関数として追加（calculateIsolationScore と同じ流儀）
export function computeDistance(c: ContactLike, interactions: InteractionLike[], now = new Date()): number {
  const mine = interactions.filter(i => i.contactId === c.id);
  if (mine.length === 0) return c.relationship === "family" ? 2 : 4; // 接触ゼロは遠い既定
  const daysSinceLast = /* 最終接触からの日数 */;
  const cadence = /* 平均接触間隔 */;
  // 頻度・鮮度・相互性・共起を 1–5 に写像（gift の rdistance_number と同じ発想）
  return clampDistance(score);
}
```
**効果:** 既存の孤立スコア・今日連絡が「実データ由来の距離」で動き出す。**新機能でなく、既存機能を"本物"にする**改修。

### ★2【最優先・安価】相互性（reciprocity）を出す
**gift:** `giving_count` / `getting_count`。bonds には give/get の**バランス信号が無い**（データは `ContactInteraction.type` の gift_sent/received、`ContactGift.direction` の outbound/inbound に既にある）。
**実装:** 連絡先ごとに outbound/inbound 比を計算 → 「あなたばかり与えている / もらってばかり」の**片務性**を関係健全度に加える。打ち手（★5）に直結：片務なら「バランスを戻す」提案。

### ★3【安全の要】適格性ルールエンジン = 自動送信ゲート
**gift:** `negotiable?` が「距離閾値・特定個人・共通友人数」で贈与可否を判定。
**bonds への写像:** CLAUDE.md 最上位制約「外に出る行動は既定=承認、自動送信は許可範囲のみ（channel×目的の粒度）」を、gift の requirement テーブル方式で**明文化**する:
```
自動送信を許可する条件（例）: channel=email AND purpose=birthday AND distance<=2
それ以外は status=draft で承認待ちに落とす
```
`requirement(code, args)` パターンで許可ルールをデータ化 → 監査可能・オーナーが粒度調整可能。bonds の第三者リスク（誤送信は不可逆）に対する構造的な安全弁。

### ★4【新しい軸】物理距離 `pdistance` → 対面 vs リモート
**gift:** 緯度経度から距離1–5。bonds は面談調整（空き時間/ICS）を持つが**近接性を考慮していない**。
**実装:** `Contact.address`（暗号化）をジオコード → 近い相手は「対面」、遠い相手は「オンライン/手紙」を打ち手で優先。※暗号化列は where/order 不可なのでアプリ層で in-memory 計算（gift の Ruby も in-memory だったので発想は同じ）。

### ★5【打ち手の具体化】situation → 貢献カタログ（+ devotion）
**gift:** situation（機会）× requirement（適格性）× logistic（手段）で「誰に何を贈れるか」をマッチング。
**bonds:** occasion/purpose は今フリー文字列。gift 式に **機会→貢献カタログ**を用意し、距離（適格性）とチャネルで絞る。`devotion` は距離に応じた手のかけ方（距離1=手書き/高 devotion、距離5=軽い一言）。→ 「毎回 something new を1つ」の打ち手生成が具体化する。

### ★6【任意】二種通貨ゲーミフィケーション
gift の point（踏み出し）+ credit（完遂）。bonds の連続記録/バッジに、**「連絡した」と「返信/貢献が成立した」を別々に**報酬化する軸を足す。踏み出しだけの空回りを防ぎ、フォロースルーを促す。

---

## 移植して「はいけない」もの（正直な線引き）

1. **コードそのもの** — Rails/ActiveRecord/Mongoid/AASM。TS/Prisma に1行も流用できない。移すのは概念のみ。
2. **Facebook 友人 API 依存の rdistance** — この API は 2015 前後に閉鎖。**gift が死んだ主因はおそらくこれ**（距離エンジンがデータ源を失った）。bonds は既に「SNS OAuth で友人リストを取る案は不採用」（INTEGRATIONS.md）。**教訓: 自分が所有しないグラフAPIの上に関係エンジンを建てない。** 計算式だけ借り、データは bonds 自身の取込データから作る。
3. **二者間マーケットプレイスの handshake**（application→deal、双方の同意） — gift は両者がユーザー。**bonds の「相手」は非ユーザーの第三者**（CLAUDE.md）。第二の同意者がいないので授受マッチングは写らない。bonds の片務 outreach（draft→approved→sent→replied、既存）で十分。
4. **無暗号の PII 保存**・`# TODO: hard coding`（100pt 直書き） — bonds は AES-256-GCM 必須・閾値パラメータ化済み。退行させない。

---

## 優先度と、正直な留保

| 順 | 項目 | 効果 | コスト |
|---|---|---|---|
| 1 | ★1 computeDistance | 既存の中核ループ（距離→今日連絡→打ち手）が"本物"になる | 中（純粋関数1本＋バッチ再計算） |
| 2 | ★2 reciprocity | 新しい健全度信号＋打ち手直結 | 小（既存データ集計のみ） |
| 3 | ★3 自動送信ゲート | 第三者誤送信への構造的安全弁（bonds 最上位制約） | 中 |
| 4 | ★4 pdistance | 対面/リモートの打ち手分岐 | 中（ジオコード要） |
| 5 | ★5 貢献カタログ | 打ち手生成の具体化 | 中〜大 |
| 6 | ★6 二種通貨 | 継続の質を上げる | 小 |

**留保（self-validating の観点）:** ★1・★2 は「新機能」ではなく「既に作った機能が固定値4で空回りしているのを直す」改修なので、実ユーザーがいるなら最優先の価値がある。逆に★4以降は、**bonds に実ユーザーがいない段階でやると cares(42人→記録39件) と同じ「使われないエンジンの磨き込み」になる**。gift 自身がその教訓（作り込んだが休止）。まず★1・★2で中核を本物にし、以降はユーザーが付いてから。
