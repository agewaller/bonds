# 4プロダクト統合アーキテクチャ（cares / shares(VM) / zentrack / bonds）

**作成**: 2026-07-07
**問い**: 4プロダクトをやがて統合する（ユーザーは既に Google ログインで統合予定）。
DB・知り合い/リストを統合し、双方向にメッセージできるようにしたい。

---

## 0. 現状の事実（統合設計の出発点）

| プロダクト | バックエンド | DB | 認証 | データの主語 |
|---|---|---|---|---|
| cares (健康) | vanilla JS + Cloudflare Worker | **Firestore** (`care-14c31`) | Firebase | 自分（健康記録） |
| zentrack (意識/生活) | Spring Boot (Java17) | **PostgreSQL** | Firebase(想定) | 自分（日次解析） |
| VM (企業価値) | Rust/Axum | **PostgreSQL** | Firebase | 企業＋顧客/投資家リスト |
| bonds (関係) | Hono + Prisma | **PostgreSQL** | Firebase(uid=ownerUid) | 相手（第三者の人物） |

**要点: スタックは4つバラバラ。共通点は Firebase の Google ログイン (uid) だけ。**

## 1. 統合の原則

> **「統合」= 物理DBを1つに merge することではない。**
> 4スタック混在で単一DBに寄せるのは大工事かつ高リスク。正解は
> **① uid を全プロダクト共通の join key にする（フェデレーション）**
> **② 「人・リスト・メッセージ」だけをハブに集約する（bonds をハブにする）**
> **③ 各ドメインDB（健康・企業・意識）は分離のまま uid で連携する**

理由: 統合したいのは実は「DB全体」ではなく、**(a) 同一ユーザーの本人性、(b) 知り合い/リスト、(c) メッセージ**の3つ。この3つだけを共有すれば、健康・企業分析・意識解析の中身は各DBに置いたままで良い。

## 2. アイデンティティの背骨（P0・ほぼ無料・最優先）

- **Firebase プロジェクトを1本に統一**（cares の `care-14c31` に寄せる or 統合用を新設）。
  Google ログインの uid が **全プロダクト横断の主キー**になる。
- 各プロダクトのユーザー行に `firebase_uid` 列を持たせる（cares は Firestore doc id=uid で既に成立）。
- プロダクトの利用権限は Firebase **カスタムクレーム**で持つ（`products: ["cares","vm",...]`）。
  → 1回のログインで4プロダクトを行き来（SSO）。ユーザー体験としての「統合」はここでほぼ完成。

これは可逆で安く、将来のどの選択肢も縛らない。**統合の中で唯一、今すぐやる価値があるのはこれ。**

## 3. ハブ = bonds（人・リスト・メッセージの正本）

bonds を共有ハブにするのが最短。理由:

- 最も豊かな**人物グラフ**を既に持つ（contacts / interactions / groups / 距離 / 暗号化）
- PostgreSQL + Prisma でスキーマ拡張が容易
- **発信(outreach)** と、先日入れた**双方向の共有応答(share token)** で、メッセージ基盤の土台が既にある
- 既に **lms エクスポート / Plaud・ZenTrack 文字起こしから人物取込**を実装済み（INTEGRATIONS.md）＝ハブの流入経路が動いている

### 3.1 共有 People レジストリ（知り合い/リストの統合）

bonds の `contacts` を **人物の正本**にする。他プロダクトの「人」を uid スコープで集約:

- cares の近親者・主治医・専門家 → contact
- VM の投資家/経営者リスト（VM Next）→ contact
- zentrack の登場人物（transcript から抽出）→ contact（既に取込経路あり）

**外部参照リンク**を contact に足して、各プロダクトのレコードへ相互に辿れるようにする:

```prisma
model ContactExternalRef {
  id         String @id @default(uuid())
  ownerUid   String @map("owner_uid")
  contactId  String @map("contact_id")
  product    String // cares / vm / zentrack
  externalId String @map("external_id") // 相手先レコードの id
  kind       String // patient / investor / dd_subject / transcript_person
  @@unique([product, externalId, contactId])
  @@map("contact_external_refs")
}
```

API: `GET/POST /api/people`（uid スコープ）、`POST /api/people/:id/refs`。
他プロダクトは自前で連絡先を持たず、bonds の People API を叩く（BFF 経由でトークンはサーバ側）。

### 3.2 双方向メッセージ基盤（unify する）

今バラバラな送受信を **1本のメッセージ基盤**に束ねる:

| 現状 | 集約後 |
|---|---|
| cares `professional-mailer.js`（社労士/税理士へ送信） | Messaging: outbound |
| zentrack SendGrid **Inbound Parse**（Plaud メール受信） | Messaging: **inbound webhook**（再利用） |
| bonds outreach（compose→承認→送信） | Messaging: outbound（正本） |
| bonds share token 応答（相手の受諾/辞退） | Messaging: inbound（正本） |

設計:

```prisma
model MessageThread {
  id        String @id @default(uuid())
  ownerUid  String @map("owner_uid")
  contactId String @map("contact_id")
  subject   String?
  channel   String // email / share / line ...
  @@map("message_threads")
}
model Message {
  id         String   @id @default(uuid())
  threadId   String   @map("thread_id")
  direction  String   // outbound / inbound
  body       String   // 暗号化
  status     String   // draft/approved/sent/delivered/replied/failed
  externalId String?  // provider message id / SendGrid id
  createdAt  DateTime @default(now())
  @@map("messages")
}
```

- **outbound**: 既存 outreach の承認フローをそのまま（第三者への発信は既定=承認。CLAUDE.md 最上位制約）
- **inbound**: SendGrid Inbound Parse の webhook を1つ立て、**送信元メール → contact.email 照合 → thread** に紐付けて `Message(inbound)` を作成 → `contact_interactions` に還流（距離スコア更新）
- どのプロダクトの画面からも「その人にメッセージ」「返信を読む」が同じ基盤でできる
- 相手が非ユーザーでも **メール往復 or 共有トークン**で双方向が成立（アカウント不要を維持）

### 3.3 ドメインデータのフェデレーション（merge しない）

健康(cares)・企業(VM)・意識(zentrack)の中身は各DBに残す。必要な断面だけ uid で連携:

- 方式A（薄い・推奨初手）: **on-demand 集約 API**。「この uid の横断プロフィール」を各プロダクトの read API から都度取得して合成。
- 方式B（後で）: 各プロダクトが uid キーの**イベント**を発行 → ハブが購読して要約を contact/profile にキャッシュ。
- 本人の健康/意識データを**他人（contact）に混ぜない**こと。cares/zentrack は「自分」、bonds は「相手」。集約は本人ダッシュボード側で行い、contact プロフィールには相手由来の情報だけ入れる。

## 4. データ主権・安全（全プロダクト共通で維持）

- 全 API は **uid スコープ厳守**（他人のデータに触れない）
- PII 暗号化は各DBで継続（bonds は AES-256-GCM 済み。統合で平文に戻さない）
- **横断エクスポート**: 「自分の全プロダクトのデータを1つの ZIP で書き出す」導線（データ主権原則）
- 第三者へのメッセージは bonds の承認フロー（誤送信は不可逆）

## 5. 段階導入（安く・可逆に・PMF を待つ順で）

| 段階 | 内容 | コスト | いつ |
|---|---|---|---|
| **P0** | Firebase 1本化 + uid を全DBの共通キーに + カスタムクレームで SSO | 小・可逆 | **今すぐ価値あり** |
| P1 | bonds People API + ContactExternalRef。他3製品が人を push/pull | 中 | 継続ユーザーが付いてから |
| P2 | Messaging 基盤（inbound webhook 統合・双方向） | 中 | P1 の後 |
| P3 | ドメイン横断プロフィール集約・横断エクスポート | 中〜大 | 最後 |

## 6. 正直な戦略的留保（self-validating）

- **今の実ユーザーは cares 42人・症状記録39件・収益ほぼ0。** その段階で4製品フル統合プラットフォームを作り込むのは、典型的な「PMF 前のプラットフォーム化」＝過剰投資のリスク。
- ただし **P0（Firebase 1本化 + uid 共通キー）だけは別**。安く・可逆で・将来を縛らず、しかも「1ログインで全部入り」は **activation を救う可能性がある**（4つの眠るアプリより、1つの入口の方が使われる）。**統合が停滞の解になりうる**という仮説は本物。
- だから推奨は明確: **P0 を今やり、P1 以降は「1製品でも継続して使う人」が出てから**。統合は「大きく作る」でなく「1つの入口に寄せて、使われるか検証する」文脈でやる。
- 逆に P1〜P3 を先に作り込むと、cares と同じ「使われないエンジンの磨き込み」を4製品分に拡大することになる。
