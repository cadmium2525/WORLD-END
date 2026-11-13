// 設計の試作用（面を作らずにビート列を試す）:
//   npx tsx tools/try-design.ts <型> "<ビート列>" [面番号] [chase=right:300:150] [dark] [quiet]
import { TS } from '../src/shared/constants';
import { setSolverDebug, solveLevel } from '../src/shared/solver';
import { buildFromDesign, type StageDesign, type StageType } from '../src/shared/stages2';
import { Sim } from '../src/shared/sim';
import { previewLevel, verifyLevel } from './lib';

const type = (process.argv[2] ?? 'normal') as StageType;
const beats = (process.argv[3] ?? '').split(' ').filter(Boolean);
const stage = Number(process.argv[4] ?? 150);
const ds: StageDesign = { type, star: 'spike', beats, note: '' };
let quiet = false;
for (const a of process.argv.slice(5)) {
  if (a.startsWith('chase=')) {
    const [dir, sp, de] = a.slice(6).split(':');
    ds.chase = { dir: dir as 'right' | 'up', speed: Number(sp), delay: Number(de) };
  }
  if (a === 'dark') ds.dark = true;
  if (a === 'quiet') quiet = true;
  if (a === 'debug') setSolverDebug(true);
}
const L = buildFromDesign(stage, 11 + Math.floor((stage - 101) / 20), ds);
if (!quiet) console.log(previewLevel(L));
const t0 = Date.now();
let r = solveLevel(L);
if (!r.inputs) r = solveLevel(L, 1500, 3);
console.log(`w=${L.w} h=${L.h}`, r.inputs ? `ok ${(r.inputs.length / 60).toFixed(1)}s` : `FAILED at x=${(r.bestX / TS).toFixed(1)}`, `${Date.now() - t0}ms`);
if (r.inputs) console.log(verifyLevel(L, r.inputs));
else if (r.partial) {
  // 途中までの最良の動き（10フレームごとの位置）
  const s = new Sim(L);
  let line = '';
  r.partial.forEach((a, i) => {
    s.step(a);
    if (i % 10 === 0) line += ` ${i}:(${(s.p.x / TS).toFixed(1)},${(s.p.y / TS).toFixed(1)})${a & 4 ? 'J' : ''}${a & 1 ? 'L' : a & 2 ? 'R' : ''}`;
  });
  console.log('best path:' + line);
}
