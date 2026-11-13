# 担当A（コンテンツ）作業メモ

## 完了済み
- 新ギミック: バネ・風（横/上昇）・氷・つらら・コンベア・扉と鍵・重力反転（タイル）、圧殺ブロック・レーザー・ノコギリ・オーブ・鍵（配置物）、暗闇・迫る壁・せり上がる溶岩（面の設定）、縦に長い面
- sim / level / stageFormat / render / audio / editor / preview への追加
- 200面ボス（3形態、予兆つき）
- stages2.ts の設計表（101〜199）と組み立て
- solver の 101面以降用の探索（道のり計算＋届く高さ、鍵、ボス戦の危険回避）
- tools: stage-hash（1〜100面のハッシュ）、diversity、determinism、verify-time、try-design、try-beats、try-stage
- 1〜100面ハッシュ一致・リプレイ一致を確認済み（tools/stage-hash.ts check）
- determinism ALL OK、diversity 警告0、tsc/worker tsc/build OK（途中時点）

## 未完了 / 作業中
- `npx tsx tools/solve.ts 1 200` の全面 ALL OK 確認（縦に登る面の修正後に再実行が必要）
- 区間ごとのボット通し時間の調整（121〜160 が短め）
- 迫る壁の面の余裕（ratio）の確認と速度調整
- verify 時間の計測（tools/verify-time.ts）
- 最終コミット・報告

## 既知の問題
- 統合時: 担当Bの stagesVersion(from,to) と stages.ts の stagesVersion が衝突する（Bの版を採用すればよい）
