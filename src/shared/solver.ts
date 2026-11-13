// 自動攻略ボット（ビームサーチ）。面がクリア可能かを検証する（開発ツール・エディタ用）
//
// 1〜100面: 従来どおり「右へ進むほど高評価」で探す（結果を変えないため、そのまま残している）。
// 101面以降: ゴールまでの道のり（タイル上の最短経路の長さ）を前もって計算し、それが短いほど高評価にする。
//   縦に登る面・行き止まりのある面・鍵と扉の面（先に鍵へ向かう）でも迷わないようにするため。
import { IN_JUMP, IN_LEFT, IN_RIGHT, PH, PW, T, TS } from './constants';
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

/** 101面以降の新しい探索を使うか */
export function usesNewSolver(L: Level): boolean {
  return L.stage > 100;
}

/** ビームサーチで面のクリア手順を探す。見つからなければ inputs = null */
export function solveLevel(L: Level, beam = 400, hold = 4, maxFrames = 60 * 240): SolveResult {
  if (usesNewSolver(L)) return solveNew(L, beam, hold, maxFrames);
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

// ================= 101面以降 =================

const FAR = 1 << 20;
/** 開発用: 探索の途中経過を表示する */
export let solverDebug = false;
export function setSolverDebug(v: boolean) {
  solverDebug = v;
}

/** タイルが（道のり計算で）通れるか。トゲは通れない扱い、扉・A/Bブロックは通れる扱い */
function passable(t: number): boolean {
  switch (t) {
    case T.SOLID:
    case T.BRICK:
    case T.SWITCH:
    case T.TURRET:
    case T.SPRING:
    case T.ICE:
    case T.CONV_L:
    case T.CONV_R:
    case T.CRUMBLE:
    case T.SPIKE_UP:
    case T.SPIKE_DOWN:
    case T.SPIKE_LEFT:
    case T.SPIKE_RIGHT:
      return false;
    default:
      return true;
  }
}

/** 足場になるタイルか（「下に何もない＝落ちたら死ぬ場所」の判定用） */
function floorLike(t: number): boolean {
  return !passable(t) && t !== T.SPIKE_UP && t !== T.SPIKE_DOWN && t !== T.SPIKE_LEFT && t !== T.SPIKE_RIGHT;
}

/**
 * 指定タイル群からの道のり（ダイクストラ法）。
 * 真下に足場が無いマス（穴の上・穴の中）は通りにくくして、穴の底を通る近道を選ばないようにする
 */
export function distanceField(L: Level, sources: number[]): Int32Array {
  const n = L.w * L.h;
  const cost = new Uint8Array(n);
  for (let x = 0; x < L.w; x++) {
    let below = false; // この行より下に足場があるか
    for (let y = L.h - 1; y >= 0; y--) {
      const i = y * L.w + x;
      cost[i] = below || L.tiles[i] === T.WIND_U ? 1 : 3;
      if (floorLike(L.tiles[i]) || L.tiles[i] === T.ONEWAY) below = true;
    }
  }
  const d = new Int32Array(n).fill(FAR);
  // 費用は 1〜3 の小さな整数なので、距離ごとのバケツで処理する
  const buckets: number[][] = [];
  for (const i of sources) {
    d[i] = 0;
    (buckets[0] ??= []).push(i);
  }
  for (let dist = 0; dist < buckets.length; dist++) {
    const bk = buckets[dist];
    if (!bk) continue;
    for (let q = 0; q < bk.length; q++) {
      const i = bk[q];
      if (d[i] !== dist) continue;
      const x = i % L.w;
      const nb = [x > 0 ? i - 1 : -1, x < L.w - 1 ? i + 1 : -1, i - L.w, i + L.w];
      for (const j of nb) {
        if (j < 0 || j >= n || !passable(L.tiles[j])) continue;
        const nd = dist + cost[j];
        if (nd >= d[j]) continue;
        d[j] = nd;
        (buckets[nd] ??= []).push(j);
      }
    }
  }
  return d;
}

interface Fields {
  goal: Int32Array;
  keys: { idx: number; f: Int32Array }[]; // ents の index と、その鍵までの距離
}

function buildFields(L: Level): Fields {
  const goals: number[] = [];
  for (let i = 0; i < L.tiles.length; i++) if (L.tiles[i] === T.GOAL) goals.push(i);
  const keys: Fields['keys'] = [];
  L.ents.forEach((e, idx) => {
    if (e.k === 'key') keys.push({ idx, f: distanceField(L, [e.y * L.w + e.x]) });
  });
  return { goal: distanceField(L, goals), keys };
}

function fieldScore(L: Level, f: Int32Array, s: Sim): number {
  const p = s.p;
  const cxs = p.x + PW / 2;
  const cys = p.y + PH / 2;
  const cx = Math.max(0, Math.min(L.w - 1, Math.floor(cxs / TS)));
  const cy = Math.max(0, Math.min(L.h - 1, Math.floor(cys / TS)));
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= L.w || y >= L.h ? FAR : f[y * L.w + x]);
  const d = at(cx, cy);
  let v = -Math.min(d, FAR) * TS;
  // タイル内の位置で細かく差をつける（距離が減る向きへ進んでいるほど高い）
  const fx = (cxs % TS) - TS / 2;
  const fy = (cys % TS) - TS / 2;
  const dl = at(cx - 1, cy);
  const dr = at(cx + 1, cy);
  const du = at(cx, cy - 1);
  const dd = at(cx, cy + 1);
  if (dr < dl) v += fx;
  else if (dl < dr) v -= fx;
  if (dd < du) v += fy;
  else if (du < dd) v -= fy;
  return v;
}

function scoreNew(L: Level, F: Fields, s: Sim): number {
  const fb = s.fboss;
  if (fb) {
    let v = (fb.maxHp - fb.hp) * 1e7;
    const bcx = fb.x + fb.w / 2;
    const pcx = s.p.x + PW / 2;
    v -= Math.abs(bcx - pcx) / 8;
    v -= s.p.y / 16;
    if (fb.state === 'dying' || fb.state === 'dead') v += 1e9;
    return v;
  }
  let field = F.goal;
  let progress = 0;
  if (F.keys.length) {
    // 拾った鍵・開けた扉の数が進み具合。鍵を持っていなければ、まだ拾っていない最初の鍵へ向かう
    let got = 0;
    let next: Int32Array | null = null;
    for (const k of F.keys) {
      if (!s.ents[k.idx].alive) got++;
      else if (!next) next = k.f;
    }
    const opened = got - s.keys;
    progress = got + opened;
    if (s.keys === 0 && next && opened < F.keys.length) field = next;
  }
  let v = progress * 1e8 + fieldScore(L, field, s);
  if (s.switchOn) v += TS;
  return v;
}

function keyNew(s: Sim): string {
  const p = s.p;
  let k = `${p.x >> 9},${p.y >> 9},${p.vy >> 7},${p.vx >> 7},${p.onGround ? 1 : 0},${s.switchOn ? 1 : 0},${p.grav},${p.air},${s.keys}`;
  if (s.fboss) k += `,${s.fboss.hp},${s.fboss.x >> 11}`;
  return k;
}

function solveNew(L: Level, beam: number, hold: number, maxFrames: number): SolveResult {
  const F = buildFields(L);
  let best = -Infinity;
  let bestAt = 0;
  let bestX = 0;
  const tall = L.h > 17;
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
        const k = keyNew(s);
        if (seen.has(k)) continue;
        seen.add(k);
        next.push({ sim: s, inputs: inp, score: scoreNew(L, F, s) });
      }
    }
    if (next.length === 0) return { inputs: null, bestX };
    next.sort((a, b) => b.score - a.score);
    if (next[0].score > best) {
      best = next[0].score;
      bestAt = f;
      bestX = next[0].sim.p.x;
    }
    if (solverDebug && f % 120 === 0) {
      const q = next[0].sim.p;
      console.log(`f=${f} n=${next.length} best=(${(q.x / TS).toFixed(1)},${(q.y / TS).toFixed(1)}) score=${next[0].score.toFixed(0)}`);
    }
    if (f - bestAt > 60 * 20) return { inputs: null, bestX };
    // 多様性の確保: 同じ場所に集中しないよう、タイルごとの上限を設けて選ぶ
    const per = new Map<number, number>();
    const cap = Math.max(8, beam >> 4);
    nodes = [];
    for (const nd of next) {
      const p = nd.sim.p;
      const b = ((p.x >> 12) * 2 + (p.onGround ? 1 : 0)) * 512 + (tall || nd.sim.fboss ? p.y >> 12 : 0);
      const c = per.get(b) ?? 0;
      if (c >= cap) continue;
      per.set(b, c + 1);
      nodes.push(nd);
      if (nodes.length >= beam) break;
    }
  }
  return { inputs: null, bestX };
}
