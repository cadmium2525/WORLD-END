// 自動攻略ボット（ビームサーチ）。全ステージがクリア可能かを検証するための開発ツール。
// 使い方: npm run solve -- 1 100     （1〜100面を検証）
//         npm run solve -- 37        （37面だけ）
import { IN_JUMP, IN_LEFT, IN_RIGHT, PW, TS } from '../src/shared/constants';
import { decodeInputs, encodeInputs, verifyStage } from '../src/shared/replay';
import { Sim } from '../src/shared/sim';
import { getStage } from '../src/shared/stages';

const ACTIONS: number[] = [];
for (const d of [0, IN_LEFT, IN_RIGHT]) for (const j of [0, IN_JUMP]) ACTIONS.push(d | j);

interface Node {
  sim: Sim;
  inputs: number[];
  score: number;
}

function score(s: Sim): number {
  let v = s.p.x;
  if (s.switchOn) v += 6 * TS;
  if (s.boss) {
    v = (s.boss.maxHp - s.boss.hp) * 1e7;
    // ボス戦: ボスの真上付近にいる状態を好む
    const bcx = s.boss.x + s.boss.w / 2;
    const pcx = s.p.x + PW / 2;
    v -= Math.abs(bcx - pcx) / 8;
    v -= s.p.y / 16;
    if (s.boss.state === 'dying' || s.boss.state === 'dead') v += 1e9;
  }
  return v;
}

function key(s: Sim): string {
  const p = s.p;
  let k = `${p.x >> 9},${p.y >> 9},${p.vy >> 7},${p.vx >> 7},${p.onGround ? 1 : 0},${s.switchOn ? 1 : 0}`;
  if (s.boss) k += `,${s.boss.hp},${s.boss.x >> 11}`;
  return k;
}

export let bestX = 0;
let bestAt = 0;
export function solve(stage: number, beam = 400, hold = 4, maxFrames = 60 * 240): number[] | null {
  const L = getStage(stage);
  bestX = 0;
  bestAt = 0;
  let nodes: Node[] = [{ sim: new Sim(L), inputs: [], score: 0 }];
  for (let f = 0; f < maxFrames; f += hold) {
    const next: Node[] = [];
    const seen = new Set<string>();
    for (const n of nodes) {
      for (const a of ACTIONS) {
        const s = n.sim.clone();
        const inp = n.inputs.slice();
        let done = false;
        for (let h = 0; h < hold; h++) {
          s.step(a);
          inp.push(a);
          if (s.dead) break;
          if (s.cleared) {
            done = true;
            break;
          }
        }
        if (done) return inp;
        if (s.dead) continue;
        const k = key(s);
        if (seen.has(k)) continue;
        seen.add(k);
        next.push({ sim: s, inputs: inp, score: score(s) });
      }
    }
    if (next.length === 0) return null;
    next.sort((a, b) => b.score - a.score);
    if (next[0].sim.p.x > bestX) {
      bestX = next[0].sim.p.x;
      bestAt = f;
    }
    if (f - bestAt > 60 * 30) return null;
    // 多様性の確保: 同じ列に集中しないよう、タイル列ごとの上限を設けて選ぶ
    const per = new Map<number, number>();
    const cap = Math.max(8, beam >> 4);
    nodes = [];
    for (const nd of next) {
      const b = (nd.sim.p.x >> 12) * 2 + (nd.sim.p.onGround ? 1 : 0);
      const c = per.get(b) ?? 0;
      if (c >= cap) continue;
      per.set(b, c + 1);
      nodes.push(nd);
      if (nodes.length >= beam) break;
    }
  }
  return null;
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
