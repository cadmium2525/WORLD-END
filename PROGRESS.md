# 担当A（コンテンツ）作業メモ

## 完了済み
- 新ギミック: バネ・風（横/上昇）・氷・つらら・コンベア・扉と鍵・重力反転（タイル）、圧殺ブロック・レーザー・ノコギリ・オーブ・鍵（配置物）、暗闇・迫る壁・せり上がる溶岩（面の設定）、縦に長い面
- sim / level / stageFormat / render / audio / editor / preview への追加
- 200面ボス（3形態、予兆つき）。ボットで撃破確認済み（約59秒）
- stages2.ts の設計表（101〜199）と組み立て
- solver の 101面以降用の探索（道のり計算＋届く高さ、鍵、ボス戦の危険回避）
- tools: stage-hash（1〜100面のハッシュ）、diversity、determinism、verify-time、try-design、try-beats、try-stage
- 1〜100面ハッシュ一致・リプレイ一致、determinism ALL OK、diversity 警告0、tsc/worker tsc/build OK
- Playwright でエディタ・テストプレイ・200面ボスのスクリーンショット確認（風・雲の見やすさを修正）

## 作業中
- 最終の `solve.ts 1 200`（4プロセスに分割）→ 結果を見て最終コミット・報告

## 既知の問題・統合メモ
- 担当Bの stagesVersion(from,to) と stages.ts の stagesVersion が衝突する（Bの版を採用し、L.h に加えて dark/chase もハッシュに入れると安全）
- BGM: audio.ts はトラック 13〜17（ワールド11〜15）と 18（200面ボス）に対応済み。main.ts 側の指定は B
