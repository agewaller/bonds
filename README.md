# bonds

人と人のつながりを扱うプロダクトの器。現在は最初のプロトタイプとして、
**人物評価**（公人の名前を入力すると「意識の七次元評価」と「社会価値創造評価」を
一度に表示する公開ページ）を提供する。

- 公開ページ: `index.html`（GitHub Pages で配信。`pages.yml` が main への push で自動デプロイ）
- AI 基盤: [agewaller/cares](https://github.com/agewaller/cares) の公開エンドポイント
  `POST /api/trial/person-eval` を使う（AI 鍵はサーバ側のみ・IP 別レート制限・専用月次コスト上限つき）。
  評価プロンプトは cares の DB 駆動プロンプト `person_eval_7d` / `person_eval_svc`（管理画面で編集可）。
- 使用モデル: cares の管理設定 `person_eval_model` で変更可（既定 Sonnet）。

## ローカル確認

```bash
python3 -m http.server 8000
# → http://localhost:8000 を開く（API は本番 cares を呼ぶ。?api=... で差し替え可能）
```

## 今後

このリポジトリは「人物デューデリジェンス + 関係性マネジメント」システムの
本体リポジトリとして育てる（技術スタック確定後に本体の実装を載せる）。
