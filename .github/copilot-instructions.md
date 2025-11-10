## Sand-Study / Portfolio — Copilot 指示（要旨）

このリポジトリで作業する AI エージェント向けの最小ガイドです。まずここを読んでからコード編集や実行を行ってください。

### 大まかな構成（読み始めるファイル）
- `Sand-Study/` — 静的サイト（HTML/CSS/JS）。主要なクライアントロジックは `assets/js/*` にあります（例: `assets/js/main.js`, `assets/js/firebase-init.js`）。
- `Sand-Study/server/` — Node.js を使った補助サーバ（プッシュ通知デモなど）。エントリは `Sand-Study/server/index.js`。サーバは `/assets` をルートの `assets/` にマップしています。
- `handmade_py/` — このワークスペース内の小さな Flask 学習アプリ（ローカルで簡易タイマーやセッション保存を試す場所）。
- `register/` 等 — ドメインデータやその他のツール群。全体を編集する前に目的ファイルだけ読む。

### 重要な開発ワークフロー（必ず理解すること）
- Node サーバ起動（Sand-Study の push demo）:
  - cd `Sand-Study/server` → `npm install`（まだ依存が無ければ） → `npm start`（`node index.js` と同等）。
  - 環境変数で VAPID キーや Firebase 設定を渡せます（下参照）。
- Flask 開発サーバ（handmade_py）:
  - 仮想環境を作成: `python -m venv .venv` → `.\\.venv\\Scripts\\Activate.ps1` → `pip install -r requirements` または `pip install flask` → `python app.py`。

### 環境変数と機密の扱い（このレポジトリ特有）
- Firebase 設定は `assets/js/firebase-config.js` としてコミットしない運用が想定されています。代わりに `Sand-Study/server/index.js` は環境変数 (`FIREBASE_API_KEY`, `FIREBASE_APP_ID`, など) を読んで動的に `/assets/js/firebase-config.js` を返します。
  - 参照: `Sand-Study/server/index.js` の `app.get('/assets/js/firebase-config.js', ...)` 部分。
- Web Push の VAPID キーは `Sand-Study/server/vapid.json`（`.gitignore` に含まれる）または環境変数 `VAPID_PUBLIC`/`VAPID_PRIVATE` で与えます。README に `npx web-push generate-vapid-keys --json > vapid.json` の記述があります。

### 保存/状態ファイル（ローカル運用の注意）
- `Sand-Study/server/subscriptions.json` — サブスクリプションのデモ用ストア（ファイルロック/並列書き込みには注意）。
- `handmade_py/sessions.json` — ローカル学習用のセッション保存。コミットしたくない場合は `.gitignore` に入れられています。

### コードベースのパターンと例（すぐ使えるヒント）
- 動的設定: `assets/js/main.js` は `/assets/js/firebase-init.js` を優先的にロードしてから `firebase-config.js` を読む。エージェントが Firebase 関連を編集する際は両方をチェック。
- サーバ側の「隠し設定」: `Sand-Study/server/index.js` は `ADMIN_OFF`, `ADMIN_USER`, `ADMIN_PASS` を使う Basic Auth ミドルウェアを実装しています。管理用 API を使うときはこれに注意。
- ファイル読み書き: 既存サーバはファイルを直接読み書きするシンプルな実装です。並列アクセスに弱いため、変更提案では「ファイルロック」か「SQLite への移行」を提示すると安全です。

### 典型的なタスク別チェックリスト（短く）
- 変更をローカルで確認する前に: `npm start`（Sand-Study/server） と `python app.py`（handmade_py）が起動することを確認。
- Firebase 機能をテストしたい: `assets/js/firebase-init.js` と `assets/js/firebase-config.example.js` を読む。実環境では `firebase-config.js` はサーバor環境変数で供給される点に注意。
- Web Push を動かしたい: `vapid.json` を生成して `server/` に置くか環境変数を設定。`subscriptions.json` が更新されることを確認。

### コミット/コードスタイルの慣習
- このリポジトリは混在プロジェクト（静的サイト + Node サーバ + Python 学習スクリプト）です。大きな変更は小さなコミットに分け、README または該当フォルダに短い説明を添えてください。

### 参考ファイル（必読）
- `Sand-Study/server/index.js` — サーバの振る舞い（firebase-config の動的提供、VAPID 管理、subscriptions.json の扱い）。
- `assets/js/main.js` / `assets/js/firebase-init.js` — クライアントの初期化パターン（Firebase の遅延ロード、フォールバック実装）。
- `handmade_py/app.py`（または `handmade_py/templates/index.html`）— ローカル学習用 Flask アプリの入り口（session 保存 API の例）。

---
もしこのファイルで不足している「どのコマンドを実行すれば動くか」「どの環境変数が必須か」などがあれば教えてください。あなたのフィードバックを受けて追記・修正します。
