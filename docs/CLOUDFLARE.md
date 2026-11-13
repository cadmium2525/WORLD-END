# Cloudflare 入門 ― WORLD END のサーバーを無料で動かす

このゲームは **「ゲーム本体（GitHub Pages）」** と **「世界の状態を管理するサーバー（Cloudflare）」** の2つに分かれています。

```
 プレイヤーのブラウザ
   │  ① ゲームを読み込む（HTML/JS）
   ├──────────────▶ GitHub Pages（静的ファイルを配るだけ）
   │
   │  ② 世界は終わった？／80〜200面のクリア記録を送る・チケットを受け取る
   └──────────────▶ Cloudflare Workers（小さなサーバープログラム）
                          │
                          ▼
                     Cloudflare D1（データベース：世界の状態・挑戦記録）
```

GitHub Pages は「ファイルを配るだけ」なので、全員共通の「世界の終わり」を判定できません。そこで Cloudflare の2つのサービスを使います。

| サービス | 役割 | このゲームでの使い方 |
| --- | --- | --- |
| **Workers** | サーバーの処理を書く場所（サーバーレス） | `worker/src/index.ts`。クリア記録（入力ログ）を再生して本物か検証し、区間をクリアしたら次の区間のチケットを発行。200面を最初に検証できた1人なら世界を終わらせる |
| **D1** | SQLite 互換のデータベース | `worker/schema.sql`。世界の状態（1行）、挑戦セッション（ノーセーブ区間1つ分）、クリア記録 |

## 無料枠について（費用 0 円で運用するために）

2026年11月時点の Workers Free プランの主な上限です（**変更されることがあるので公開前に公式ページで再確認してください**）。

- Workers: 1日 100,000 リクエスト、1リクエストあたり CPU 10ms
- D1: 1日 読み取り 500万行 / 書き込み 10万行、保存容量 5GB

ポイント:

- **無料プランのままなら、上限を超えても自動で課金されません**。超えた分のリクエストはエラーになります（＝受付停止）。ゲーム側は通信エラー時に「開始・再開できません」と表示する安全側の作りです。
- 有料の「Workers Paid」プランに自分で申し込まない限り課金は発生しません。クレジットカード登録も不要です。
- このゲームのサーバー検証は1面あたり約 1ms（10ms 上限の範囲内）で、全員の画面の状態確認は約2.5分に1回です。
  区間開始時のステージ照合はその区間（20〜21面）の分だけを計算し、結果は使い回します。チケットの署名・検証（HMAC-SHA256）は1回 1ms 未満です。

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

### 4-2. チケットの署名鍵（TICKET_SECRET）を登録

101面以降のノーセーブ区間を始めるには、直前の区間をクリアしたときにサーバーが発行する **チケット** が必要です。
チケットが偽造されないよう、サーバーだけが知っている鍵で署名します（HMAC-SHA256）。

```bash
openssl rand -hex 32          # 例：ランダムな文字列を作る
npx wrangler secret put TICKET_SECRET
# → 上の文字列を貼り付けて Enter（16文字以上）
```

- 未登録の場合は ADMIN_TOKEN を鍵として流用します（動きますが、別々にしておくのがおすすめです）
- ADMIN_TOKEN も TICKET_SECRET も無い（または16文字未満の）場合、挑戦の開始は `ticket_key_missing`（503）で拒否され、
  ゲーム画面には「サーバーの設定が不完全です（チケットの署名鍵が未設定）」と表示されます
- **鍵を変えると、それまでに発行したチケットはすべて無効になります**（その人たちは80面から挑戦し直すまで、101面以降が公式記録の対象外になります）。
  本番中は変更しないでください
- テストモードで発行したチケットは本番モード（`MODE = "live"`）では使えません（署名にモードを含めているため）

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

- `npm run deploy`（と `npm run dev`）は、最初に区間ごとのステージのハッシュを `worker/src/stages-version.json` に書き出します
  （`tools/stages-version.ts`。区間開始時の CPU 時間を節約するため）。リポジトリのルートで `npm install` を済ませておいてください
- `npx wrangler deploy` を直接実行するとこの書き出しが行われません。ステージを変えたあとは `npm run deploy` を使ってください
  （古いままでも、今のステージと同じクライアントは受け付けますが、区間開始のたびに計算が走ります）

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
| 検証済みクリア（200面）の一覧を見る | `curl -H "Authorization: Bearer <ADMIN_TOKEN>" https://<URL>/api/admin/clears` |
| どの区間に何人挑戦中か見る | `npx wrangler d1 execute world-end --remote --command "SELECT segment, status, COUNT(*) FROM sessions GROUP BY segment, status"` |
| 世界をリセットする（テスト後など） | `curl -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" https://<URL>/api/admin/reset` |
| DB の中身を直接見る | `npx wrangler d1 execute world-end --remote --command "SELECT * FROM world"` |
| 設定を変えて再公開 | `wrangler.toml` を編集して `npm run deploy` |

ダッシュボード（https://dash.cloudflare.com）の **Workers & Pages** で、リクエスト数や無料枠の使用状況を確認できます。D1 の使用量は **Storage & Databases → D1** から確認できます。

## ローカルで試す（Cloudflare アカウント不要）

```bash
# ターミナル1：サーバー
cd worker
cp .dev.vars.example .dev.vars     # ADMIN_TOKEN と TICKET_SECRET（ローカル用の値）が入っている
npm install
npm run db:init:local
npm run dev            # http://localhost:8787

# ターミナル2：ゲーム
VITE_API_URL=http://localhost:8787 npm run dev   # http://localhost:5173
```

ローカルの DB は `worker/.wrangler/` に保存され、本番には影響しません。

### 結合テスト・ブラウザでの進行テスト

```bash
# サーバーを「実時間チェックなし」で起動（ボットは人間より速く送るため）
cd worker && npx wrangler dev --var MIN_TIME_FACTOR:0          # テストモード
cd worker && npx wrangler dev --var MIN_TIME_FACTOR:0 --var MODE:live   # 本番モードの確認

# 別のターミナルで（リポジトリのルート）
npm run e2e                           # 全6区間・チケットの拒否・順番飛ばし/偽ログ・（live なら）同時クリアで勝者1人
npx tsx tools/browser-progress.ts     # ブラウザで進行ルールを確認（テストモードのサーバーが必要。Vite は自動で起動）
```

- `npm run e2e` は最初に `/api/admin/reset` で世界をリセットします（ローカルの ADMIN_TOKEN `local-admin-token` を使用。別の値なら `npx tsx tools/e2e.ts <URL> <ADMIN_TOKEN>`）
- ボットの解答作成に数分かかります。解答は `node_modules/.cache/` に保存され、ステージが変わらなければ2回目以降は再利用されます

## 100面版のサーバーからの移行

100面版の D1 を使っている場合は、デプロイの前に1回だけ移行します（`worker/` ディレクトリで）。

```bash
npm run db:migrate:remote      # ローカルの DB は db:migrate:local
npx wrangler secret put TICKET_SECRET    # 手順 4-2
npm run deploy
```

- 移行は `sessions`（挑戦中のセッション。数時間で消える一時データ）を作り直すだけです。世界の状態（`world`）とクリア記録（`clears`）はそのまま残ります
- 移行の時点で挑戦中だった人は、次の送信で「チャレンジの有効期限が切れました」となり、その区間は公式記録の対象外になります
- 新しく作る場合は `npm run db:init:remote`（`schema.sql`）だけで十分です（移行は不要）

## 本番モードへの切り替え

1. テストプレイが終わったら、`worker/wrangler.toml` の `MODE = "test"` を `MODE = "live"` に変更
2. `TICKET_SECRET` が登録済みか確認：`npx wrangler secret list`
3. `npm run deploy`
4. 世界をリセット：`curl -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" https://<URL>/api/admin/reset`
5. `curl https://<URL>/api/state` が `"mode":"live"` と `"ended":false` を返すことを確認
6. GitHub の Actions 変数 `ALLOW_DEBUG` を `false` にして Pages を再デプロイ（テスト用の面選択・無敵を無効化）

本番モードでは、200面の検証に成功した最初の1人で世界が終わります（100面のボスでは終わりません）。
テストモードで発行されたチケットは本番では使えないため、本番で公式記録を狙う人は全員80面から挑戦することになります。

## トラブルシューティング

- **タイトルに「サーバーに接続できません」と出る**
  - `API_URL` 変数の URL が正しいか（`https://` から始まり、末尾 `/` なし）
  - ブラウザの開発者ツール → Console に `CORS` のエラーがあれば、`ALLOWED_ORIGINS` に GitHub Pages のオリジンを追加して `npm run deploy`
  - 無料枠を使い切った日は翌日（UTC 0時）まで復旧しません
- **`npm run deploy` で database_id のエラー** → 手順3の `database_id` を `wrangler.toml` に貼ったか確認
- **`API_URL` を変えたのにゲームに反映されない** → 変数はビルド時に埋め込まれます。Actions を再実行してください
- **「サーバーの設定が不完全です（チケットの署名鍵が未設定）」と出る** → 手順 4-2 の `TICKET_SECRET`（または ADMIN_TOKEN）を16文字以上で登録
- **101面以降で「チケットがありません」「チケットが正しくありません」と出る** → 前の区間をサーバーで検証できなかった（通信エラー・一時停止しすぎ・テスト機能の使用など）か、
  署名鍵やモードを変えた後です。遊ぶことはできますが公式記録の対象外です。公式記録にするには、その区間の前の区間（最終的には80面）から挑戦し直します
