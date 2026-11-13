// 1面をボットで解き、途中経過・失敗時の最良の動きを表示する（開発用）: npx tsx tools/try-stage.ts 200 [beam] [hold]
import { TS } from '../src/shared/constants';
import { Sim } from '../src/shared/sim';
import { setSolverDebug, solveLevel } from '../src/shared/solver';
import { getStage } from '../src/shared/stages';

const st = Number(process.argv[2]);
const beam = Number(process.argv[3] ?? 400);
const hold = Number(process.argv[4] ?? 4);
setSolverDebug(true);
const L = getStage(st);
const t0 = Date.now();
const r = solveLevel(L, beam, hold);
console.log(r.inputs ? `ok ${(r.inputs.length / 60).toFixed(1)}s` : 'FAILED', `${Date.now() - t0}ms`);
const path = r.inputs ?? r.partial ?? [];
const s = new Sim(L);
let line = '';
path.forEach((a, i) => {
  s.step(a);
  if (i % 20 === 0) line += ` ${i}:(${(s.p.x / TS).toFixed(1)},${(s.p.y / TS).toFixed(1)})${s.fboss ? `[${s.fboss.state},hp${s.fboss.hp}]` : ''}`;
});
console.log('path:' + line);
