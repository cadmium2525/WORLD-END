// ステージ生成。
// 100面すべてを「ステージ番号から決定論的に」生成する。
// どの端末・サーバーでも同じ番号なら同じステージになるため、ルート暗記が成立し、
// サーバー側でも同じステージで入力ログを再生検証できる。
//
// 各ステージは「チャンク（短い地形パターン）」をつないで作る。
// チャンクはすべて「左端・右端が地面の高さ G」で始まり終わるため、自由につなげられる。

import { BOSS_STAGE, ROWS, T } from './constants';
import type { EntSpec, Level } from './level';
import { Rng, hashSeed } from './rng';

const G = 14; // 地面の上面の行

class Grid {
  cols: number[][] = [];
  ents: EntSpec[] = [];
  get x() {
    return this.cols.length;
  }
  add(top: number | null = G): number {
    const c = new Array<number>(ROWS).fill(T.EMPTY);
    if (top !== null) for (let y = top; y < ROWS; y++) c[y] = T.SOLID;
    this.cols.push(c);
    return this.cols.length - 1;
  }
  flat(n: number, top: number = G) {
    for (let i = 0; i < n; i++) this.add(top);
  }
  pit(n: number) {
    for (let i = 0; i < n; i++) this.add(null);
  }
  set(x: number, y: number, t: number) {
    this.cols[x][y] = t;
  }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

type Chunk = (g: Grid, lv: number, r: Rng) => void;

// ---------------- 基礎 ----------------
const gap: Chunk = (g, lv, r) => {
  g.flat(2);
  let w = lv < 15 ? r.range(1, 2) : 2;
  if (lv >= 40) w += r.range(0, 1);
  if (lv >= 75) w += r.range(0, 1);
  g.pit(w);
  g.flat(2);
};

const spikes: Chunk = (g, lv, r) => {
  g.flat(2);
  const n = lv < 20 ? 1 : r.range(1, lv >= 50 ? 3 : 2);
  for (let i = 0; i < n; i++) g.set(g.add(), G - 1, T.SPIKE_UP);
  g.flat(2);
};

const stairs: Chunk = (g, lv, r) => {
  g.flat(1);
  const steps = r.range(2, 3);
  const rise = lv >= 35 ? 2 : 1;
  let top = G;
  for (let i = 0; i < steps; i++) {
    top = Math.max(7, top - rise);
    g.flat(2, top);
  }
  g.flat(1, top);
  if (lv >= 25) {
    const n = r.range(1, 2);
    for (let i = 0; i < n; i++) g.set(g.add(), G - 1, T.SPIKE_UP);
  }
  g.flat(2);
};

const pillars: Chunk = (g, lv, r) => {
  g.flat(2);
  const n = r.range(2, lv >= 50 ? 4 : 3);
  const pw = lv >= 55 ? 1 : 2;
  let top = G;
  for (let i = 0; i < n; i++) {
    g.pit(r.range(2, lv >= 45 ? 3 : 2));
    const dh = r.range(-1, lv >= 30 ? 2 : 1);
    top = clamp(top - dh, G - 3, G);
    g.flat(pw, top);
  }
  g.pit(2);
  g.flat(2);
};

const floaters: Chunk = (g, lv, r) => {
  g.flat(2);
  const n = r.range(2, lv >= 50 ? 4 : 3);
  const bw = lv >= 55 ? 2 : 3;
  let row = G;
  for (let i = 0; i < n; i++) {
    const gw = r.range(2, lv >= 40 ? 4 : 3);
    g.pit(gw);
    row = clamp(row - r.range(-1, 1), G - 3, G);
    for (let j = 0; j < bw; j++) {
      const x = g.add(null);
      g.set(x, row, T.BRICK);
      // 高難度では足場の裏にトゲ（下から突っ込むと死ぬ）
      if (lv >= 65 && gw <= 3) g.set(x, row + 1, T.SPIKE_DOWN);
    }
  }
  g.pit(2);
  g.flat(2);
};

const lowCeil: Chunk = (g, lv, r) => {
  g.flat(2);
  const len = r.range(7, 9);
  const spikeAt = lv >= 40 ? [2, 6] : [3];
  for (let i = 0; i < len; i++) {
    const x = g.add();
    for (let y = 0; y <= 9; y++) g.set(x, y, T.SOLID);
    g.set(x, 10, T.SPIKE_DOWN);
    if (spikeAt.includes(i)) g.set(x, G - 1, T.SPIKE_UP);
  }
  g.flat(2);
};

// ---------------- 移動床・敵・弾 ----------------
const walkers: Chunk = (g, lv, r) => {
  const len = r.range(10, 13);
  const start = g.x;
  g.flat(len);
  const k = lv < 40 ? 1 : r.range(1, lv >= 70 ? 3 : 2);
  for (let i = 0; i < k; i++) g.ents.push({ k: 'walker', x: start + 5 + i * 3, y: G - 1, dir: -1 });
  g.flat(1);
};

const platH: Chunk = (g, lv, r) => {
  g.flat(2);
  const range = r.range(3, lv >= 50 ? 5 : 4);
  const pw = lv >= 60 ? 2 : 3;
  const start = g.x;
  g.pit(range + pw + 2);
  const speed = lv >= 60 ? 192 : 144;
  g.ents.push({ k: 'platH', x: start, y: G, w: pw, range, speed, phase: r.int(240) });
  g.flat(2);
};

const lift: Chunk = (g, lv, r) => {
  g.flat(2);
  const range = r.range(4, 6);
  const top = G - range;
  const x = g.x;
  g.pit(2);
  g.ents.push({ k: 'platV', x, y: G, w: 2, range, speed: lv >= 60 ? 160 : 128, phase: r.int(200) });
  g.flat(3, top);
  g.flat(3);
};

const turret: Chunk = (g, lv, r) => {
  g.flat(9);
  const tx = g.add();
  g.set(tx, G - 1, T.TURRET);
  const period = lv < 50 ? 110 : 86;
  g.ents.push({ k: 'turret', x: tx, y: G - 1, dir: -1, period, phase: r.int(period), speed: 384 });
  g.flat(3);
  if (lv >= 55) {
    g.flat(6);
    const x2 = g.add(G - 1);
    g.set(x2, G - 2, T.TURRET);
    g.ents.push({ k: 'turret', x: x2, y: G - 2, dir: -1, period: 120, phase: r.int(120), speed: 320 });
    g.flat(2, G - 1);
    g.flat(2);
  }
};

const flyerGap: Chunk = (g, lv, r) => {
  g.flat(2);
  const w = lv >= 50 ? 4 : 3;
  const x = g.x;
  g.pit(w);
  g.ents.push({
    k: 'flyer',
    x: x + Math.floor(w / 2),
    y: G - 5,
    range: 4,
    speed: lv >= 60 ? 192 : 128,
    phase: r.int(256),
  });
  g.flat(2);
};

// ---------------- 消える床・罠・スイッチ ----------------
const crumbleBridge: Chunk = (g, lv, r) => {
  g.flat(2);
  const n = r.range(5, lv >= 60 ? 9 : 7);
  const hole = lv >= 65 ? Math.floor(n / 2) : -1;
  for (let i = 0; i < n; i++) {
    const x = g.add(null);
    if (i !== hole) g.set(x, G, T.CRUMBLE);
  }
  g.flat(2);
};

const traps: Chunk = (g, lv, _r) => {
  const start = g.x;
  g.flat(11);
  g.set(start + 4, G - 1, T.TRAP);
  if (lv >= 55) g.set(start + 8, G - 1, T.TRAP);
};

const switchGate: Chunk = (g, lv, _r) => {
  g.flat(2);
  g.set(g.add(), G - 1, T.SWITCH);
  g.flat(2);
  for (let i = 0; i < 2; i++) {
    const x = g.add();
    for (let y = G - 5; y <= G - 1; y++) g.set(x, y, T.ABLOCK);
  }
  const p = lv >= 60 ? 4 : 3;
  for (let i = 0; i < p; i++) g.set(g.add(null), G, T.BBLOCK);
  g.flat(2);
};

const crumbleSteps: Chunk = (g, _lv, r) => {
  g.flat(2);
  const n = r.range(2, 4);
  let row = G;
  for (let i = 0; i < n; i++) {
    g.pit(r.range(2, 3));
    row = clamp(row - r.range(-1, 1), G - 2, G);
    for (let j = 0; j < 2; j++) g.set(g.add(null), row, T.CRUMBLE);
  }
  g.pit(2);
  g.flat(2);
};

// ---------------- 複合（61面〜） ----------------
const ceilPlat: Chunk = (g, lv, r) => {
  g.flat(2);
  const range = r.range(3, 4);
  const pw = 2;
  const start = g.x;
  const n = range + pw + 2;
  for (let i = 0; i < n; i++) {
    const x = g.add(null);
    for (let y = 0; y <= G - 5; y++) g.set(x, y, T.SOLID);
    g.set(x, G - 4, T.SPIKE_DOWN);
  }
  g.ents.push({ k: 'platH', x: start, y: G, w: pw, range, speed: lv >= 80 ? 192 : 160, phase: r.int(240) });
  g.flat(2);
};

const trapGap: Chunk = (g, _lv, _r) => {
  g.flat(5);
  g.set(g.add(), G - 1, T.TRAP);
  g.pit(2);
  g.flat(2);
};

const turretBridge: Chunk = (g, _lv, r) => {
  g.flat(2);
  const n = r.range(5, 7);
  for (let i = 0; i < n; i++) g.set(g.add(null), G, T.CRUMBLE);
  g.flat(3);
  const tx = g.add();
  g.set(tx, G - 1, T.TURRET);
  g.ents.push({ k: 'turret', x: tx, y: G - 1, dir: -1, period: 100, phase: r.int(100), speed: 320 });
  g.flat(2);
};

const walkerPit: Chunk = (g, lv, r) => {
  g.flat(2);
  const n = r.range(2, 3);
  for (let i = 0; i < n; i++) {
    g.pit(2);
    const x = g.x;
    g.flat(5);
    if (i % 2 === 0 || lv >= 80) g.ents.push({ k: 'walker', x: x + 3, y: G - 1, dir: -1 });
  }
  g.pit(2);
  g.flat(2);
};

const switchCrumble: Chunk = (g, _lv, _r) => {
  g.flat(2);
  g.set(g.add(), G - 1, T.SWITCH);
  g.flat(1);
  // スイッチを押すと崩れる床の橋の先の壁が消える
  for (let i = 0; i < 4; i++) g.set(g.add(null), G, T.CRUMBLE);
  for (let i = 0; i < 2; i++) {
    const x = g.add();
    for (let y = G - 5; y <= G - 1; y++) g.set(x, y, T.ABLOCK);
  }
  g.flat(2);
};

interface PoolItem {
  c: Chunk;
  from: number; // 登場する面
  w: number; // 出やすさ
}

const POOL: PoolItem[] = [
  { c: gap, from: 1, w: 3 },
  { c: spikes, from: 1, w: 3 },
  { c: stairs, from: 2, w: 2 },
  { c: pillars, from: 4, w: 2 },
  { c: lowCeil, from: 7, w: 1 },
  { c: floaters, from: 10, w: 2 },
  { c: walkers, from: 21, w: 2 },
  { c: platH, from: 23, w: 2 },
  { c: turret, from: 26, w: 2 },
  { c: lift, from: 29, w: 1 },
  { c: flyerGap, from: 32, w: 2 },
  { c: crumbleBridge, from: 41, w: 2 },
  { c: traps, from: 44, w: 2 },
  { c: switchGate, from: 47, w: 1 },
  { c: crumbleSteps, from: 51, w: 2 },
  { c: ceilPlat, from: 61, w: 2 },
  { c: trapGap, from: 64, w: 1 },
  { c: turretBridge, from: 67, w: 2 },
  { c: walkerPit, from: 70, w: 2 },
  { c: switchCrumble, from: 73, w: 1 },
];

/** 面ごとの難易度（0〜100） */
export function stageLevel(stage: number): number {
  if (stage >= 80) return 58 + Math.floor(((stage - 80) * 27) / 19);
  return 4 + Math.floor(((stage - 1) * 82) / 78);
}

function chunkCount(stage: number): number {
  if (stage >= 80) return 4 + Math.floor((stage - 80) / 10);
  return 3 + Math.floor((stage - 1) / 13);
}

export function worldOf(stage: number): number {
  return Math.min(10, Math.floor((stage - 1) / 10) + 1);
}

export function stageLabel(stage: number): string {
  if (stage === BOSS_STAGE) return 'FINAL';
  return `${worldOf(stage)}-${((stage - 1) % 10) + 1}`;
}

const cache = new Map<number, Level>();

export function getStage(stage: number): Level {
  let L = cache.get(stage);
  if (!L) {
    L = stage === BOSS_STAGE ? bossStage() : buildStage(stage);
    cache.set(stage, L);
  }
  return L;
}

function finish(g: Grid, stage: number, startX: number, boss: boolean): Level {
  const w = g.cols.length;
  const tiles = new Uint8Array(w * ROWS);
  for (let x = 0; x < w; x++) for (let y = 0; y < ROWS; y++) tiles[y * w + x] = g.cols[x][y];
  return { stage, world: worldOf(stage), w, h: ROWS, tiles, ents: g.ents, startX, startY: G - 1, boss };
}

function buildStage(stage: number): Level {
  const r = new Rng(hashSeed(stage));
  const lv = stageLevel(stage);
  const g = new Grid();
  g.flat(6);
  const avail = POOL.filter((p) => p.from <= stage);
  // 新しく登場したギミックは、その直後の数面で必ず登場させる
  const fresh = avail.filter((p) => stage - p.from < 3 && stage < 80);
  const n = chunkCount(stage);
  const total = avail.reduce((s, p) => s + p.w, 0);
  let last: Chunk | null = null;
  for (let i = 0; i < n; i++) {
    let c: Chunk;
    if (i < fresh.length) c = fresh[i].c;
    else {
      do {
        let k = r.int(total);
        c = avail[0].c;
        for (const p of avail) {
          if (k < p.w) {
            c = p.c;
            break;
          }
          k -= p.w;
        }
      } while (c === last && avail.length > 1);
    }
    last = c;
    c(g, lv, r);
    g.flat(r.range(1, 2));
  }
  g.flat(3);
  const gx = g.add();
  g.set(gx, G - 1, T.GOAL);
  g.set(gx, G - 2, T.GOAL);
  g.flat(4);
  return finish(g, stage, 2, false);
}

function bossStage(): Level {
  const g = new Grid();
  for (let i = 0; i < 30; i++) {
    const x = g.add();
    if (i === 0 || i === 29) for (let y = 0; y < G; y++) g.set(x, y, T.SOLID);
  }
  g.ents.push({ k: 'boss', x: 22, y: G - 1 });
  return finish(g, BOSS_STAGE, 3, true);
}
