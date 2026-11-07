# Cloudflare 入門 ― WORLD END のサーバーを無料で動かす

このゲームは **「ゲーム本体（GitHub Pages）」** と **「世界の状態を管理するサーバー（Cloudflare）」** の2つに分かれています。

```
 プレイヤーのブラウザ
   │  ① ゲームを読み込む（HTML/JS）
   ├──────────────▶ GitHub Pages（静的ファイルを配るだけ）
   │
   │  ② 世界は終わった？／80〜100面のクリア記録を送る
   └──────────────▶ Cloudflare Workers（小さなサーバープログラム）
                          │
                          ▼
                     Cloudflare D1（データベース：世界の状態・挑戦記録）
```

GitHub Pages は「ファイルを配るだけ」なので、全員共通の「世界の終わり」を判定できません。そこで Cloudflare の2つのサービスを使います。

| サービス | 役割 | このゲームでの使い方 |
| --- | --- | --- |
| **Workers** | サーバーの処理を書く場所（サーバーレス） | `worker/src/index.ts`。クリア記録（入力ログ）を再生して本物か検証し、最初の1人なら世界を終わらせる |
| **D1** | SQLite 互換のデータベース | `worker/schema.sql`。世界の状態（1行）、挑戦セッション、クリア記録 |

## 無料枠について（費用 0 円で運用するために）

2026年11月時点の Workers Free プランの主な上限です（**変更されることがあるので公開前に公式ページで再確認してください**）。

- Workers: 1日 100,000 リクエスト、1リクエストあたり CPU 10ms
- D1: 1日 読み取り 500万行 / 書き込み 10万行、保存容量 5GB

ポイント:

- **無料プランのままなら、上限を超えても自動で課金されません**。超えた分のリクエストはエラーになります（＝受付停止）。ゲーム側は通信エラー時に「開始・再開できません」と表示する安全側の作りです。
- 有料の「Workers Paid」プランに自分で申し込まない限り課金は発生しません。クレジットカード登録も不要です。
- このゲームのサーバー検証は1面あたり約 1ms（10ms 上限の範囲内）で、全員の画面の状態確認は約2.5分に1回です。

---

## セットアップ手順

作業はすべて、このリポジトリを手元のPCに clone した状態で行います（Node.js 20 以上が必要）。

### 1. Cloudflare アカウントを作る

1. https://dash.cloudflare.com/sign-up でメールアドレスとパスワードを登録（無料・カード不要）
2. 届いたメールで認証

### 2. Wrangler（Cloudflare の公式コマンドツール）でログイン

```bash
cd worker
npm install
npx wrangler login
```

ブラウザが開くので「Allow（許可）」を押します。ターミナルに `Successfully logged in` と出れば OK。

### 3. データベース（D1）を作る

```bash
npx wrangler d1 create world-end
```

結果にこのような行が表示されます：

```toml
[[d1_databases]]
binding = "DB"
database_name = "world-end"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

`database_id` の値を `worker/wrangler.toml` の `database_id = "0000..."` の部分にコピーします。

次にテーブルを作ります：

```bash
npm run db:init:remote
```

### 4. 管理用パスワード（ADMIN_TOKEN）を登録

世界のリセット等に使う秘密の文字列です。推測されにくい長い文字列にしてください。

```bash
# 例：ランダムな文字列を作る（macOS / Linux）
openssl rand -hex 24

npx wrangler secret put ADMIN_TOKEN
# → 入力を求められるので、上の文字列を貼り付けて Enter
```

`secret` に入れた値はコードや GitHub には残りません（Cloudflare 上で暗号化保存）。**この文字列は自分のメモ帳などに保管してください。**

### 5. 許可するサイト（ALLOWED_ORIGINS）を確認

`worker/wrangler.toml` の `ALLOWED_ORIGINS` に、ゲームを公開するサイトのオリジンが入っていることを確認します。

```toml
ALLOWED_ORIGINS = "http://localhost:5173,http://localhost:4173,https://cadmium2525.github.io"
```

（GitHub Pages のオリジンは `https://ユーザー名.github.io` です。リポジトリ名の部分は含めません）

### 6. デプロイ（公開）

```bash
npm run deploy
```

初回は workers.dev のサブドメイン名（例：`cadmium2525`）を決めるよう聞かれることがあります。
完了すると URL が表示されます：

```
https://world-end-api.<サブドメイン>.workers.dev
```

動作確認：

```bash
curl https://world-end-api.<サブドメイン>.workers.dev/api/state
# {"ended":false,"winnerName":null,"endedAt":null,"mode":"test"} と出れば成功
```

### 7. ゲーム本体（GitHub Pages）とつなぐ

GitHub のリポジトリページで：

1. **Settings → Pages → Build and deployment → Source** を「**GitHub Actions**」にする
2. **Settings → Secrets and variables → Actions → Variables タブ → New repository variable**
   - Name: `API_URL`
   - Value: 手順6の URL（例 `https://world-end-api.xxxx.workers.dev`、末尾の `/` なし）
3. `main` ブランチに push する（または Actions タブから「Deploy to GitHub Pages」を手動実行）

数分後に `https://cadmium2525.github.io/WORLD-END/` でゲームが遊べます。
タイトル画面に「● テストモード（クリアしても世界は終わりません）」と出ていれば、サーバーとつながっています。

---

## よく使う運用コマンド（`worker/` ディレクトリで実行）

| やりたいこと | コマンド |
| --- | --- |
| サーバーのログをリアルタイムで見る | `npx wrangler tail` |
| 世界の状態を見る | `curl https://<URL>/api/state` |
| 検証済みクリアの一覧を見る | `curl -H "Authorization: Bearer <ADMIN_TOKEN>" https://<URL>/api/admin/clears` |
| 世界をリセットする（テスト後など） | `curl -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" https://<URL>/api/admin/reset` |
| DB の中身を直接見る | `npx wrangler d1 execute world-end --remote --command "SELECT * FROM world"` |
| 設定を変えて再公開 | `wrangler.toml` を編集して `npm run deploy` |

ダッシュボード（https://dash.cloudflare.com）の **Workers & Pages** で、リクエスト数や無料枠の使用状況を確認できます。D1 の使用量は **Storage & Databases → D1** から確認できます。

## ローカルで試す（Cloudflare アカウント不要）

```bash
# ターミナル1：サーバー
cd worker
cp .dev.vars.example .dev.vars
npm install
npm run db:init:local
npm run dev            # http://localhost:8787

# ターミナル2：ゲーム
VITE_API_URL=http://localhost:8787 npm run dev   # http://localhost:5173
```

ローカルの DB は `worker/.wrangler/` に保存され、本番には影響しません。

## トラブルシューティング

- **タイトルに「サーバーに接続できません」と出る**
  - `API_URL` 変数の URL が正しいか（`https://` から始まり、末尾 `/` なし）
  - ブラウザの開発者ツール → Console に `CORS` のエラーがあれば、`ALLOWED_ORIGINS` に GitHub Pages のオリジンを追加して `npm run deploy`
  - 無料枠を使い切った日は翌日（UTC 0時）まで復旧しません
- **`npm run deploy` で database_id のエラー** → 手順3の `database_id` を `wrangler.toml` に貼ったか確認
- **`API_URL` を変えたのにゲームに反映されない** → 変数はビルド時に埋め込まれます。Actions を再実行してください
