// 自動攻略ボットで面がクリア可能かを検証する開発ツール。
// 使い方: npm run solve -- 1 100     （1〜100面を検証）
//         npm run solve -- 37        （37面だけ）
import { TS } from '../src/shared/constants';
import { decodeInputs, encodeInputs, verifyStage } from '../src/shared/replay';
import { solveLevel } from '../src/shared/solver';
import { getStage } from '../src/shared/stages';

export let bestX = 0;
export function solve(stage: number, beam = 400, hold = 4): number[] | null {
  const r = solveLevel(getStage(stage), beam, hold);
  bestX = r.bestX;
  return r.inputs;
}

const isMain = process.argv[1]?.endsWith('solve.ts');
if (isMain) {
  const a = Number(process.argv[2] ?? 1);
  const b = Number(process.argv[3] ?? a);
  let fail = 0;
  let finalFrames = 0;
  for (let st = a; st <= b; st++) {
    const t0 = Date.now();
    let sol = solve(st);
    if (!sol) sol = solve(st, 1500, 3);
    const ms = Date.now() - t0;
    const L = getStage(st);
    if (!sol) {
      fail++;
      console.log(`stage ${st}: FAILED (w=${L.w}) stuck at tile x=${(bestX / TS).toFixed(1)} ${ms}ms`);
      continue;
    }
    const enc = encodeInputs(sol);
    const dec = decodeInputs(enc)!;
    const t1 = performance.now();
    const v = verifyStage(st, dec);
    const vt = performance.now() - t1;
    if (st >= 80) finalFrames += sol.length;
    console.log(
      `stage ${st}: ok ${(sol.length / 60).toFixed(1)}s w=${L.w} log=${enc.length}B verify=${v.ok} ${vt.toFixed(2)}ms solve=${ms}ms`,
    );
    if (!v.ok) fail++;
  }
  if (finalFrames) console.log(`80-100 bot total: ${(finalFrames / 60).toFixed(1)}s`);
  console.log(fail ? `${fail} FAILED` : 'ALL OK');
  process.exitCode = fail ? 1 : 0;
}
