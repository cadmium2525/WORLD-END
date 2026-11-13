// 自動攻略ボットで面がクリア可能かを検証する開発ツール。
// 使い方: npm run solve -- 1 200     （1〜200面を検証）
//         npm run solve -- 37        （37面だけ）
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { TS } from '../src/shared/constants';
import { decodeInputs, encodeInputs, verifyStage } from '../src/shared/replay';
import { solveLevel } from '../src/shared/solver';
import { Sim } from '../src/shared/sim';
import { getStage } from '../src/shared/stages';

/**
 * 迫る壁・溶岩の面の余裕。
 *   margin: ボットが壁から最も近づいたときの距離（壁が追いつくまでの秒数）
 *   ratio: 「人がボットの何倍の時間をかけても追いつかれないか」（どの地点でも一様に遅いと仮定した最小値）
 */
export function chaseMargin(stage: number, inputs: number[]): { margin: number; ratio: number } | null {
  const L = getStage(stage);
  const c = L.chase;
  if (!c) return null;
  const s = new Sim(L);
  let min = Infinity;
  let ratio = Infinity;
  const start = s.chase;
  for (const a of inputs) {
    s.step(a);
    const pos = c.dir === 'right' ? s.p.x : s.p.y + 14 * 256;
    if (s.frame > c.delay) {
      const gap = c.dir === 'right' ? pos - s.chase : s.chase - pos;
      min = Math.min(min, gap / c.speed / 60);
    }
    // 壁がこの位置に届くフレーム
    const reach = c.delay + Math.abs(pos - start) / c.speed;
    if (s.frame > 60) ratio = Math.min(ratio, reach / s.frame);
  }
  return { margin: min, ratio };
}

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
  const logs: Record<string, string> = {};
  const segFrames = new Map<string, number>();
  let maxVerify = 0;
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
    verifyStage(st, dec); // 1回目はJITの準備
    const t1 = performance.now();
    const v = verifyStage(st, dec);
    const vt = performance.now() - t1;
    maxVerify = Math.max(maxVerify, vt);
    if (st >= 80) {
      const seg = st <= 100 ? '80-100' : `${101 + Math.floor((st - 101) / 20) * 20}-${120 + Math.floor((st - 101) / 20) * 20}`;
      segFrames.set(seg, (segFrames.get(seg) ?? 0) + sol.length);
    }
    logs[st] = enc;
    const cm = chaseMargin(st, dec);
    console.log(
      `stage ${st}: ok ${(sol.length / 60).toFixed(1)}s w=${L.w} h=${L.h} log=${enc.length}B verify=${v.ok} ${vt.toFixed(2)}ms solve=${ms}ms${cm !== null ? ` chase-margin=${cm.margin.toFixed(1)}s ratio=${cm.ratio.toFixed(2)}` : ''}`,
    );
    if (!v.ok) fail++;
  }
  for (const [seg, f] of segFrames) console.log(`${seg} bot total: ${(f / 60).toFixed(1)}s (${(f / 3600).toFixed(1)}分)`);
  console.log(`verify max: ${maxVerify.toFixed(2)}ms`);
  // SOLVE_OUT=ファイル名 で解答（入力ログ）を JSON に追記保存（tools/verify-time.ts で使う）
  const outFile = process.env.SOLVE_OUT;
  if (outFile) {
    const old = existsSync(outFile) ? (JSON.parse(readFileSync(outFile, 'utf8')) as Record<string, string>) : {};
    writeFileSync(outFile, JSON.stringify({ ...old, ...logs }));
  }
  console.log(fail ? `${fail} FAILED` : 'ALL OK');
  process.exitCode = fail ? 1 : 0;
}
