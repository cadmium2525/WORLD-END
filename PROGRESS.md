# 担当A（コンテンツ）作業メモ

## 状態: 完了（完了条件をすべて確認済み）
- `npx tsc --noEmit` / `(cd worker && npx tsc --noEmit)` / `npm run build`: OK
- `npx tsx tools/solve.ts 1 200`（4プロセスに分割して実行）: 200面すべて ALL OK
- `npx tsx tools/diversity.ts`（101〜199）: 警告 0 件
- `npx tsx tools/stage-hash.ts check`: 1〜100面 Level ハッシュ 100/100 一致、リプレイ 100/100 一致
- `npx tsx tools/determinism.ts`: ALL OK
- Playwright でエディタ・テストプレイ・200面ボスの描画を確認

## 区間ごとのボット通し時間
- 101〜120: 237.9秒 / 121〜140: 276.5秒 / 141〜160: 256.0秒 / 161〜180: 220.0秒 / 181〜200: 306.6秒（ボス込み）

## 既知の問題・統合メモ
- 161〜180 のボット通し時間は 3.7分で、目安（4〜7分）を少し下回る
- 200面の verify は中央値 約2ms だが、10回中の最大 5.75ms、JIT前の初回 6.1ms
- 統合時: 担当Bの stagesVersion(from,to) と stages.ts の stagesVersion が衝突する（Bの版を採用。101面以降の dark/chase もハッシュに入れると安全）
- BGM: audio.ts はトラック 13〜17（ワールド11〜15）と 18（200面ボス）に対応済み。main.ts 側の指定は B
