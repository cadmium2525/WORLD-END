// ステージをテキストで表示する開発ツール: npm run preview-stage -- 12 [開始列] [終了列]
// 文字は stageFormat.ts と同じ。配置物: e 歩く敵 f 飛ぶ敵 _ 横移動床 ^ 縦移動床 X ボス
//   C 圧殺ブロック * レーザー @ ノコギリ o オーブ k 鍵
import { getStage, stageLevel } from '../src/shared/stages';
import { MECH_NAMES, TYPE_NAMES, designOf } from '../src/shared/stages2';
import { previewLevel } from './lib';

const n = Number(process.argv[2] ?? 1);
const from = Number(process.argv[3] ?? 0);
const to = Number(process.argv[4] ?? 9999);
const L = getStage(n);
const ds = designOf(n);
console.log(`stage ${n} ${n <= 100 ? `lv=${stageLevel(n)} ` : ''}w=${L.w} h=${L.h}${L.dark ? ' 暗闇' : ''}${L.chase ? ` chase=${JSON.stringify(L.chase)}` : ''}`);
if (ds) console.log(`設計: ${TYPE_NAMES[ds.type]}・主役 ${MECH_NAMES[ds.star]}・${ds.beats.join(' ')}（${ds.note}）`);
console.log(previewLevel(L, from, to));
const simple = new Set(['walker', 'orb', 'key']);
console.log(JSON.stringify(L.ents.filter((e) => !simple.has(e.k))));
