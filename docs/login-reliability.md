# ログイン信頼性の設計（Cloudflare 不使用・全プロダクト共通方針）

**作成**: 2026-07-07
**症状**: Google ログインが「ブラウザ・Google 規約・developer 設定」等の理由で不安定。
登録できない/ログインが7日で切れる/リダイレクトが静かに失敗する。Amazon 等の大手では起きない。
**制約**: Cloudflare は使わない（オーナー判断。過去の不安定経路の実績: stock-screener 2026-06-30 コミット参照）。

## 根本原因は4つ（それぞれ別の病気）

1. **認証が第三者ドメイン経由**: 既定の authDomain (`<project>.firebaseapp.com`) は
   アプリから見て他人のドメイン。Safari 等のストレージ分離で `signInWithRedirect` が
   静かに失敗する。cares は popup 全面切替で回避したが、popup はモバイルでブロックされる
   （どちらも構造的に不完全）。**Amazon が壊れないのは認証が全部第一者だから。**
2. **ログイン持続がスクリプト書きストレージ頼み**: Firebase の永続化は IndexedDB。
   Safari は7日間訪問がないとスクリプト由来ストレージを削除 → 勝手にログアウト。
   **サーバが設定する httpOnly Cookie はこの削除の対象外**（大手はこれ）。
3. **OAuth 同意画面が「テスト」ステータス**の場合: 100人上限・未確認アプリ警告・
   リフレッシュトークン7日失効。→ Google Cloud Console で「本番」に公開（基本スコープは審査不要）。
4. **アプリ内ブラウザ (LINE 等)**: Google が OAuth 自体を拒否 (`disallowed_useragent`)。
   Google 以外の入口（メールリンク）が無いと詰む。

## 解決アーキテクチャ（Google スタックだけで完結）

### A. 認証ハンドラの第一者化 — 実装済み (bonds web)

`apps/web/app/__/auth/[...path]/route.ts` が `/__/auth/*` を
`<project>.firebaseapp.com` へサーバ側で中継する。
`NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` を**アプリ自身のドメイン**にすれば、
redirect フロー全体が第一者で完結し、Safari/モバイルで安定する。

有効化手順（デプロイ時に一度）:
1. env: `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<bonds の本番ドメイン>`
2. Firebase Console → Authentication → 承認済みドメイン に同ドメインを追加
3. GCP → 認証情報 → OAuth クライアント → 承認済みリダイレクト URI に
   `https://<ドメイン>/__/auth/handler` を追加

### B. サーバセッション Cookie ＋ 静かな復元 — 実装済み (bonds web)

- `POST /api/session`: ログイン成功時に idToken → **httpOnly Cookie `__session`（14日）**
- `POST /api/session/restore`: クライアント状態が消えていたら Cookie を検証し
  カスタムトークンでサインインし直す（`lib/firebase.ts` の `restoreSession`。
  `watchUser` / `currentIdToken` が自動で呼ぶ）
- 来訪のたびに実質延長 → **使い続ける限りログインが切れない（Amazon と同じ体験）**
- `FIREBASE_SERVICE_ACCOUNT_JSON` 未設定のローカルでは全体が無害に縮退

### C. 他プロダクトへの展開

| プロダクト | ホスティング | 処方 |
|---|---|---|
| bonds | Next.js (Cloud Run 予定) | 本実装のまま（A+B とも web に同梱） |
| cares (新・agewaller/cares) | Cloud Run | 同じ2部品を移植（BFF 相当があるなら同型） |
| stock-screener (旧健康日記) | GitHub Pages | サーバが無いので A/B とも載らない。**Firebase Hosting へ移行**すれば `/__/auth/*` は Hosting が標準で同一ドメイン配信（プロキシ実装すら不要）。B は Functions か、旧版の位置づけ次第で見送り可 |
| zentrack | Spring Boot | 認証実装がフロントから確認できず（要調査）。同じ原則（第一者化＋サーバ Cookie）を Spring 側で |
| 将来の統合 (P0) | account.<共通ドメイン> | Cookie を親ドメイン共通にすれば**1回のログインで全製品 SSO**。4製品で4回直す代わりに1回で直す最終形 |

### D. コード外の即効タスク（オーナー作業・15分）

1. Google Cloud Console → API とサービス → OAuth 同意画面 → **公開ステータスを「本番」に**
2. ブランド確認（アプリ名・ロゴ・ドメイン）を設定 → 「未確認アプリ」警告が消える

### E. 今後（未実装）

- メールリンク（マジックリンク）ログイン: Google を使えない/持たない層と
  アプリ内ブラウザ対策。Firebase Email Link 認証で実装可
- アプリ内ブラウザ検知 → 「Safari/Chrome で開く」案内
- passkey（将来。65歳ペルソナには「メールリンク」の方が先）
