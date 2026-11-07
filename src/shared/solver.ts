// 自動攻略ボット（ビームサーチ）。面がクリア可能かを検証する（開発ツール・エディタ用）
import { IN_JUMP, IN_LEFT, IN_RIGHT, PW, TS } from './constants';
import type { Level } from './level';
import { Sim } from './sim';

const ACTIONS: number[] = [];
for (const d of [0, IN_LEFT, IN_RIGHT]) for (const j of [0, IN_JUMP]) ACTIONS.push(d | j);

interface Node {
  sim: Sim;
  inputs: number[];
  score: number;
}

function score(s: Sim): number {
  // 右へ進むほど高評価。登る地形のため、高い位置も少しだけ評価する
  let v = s.p.x - (s.p.y >> 1);
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

export interface SolveResult {
  inputs: number[] | null;
  bestX: number; // 到達できた最も右の位置（サブピクセル）
}

/** ビームサーチで面のクリア手順を探す。見つからなければ inputs = null */
export function solveLevel(L: Level, beam = 400, hold = 4, maxFrames = 60 * 240): SolveResult {
  let bestX = 0;
  let bestAt = 0;
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
        if (done) return { inputs: inp, bestX: s.p.x };
        if (s.dead) continue;
        const k = key(s);
        if (seen.has(k)) continue;
        seen.add(k);
        next.push({ sim: s, inputs: inp, score: score(s) });
      }
    }
    if (next.length === 0) return { inputs: null, bestX };
    next.sort((a, b) => b.score - a.score);
    if (next[0].sim.p.x > bestX) {
      bestX = next[0].sim.p.x;
      bestAt = f;
    }
    if (f - bestAt > 60 * 30) return { inputs: null, bestX };
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
  return { inputs: null, bestX };
}

