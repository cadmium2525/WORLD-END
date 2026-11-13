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
import customData from './stage-data.json';
import { checkDef, defToLevel, type StageDef } from './stageFormat';
import { buildDesigned, designOf, finalBossStage } from './stages2';

/** 200面（真の最終ボス） */
export const TRUE_FINAL_STAGE = 200;

/** ステージエディタで作った手作りステージ（面番号 → データ）。自動生成より優先される */
export const CUSTOM_STAGES = customData as unknown as Record<string, StageDef>;

const G0 = 14; // スタート地点の地面の上面の行
const G_MIN = 10; // 地面が一番高いときの上面の行

class Grid {
  cols: number[][] = [];
  ents: EntSpec[] = [];
  /** 現在の地面の高さ（上面の行）。チャンクの間で上下する */
  G = G0;
  get x() {
    return this.cols.length;
  }
  add(top: number | null = this.G): number {
    const c = new Array<number>(ROWS).fill(T.EMPTY);
    if (top !== null) for (let y = Math.max(0, top); y < ROWS; y++) c[y] = T.SOLID;
    this.cols.push(c);
    return this.cols.length - 1;
  }
  flat(n: number, top: number = this.G) {
    for (let i = 0; i < n; i++) this.add(top);
  }
  pit(n: number) {
    for (let i = 0; i < n; i++) this.add(null);
  }
  set(x: number, y: number, t: number) {
    if (y >= 0 && y < ROWS) this.cols[x][y] = t;
  }
  /** 天井（0行目〜bottom行目を埋める） */
  ceil(x: number, bottom: number) {
    for (let y = 0; y <= bottom; y++) this.cols[x][y] = T.SOLID;
  }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

type Chunk = (g: Grid, lv: number, r: Rng) => void;

// すべてのチャンクは「左端・右端が現在の地面の高さ g.G」で始まり終わる。
// 高さは g.G からの相対で指定する（G - 1 = 地面のすぐ上の行）。

// ================= 基礎 =================
const gap: Chunk = (g, lv, r) => {
  g.flat(2);
  let w = lv < 15 ? r.range(1, 2) : 2;
  if (lv >= 40) w += r.range(0, 1);
  if (lv >= 75) w += r.range(0, 1);
  g.pit(w);
  g.flat(2);
};

const spikes: Chunk = (g, lv, r) => {
  const G = g.G;
  g.flat(2);
  const n = lv < 20 ? 1 : r.range(1, lv >= 50 ? 3 : 2);
  for (let i = 0; i < n; i++) g.set(g.add(), G - 1, T.SPIKE_UP);
  // 上にフタ（高く跳びすぎ禁止）
  if (lv >= 45 && r.chance(40)) {
    const x0 = g.x - n;
    for (let i = 0; i < n; i++) g.set(x0 + i, G - 5, T.BRICK);
  }
  g.flat(2);
};

const stairs: Chunk = (g, lv, r) => {
  const G = g.G;
  g.flat(1);
  const steps = r.range(2, 3);
  const rise = lv >= 35 ? 2 : 1;
  let top = G;
  for (let i = 0; i < steps; i++) {
    top = Math.max(3, top - rise);
    g.flat(r.range(1, 2) + (lv < 30 ? 1 : 0), top);
  }
  g.flat(1, top);
  if (lv >= 25) {
    const n = r.range(1, 2);
    for (let i = 0; i < n; i++) g.set(g.add(), G - 1, T.SPIKE_UP);
  }
  g.flat(2);
};

const pillars: Chunk = (g, lv, r) => {
  const G = g.G;
  g.flat(2);
  const n = r.range(2, lv >= 50 ? 4 : 3);
  const pw = lv >= 55 ? 1 : 2;
  let top = G;
  for (let i = 0; i < n; i++) {
    g.pit(r.range(2, lv >= 45 ? 3 : 2));
    top = clamp(top - r.range(-1, lv >= 30 ? 2 : 1), G - 3, G);
    g.flat(pw, top);
  }
  g.pit(2);
  g.flat(2);
};

const floaters: Chunk = (g, lv, r) => {
  const G = g.G;
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
      if (lv >= 65 && gw <= 3) g.set(x, row + 1, T.SPIKE_DOWN);
    }
  }
  g.pit(2);
  g.flat(2);
};

const lowCeil: Chunk = (g, lv, r) => {
  const G = g.G;
  g.flat(2);
  const len = r.range(7, 9);
  const spikeAt = lv >= 40 ? [2, 6] : [3];
  for (let i = 0; i < len; i++) {
    const x = g.add();
    g.ceil(x, G - 5);
    g.set(x, G - 4, T.SPIKE_DOWN);
    if (spikeAt.includes(i)) g.set(x, G - 1, T.SPIKE_UP);
  }
  g.flat(2);
};

/** 起伏のある地形。谷にトゲが生えることも */
const hills: Chunk = (g, lv, r) => {
  const G = g.G;
  g.flat(1);
  const n = r.range(3, 5);
  let top = G;
  for (let i = 0; i < n; i++) {
    const w = r.range(2, 4);
    const nt = clamp(top - r.range(-2, 2), G - 3, G);
    if (Math.abs(nt - top) === 0) top = clamp(top - 1, G - 3, G);
    else top = nt;
    const x0 = g.x;
    g.flat(w, top);
    if (lv >= 15 && w >= 3 && r.chance(35)) g.set(x0 + 1, top - 1, T.SPIKE_UP);
  }
  g.flat(2);
};

/** 1マスの足場とトゲが交互に並ぶ */
const spikeHop: Chunk = (g, lv, r) => {
  const G = g.G;
  g.flat(2);
  const n = r.range(3, lv >= 50 ? 5 : 4);
  for (let i = 0; i < n; i++) {
    const sw = lv >= 45 ? r.range(1, 2) : 1;
    for (let j = 0; j < sw; j++) g.set(g.add(), G - 1, T.SPIKE_UP);
    g.flat(1);
  }
  g.flat(1);
};

/** 両側の壁にトゲが生えた穴 */
const spikeWalls: Chunk = (g, lv, r) => {
  const G = g.G;
  g.flat(1);
  const top = G - r.range(1, 2);
  g.flat(2, top);
  const w = lv >= 40 ? 4 : 3;
  for (let i = 0; i < w; i++) {
    const x = g.add(null);
    if (i === 0) for (let y = top + 1; y < ROWS; y++) g.set(x, y, T.SPIKE_RIGHT);
    if (i === w - 1) for (let y = top + 1; y < ROWS; y++) g.set(x, y, T.SPIKE_LEFT);
  }
  g.flat(2, top);
  g.flat(2);
};

/** トゲの溝（または敵のいる溝） */
const valley: Chunk = (g, lv, r) => {
  const G = g.G;
  g.flat(2);
  const depth = Math.min(2, ROWS - 1 - G);
  const w = lv >= 50 ? 4 : 3;
  const withEnemy = lv >= 25 && r.chance(45);
  const x0 = g.x;
  for (let i = 0; i < w; i++) {
    const x = g.add(G + depth);
    if (!withEnemy) g.set(x, G + depth - 1, T.SPIKE_UP);
  }
  if (withEnemy) {
    g.ents.push({ k: 'walker', x: x0 + 1, y: G + depth - 1, dir: 1 });
    if (depth < 2) g.ents.pop(); // 浅すぎると出られなくなるので置かない
  }
  g.flat(2);
};

/** 穴の上を下りながら渡る */
const descent: Chunk = (g, lv, r) => {
  const G = g.G;
  g.flat(1);
  g.flat(2, G - 2);
  const top = G - 4;
  g.flat(2, top);
  let row = top;
  const n = r.range(2, 3);
  for (let i = 0; i < n; i++) {
    g.pit(r.range(3, lv >= 50 ? 5 : 4));
    row = Math.min(G, row + r.range(1, 2));
    for (let j = 0; j < 2; j++) g.set(g.add(null), row, T.BRICK);
  }
  g.pit(2);
  g.flat(2);
};

// ================= 移動床・敵・弾 =================
const walkers: Chunk = (g, lv, r) => {
  const G = g.G;
  const len = r.range(10, 13);
  const start = g.x;
  g.flat(len);
  const k = lv < 40 ? 1 : r.range(1, lv >= 70 ? 3 : 2);
  for (let i = 0; i < k; i++) g.ents.push({ k: 'walker', x: start + 5 + i * 3, y: G - 1, dir: -1 });
  if (lv >= 50 && r.chance(50)) {
    // 敵の上にフタ：踏まずに跳び越えるのが難しい
    for (let x = start + 4; x < start + 9; x++) g.set(x, G - 4, T.BRICK);
  }
  g.flat(1);
};

/** 細い橋の上を歩く敵 */
const walkerBridge: Chunk = (g, lv, r) => {
  const G = g.G;
  g.flat(2);
  const w = r.range(6, 8);
  const x0 = g.x;
  for (let i = 0; i < w; i++) g.set(g.add(null), G, T.BRICK);
  g.ents.push({ k: 'walker', x: x0 + w - 2, y: G - 1, dir: -1 });
  if (lv >= 55) g.ents.push({ k: 'walker', x: x0 + 2, y: G - 1, dir: 1 });
  g.flat(2);
};

const platH: Chunk = (g, lv, r) => {
  const G = g.G;
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
  const G = g.G;
  g.flat(2);
  const range = clamp(r.range(4, 6), 3, G - 4);
  const top = G - range;
  const x = g.x;
  g.pit(2);
  g.ents.push({ k: 'platV', x, y: G, w: 2, range, speed: lv >= 60 ? 160 : 128, phase: r.int(200) });
  g.flat(3, top);
  if (lv >= 50 && r.chance(50)) g.set(g.x - 2, top - 1, T.SPIKE_UP);
  g.flat(3);
};

const turret: Chunk = (g, lv, r) => {
  const G = g.G;
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

/** 階段の上から砲台が撃ち下ろす */
const turretStairs: Chunk = (g, lv, r) => {
  const G = g.G;
  g.flat(2);
  g.flat(2, G - 1);
  g.flat(2, G - 2);
  g.flat(lv >= 50 ? 5 : 6, G - 3);
  const tx = g.add(G - 3);
  g.set(tx, G - 4, T.TURRET);
  const period = lv >= 60 ? 80 : 100;
  g.ents.push({ k: 'turret', x: tx, y: G - 4, dir: -1, period, phase: r.int(period), speed: 352 });
  g.flat(2, G - 3);
  g.flat(2);
};

const flyerGap: Chunk = (g, lv, r) => {
  const G = g.G;
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

/** 飛ぶ敵を踏んで跳ねないと届かない大穴 */
const stompChain: Chunk = (g, _lv, r) => {
  const G = g.G;
  g.flat(2);
  const x = g.x;
  g.pit(6);
  g.ents.push({ k: 'flyer', x: x + 2, y: G - 2, range: 1, speed: 64, phase: r.int(64) });
  g.flat(2);
};

// ================= 消える床・罠・スイッチ =================
const crumbleBridge: Chunk = (g, lv, r) => {
  const G = g.G;
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
  const G = g.G;
  const start = g.x;
  g.flat(11);
  g.set(start + 4, G - 1, T.TRAP);
  if (lv >= 55) g.set(start + 8, G - 1, T.TRAP);
};

const switchGate: Chunk = (g, lv, _r) => {
  const G = g.G;
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

/** スイッチを2回押して、橋を交互に出す */
const switchDouble: Chunk = (g, _lv, _r) => {
  const G = g.G;
  g.flat(2);
  g.set(g.add(), G - 1, T.SWITCH);
  g.flat(2);
  for (let i = 0; i < 3; i++) g.set(g.add(null), G, T.BBLOCK);
  g.flat(1);
  g.set(g.add(), G - 1, T.SWITCH);
  g.flat(1);
  for (let i = 0; i < 3; i++) g.set(g.add(null), G, T.ABLOCK);
  g.flat(2);
};

const crumbleSteps: Chunk = (g, _lv, r) => {
  const G = g.G;
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

/** 崩れる足場を登る */
const crumbleTower: Chunk = (g, lv, r) => {
  const G = g.G;
  g.flat(2);
  let row = G;
  const n = r.range(2, 3);
  for (let i = 0; i < n; i++) {
    g.pit(lv >= 60 ? 2 : 1);
    row -= 2;
    for (let j = 0; j < 2; j++) g.set(g.add(null), row, T.CRUMBLE);
  }
  g.pit(1);
  g.flat(3, row);
  g.flat(2);
};

/** すり抜け床を登って高い壁を越える */
const towerClimb: Chunk = (g, lv, r) => {
  const G = g.G;
  g.flat(2);
  const x0 = g.x;
  g.flat(7);
  for (let i = 0; i < 3; i++) g.set(x0 + i, G - 2, T.ONEWAY);
  for (let i = 4; i < 7; i++) g.set(x0 + i, G - 4, T.ONEWAY);
  const top = G - 5; // 地面からは5段（跳んで届かない）
  g.flat(5, top);
  if (lv >= 60 && r.chance(50)) g.set(x0 + 1, G - 1, T.SPIKE_UP);
  g.flat(2);
};

/** すり抜け床を渡る（下から跳び乗れる） */
const onewayStack: Chunk = (g, lv, r) => {
  const G = g.G;
  g.flat(2);
  const n = r.range(3, 4);
  let row = G - 1;
  for (let i = 0; i < n; i++) {
    g.pit(r.range(2, lv >= 45 ? 3 : 2));
    row = clamp(row - r.range(-2, 2), G - 4, G);
    for (let j = 0; j < 3; j++) g.set(g.add(null), row, T.ONEWAY);
  }
  g.pit(2);
  g.flat(2);
};

// ================= 複合 =================
const ceilPlat: Chunk = (g, lv, r) => {
  const G = g.G;
  g.flat(2);
  const range = r.range(3, 4);
  const pw = 2;
  const start = g.x;
  const n = range + pw + 2;
  for (let i = 0; i < n; i++) {
    const x = g.add(null);
    g.ceil(x, G - 5);
    g.set(x, G - 4, T.SPIKE_DOWN);
  }
  g.ents.push({ k: 'platH', x: start, y: G, w: pw, range, speed: lv >= 80 ? 192 : 160, phase: r.int(240) });
  g.flat(2);
};

/** 天井の高さが変わる通路（高い天井→低い天井） */
const ceilingRun: Chunk = (g, lv, r) => {
  const G = g.G;
  g.flat(2);
  const secs = r.range(2, 3);
  for (let s = 0; s < secs; s++) {
    const low = lv >= 60 && s % 2 === 1;
    const len = r.range(3, 4);
    for (let i = 0; i < len; i++) {
      const x = g.add();
      g.ceil(x, low ? G - 4 : G - 5);
      g.set(x, low ? G - 3 : G - 4, T.SPIKE_DOWN);
      if (i === 1) g.set(x, G - 1, T.SPIKE_UP);
    }
  }
  g.flat(2);
};

const trapGap: Chunk = (g, _lv, _r) => {
  const G = g.G;
  g.flat(5);
  g.set(g.add(), G - 1, T.TRAP);
  g.pit(2);
  g.flat(2);
};

const turretBridge: Chunk = (g, _lv, r) => {
  const G = g.G;
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
  const G = g.G;
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
  const G = g.G;
  g.flat(2);
  g.set(g.add(), G - 1, T.SWITCH);
  g.flat(1);
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
  worlds?: number[]; // このワールドでは出やすい（特色）
  sw?: boolean; // スイッチを使う（1面に1つまで。スイッチの状態は面全体で共通のため）
}

const POOL: PoolItem[] = [
  { c: gap, from: 1, w: 3, worlds: [1] },
  { c: spikes, from: 1, w: 3, worlds: [1, 3] },
  { c: stairs, from: 2, w: 2, worlds: [1, 3] },
  { c: hills, from: 3, w: 2, worlds: [1, 2] },
  { c: pillars, from: 4, w: 2, worlds: [2] },
  { c: spikeHop, from: 6, w: 2, worlds: [3, 10] },
  { c: lowCeil, from: 7, w: 1, worlds: [3, 4] },
  { c: floaters, from: 10, w: 2, worlds: [2, 9] },
  { c: valley, from: 12, w: 2, worlds: [2, 7] },
  { c: spikeWalls, from: 15, w: 2, worlds: [3, 9] },
  { c: descent, from: 17, w: 2, worlds: [2, 5] },
  { c: walkers, from: 21, w: 2, worlds: [4] },
  { c: platH, from: 23, w: 2, worlds: [5, 8] },
  { c: walkerBridge, from: 25, w: 2, worlds: [4, 6] },
  { c: turret, from: 26, w: 2, worlds: [8] },
  { c: lift, from: 29, w: 1, worlds: [5, 8] },
  { c: flyerGap, from: 32, w: 2, worlds: [4, 6] },
  { c: stompChain, from: 34, w: 1, worlds: [4, 6] },
  { c: turretStairs, from: 36, w: 2, worlds: [7, 8] },
  { c: onewayStack, from: 38, w: 2, worlds: [4, 9] },
  { c: crumbleBridge, from: 41, w: 2, worlds: [6, 7] },
  { c: traps, from: 44, w: 2, worlds: [6] },
  { c: switchGate, from: 47, w: 1, worlds: [8], sw: true },
  { c: towerClimb, from: 49, w: 2, worlds: [5, 9] },
  { c: crumbleSteps, from: 51, w: 2, worlds: [7, 9] },
  { c: switchDouble, from: 54, w: 1, worlds: [8], sw: true },
  { c: crumbleTower, from: 56, w: 1, worlds: [7] },
  { c: ceilingRun, from: 58, w: 2, worlds: [3, 10] },
  { c: ceilPlat, from: 61, w: 2, worlds: [9] },
  { c: trapGap, from: 64, w: 1, worlds: [6, 10] },
  { c: turretBridge, from: 67, w: 2, worlds: [7, 8] },
  { c: walkerPit, from: 70, w: 2, worlds: [4, 10] },
  { c: switchCrumble, from: 73, w: 1, worlds: [8], sw: true },
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
  if (stage > BOSS_STAGE) return Math.min(15, 11 + Math.floor((stage - 101) / 20));
  return Math.min(10, Math.floor((stage - 1) / 10) + 1);
}

export function stageLabel(stage: number): string {
  if (stage === BOSS_STAGE) return 'FINAL';
  if (stage === TRUE_FINAL_STAGE) return 'WORLD END';
  if (stage > BOSS_STAGE) return `${worldOf(stage)}-${((stage - 101) % 20) + 1}`;
  return `${worldOf(stage)}-${((stage - 1) % 10) + 1}`;
}

/** ボス面か（100面・200面。エディタで編集できない） */
export function isBossStage(stage: number): boolean {
  return stage === BOSS_STAGE || stage === TRUE_FINAL_STAGE;
}

const cache = new Map<number, Level>();

export function getStage(stage: number): Level {
  let L = cache.get(stage);
  if (!L) {
    const def = CUSTOM_STAGES[String(stage)];
    if (stage === BOSS_STAGE) L = bossStage();
    else if (stage === TRUE_FINAL_STAGE) L = finalBossStage(stage, worldOf(stage));
    else if (def && checkDef(def).length === 0) L = defToLevel(stage, worldOf(stage), def);
    else L = generatedStage(stage);
    cache.set(stage, L);
  }
  return L;
}

/** 自動生成のステージ（手作りがあっても無視して生成） */
export function generatedStage(stage: number): Level {
  if (stage === BOSS_STAGE) return bossStage();
  if (stage === TRUE_FINAL_STAGE) return finalBossStage(stage, worldOf(stage));
  if (designOf(stage)) return buildDesigned(stage, worldOf(stage));
  return buildStage(stage);
}

export function isCustomStage(stage: number): boolean {
  const def = CUSTOM_STAGES[String(stage)];
  return !!def && checkDef(def).length === 0;
}

function finish(g: Grid, stage: number, startX: number, startY: number, boss: boolean): Level {
  const w = g.cols.length;
  const tiles = new Uint8Array(w * ROWS);
  for (let x = 0; x < w; x++) for (let y = 0; y < ROWS; y++) tiles[y * w + x] = g.cols[x][y];
  return { stage, world: worldOf(stage), w, h: ROWS, tiles, ents: g.ents, startX, startY, boss };
}

/** チャンクの間のつなぎ。ときどき地面の高さを上下させる */
function connect(g: Grid, lv: number, r: Rng) {
  g.flat(r.range(1, 2));
  if (!r.chance(lv < 10 ? 25 : 45)) return;
  const d = r.pick([-2, -1, 1, 2]);
  const ng = clamp(g.G + d, G_MIN, G0);
  if (ng === g.G) return;
  g.G = ng;
  g.flat(2);
}

function pickWeighted(items: PoolItem[], weight: (p: PoolItem) => number, r: Rng): PoolItem {
  const total = items.reduce((s, p) => s + weight(p), 0);
  let k = r.int(Math.max(1, total));
  for (const p of items) {
    k -= weight(p);
    if (k < 0) return p;
  }
  return items[items.length - 1];
}

function buildStage(stage: number): Level {
  const r = new Rng(hashSeed(stage));
  const lv = stageLevel(stage);
  const world = worldOf(stage);
  const g = new Grid();
  g.flat(6);
  const avail = POOL.filter((p) => p.from <= stage);
  // 新しく登場したギミックは、その直後の数面で必ず登場させる
  const fresh = stage < 80 ? avail.filter((p) => stage - p.from < 3) : [];
  const n = chunkCount(stage) + (stage > 5 ? r.range(0, 1) : 0);
  // ワールドの特色：そのワールドが得意なチャンクは出やすい
  const weight = (p: PoolItem) => p.w * (p.worlds?.includes(world) ? 4 : 1);
  // 面ごとの「主役」チャンク。2回まで出る（面に個性を持たせる）
  const featured = pickWeighted(avail, weight, r);
  const used = new Map<PoolItem, number>();
  let usedSwitch = false;
  const plan: PoolItem[] = [];
  for (const f of fresh) plan.push(f);
  while (plan.length < n) {
    const cand = avail.filter((p) => {
      const u = used.get(p) ?? 0;
      if (p.sw && usedSwitch) return false;
      if (plan[plan.length - 1] === p) return false;
      return u < (p === featured ? 2 : 1);
    });
    if (cand.length === 0) break;
    const p = plan.length === 0 || (r.chance(40) && (used.get(featured) ?? 0) < 2 && !(featured.sw && usedSwitch) && plan[plan.length - 1] !== featured)
      ? (cand.includes(featured) ? featured : pickWeighted(cand, weight, r))
      : pickWeighted(cand, weight, r);
    plan.push(p);
    used.set(p, (used.get(p) ?? 0) + 1);
    if (p.sw) usedSwitch = true;
  }
  // fresh で入れたスイッチ系が重複しないように
  let sw = false;
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    if (p.sw) {
      if (sw) plan.splice(i--, 1);
      sw = true;
    }
  }
  for (const p of plan) {
    p.c(g, lv, r);
    connect(g, lv, r);
  }
  g.flat(3);
  const gx = g.add();
  g.set(gx, g.G - 1, T.GOAL);
  g.set(gx, g.G - 2, T.GOAL);
  g.flat(4);
  return finish(g, stage, 2, G0 - 1, false);
}

function bossStage(): Level {
  const g = new Grid();
  for (let i = 0; i < 30; i++) {
    const x = g.add();
    if (i === 0 || i === 29) for (let y = 0; y < G0; y++) g.set(x, y, T.SOLID);
  }
  g.ents.push({ k: 'boss', x: 22, y: G0 - 1 });
  return finish(g, BOSS_STAGE, 3, G0 - 1, true);
}

/**
 * 80〜200面のデータのハッシュ。ゲームとサーバーでステージが食い違っていないかの確認に使う
 * （手作りステージを変えたのにサーバーを更新し忘れると、正しいクリアが検証失敗になるため）
 */
export function stagesVersion(): string {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    h ^= n & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (let s = 80; s <= TRUE_FINAL_STAGE; s++) {
    const L = getStage(s);
    mix(L.w);
    mix(L.startX);
    mix(L.startY);
    if (s > BOSS_STAGE) {
      // 101面以降は高さ・暗闇・迫る壁も対象
      mix(L.h);
      mix(L.dark ? 1 : 0);
      if (L.chase) for (const c of JSON.stringify(L.chase)) mix(c.charCodeAt(0));
    }
    for (let i = 0; i < L.tiles.length; i++) mix(L.tiles[i]);
    const e = JSON.stringify(L.ents);
    for (let i = 0; i < e.length; i++) mix(e.charCodeAt(i));
  }
  return h.toString(16).padStart(8, '0');
}
