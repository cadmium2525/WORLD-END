// 入力ログの検証（サーバーと同じ verifyStage）にかかる時間を測る:
//   SOLVE_OUT=logs.json npx tsx tools/solve.ts 1 200   … ボットの解答を保存
//   npx tsx tools/verify-time.ts logs.json
// 1面ごとに「最初の1回（JIT前）」と「10回の中央値・最大」を出す。
import { readFileSync } from 'node:fs';
import { decodeInputs, verifyStage } from '../src/shared/replay';
import { getStage } from '../src/shared/stages';

const logs = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Record<string, string>;
const stages = Object.keys(logs).map(Number).sort((a, b) => a - b);
let worstMed = 0;
let worstMax = 0;
let worstFirst = 0;
let bad = 0;
for (const st of stages) {
  getStage(st); // 面の生成は計測に含めない（サーバーでも起動時に1回だけ）
  const inp = decodeInputs(logs[st])!;
  const t0 = performance.now();
  const ok = verifyStage(st, inp).ok;
  const first = performance.now() - t0;
  const ts: number[] = [];
  for (let k = 0; k < 10; k++) {
    const t = performance.now();
    verifyStage(st, inp);
    ts.push(performance.now() - t);
  }
  ts.sort((a, b) => a - b);
  const med = ts[5];
  const max = ts[9];
  if (!ok) bad++;
  worstMed = Math.max(worstMed, med);
  worstMax = Math.max(worstMax, max);
  worstFirst = Math.max(worstFirst, first);
  if (st > 100 || med > 1) console.log(`stage ${st}: ${inp.length}f ok=${ok} first=${first.toFixed(2)}ms median=${med.toFixed(2)}ms max=${max.toFixed(2)}ms`);
}
console.log(`中央値の最大 ${worstMed.toFixed(2)}ms / 10回中の最大 ${worstMax.toFixed(2)}ms / 初回（JIT前を含む）の最大 ${worstFirst.toFixed(2)}ms / NG ${bad}`);
