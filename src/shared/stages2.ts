// 101〜200面のステージ。
//
// 1〜100面（stages.ts）は「チャンクを乱数で並べる」生成だが、101面以降は
// 面ごとの設計表（DESIGN）で「面の型・主役のギミック・使う区間（ビート）の並び」を決めておき、
// その通りに組み立てる。乱数は段差の高さや敵の位相などの細部にだけ使う。
// どの端末・サーバーでも同じ番号なら同じステージになる（決定論的）。

import { T } from './constants';
import type { ChaseSpec, EntSpec, Level } from './level';
import { Rng, hashSeed } from './rng';

// ================================================================
// 面の型・ギミック
// ================================================================

/** 面の型（構造） */
export type StageType =
  | 'normal' // 通常の横スクロール
  | 'scroll' // 強制スクロール（背後から壁が迫る）
  | 'climb' // 縦に登る
  | 'precise' // 短い精密面
  | 'rush' // 敵ラッシュ
  | 'puzzle' // パズル（鍵と扉・スイッチ）
  | 'dark'; // 暗闇

export const TYPE_NAMES: Record<StageType, string> = {
  normal: '通常',
  scroll: '強制スクロール',
  climb: '縦に登る',
  precise: '短い精密',
  rush: '敵ラッシュ',
  puzzle: 'パズル',
  dark: '暗闇',
};

/** ギミックの名前（設計表・多様性ツールで使う） */
export const MECH_NAMES = {
  spring: 'バネ',
  wind: '風',
  cloud: '雲の足場',
  ice: '氷の床',
  crusher: '圧殺ブロック',
  icicle: 'つらら',
  conveyor: 'ベルトコンベア',
  laser: 'レーザー',
  saw: '回転ノコギリ',
  dark: '暗闇',
  orb: '空中ジャンプオーブ',
  lava: 'せり上がる溶岩',
  wall: '迫る壁',
  key: '鍵と扉',
  grav: '重力反転',
  // 1〜100面からある要素
  walker: '歩く敵',
  flyer: '飛ぶ敵',
  turret: '砲台',
  crumble: '崩れる床',
  switch: 'スイッチ',
  plat: '移動床',
  spike: 'トゲ',
} as const;
export type Mech = keyof typeof MECH_NAMES;

/** 101面以降で新しく登場するギミック */
export const NEW_MECHS: Mech[] = ['spring', 'wind', 'ice', 'crusher', 'icicle', 'conveyor', 'laser', 'saw', 'dark', 'orb', 'lava', 'wall', 'key', 'grav'];

// ================================================================
// 横スクロール面の組み立て
// ================================================================

class HGrid {
  cols: number[][] = [];
  ents: EntSpec[] = [];
  constructor(
    public H = 17,
    public G = 14, // 現在の地面の上面の行
  ) {}
  get x() {
    return this.cols.length;
  }
  add(top: number | null = this.G): number {
    const c = new Array<number>(this.H).fill(T.EMPTY);
    if (top !== null) for (let y = Math.max(0, top); y < this.H; y++) c[y] = T.SOLID;
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
    if (x >= 0 && x < this.cols.length && y >= 0 && y < this.H) this.cols[x][y] = t;
  }
  get(x: number, y: number): number {
    if (x < 0 || x >= this.cols.length || y < 0 || y >= this.H) return T.EMPTY;
    return this.cols[x][y];
  }
  /** 0行目〜bottom行目を埋める（天井） */
  ceil(x: number, bottom: number) {
    for (let y = 0; y <= bottom; y++) this.cols[x][y] = T.SOLID;
  }
  /** x 列の地面の一番上のタイルを t にする（氷・コンベア・バネ） */
  surface(x: number, t: number) {
    for (let y = 0; y < this.H; y++) {
      if (this.cols[x][y] === T.SOLID) {
        this.cols[x][y] = t;
        return;
      }
    }
  }
  /** 範囲のうち空白のところだけを t で埋める（風ゾーンなど） */
  zone(x0: number, x1: number, y0: number, y1: number, t: number) {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) if (this.get(x, y) === T.EMPTY) this.set(x, y, t);
  }
}

type Beat = (g: HGrid, d: number, r: Rng) => void;

// ---------------- 天空（バネ・風・雲） ----------------

/** バネで高い壁を越える。ジャンプ押しっぱなしで高く跳ぶことを覚える */
const springWall: Beat = (g, d) => {
  const G = g.G;
  g.flat(3);
  g.surface(g.add(), T.SPRING);
  g.flat(1);
  const hw = d >= 2 ? 6 : 5;
  const x0 = g.x;
  g.flat(d >= 1 ? 4 : 5, G - hw);
  if (d >= 2) g.set(x0 + 2, G - hw - 1, T.SPIKE_UP);
  g.flat(3);
};

/** バネで大きな穴を跳び越える */
const springPit: Beat = (g, d) => {
  g.flat(3);
  g.surface(g.add(), T.SPRING);
  g.pit(5);
  if (d >= 1) {
    // 小さな足場をはさんで、もう一度バネ
    g.flat(1);
    g.surface(g.add(), T.SPRING);
    g.pit(d >= 2 ? 5 : 4);
  }
  g.flat(3);
};

/** トゲの天井の下でバネを連続で踏む。ジャンプを押さずに低く跳ぶ */
const springLow: Beat = (g, d) => {
  const G = g.G;
  g.flat(3);
  const n = 2 + Math.min(d, 2);
  for (let i = 0; i < n; i++) {
    const x = g.add();
    g.surface(x, T.SPRING);
    g.ceil(x, G - 6);
    g.set(x, G - 5, T.SPIKE_DOWN);
    for (let k = 0; k < 2; k++) {
      const p = g.add(null);
      g.ceil(p, G - 6);
      g.set(p, G - 5, T.SPIKE_DOWN);
    }
  }
  const x = g.add();
  g.ceil(x, G - 6);
  g.flat(3);
};

/** バネで段々を登っていく */
const springSteps: Beat = (g, d) => {
  const G = g.G;
  g.flat(2);
  g.surface(g.add(), T.SPRING);
  g.flat(1);
  const x1 = g.x;
  g.flat(4, G - 5);
  if (d >= 1) {
    g.surface(x1 + 3, T.SPRING);
    const x2 = g.x;
    g.flat(4, G - 9);
    if (d >= 2) g.set(x2 + 2, G - 10, T.SPIKE_UP);
  } else g.flat(1, G - 5);
  g.flat(3);
};

/** 追い風に乗って広い穴を跳ぶ */
const windTail: Beat = (g, d) => {
  const G = g.G;
  g.flat(3);
  const x0 = g.x;
  const w = d >= 1 ? 6 : 5;
  g.pit(w);
  g.zone(x0 - 2, x0 + w - 1, G - 6, G - 1, T.WIND_R);
  g.flat(3);
};

/** 向かい風の中、トゲを跳び越えて進む（止まると押し戻される） */
const windHead: Beat = (g, d) => {
  const G = g.G;
  g.flat(2);
  const x0 = g.x;
  const n = 2 + Math.min(d, 2);
  for (let i = 0; i < n; i++) {
    g.flat(3);
    const sw = d >= 2 && i % 2 === 1 ? 2 : 1;
    for (let k = 0; k < sw; k++) g.set(g.add(), G - 1, T.SPIKE_UP);
  }
  g.flat(2);
  g.zone(x0, g.x - 1, G - 5, G - 1, T.WIND_L);
  g.flat(2);
};

/** 上昇気流の穴に飛び込んで高い足場へ */
const windLift: Beat = (g, d) => {
  const G = g.G;
  g.flat(2);
  const top = G - (d >= 1 ? 8 : 7); // 着く足場の上面
  const x0 = g.x;
  const w = d >= 2 ? 2 : 3;
  g.pit(w);
  g.zone(x0, x0 + w - 1, top - 1, g.H - 1, T.WIND_U);
  if (d >= 2) {
    // 気流の壁際にトゲ
    for (let y = top + 2; y < G; y++) g.set(x0 - 1, y, T.SPIKE_RIGHT);
  }
  const x1 = g.x;
  g.flat(3, top);
  if (d >= 1) g.set(x1 + 2, top - 1, T.SPIKE_UP);
  g.flat(1, top);
  g.flat(3);
};

/** 向かい風の中、小さな足場を跳び移る */
const windStones: Beat = (g, d) => {
  const G = g.G;
  g.flat(2);
  const x0 = g.x;
  const n = 3 + Math.min(d, 1);
  const sw = d >= 2 ? 1 : 2;
  for (let i = 0; i < n; i++) {
    g.pit(2);
    for (let k = 0; k < sw; k++) g.set(g.add(null), G, T.BRICK);
  }
  g.pit(2);
  g.zone(x0, g.x - 1, G - 5, G - 1, T.WIND_L);
  g.flat(3);
};

/** 雲（すり抜け床）を登り降りして渡る */
const cloudHop: Beat = (g, d, r) => {
  const G = g.G;
  g.flat(2);
  const n = 3 + Math.min(d, 2);
  let row = G - 1;
  for (let i = 0; i < n; i++) {
    g.pit(2 + (d >= 2 && i % 2 ? 1 : 0));
    row = Math.max(G - 5, Math.min(G, row + r.pick([-2, -1, 1, 2])));
    for (let k = 0; k < 3; k++) g.set(g.add(null), row, T.ONEWAY);
  }
  g.pit(2);
  g.flat(2);
};

// ---------------- 氷の宮殿（氷・圧殺ブロック・つらら） ----------------

function iceFlat(g: HGrid, n: number, top = g.G) {
  for (let i = 0; i < n; i++) g.surface(g.add(top), T.ICE);
}

/** すべる床の上を走って穴を跳ぶ */
const iceRun: Beat = (g, d) => {
  const G = g.G;
  g.flat(2);
  const n = 2 + Math.min(d, 2);
  for (let i = 0; i < n; i++) {
    iceFlat(g, 5);
    if (d >= 1 && i % 2 === 1) g.set(g.x - 2, G - 1, T.SPIKE_UP);
    g.pit(2 + (d >= 2 && i === n - 1 ? 1 : 0));
  }
  iceFlat(g, 4);
  g.flat(2);
};

/** すべる小島を跳び移る（着地したらすぐ次へ） */
const iceIslands: Beat = (g, d, r) => {
  const G = g.G;
  g.flat(3);
  const n = 3 + Math.min(d, 2);
  const iw = d >= 2 ? 2 : 3;
  let row = G;
  for (let i = 0; i < n; i++) {
    g.pit(2 + (i % 2));
    row = Math.max(G - 2, Math.min(G, row + r.pick([-1, 0, 1])));
    for (let k = 0; k < iw; k++) g.set(g.add(null), row, T.ICE);
  }
  g.pit(2);
  g.flat(3);
};

/** 氷の階段を下りる（止まれないので勢いのまま） */
const iceStairs: Beat = (g, d) => {
  const G = g.G;
  g.flat(2);
  g.flat(2, G - 1);
  g.flat(2, G - 2);
  const steps = 3 + Math.min(d, 1);
  for (let s = 0; s < steps; s++) {
    iceFlat(g, 3, G - 3 + s);
    if (d >= 1 && s === 1) g.pit(2);
  }
  if (d >= 2) g.set(g.x - 1, G - 1 + steps - 3, T.SPIKE_UP);
  iceFlat(g, 3);
  g.flat(2);
};

/** 天井から圧殺ブロックが落ちてくる通路（止まらずに走り抜ける） */
const crusherHall: Beat = (g, d) => {
  const G = g.G;
  g.flat(2);
  const x0 = g.x;
  const n = 2 + Math.min(d, 2);
  const len = 3 + n * 5;
  for (let i = 0; i < len; i++) g.ceil(g.add(), G - 6);
  for (let i = 0; i < n; i++) g.ents.push({ k: 'crusher', x: x0 + 2 + i * 5, y: G - 5, w: 2 });
  if (d >= 2) for (let i = 0; i < n - 1; i++) g.set(x0 + 5 + i * 5, G - 1, T.SPIKE_UP);
  g.flat(2);
};

/** 段差を下りながら圧殺ブロックをくぐる */
const crusherStairs: Beat = (g, d) => {
  const G = g.G;
  g.flat(1);
  g.flat(2, G - 1);
  g.flat(2, G - 2);
  const n = 2 + Math.min(d, 1);
  for (let s = 0; s < n; s++) {
    const floor = G - 2 + s;
    const x0 = g.x;
    for (let i = 0; i < 5; i++) g.ceil(g.add(floor), floor - 6);
    g.ents.push({ k: 'crusher', x: x0 + 2, y: floor - 5, w: 2 });
  }
  g.flat(3);
};

/** つららの下がる天井の下を走る */
const icicleRun: Beat = (g, d) => {
  const G = g.G;
  g.flat(2);
  const n = 3 + Math.min(d, 2);
  for (let i = 0; i < n; i++) {
    const x = g.add();
    g.ceil(x, G - 7);
    for (let k = 0; k < 3; k++) g.ceil(g.add(), G - 7);
    g.set(x + 1, G - 6, T.ICICLE);
    if (d >= 1 && i % 2 === 1) {
      g.cols[x + 3] = new Array<number>(g.H).fill(T.EMPTY);
      g.ceil(x + 3, G - 7);
    }
    if (d >= 2) g.surface(x + 2, T.ICE);
  }
  g.ceil(g.add(), G - 7);
  g.flat(2);
};

// ---------------- 工場（コンベア・レーザー・ノコギリ） ----------------

/** 逆向き・順向きのベルトコンベアの床を進む */
const convRun: Beat = (g, d) => {
  const G = g.G;
  g.flat(2);
  const n = 2 + Math.min(d, 2);
  for (let i = 0; i < n; i++) {
    const t = i % 2 === 0 ? T.CONV_L : T.CONV_R;
    const x0 = g.x;
    for (let k = 0; k < 5; k++) g.surface(g.add(), t);
    if (t === T.CONV_R && d >= 1) g.set(x0 + 3, G - 1, T.SPIKE_UP);
    g.pit(2 + (d >= 2 && i === n - 1 ? 1 : 0));
  }
  g.flat(3);
};

/** 宙に浮いたコンベアの足場を渡る */
const convIslands: Beat = (g, d, r) => {
  const G = g.G;
  g.flat(3);
  const n = 3 + Math.min(d, 1);
  let row = G - 1;
  for (let i = 0; i < n; i++) {
    g.pit(2 + (d >= 2 ? 1 : 0));
    row = Math.max(G - 3, Math.min(G, row + r.pick([-1, 1])));
    const t = i % 2 === 0 ? T.CONV_R : T.CONV_L;
    for (let k = 0; k < 4; k++) g.set(g.add(null), row, t);
  }
  g.pit(2);
  g.flat(3);
};

/** 天井から床へのレーザーの門。消えている間にくぐる */
const laserGates: Beat = (g, d) => {
  const G = g.G;
  g.flat(2);
  const x0 = g.x;
  const n = 2 + Math.min(d, 2);
  const len = 3 + n * 4;
  for (let i = 0; i < len; i++) g.ceil(g.add(), G - 7);
  const period = d >= 2 ? 96 : 110;
  const on = d >= 2 ? 44 : 40;
  for (let i = 0; i < n; i++) {
    g.ents.push({ k: 'laser', x: x0 + 2 + i * 4, y: G - 7, dx: 0, dy: 1, len: 6, period, on, phase: i * 28 });
  }
  g.flat(2);
};

/** 床すれすれの横レーザー（出たら跳ぶ）と、頭の高さのレーザー（出たら跳ばない） */
const laserHop: Beat = (g, d) => {
  const G = g.G;
  g.flat(2);
  const ex = g.add(G - 1); // 発射口（1段の段差）
  g.flat(7);
  g.ents.push({ k: 'laser', x: ex, y: G - 1, dx: 1, dy: 0, len: 7, period: 110, on: 36, phase: 0 });
  if (d >= 1) {
    const ex2 = g.add(G - 3);
    g.flat(1, G - 3);
    g.flat(7);
    g.ents.push({ k: 'laser', x: ex2 + 1, y: G - 3, dx: 1, dy: 0, len: 7, period: 110, on: 40, phase: 55 });
  }
  g.flat(2);
};

/** 穴の中を上下するノコギリ。下がったときに跳び越える */
const sawPit: Beat = (g, d, r) => {
  const G = g.G;
  g.flat(2);
  const n = 1 + Math.min(d, 2);
  for (let i = 0; i < n; i++) {
    const x0 = g.x;
    g.pit(3);
    g.ents.push({ k: 'saw', x: x0 + 1, y: G - 4, tw: 0, th: 5, speed: d >= 2 ? 160 : 128, phase: r.int(200) });
    g.flat(3);
  }
};

/** 浮いた足場のまわりを回るノコギリ */
const sawOrbit: Beat = (g, d, r) => {
  const G = g.G;
  g.flat(2);
  const n = 1 + Math.min(d, 1);
  for (let i = 0; i < n; i++) {
    const x0 = g.x;
    g.pit(7);
    for (let k = 2; k <= 4; k++) g.set(x0 + k, G - 1, T.BRICK);
    g.ents.push({ k: 'saw', x: x0 + 1, y: G - 2, tw: 4, th: 2, speed: d >= 2 ? 112 : 96, phase: r.int(400) });
    g.flat(2);
  }
  g.flat(1);
};

/** 床を往復するノコギリを跳び越える */
const sawFloor: Beat = (g, d, r) => {
  const G = g.G;
  g.flat(2);
  const x0 = g.x;
  const n = 1 + Math.min(d, 2);
  for (let i = 0; i < n; i++) {
    g.flat(8);
    g.ents.push({ k: 'saw', x: x0 + 1 + i * 8, y: G - 1, tw: 6, th: 0, speed: 128 + d * 16, phase: r.int(300) });
  }
  g.flat(2);
};

// ---------------- 深淵（オーブ・暗闇） ----------------

/** 広い穴の途中のオーブで空中ジャンプ */
const orbGap: Beat = (g, d) => {
  const G = g.G;
  g.flat(3);
  const x0 = g.x;
  const w = d >= 1 ? 7 : 6;
  g.pit(w);
  g.ents.push({ k: 'orb', x: x0 + 2, y: G - 4 });
  g.flat(3);
};

/** オーブを次々に使って長い穴を渡る */
const orbChain: Beat = (g, d) => {
  const G = g.G;
  g.flat(3);
  const x0 = g.x;
  const n = 2 + Math.min(d, 2);
  g.pit(4 + n * 4);
  for (let i = 0; i < n; i++) g.ents.push({ k: 'orb', x: x0 + 2 + i * 4, y: G - 4 });
  g.flat(3);
};

/** オーブで高い壁を越える */
const orbWall: Beat = (g, d) => {
  const G = g.G;
  g.flat(3);
  const x0 = g.x;
  g.flat(3);
  g.ents.push({ k: 'orb', x: x0 + 1, y: G - 4 });
  const hw = d >= 1 ? 6 : 5;
  g.flat(3, G - hw);
  if (d >= 2) {
    for (let y = G - hw + 1; y < G; y++) g.set(x0 + 2, y, T.SPIKE_LEFT);
  }
  g.flat(3);
};

// ---------------- 終焉（鍵と扉・重力反転） ----------------

/** 扉の柱（床から天井まで。下の4マスが扉） */
function doorWall(g: HGrid) {
  const G = g.G;
  const x = g.add();
  g.ceil(x, G - 5);
  for (let y = G - 4; y < G; y++) g.set(x, y, T.DOOR);
}

/** 扉の手前、すり抜け床を登った先に鍵がある */
const keyHigh: Beat = (g, d) => {
  const G = g.G;
  g.flat(2);
  const x0 = g.x;
  g.flat(9);
  const rows = d >= 1 ? [G - 3, G - 6, G - 9] : [G - 3, G - 6];
  rows.forEach((row, i) => {
    const xs = i % 2 === 0 ? x0 + 1 : x0 + 5;
    for (let k = 0; k < 3; k++) g.set(xs + k, row, T.ONEWAY);
  });
  const last = rows.length - 1;
  g.ents.push({ k: 'key', x: last % 2 === 0 ? x0 + 2 : x0 + 6, y: rows[last] - 1 });
  if (d >= 2) g.set(x0 + 4, G - 1, T.SPIKE_UP);
  doorWall(g);
  g.flat(3);
};

/** 鍵は下の部屋。穴から落ちて拾い、すり抜け床を下から跳んで戻る */
const keyLow: Beat = (g, d) => {
  const G = g.G;
  g.flat(2);
  g.flat(4, G - 1); // 一段高い道
  const room = g.x;
  for (let k = 0; k < 4; k++) g.add(G + 2);
  for (const k of [0, 1, 3]) g.set(room + k, G - 1, T.ONEWAY);
  g.ents.push({ k: 'key', x: room + 1, y: G + 1 });
  if (d >= 1) g.set(room + 3, G + 1, T.SPIKE_UP);
  g.flat(3, G - 1);
  g.G = G - 1;
  doorWall(g);
  g.G = G;
  g.flat(3);
};

/** 重力反転ゾーンで天井を歩いて穴を渡る */
const gravCeil: Beat = (g, d) => {
  const G = g.G;
  g.flat(2);
  const z = g.add();
  g.ceil(z, G - 7);
  for (let y = G - 5; y < G; y++) g.set(z, y, T.GRAV_UP);
  const len = 7 + Math.min(d, 2) * 2;
  const x0 = g.x;
  for (let i = 0; i < len; i++) g.ceil(g.add(null), G - 7);
  // 天井側の障害物（反転中に下へ跳び越える）
  if (d >= 1) g.set(x0 + 3, G - 6, T.SPIKE_DOWN);
  if (d >= 2) g.set(x0 + 7, G - 6, T.SPIKE_DOWN);
  const z2 = g.add();
  g.ceil(z2, G - 7);
  for (let y = G - 6; y < G; y++) g.set(z2, y, T.GRAV_DOWN);
  g.flat(3);
};

/** 床と天井を行き来する（反転ゾーンが交互に並ぶ） */
const gravWeave: Beat = (g, d) => {
  const G = g.G;
  g.flat(2);
  const n = 2 + Math.min(d, 1);
  for (let i = 0; i < n; i++) {
    // 床側: 天井にトゲ、床に穴
    const a = g.add();
    g.ceil(a, G - 7);
    for (let y = G - 5; y < G; y++) g.set(a, y, T.GRAV_UP);
    for (let k = 0; k < 3; k++) {
      const x = g.add(null);
      g.ceil(x, G - 7);
    }
    // 天井側の道。終わりで重力を戻す
    const b = g.add();
    g.ceil(b, G - 7);
    for (let y = G - 6; y < G; y++) g.set(b, y, T.GRAV_DOWN);
    // 床の道。天井にトゲが並ぶ
    for (let k = 0; k < 3; k++) {
      const x = g.add();
      g.ceil(x, G - 7);
      g.set(x, G - 6, T.SPIKE_DOWN);
    }
    if (d >= 2) g.set(g.x - 2, G - 1, T.SPIKE_UP);
  }
  g.flat(3);
};

// ---------------- 1〜100面からある要素（組み合わせ用） ----------------

const walkerGroup: Beat = (g, d, r) => {
  const G = g.G;
  const x0 = g.x;
  g.flat(12);
  const n = 2 + Math.min(d, 2);
  for (let i = 0; i < n; i++) g.ents.push({ k: 'walker', x: x0 + 4 + i * 3, y: G - 1, dir: r.chance(50) ? -1 : 1 });
  if (d >= 2) for (let x = x0 + 4; x < x0 + 9; x++) g.set(x, G - 4, T.BRICK);
  g.flat(1);
};

const flyerPit: Beat = (g, d, r) => {
  const G = g.G;
  g.flat(2);
  const n = 1 + Math.min(d, 2);
  for (let i = 0; i < n; i++) {
    const x = g.x;
    g.pit(4);
    g.ents.push({ k: 'flyer', x: x + 2, y: G - 5, range: 4, speed: 128 + d * 32, phase: r.int(256) });
    g.flat(2);
  }
};

const turretRow: Beat = (g, d, r) => {
  const G = g.G;
  g.flat(8);
  const tx = g.add();
  g.set(tx, G - 1, T.TURRET);
  const period = d >= 2 ? 80 : 100;
  g.ents.push({ k: 'turret', x: tx, y: G - 1, dir: -1, period, phase: r.int(period), speed: 352 });
  if (d >= 1) {
    g.flat(5);
    const t2 = g.add(G - 1);
    g.set(t2, G - 2, T.TURRET);
    g.ents.push({ k: 'turret', x: t2, y: G - 2, dir: -1, period: 110, phase: r.int(110), speed: 320 });
    g.flat(2, G - 1);
  }
  g.flat(2);
};

const crumbleRun: Beat = (g, d) => {
  const G = g.G;
  g.flat(2);
  const n = 5 + Math.min(d, 2) * 2;
  for (let i = 0; i < n; i++) g.set(g.add(null), G, T.CRUMBLE);
  g.flat(2);
};

const platRide: Beat = (g, d, r) => {
  const G = g.G;
  g.flat(2);
  const range = 4 + Math.min(d, 1);
  const start = g.x;
  g.pit(range + 4);
  g.ents.push({ k: 'platH', x: start, y: G, w: 2, range, speed: 160, phase: r.int(240) });
  g.flat(2);
};

const spikeHop: Beat = (g, d) => {
  const G = g.G;
  g.flat(2);
  const n = 3 + Math.min(d, 2);
  for (let i = 0; i < n; i++) {
    const sw = d >= 2 && i % 2 ? 2 : 1;
    for (let k = 0; k < sw; k++) g.set(g.add(), G - 1, T.SPIKE_UP);
    g.flat(1);
  }
  g.flat(1);
};

const gapRun: Beat = (g, d) => {
  g.flat(2);
  const n = 2 + Math.min(d, 2);
  for (let i = 0; i < n; i++) {
    g.pit(2 + (i % 2) + (d >= 2 ? 1 : 0));
    g.flat(2);
  }
};

/** スイッチで橋（Bブロック）を出し、壁（Aブロック）を消す */
const switchBridge: Beat = (g, d) => {
  const G = g.G;
  g.flat(2);
  g.set(g.add(), G - 1, T.SWITCH);
  g.flat(2);
  for (let i = 0; i < 2; i++) {
    const x = g.add();
    for (let y = G - 6; y <= G - 1; y++) g.set(x, y, T.ABLOCK);
    g.ceil(x, G - 7);
  }
  const p = 3 + Math.min(d, 1);
  for (let i = 0; i < p; i++) g.set(g.add(null), G, T.BBLOCK);
  g.flat(2);
};

/** 2つ目のスイッチで元に戻す（Aの橋を渡る） */
const switchBack: Beat = (g, d) => {
  const G = g.G;
  g.flat(1);
  g.set(g.add(), G - 1, T.SWITCH);
  g.flat(1);
  const p = 3 + Math.min(d, 1);
  for (let i = 0; i < p; i++) g.set(g.add(null), G, T.ABLOCK);
  g.flat(2);
};

/** 地面の高さを変える（つなぎ） */
function shiftGround(g: HGrid, dy: number) {
  const ng = Math.max(9, Math.min(14, g.G + dy));
  if (ng === g.G) return;
  g.G = ng;
  g.flat(2);
}

const BEATS: Record<string, Beat> = {
  springWall,
  springPit,
  springLow,
  springSteps,
  windTail,
  windHead,
  windLift,
  windStones,
  cloudHop,
  iceRun,
  iceIslands,
  iceStairs,
  crusherHall,
  crusherStairs,
  icicleRun,
  convRun,
  convIslands,
  laserGates,
  laserHop,
  sawPit,
  sawOrbit,
  sawFloor,
  orbGap,
  orbChain,
  orbWall,
  keyHigh,
  keyLow,
  gravCeil,
  gravWeave,
  walkerGroup,
  flyerPit,
  turretRow,
  crumbleRun,
  platRide,
  spikeHop,
  gapRun,
  switchBridge,
  switchBack,
};

// ================================================================
// 縦に登る面の組み立て（下から上へ。u = 下からの行番号）
// ================================================================

class Tower {
  rows: number[][] = []; // rows[u][x]
  ents: { e: EntSpec; u: number; ub?: number }[] = []; // u: e.y の代わりの行（下から）
  u = 2; // プレイヤーが立つ行（床の1つ上）
  x = 3; // プレイヤーが立つ列
  constructor(public W = 24) {
    this.ensure(4);
    for (let u = 0; u < 2; u++) for (let x = 0; x < W; x++) this.rows[u][x] = T.SOLID;
  }
  ensure(u: number) {
    while (this.rows.length <= u) {
      const r = new Array<number>(this.W).fill(T.EMPTY);
      r[0] = T.SOLID;
      r[this.W - 1] = T.SOLID;
      this.rows.push(r);
    }
  }
  set(x: number, u: number, t: number) {
    if (x <= 0 || x >= this.W - 1 || u < 0) return;
    this.ensure(u);
    this.rows[u][x] = t;
  }
  get(x: number, u: number): number {
    if (u < 0 || u >= this.rows.length) return T.EMPTY;
    return this.rows[u][x];
  }
  /** 床のタイル列 [x0, x1] を行 u に置き、その上（u+1）に立てる */
  ledge(x0: number, x1: number, u: number, t: number = T.ONEWAY) {
    for (let x = x0; x <= x1; x++) this.set(x, u, t);
  }
  ent(e: EntSpec, u: number) {
    this.ents.push({ e, u });
  }
  /** 左右の壁沿いで、x0..x1 が内側に収まるよう補正 */
  clampX(x: number, w: number): number {
    return Math.max(1, Math.min(this.W - 1 - w, x));
  }
}

type Band = (t: Tower, d: number, r: Rng) => void;

/** 次の足場の左端を、今の位置から左右に振って決める */
function stepX(t: Tower, w: number, r: Rng, min = 3, max = 5): number {
  const dir = t.x + 2 > t.W / 2 ? -1 : 1;
  const flip = r.chance(25) ? -dir : dir;
  let nx = t.x + flip * r.range(min, max) - (flip < 0 ? w - 1 : 0);
  nx = t.clampX(nx, w);
  if (Math.abs(nx - t.x) < 2 && Math.abs(nx + w - 1 - t.x) < 2) nx = t.clampX(t.x + (dir > 0 ? 3 : -2 - w), w);
  return nx;
}

/** すり抜け床（雲）のジグザグ */
const tZig: Band = (t, d, r) => {
  const n = 3 + Math.min(d, 2);
  const w = d >= 2 ? 3 : 4;
  for (let i = 0; i < n; i++) {
    const nx = stepX(t, w, r);
    const nu = t.u + (d >= 1 ? 3 : 2);
    t.ledge(nx, nx + w - 1, nu - 1);
    t.u = nu;
    t.x = nx + (w >> 1);
  }
};

/** バネのはしご（固い足場の真ん中にバネ） */
const tSpring: Band = (t, d, r) => {
  const n = 2 + Math.min(d, 2);
  // 今の足場にバネを置く
  const sx = t.x + (t.x + 1 < t.W - 2 ? 1 : -1);
  t.set(sx, t.u - 1, T.SPRING);
  let cur = sx;
  for (let i = 0; i < n; i++) {
    const nu = t.u + 5;
    const dir = cur > t.W / 2 ? -1 : 1;
    const nx = t.clampX(dir > 0 ? cur + 3 : cur - 5, 3);
    t.ledge(nx, nx + 2, nu - 1, T.SOLID);
    t.u = nu;
    if (i < n - 1) {
      const s2 = dir > 0 ? nx + 2 : nx;
      t.set(s2, nu - 1, T.SPRING);
      cur = s2;
      t.x = dir > 0 ? nx : nx + 2;
    } else t.x = nx + 1;
    if (d >= 2 && i === 1) t.set(dir > 0 ? nx + 1 : nx + 1, nu + 3, T.SPIKE_DOWN);
  }
  void r;
};

/** 上昇気流の縦穴 */
const tWind: Band = (t, d, r) => {
  const h = 8 + Math.min(d, 2) * 2;
  const right = t.x + 4 < t.W - 1;
  const cx = right ? t.x + 2 : t.x - 3; // 気流の左端
  const u0 = t.u;
  const u1 = t.u + h; // 気流の最上段
  for (let u = u0; u <= u1; u++) {
    t.set(cx, u, T.WIND_U);
    t.set(cx + 1, u, T.WIND_U);
  }
  if (d >= 1) {
    // 気流の反対側の壁にトゲ
    const sx = right ? cx + 2 : cx - 1;
    for (let u = u0 + 3; u <= u1 - 3; u++) t.set(sx, u, right ? T.SPIKE_LEFT : T.SPIKE_RIGHT);
  }
  // 最上段の横に足場（気流の上端の1つ下が床）
  const lx = right ? t.clampX(cx + 2, 3) : t.clampX(cx - 3, 3);
  t.ledge(lx, lx + 2, u1 - 1, T.SOLID);
  t.u = u1;
  t.x = lx + 1;
  void r;
};

/** 氷の足場（固い）を斜めに登る */
const tIce: Band = (t, d, r) => {
  const n = 3 + Math.min(d, 2);
  for (let i = 0; i < n; i++) {
    const nx = stepX(t, 3, r, 3, 4);
    const nu = t.u + 2;
    t.ledge(nx, nx + 2, nu - 1, T.ICE);
    t.u = nu;
    t.x = nx + 1;
  }
};

/** コンベアの足場（固い）を登る */
const tConv: Band = (t, d, r) => {
  const n = 3 + Math.min(d, 2);
  for (let i = 0; i < n; i++) {
    const nx = stepX(t, 4, r, 3, 4);
    const nu = t.u + 2;
    t.ledge(nx, nx + 3, nu - 1, nx > t.x ? T.CONV_L : T.CONV_R);
    t.u = nu;
    t.x = nx + 1;
  }
};

/** 足場の間を横切るノコギリ */
const tSaw: Band = (t, d, r) => {
  const n = 3 + Math.min(d, 1);
  for (let i = 0; i < n; i++) {
    const nx = stepX(t, 4, r);
    const nu = t.u + 3;
    t.ledge(nx, nx + 3, nu - 1);
    if (i % 2 === 1 || d >= 2) t.ent({ k: 'saw', x: 2, y: 0, tw: t.W - 5, th: 0, speed: 112 + d * 16, phase: r.int(600) }, nu + 1);
    t.u = nu;
    t.x = nx + 1;
  }
};

/** 縦穴を横切るレーザー */
const tLaser: Band = (t, d, r) => {
  const n = 3 + Math.min(d, 1);
  for (let i = 0; i < n; i++) {
    const nx = stepX(t, 4, r);
    const nu = t.u + 3;
    t.ledge(nx, nx + 3, nu - 1);
    if (i % 2 === 0) t.ent({ k: 'laser', x: 0, y: 0, dx: 1, dy: 0, len: t.W - 2, period: 120, on: 40, phase: i * 30 + r.int(20) }, nu - 2);
    t.u = nu;
    t.x = nx + 1;
  }
};

/** オーブで2段ジャンプして登る */
const tOrb: Band = (t, d, r) => {
  const n = 2 + Math.min(d, 2);
  for (let i = 0; i < n; i++) {
    const dir = t.x > t.W / 2 ? -1 : 1;
    const ox = t.clampX(t.x + dir * 2, 1);
    t.ent({ k: 'orb', x: ox, y: 0 }, t.u + 3);
    const nx = t.clampX(dir > 0 ? t.x + 3 : t.x - 6, 4);
    const nu = t.u + 6;
    t.ledge(nx, nx + 3, nu - 1);
    t.u = nu;
    t.x = nx + 1 + (dir > 0 ? 1 : 0);
  }
  void r;
};

/** 崩れる足場を急いで登る */
const tCrumble: Band = (t, d, r) => {
  const n = 3 + Math.min(d, 2);
  for (let i = 0; i < n; i++) {
    const nx = stepX(t, 3, r, 3, 4);
    const nu = t.u + 2;
    t.ledge(nx, nx + 2, nu - 1, T.CRUMBLE);
    t.u = nu;
    t.x = nx + 1;
  }
};

/** 縦移動床に乗って登る */
const tLift: Band = (t, d, r) => {
  const right = t.x + 6 < t.W - 1;
  const px = right ? t.x + 2 : t.x - 3;
  const range = 6 + Math.min(d, 1) * 2;
  t.ent({ k: 'platV', x: px, y: 0, w: 2, range, speed: 112 + d * 16, phase: r.int(200) }, t.u - 1);
  const nu = t.u + range;
  const lx = right ? t.clampX(px + 3, 3) : t.clampX(px - 4, 3);
  t.ledge(lx, lx + 2, nu - 1, T.SOLID);
  t.u = nu;
  t.x = lx + 1;
};

/** 足場の上につらら */
const tIcicle: Band = (t, d, r) => {
  const n = 3 + Math.min(d, 1);
  for (let i = 0; i < n; i++) {
    const nx = stepX(t, 4, r);
    const nu = t.u + 3;
    t.ledge(nx, nx + 3, nu - 1, T.SOLID);
    t.set(nx + 1 + (i % 2), nu + 4, T.SOLID);
    t.set(nx + 1 + (i % 2), nu + 3, T.ICICLE);
    t.u = nu;
    t.x = nx + (i % 2 ? 0 : 3);
  }
};

const BANDS: Record<string, Band> = { tZig, tSpring, tWind, tIce, tConv, tSaw, tLaser, tOrb, tCrumble, tLift, tIcicle };

// ================================================================
// 設計表
// ================================================================

export interface StageDesign {
  type: StageType;
  star: Mech; // 主役のギミック
  beats: string[]; // 区間（ビート）の並び。"名前.難しさ"（難しさ 0〜3）
  dark?: boolean;
  chase?: ChaseSpec;
  note: string;
}

const D = (type: StageType, star: Mech, beats: string, note: string, extra: Partial<StageDesign> = {}): StageDesign => ({
  type,
  star,
  beats: beats.split(' ').filter(Boolean),
  note,
  ...extra,
});
const wall = (speed: number, delay = 150): ChaseSpec => ({ dir: 'right', speed, delay });
const lava = (speed: number, delay = 180): ChaseSpec => ({ dir: 'up', speed, delay });

/** 101〜199面の設計表（index 0 = 101面） */
export const DESIGN: StageDesign[] = [];

export function designOf(stage: number): StageDesign | null {
  return stage >= 101 && stage <= 199 ? DESIGN[stage - 101] ?? null : null;
}

// ================================================================
// 生成
// ================================================================

function parseBeat(s: string): [string, number] {
  const [n, dd] = s.split('.');
  return [n, dd === undefined ? 0 : Number(dd)];
}

export function buildDesigned(stage: number, world: number): Level {
  return buildFromDesign(stage, world, designOf(stage)!);
}

export function buildFromDesign(stage: number, world: number, ds: StageDesign): Level {
  const r = new Rng(hashSeed(stage, 0x51ed270b));
  return ds.type === 'climb' ? buildTower(stage, world, ds, r) : buildRun(stage, world, ds, r);
}

function buildRun(stage: number, world: number, ds: StageDesign, r: Rng): Level {
  const g = new HGrid();
  g.flat(6);
  ds.beats.forEach((b, i) => {
    if (b === 'up') return shiftGround(g, -2);
    if (b === 'down') return shiftGround(g, 2);
    const [name, d] = parseBeat(b);
    const fn = BEATS[name];
    if (!fn) throw new Error(`unknown beat ${name} (stage ${stage})`);
    fn(g, d, r);
    if (i < ds.beats.length - 1) g.flat(1 + r.int(2));
  });
  g.flat(3);
  const gx = g.add();
  g.set(gx, g.G - 1, T.GOAL);
  g.set(gx, g.G - 2, T.GOAL);
  g.flat(4);
  const w = g.cols.length;
  const H = g.H;
  const tiles = new Uint8Array(w * H);
  for (let x = 0; x < w; x++) for (let y = 0; y < H; y++) tiles[y * w + x] = g.cols[x][y];
  const L: Level = { stage, world, w, h: H, tiles, ents: g.ents, startX: 2, startY: 13, boss: false };
  if (ds.dark) L.dark = true;
  if (ds.chase) L.chase = { ...ds.chase };
  return L;
}

function buildTower(stage: number, world: number, ds: StageDesign, r: Rng): Level {
  const t = new Tower();
  const sx = t.x;
  for (const b of ds.beats) {
    const [name, d] = parseBeat(b);
    const fn = BANDS[name];
    if (!fn) throw new Error(`unknown band ${name} (stage ${stage})`);
    fn(t, d, r);
  }
  // ゴールの足場
  const gx = t.clampX(t.x + (t.x > t.W / 2 ? -5 : 3), 4);
  const gu = t.u + 2;
  t.ledge(gx, gx + 3, gu - 1, T.SOLID);
  t.set(gx + 2, gu, T.GOAL);
  t.set(gx + 2, gu + 1, T.GOAL);
  t.ensure(gu + 6);
  const H = t.rows.length;
  const W = t.W;
  const tiles = new Uint8Array(W * H);
  for (let u = 0; u < H; u++) for (let x = 0; x < W; x++) tiles[(H - 1 - u) * W + x] = t.rows[u][x];
  const ents: EntSpec[] = t.ents.map(({ e, u }) => ({ ...e, y: H - 1 - u }) as EntSpec);
  const L: Level = { stage, world, w: W, h: H, tiles, ents, startX: sx, startY: H - 3, boss: false };
  if (ds.dark) L.dark = true;
  if (ds.chase) L.chase = { ...ds.chase };
  return L;
}

/** 200面: 真の最終ボスの闘技場 */
export function finalBossStage(stage: number, world: number): Level {
  const w = 30;
  const H = 17;
  const tiles = new Uint8Array(w * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < w; x++) {
      let t: number = T.EMPTY;
      if (y >= 14) t = T.SOLID;
      else if (x === 0 || x === w - 1) t = T.SOLID;
      else if (y === 11 && ((x >= 5 && x <= 8) || (x >= 21 && x <= 24))) t = T.ONEWAY;
      tiles[y * w + x] = t;
    }
  }
  return { stage, world, w, h: H, tiles, ents: [{ k: 'fboss', x: 13, y: 3 }], startX: 3, startY: 13, boss: true };
}

void D;
void wall;
void lava;
