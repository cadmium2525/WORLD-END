// Worker に埋め込む「区間ごとのステージのハッシュ（stagesVersion）」を作る・確かめるツール。
//   npx tsx tools/stages-version.ts write   … worker/src/stages-version.json を作り直す
//   npx tsx tools/stages-version.ts check   … 今のステージと一致しているか確認（不一致なら終了コード 1）
//
// 区間の開始時（/api/run/start）にサーバーで stagesVersion を計算すると、その区間の20面ぶんの生成とハッシュで
// 冷えた状態では 7〜11ms ほどかかり、無料枠の CPU 時間（1リクエスト 10ms）を超えうる。
// そこで deploy / dev の前（worker の predeploy / predev）にこのツールで値を作っておき、Worker はそれを使う。
// 埋め込んだ値がクライアントの値と食い違うときだけ、Worker はその場で計算し直して確かめる（古いままでも誤判定しない）。
import { readFileSync, writeFileSync } from 'node:fs';
import { SEGMENT_STARTS, segmentEnd } from '../src/shared/progress';
import { stagesVersion } from '../src/shared/stages';

const FILE = new URL('../worker/src/stages-version.json', import.meta.url);

const now: Record<string, string> = {};
for (const seg of SEGMENT_STARTS) now[String(seg)] = stagesVersion(seg, segmentEnd(seg));
const text = JSON.stringify(now, null, 2) + '\n';

const cmd = process.argv[2] ?? 'check';
if (cmd === 'write') {
  writeFileSync(FILE, text);
  console.log(`worker/src/stages-version.json を更新しました: ${JSON.stringify(now)}`);
} else {
  let old = '';
  try {
    old = readFileSync(FILE, 'utf8');
  } catch {
    /* 無い */
  }
  if (old === text) console.log('OK worker/src/stages-version.json は今のステージと一致');
  else {
    console.log('NG worker/src/stages-version.json が古い（npx tsx tools/stages-version.ts write で更新）');
    process.exit(1);
  }
}
