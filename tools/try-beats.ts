// ビートを1つずつ試す（開発用）: npx tsx tools/try-beats.ts <型> 面番号 ビート1 ビート2 ...
// 各ビートを単独の面にしてボットで解けるかを1行ずつ表示する
import { TS } from '../src/shared/constants';
import { solveLevel } from '../src/shared/solver';
import { buildFromDesign, type StageType } from '../src/shared/stages2';
import { verifyLevel } from './lib';

const type = process.argv[2] as StageType;
const stage = Number(process.argv[3]);
for (const b of process.argv.slice(4)) {
  const L = buildFromDesign(stage, 11 + Math.floor((stage - 101) / 20), { type, star: 'spike', beats: b.split(','), note: '' });
  const t0 = Date.now();
  let r = solveLevel(L);
  let big = false;
  if (!r.inputs) {
    r = solveLevel(L, 1500, 3);
    big = true;
  }
  const v = r.inputs ? verifyLevel(L, r.inputs).ok : false;
  console.log(
    `${b.padEnd(28)} w=${L.w} h=${L.h} ${r.inputs ? `ok ${(r.inputs.length / 60).toFixed(1)}s${big ? ' (big beam)' : ''} verify=${v}` : `FAILED at x=${(r.bestX / TS).toFixed(1)}`} ${Date.now() - t0}ms`,
  );
}
