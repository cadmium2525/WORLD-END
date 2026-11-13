// 決定論のテスト（101面以降の新ギミックごと）: npx tsx tools/determinism.ts
//
// ギミックごとに小さな面を作り、次を確かめる:
//   1. 同じ入力列を2回再生すると、毎フレームの状態がすべて同じ
//   2. 途中で Sim.clone() したものと元を同じ入力で進めると、その後の状態がすべて同じ
//      （clone が新しい状態を含めて完全に複製していること。元を進めても clone が変わらないこと）
// 入力列は「ボットの解答」と「決まった種の疑似乱数の入力」の2種類。
import type { Level } from '../src/shared/level';
import { Sim } from '../src/shared/sim';
import { solveLevel } from '../src/shared/solver';
import { getStage } from '../src/shared/stages';
import { buildFromDesign, type StageDesign, type StageType } from '../src/shared/stages2';

/** Sim の状態をすべて文字列にする（関数・共有の不変データ以外） */
export function simState(s: Sim): string {
  return JSON.stringify({
    f: s.frame,
    p: s.p,
    py: s.prevY,
    e: s.ents,
    b: s.bullets,
    t: Array.from(s.tstate),
    sw: s.switchOn,
    la: s.latch,
    d: s.dead,
    c: s.cleared,
    bo: s.boss,
    k: s.keys,
    ch: s.chase,
    fb: s.fboss,
    ev: s.events,
  });
}

function randomInputs(seed: number, n: number): number[] {
  let x = seed >>> 0;
  const out: number[] = [];
  let cur = 2;
  for (let i = 0; i < n; i++) {
    if (i % 6 === 0) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      const r = x >>> 24;
      // 右に進みがち。ジャンプも混ぜる
      cur = (r % 10 < 7 ? 2 : r % 10 < 9 ? 0 : 1) | ((r >> 4) % 3 === 0 ? 4 : 0);
    }
    out.push(cur);
  }
  return out;
}

function check(name: string, L: Level, inputs: number[], invincible = false): string | null {
  const opts = { invincible };
  // 1. 2回再生
  const a = new Sim(L, opts);
  const b = new Sim(L, opts);
  const trace: string[] = [];
  for (let i = 0; i < inputs.length; i++) {
    a.step(inputs[i]);
    b.step(inputs[i]);
    const sa = simState(a);
    if (sa !== simState(b)) return `${name}: 2回の再生が ${i + 1} フレーム目で食い違いました`;
    trace.push(sa);
    if (a.dead || a.cleared) break;
  }
  // 2. 途中で clone
  const n = trace.length;
  for (let at = 0; at < n; at += Math.max(1, Math.floor(n / 12))) {
    const s = new Sim(L, opts);
    for (let i = 0; i < at; i++) s.step(inputs[i]);
    const c = s.clone();
    for (let i = at; i < n; i++) {
      s.step(inputs[i]);
      // 元を先に進めても clone は影響を受けない
      if (i === at && simState(c) === simState(s) && at < n - 1) {
        /* 1フレームで変わらない場合もあるので、ここでは比べない */
      }
      c.step(inputs[i]);
      const sc = simState(c);
      if (sc !== simState(s)) return `${name}: ${at} フレーム目の clone が ${i + 1} フレーム目で元と食い違いました`;
      if (sc !== trace[i]) return `${name}: ${at} フレーム目の clone が ${i + 1} フレーム目で最初の再生と食い違いました`;
    }
  }
  return null;
}

const D = (type: StageType, beats: string, extra: Partial<StageDesign> = {}): StageDesign => ({ type, star: 'spike', beats: beats.split(' '), note: '', ...extra });
const CASES: [string, Level][] = [
  ['バネ', buildFromDesign(150, 11, D('normal', 'springWall.0 springLow.1'))],
  ['風', buildFromDesign(150, 11, D('normal', 'windTail.0 windHead.0 windLift.1'))],
  ['氷の床', buildFromDesign(150, 12, D('normal', 'iceRun.1 iceIslands.0'))],
  ['圧殺ブロック', buildFromDesign(150, 12, D('normal', 'crusherHall.1'))],
  ['つらら', buildFromDesign(150, 12, D('normal', 'icicleRun.1'))],
  ['ベルトコンベア', buildFromDesign(150, 13, D('normal', 'convRun.1 convIslands.0'))],
  ['レーザー', buildFromDesign(150, 13, D('normal', 'laserGates.0 laserHop.1'))],
  ['回転ノコギリ', buildFromDesign(150, 13, D('normal', 'sawPit.0 sawOrbit.0 sawFloor.0'))],
  ['空中ジャンプオーブ', buildFromDesign(150, 14, D('normal', 'orbGap.0 orbWall.0'))],
  ['暗闇', buildFromDesign(150, 14, D('normal', 'gapRun.0 spikeHop.0', { dark: true }))],
  ['迫る壁', buildFromDesign(150, 14, D('normal', 'gapRun.0 spikeHop.0', { chase: { dir: 'right', speed: 240, delay: 60 } }))],
  ['せり上がる溶岩（縦に登る面）', buildFromDesign(150, 14, D('climb', 'tZig.0 tZig.1', { chase: { dir: 'up', speed: 100, delay: 120 } }))],
  ['鍵と扉', buildFromDesign(150, 15, D('normal', 'keyHigh.0 keyLow.0'))],
  ['重力反転', buildFromDesign(150, 15, D('normal', 'gravCeil.1 gravWeave.0'))],
];

let bad = 0;
for (const [name, L] of CASES) {
  const sol = solveLevel(L).inputs;
  const seqs: [string, number[]][] = [['乱数入力', randomInputs(L.w * 7919 + L.h, 1800)]];
  if (sol) seqs.unshift(['ボットの解答', sol]);
  for (const [kind, inp] of seqs) {
    const err = check(`${name}（${kind}）`, L, inp);
    if (err) {
      bad++;
      console.log('NG', err);
    } else console.log(`OK ${name}（${kind}、${inp.length}フレーム）`);
  }
  if (!sol) console.log(`  ※ ${name}: ボットの解答なし（乱数入力のみ）`);
}
// 200面の最終ボス（無敵で長く再生して、全形態のパターンを通す）
{
  const L = getStage(200);
  for (const seed of [1, 2, 3]) {
    const inp = randomInputs(seed, 4000);
    const err = check(`200面ボス（無敵・乱数入力 ${seed}）`, L, inp, true);
    if (err) {
      bad++;
      console.log('NG', err);
    } else console.log(`OK 200面ボス（無敵・乱数入力 ${seed}、${inp.length}フレーム）`);
  }
}
console.log(bad ? `${bad} NG` : 'ALL OK（同じ入力で同じ結果・clone 後も同じ結果）');
process.exitCode = bad ? 1 : 0;
