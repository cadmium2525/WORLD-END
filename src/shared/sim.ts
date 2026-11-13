// 決定論的ゲームシミュレーション。
// ・整数演算のみ（Math.sin 等は使わない）
// ・1フレーム = 1/60 秒固定
// 同じステージ・同じ入力列なら、ブラウザでも Cloudflare Workers でも必ず同じ結果になる。
// これにより、サーバー側でプレイ記録（入力ログ）を再生してクリアの正当性を検証できる。

import {
  ACC_AIR,
  ACC_GROUND,
  COYOTE,
  CRUMBLE_DELAY,
  CRUMBLE_RESPAWN,
  DEC_AIR,
  DEC_GROUND,
  G_FALL,
  G_HOLD,
  IN_JUMP,
  IN_LEFT,
  IN_RIGHT,
  JUMP_BUFFER,
  JUMP_V,
  MAX_FALL,
  PH,
  PW,
  RUN_MAX,
  STOMP_BOUNCE,
  SUB,
  T,
  TS,
} from './constants';
import type { Level } from './level';

const px = (n: number) => n * SUB;

export interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  onGround: boolean;
  coyote: number;
  jumpBuf: number;
  prevIn: number;
  facing: 1 | -1;
  ride: number; // 乗っている移動床の ents インデックス（-1 = なし）
  // ---- 101面以降 ----
  grav: 1 | -1; // 重力の向き（-1 = 天井へ落ちる）
  air: number; // オーブで得た空中ジャンプの回数
  surf: number; // 足元の床の種類（SURF_*）
}

/** 足元の床の種類 */
export const SURF_NORMAL = 0;
export const SURF_ICE = 1;
export const SURF_CONV_L = 2;
export const SURF_CONV_R = 3;

// ---- 101面以降の新ギミックの定数（サブピクセル・フレーム単位の整数） ----
export const SPRING_V = 1700; // バネの初速（ジャンプ押しっぱなしで約7タイル）
export const WIND_PUSH = 176; // 横風で流される量 /f
export const WIND_UP_ACC = 224; // 上昇気流の加速 /f
export const WIND_UP_MAX = 720; // 上昇気流の最高速度
export const ACC_ICE = 12; // 氷の上の加速
export const DEC_ICE = 8; // 氷の上の減速
export const CONV_SPEED = 160; // ベルトコンベアで流される量 /f
export const ICICLE_SHAKE = 18; // つららが揺れてから落ちるまで
export const ORB_RESPAWN = 150; // オーブが復活するまで
export const LASER_WARN = 30; // レーザーの予兆の長さ
export const CRUSHER_SHAKE = 16; // 圧殺ブロックが揺れてから落ちるまで

export const E_WALKER = 0;
export const E_FLYER = 1;
export const E_TURRET = 2;
export const E_PLAT_H = 3;
export const E_PLAT_V = 4;
export const E_CRUSHER = 5;
export const E_LASER = 6;
export const E_SAW = 7;
export const E_ORB = 8;
export const E_KEY = 9;

export interface Ent {
  kind: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  alive: boolean;
  active: boolean;
  // 種別ごとのパラメータ
  ox: number; // 原点 x
  oy: number; // 原点 y
  range: number; // 往復距離（サブピクセル）
  speed: number;
  phase: number;
  period: number;
  dir: number;
  dx: number; // このフレームの移動量（移動床）
  dy: number;
  st: number; // 101面以降のギミックの状態（圧殺ブロックの段階など）
  tm: number; // 同・タイマー
}

export const B_TURRET = 0;
export const B_BOSS = 1;
export const B_WAVE = 2;
export const B_RAIN = 3;
export const B_ICICLE = 4;
export const B_FRAIN = 5; // 最終ボスの落下弾

export interface Bullet {
  kind: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
}

export type BossState =
  | 'intro'
  | 'tele_charge'
  | 'charge'
  | 'tele_shoot'
  | 'shoot'
  | 'tele_leap'
  | 'leap'
  | 'tele_rain'
  | 'idle'
  | 'stun'
  | 'recover'
  | 'dying'
  | 'dead';

export interface Boss {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  state: BossState;
  timer: number;
  patIdx: number;
  dir: number;
  shots: number;
  targetX: number;
  rainCols: number[];
}

export const BOSS_HP = 6;
const BOSS_G = 48;
const PAT1 = ['charge', 'shoot', 'leap'] as const;
const PAT2 = ['rain', 'charge', 'leap', 'shoot', 'charge'] as const;

// ---------- 200面 真の最終ボス ----------
export type FBossState =
  | 'intro'
  | 'hover'
  | 'tele_slam'
  | 'slam'
  | 'stun'
  | 'recover'
  | 'tele_beam'
  | 'beam'
  | 'tele_pillar'
  | 'pillar'
  | 'tele_rain'
  | 'transform'
  | 'dying'
  | 'dead';

export interface FBoss {
  x: number;
  y: number;
  w: number;
  h: number;
  vy: number;
  hp: number;
  maxHp: number;
  form: number; // 1..3（体力が減るごとに形態が変わる）
  state: FBossState;
  timer: number;
  patIdx: number;
  targetX: number;
  beamHigh: boolean; // 光線が高い位置か（高い＝床にいる／低い＝跳ぶか足場へ）
  cols: number[]; // 柱・落下弾の列
}

export const FBOSS_HP = 9;
export const FBOSS_W = 48 * SUB;
export const FBOSS_H = 40 * SUB;
export const FB_FLOOR = 14 * TS; // 床の上面
export const FB_HOVER_Y = 3 * TS;
/** 光線の位置（上端・高さ） */
export const FB_BEAM_LOW: [number, number] = [FB_FLOOR - 12 * SUB, 8 * SUB];
export const FB_BEAM_HIGH: [number, number] = [10 * TS, 8 * SUB];
export const FB_PILLAR_H = 40 * SUB;
const FPAT: readonly (readonly string[])[] = [
  ['beamLow', 'slam'],
  ['pillar', 'slam', 'beamHigh', 'beamLow', 'slam'],
  ['rain', 'beamHigh', 'slam', 'pillar', 'beamLow', 'slam'],
];

export interface SimOptions {
  invincible?: boolean; // デバッグ専用（サーバーは使わない）
}

export class Sim {
  level!: Level;
  frame = 0;
  p!: Player;
  prevY = 0;
  ents: Ent[] = [];
  bullets: Bullet[] = [];
  tstate!: Int16Array; // 崩れる床・トラップの状態
  special: number[] = []; // 崩れる床・トラップのタイル index
  switchOn = false;
  latch = false;
  dead = false;
  cleared = false;
  boss: Boss | null = null;
  events: string[] = [];
  invincible = false;
  // ---- 101面以降 ----
  keys = 0; // 持っている鍵の数
  chase = 0; // 迫る壁の右端 x ／ せり上がる溶岩の上面 y（サブピクセル）
  fboss: FBoss | null = null;
  doorGroup: Int16Array | null = null; // タイル index → 扉のまとまり番号（-1 = 扉ではない）。不変なので clone で共有
  doorTiles: number[][] = []; // まとまりごとの扉タイル index。不変なので共有

  constructor(level?: Level, opts: SimOptions = {}) {
    if (!level) return; // clone 用
    this.level = level;
    this.invincible = !!opts.invincible;
    this.tstate = new Int16Array(level.w * level.h);
    let hasDoor = false;
    for (let i = 0; i < level.tiles.length; i++) {
      const t = level.tiles[i];
      if (t === T.CRUMBLE || t === T.TRAP || t === T.ICICLE) this.special.push(i);
      if (t === T.DOOR) hasDoor = true;
    }
    if (hasDoor) this.buildDoors();
    if (level.chase) this.chase = level.chase.dir === 'right' ? -2 * TS : (level.h + 1) * TS;
    this.p = {
      x: level.startX * TS + (TS - PW) / 2,
      y: (level.startY + 1) * TS - PH,
      vx: 0,
      vy: 0,
      onGround: true,
      coyote: 0,
      jumpBuf: 0,
      prevIn: 0,
      facing: 1,
      ride: -1,
      grav: 1,
      air: 0,
      surf: SURF_NORMAL,
    };
    for (const s of level.ents) {
      const e: Ent = {
        kind: 0,
        x: s.x * TS,
        y: s.y * TS,
        vx: 0,
        vy: 0,
        w: TS,
        h: TS,
        alive: true,
        active: false,
        ox: s.x * TS,
        oy: s.y * TS,
        range: 0,
        speed: 0,
        phase: 0,
        period: 0,
        dir: 1,
        dx: 0,
        dy: 0,
        st: 0,
        tm: 0,
      };
      switch (s.k) {
        case 'walker':
          e.kind = E_WALKER;
          e.w = px(12);
          e.h = px(12);
          e.x = s.x * TS + px(2);
          e.y = (s.y + 1) * TS - e.h;
          e.dir = s.dir;
          break;
        case 'flyer':
          e.kind = E_FLYER;
          e.w = px(12);
          e.h = px(10);
          e.x = e.ox = s.x * TS + px(2);
          e.oy = s.y * TS + px(3);
          e.range = s.range * TS;
          e.speed = s.speed;
          e.phase = s.phase;
          break;
        case 'turret':
          e.kind = E_TURRET;
          e.dir = s.dir;
          e.period = s.period;
          e.phase = s.phase;
          e.speed = s.speed;
          break;
        case 'platH':
        case 'platV':
          e.kind = s.k === 'platH' ? E_PLAT_H : E_PLAT_V;
          e.w = s.w * TS;
          e.h = px(6);
          e.oy = s.y * TS;
          e.range = s.range * TS;
          e.speed = s.speed;
          e.phase = s.phase;
          break;
        case 'boss':
          this.boss = {
            x: s.x * TS,
            y: (s.y + 1) * TS - px(32),
            vx: 0,
            vy: 0,
            w: px(32),
            h: px(32),
            hp: BOSS_HP,
            maxHp: BOSS_HP,
            state: 'intro',
            timer: 100,
            patIdx: 0,
            dir: -1,
            shots: 0,
            targetX: 0,
            rainCols: [],
          };
          continue;
        case 'crusher':
          e.kind = E_CRUSHER;
          e.w = s.w * TS;
          e.h = 2 * TS;
          break;
        case 'laser': {
          // 光線の当たり判定（幅6px）を前もって計算しておく
          e.kind = E_LASER;
          e.period = s.period;
          e.phase = s.phase;
          e.range = s.on;
          const bw = px(6);
          const half = (TS - bw) / 2;
          const len = s.len * TS;
          if (s.dx !== 0) {
            e.w = len;
            e.h = bw;
            e.x = s.dx > 0 ? (s.x + 1) * TS : s.x * TS - len;
            e.y = s.y * TS + half;
          } else {
            e.w = bw;
            e.h = len;
            e.x = s.x * TS + half;
            e.y = s.dy > 0 ? (s.y + 1) * TS : s.y * TS - len;
          }
          e.dir = s.dx !== 0 ? (s.dx > 0 ? 1 : 3) : s.dy > 0 ? 2 : 0; // 0上 1右 2下 3左
          break;
        }
        case 'saw':
          // range = 軌道の幅、period = 軌道の高さ（どちらもサブピクセル）
          e.kind = E_SAW;
          e.w = px(12);
          e.h = px(12);
          e.ox = s.x * TS + TS / 2;
          e.oy = s.y * TS + TS / 2;
          e.range = s.tw * TS;
          e.period = s.th * TS;
          e.speed = s.speed;
          e.phase = s.phase;
          break;
        case 'orb':
          e.kind = E_ORB;
          e.w = px(12);
          e.h = px(12);
          e.x = s.x * TS + px(2);
          e.y = s.y * TS + px(2);
          break;
        case 'key':
          e.kind = E_KEY;
          e.w = px(10);
          e.h = px(12);
          e.x = s.x * TS + px(3);
          e.y = s.y * TS + px(2);
          break;
        case 'fboss':
          this.fboss = {
            x: s.x * TS,
            y: FB_HOVER_Y,
            w: FBOSS_W,
            h: FBOSS_H,
            vy: 0,
            hp: FBOSS_HP,
            maxHp: FBOSS_HP,
            form: 1,
            state: 'intro',
            timer: 150,
            patIdx: 0,
            targetX: s.x * TS,
            beamHigh: false,
            cols: [],
          };
          continue;
      }
      this.ents.push(e);
    }
    this.placePlatforms(0);
    this.placeSaws(0);
    for (const e of this.ents) {
      e.dx = 0;
      e.dy = 0;
    }
  }

  /** つながった扉タイルをまとめる（4近傍の塗りつぶし） */
  private buildDoors() {
    const L = this.level;
    const g = new Int16Array(L.w * L.h).fill(-1);
    for (let i = 0; i < L.tiles.length; i++) {
      if (L.tiles[i] !== T.DOOR || g[i] >= 0) continue;
      const id = this.doorTiles.length;
      const list: number[] = [];
      const stack = [i];
      g[i] = id;
      while (stack.length) {
        const j = stack.pop()!;
        list.push(j);
        const x = j % L.w;
        const nb = [x > 0 ? j - 1 : -1, x < L.w - 1 ? j + 1 : -1, j - L.w, j + L.w];
        for (const k of nb) {
          if (k < 0 || k >= L.tiles.length || g[k] >= 0 || L.tiles[k] !== T.DOOR) continue;
          g[k] = id;
          stack.push(k);
        }
      }
      this.doorTiles.push(list);
    }
    this.doorGroup = g;
  }

  clone(): Sim {
    const s = new Sim();
    s.level = this.level;
    s.frame = this.frame;
    s.p = { ...this.p };
    s.prevY = this.prevY;
    s.ents = this.ents.map((e) => ({ ...e }));
    s.bullets = this.bullets.map((b) => ({ ...b }));
    s.tstate = this.tstate.slice();
    s.special = this.special;
    s.switchOn = this.switchOn;
    s.latch = this.latch;
    s.dead = this.dead;
    s.cleared = this.cleared;
    s.boss = this.boss ? { ...this.boss, rainCols: this.boss.rainCols.slice() } : null;
    s.events = [];
    s.invincible = this.invincible;
    s.keys = this.keys;
    s.chase = this.chase;
    s.fboss = this.fboss ? { ...this.fboss, cols: this.fboss.cols.slice() } : null;
    s.doorGroup = this.doorGroup;
    s.doorTiles = this.doorTiles;
    return s;
  }

  // ---------- タイル ----------
  tileAt(tx: number, ty: number): number {
    const L = this.level;
    if (tx < 0 || tx >= L.w) return T.SOLID;
    if (ty < 0 || ty >= L.h) return T.EMPTY;
    return L.tiles[ty * L.w + tx];
  }

  solid(tx: number, ty: number): boolean {
    const L = this.level;
    if (tx < 0 || tx >= L.w) return true;
    if (ty < 0 || ty >= L.h) return false;
    const i = ty * L.w + tx;
    switch (L.tiles[i]) {
      case T.SOLID:
      case T.BRICK:
      case T.SWITCH:
      case T.TURRET:
        return true;
      case T.CRUMBLE:
        return this.tstate[i] >= 0;
      case T.ABLOCK:
        return !this.switchOn;
      case T.BBLOCK:
        return this.switchOn;
      case T.SPRING:
      case T.ICE:
      case T.CONV_L:
      case T.CONV_R:
        return true;
      case T.DOOR:
        return this.tstate[i] === 0;
      default:
        return false;
    }
  }

  private oneway(tx: number, ty: number): boolean {
    return this.tileAt(tx, ty) === T.ONEWAY;
  }

  // ---------- 移動床 ----------
  private tri(frame: number, e: Ent): number {
    // 0..range..0 の三角波（整数）
    if (e.range <= 0 || e.speed <= 0) return 0;
    const span = e.range * 2;
    let d = ((frame + e.phase) * e.speed) % span;
    if (d > e.range) d = span - d;
    return d;
  }

  private placePlatforms(frame: number) {
    for (const e of this.ents) {
      if (e.kind === E_PLAT_H) {
        const nx = e.ox + this.tri(frame, e);
        e.dx = nx - e.x;
        e.dy = 0;
        e.x = nx;
        e.y = e.oy;
      } else if (e.kind === E_PLAT_V) {
        const ny = e.oy - this.tri(frame, e);
        e.dy = ny - e.y;
        e.dx = 0;
        e.y = ny;
        e.x = e.ox;
      } else if (e.kind === E_FLYER && e.alive) {
        e.y = e.oy + this.tri(frame, e);
      }
    }
  }

  /** 回転ノコギリの位置（軌道上の距離から計算する。整数のみ） */
  private placeSaws(frame: number) {
    for (const e of this.ents) {
      if (e.kind !== E_SAW) continue;
      const tw = e.range;
      const th = e.period;
      let cx = e.ox;
      let cy = e.oy;
      if (tw === 0 || th === 0) {
        const len = tw + th;
        if (len > 0 && e.speed > 0) {
          let d = ((frame + e.phase) * e.speed) % (len * 2);
          if (d > len) d = len * 2 - d;
          if (tw > 0) cx += d;
          else cy += d;
        }
      } else if (e.speed > 0) {
        let d = ((frame + e.phase) * e.speed) % (2 * (tw + th));
        if (d < tw) cx += d;
        else if ((d -= tw) < th) {
          cx += tw;
          cy += d;
        } else if ((d -= th) < tw) {
          cx += tw - d;
          cy += th;
        } else {
          d -= tw;
          cy += th - d;
        }
      }
      e.x = cx - e.w / 2;
      e.y = cy - e.h / 2;
    }
  }

  // ---------- プレイヤー移動 ----------
  private moveX(dx: number) {
    const p = this.p;
    if (dx === 0) return;
    p.x += dx;
    const ty0 = Math.floor(p.y / TS);
    const ty1 = Math.floor((p.y + PH - 1) / TS);
    if (dx > 0) {
      const tx = Math.floor((p.x + PW - 1) / TS);
      for (let ty = ty0; ty <= ty1; ty++) {
        if (this.solid(tx, ty)) {
          p.x = tx * TS - PW;
          p.vx = 0;
          return;
        }
      }
    } else {
      const tx = Math.floor(p.x / TS);
      for (let ty = ty0; ty <= ty1; ty++) {
        if (this.solid(tx, ty)) {
          p.x = (tx + 1) * TS;
          p.vx = 0;
          return;
        }
      }
    }
  }

  /** 戻り値: 着地したか */
  private moveY(dy: number): boolean {
    const p = this.p;
    if (dy === 0) return false;
    const oldBottom = p.y + PH;
    p.y += dy;
    const tx0 = Math.floor(p.x / TS);
    const tx1 = Math.floor((p.x + PW - 1) / TS);
    if (dy > 0) {
      const ty = Math.floor((p.y + PH - 1) / TS);
      let landY = Infinity;
      for (let tx = tx0; tx <= tx1; tx++) {
        if (this.solid(tx, ty) || (this.oneway(tx, ty) && oldBottom <= ty * TS)) {
          landY = Math.min(landY, ty * TS - PH);
        }
      }
      let ride = -1;
      for (let i = 0; i < this.ents.length; i++) {
        const e = this.ents[i];
        if (e.kind !== E_PLAT_H && e.kind !== E_PLAT_V) continue;
        if (p.x + PW <= e.x || p.x >= e.x + e.w) continue;
        const tol = Math.abs(e.dy) + 1;
        if (oldBottom <= e.y + tol && p.y + PH >= e.y) {
          const ly = e.y - PH;
          if (ly < landY || (ly === landY && ride < 0)) {
            landY = ly;
            ride = i;
          }
        }
      }
      if (landY !== Infinity) {
        p.y = landY;
        p.vy = 0;
        p.ride = ride;
        return true;
      }
    } else {
      const ty = Math.floor(p.y / TS);
      for (let tx = tx0; tx <= tx1; tx++) {
        if (this.solid(tx, ty)) {
          p.y = (ty + 1) * TS;
          p.vy = 0;
          return false;
        }
      }
    }
    return false;
  }

  /** 重力反転中の縦移動（天井に着地する）。戻り値: 着地したか */
  private moveYFlip(dy: number): boolean {
    const p = this.p;
    if (dy === 0) return false;
    p.y += dy;
    const tx0 = Math.floor(p.x / TS);
    const tx1 = Math.floor((p.x + PW - 1) / TS);
    if (dy < 0) {
      const ty = Math.floor(p.y / TS);
      for (let tx = tx0; tx <= tx1; tx++) {
        if (this.solid(tx, ty)) {
          p.y = (ty + 1) * TS;
          p.vy = 0;
          p.ride = -1;
          return true;
        }
      }
    } else {
      const ty = Math.floor((p.y + PH - 1) / TS);
      for (let tx = tx0; tx <= tx1; tx++) {
        if (this.solid(tx, ty)) {
          p.y = ty * TS - PH;
          p.vy = 0;
          return false;
        }
      }
    }
    return false;
  }

  private die() {
    if (this.invincible || this.cleared) return;
    if (this.boss && (this.boss.state === 'dying' || this.boss.state === 'dead')) return;
    if (this.fboss && (this.fboss.state === 'dying' || this.fboss.state === 'dead')) return;
    this.dead = true;
    this.events.push('die');
  }

  // ---------- 1フレーム進める ----------
  // 101面以降の新ギミックの処理は、そのギミックが面に無ければ何もしない（1〜100面の挙動は変わらない）
  step(input: number) {
    this.events = [];
    if (this.dead || this.cleared) return;
    this.frame++;
    const p = this.p;
    const L = this.level;

    this.placePlatforms(this.frame);
    this.placeSaws(this.frame);

    // 移動床に乗っていれば一緒に動く
    if (p.ride >= 0) {
      const e = this.ents[p.ride];
      this.moveX(e.dx);
      if (e.dy !== 0) {
        if (e.dy < 0) this.moveY(e.dy);
        else p.y += e.dy;
      }
    }
    // ベルトコンベア
    if (p.onGround && p.surf >= SURF_CONV_L) this.moveX(p.surf === SURF_CONV_L ? -CONV_SPEED : CONV_SPEED);
    this.prevY = p.y;

    // --- 入力 ---
    const left = (input & IN_LEFT) !== 0;
    const right = (input & IN_RIGHT) !== 0;
    const jump = (input & IN_JUMP) !== 0;
    const jumpPressed = jump && (p.prevIn & IN_JUMP) === 0;
    p.prevIn = input;
    const dir = (right ? 1 : 0) - (left ? 1 : 0);

    const ice = p.onGround && p.surf === SURF_ICE;
    const acc = ice ? ACC_ICE : p.onGround ? ACC_GROUND : ACC_AIR;
    const dec = ice ? DEC_ICE : p.onGround ? DEC_GROUND : DEC_AIR;
    if (dir !== 0) {
      p.facing = dir as 1 | -1;
      if (p.vx * dir < 0) p.vx += dir * (acc + dec);
      else p.vx += dir * acc;
      if (p.vx > RUN_MAX) p.vx = RUN_MAX;
      if (p.vx < -RUN_MAX) p.vx = -RUN_MAX;
    } else {
      if (p.vx > 0) p.vx = Math.max(0, p.vx - dec);
      else if (p.vx < 0) p.vx = Math.min(0, p.vx + dec);
    }

    if (jumpPressed) p.jumpBuf = JUMP_BUFFER;
    else if (p.jumpBuf > 0) p.jumpBuf--;
    if (p.onGround) p.coyote = COYOTE;
    else if (p.coyote > 0) p.coyote--;

    if (p.jumpBuf > 0 && p.coyote > 0) {
      p.vy = -JUMP_V * p.grav;
      p.jumpBuf = 0;
      p.coyote = 0;
      p.onGround = false;
      p.ride = -1;
      this.events.push('jump');
    } else if (p.jumpBuf > 0 && p.air > 0 && !p.onGround) {
      // オーブの空中ジャンプ
      p.vy = -JUMP_V * p.grav;
      p.jumpBuf = 0;
      p.air--;
      this.events.push('airjump');
    }

    // 風・重力ゾーン（体の中心のタイル）
    const zone = this.tileAt(Math.floor((p.x + PW / 2) / TS), Math.floor((p.y + PH / 2) / TS));

    if (p.grav > 0) {
      p.vy += p.vy < 0 && jump ? G_HOLD : G_FALL;
      if (p.vy > MAX_FALL) p.vy = MAX_FALL;
    } else {
      p.vy -= p.vy > 0 && jump ? G_HOLD : G_FALL;
      if (p.vy < -MAX_FALL) p.vy = -MAX_FALL;
    }
    if (zone === T.WIND_U) p.vy = Math.max(p.vy - WIND_UP_ACC, -WIND_UP_MAX);

    // --- 移動 ---
    this.moveX(p.vx);
    if (zone === T.WIND_R) this.moveX(WIND_PUSH);
    else if (zone === T.WIND_L) this.moveX(-WIND_PUSH);
    const wasGround = p.onGround;
    p.ride = -1;
    p.onGround = p.grav > 0 ? this.moveY(p.vy) : this.moveYFlip(p.vy);
    if (p.onGround && !wasGround) this.events.push('land');

    // --- 足元のタイル（崩れる床・スイッチ・バネ・氷・コンベア） ---
    let onSwitch = false;
    let spring = false;
    p.surf = SURF_NORMAL;
    if (p.onGround && p.ride < 0) {
      const ty = p.grav > 0 ? Math.floor((p.y + PH) / TS) : Math.floor((p.y - 1) / TS);
      const tx0 = Math.floor(p.x / TS);
      const tx1 = Math.floor((p.x + PW - 1) / TS);
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = this.tileAt(tx, ty);
        if (t === T.CRUMBLE) {
          const i = ty * L.w + tx;
          if (this.tstate[i] === 0) this.tstate[i] = 1;
        } else if (t === T.SWITCH) onSwitch = true;
        else if (t === T.SPRING) spring = true;
        else if (t === T.ICE) {
          if (p.surf === SURF_NORMAL) p.surf = SURF_ICE;
        } else if (t === T.CONV_L) p.surf = SURF_CONV_L;
        else if (t === T.CONV_R) p.surf = SURF_CONV_R;
      }
    }
    if (p.onGround) p.air = 0;
    if (spring && p.grav > 0) {
      p.vy = -SPRING_V;
      p.onGround = false;
      p.coyote = 0;
      p.jumpBuf = 0;
      p.surf = SURF_NORMAL;
      this.events.push('spring');
    }
    if (onSwitch && !this.latch) {
      this.switchOn = !this.switchOn;
      this.events.push('switch');
    }
    this.latch = onSwitch;

    // 重力反転ゾーン
    if ((zone === T.GRAV_UP && p.grav > 0) || (zone === T.GRAV_DOWN && p.grav < 0)) {
      p.grav = zone === T.GRAV_UP ? -1 : 1;
      p.onGround = false;
      p.coyote = 0;
      p.vy = Math.trunc(p.vy / 2);
      this.events.push('grav');
    }
    if (this.keys > 0 && this.doorGroup) this.tryDoors();

    this.updateSpecialTiles();
    this.updateEnts();
    this.updateNewEnts();
    if (this.boss) this.updateBoss();
    if (this.fboss) this.updateFBoss();
    this.updateBullets();
    if (this.dead) return;

    // --- 判定 ---
    if (p.y > L.h * TS || (p.grav < 0 && p.y + PH < 0)) {
      this.die();
      if (this.invincible) {
        p.y = 0;
        p.vy = 0;
        p.grav = 1;
      }
      return;
    }
    if (L.chase) {
      const c = L.chase;
      if (this.frame > c.delay) this.chase += c.dir === 'right' ? c.speed : -c.speed;
      if (c.dir === 'right' ? p.x < this.chase : p.y + PH > this.chase + px(4)) {
        this.die();
        if (this.dead) return;
      }
    }
    this.checkTiles();
  }

  /** 鍵を持って扉に触れたら、つながった扉をまとめて開ける */
  private tryDoors() {
    const p = this.p;
    const L = this.level;
    const tx0 = Math.floor((p.x - 1) / TS);
    const tx1 = Math.floor((p.x + PW) / TS);
    const ty0 = Math.floor((p.y - 1) / TS);
    const ty1 = Math.floor((p.y + PH) / TS);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (tx < 0 || ty < 0 || tx >= L.w || ty >= L.h) continue;
        const i = ty * L.w + tx;
        if (L.tiles[i] !== T.DOOR || this.tstate[i] !== 0) continue;
        for (const j of this.doorTiles[this.doorGroup![i]]) this.tstate[j] = 1;
        this.keys--;
        this.events.push('door');
        if (this.keys <= 0) return;
      }
    }
  }

  private updateSpecialTiles() {
    const L = this.level;
    const p = this.p;
    const pcx = p.x + PW / 2;
    for (const i of this.special) {
      const t = L.tiles[i];
      const tx = i % L.w;
      const ty = (i - tx) / L.w;
      const s = this.tstate[i];
      if (t === T.CRUMBLE) {
        if (s > 0) {
          if (s >= CRUMBLE_DELAY) {
            this.tstate[i] = -CRUMBLE_RESPAWN;
            this.events.push('crumble');
          } else this.tstate[i] = s + 1;
        } else if (s < 0) {
          if (s === -1) {
            // プレイヤーと重なっていたら復活を待つ
            const bx = tx * TS;
            const by = ty * TS;
            if (p.x < bx + TS && p.x + PW > bx && p.y < by + TS && p.y + PH > by) continue;
          }
          this.tstate[i] = s + 1;
        }
      } else if (t === T.TRAP) {
        if (s === 0) {
          const bx = tx * TS;
          if (pcx >= bx - px(36) && pcx <= bx + TS + px(4) && Math.abs(p.y - ty * TS) < 5 * TS) {
            this.tstate[i] = 1;
            this.events.push('trap');
          }
        } else if (s < 8) this.tstate[i] = s + 1;
      } else if (t === T.ICICLE) {
        if (s === 0) {
          const bx = tx * TS;
          const dy = p.y - ty * TS;
          if (pcx >= bx - px(20) && pcx <= bx + TS + px(12) && dy > 0 && dy < 9 * TS) {
            this.tstate[i] = 1;
            this.events.push('icicle');
          }
        } else if (s > 0) {
          if (s >= ICICLE_SHAKE) {
            this.tstate[i] = -1;
            this.bullets.push({ kind: B_ICICLE, x: tx * TS + px(4), y: ty * TS, vx: 0, vy: 0, w: px(8), h: px(12) });
          } else this.tstate[i] = s + 1;
        }
      }
    }
  }

  private checkTiles() {
    const p = this.p;
    const L = this.level;
    const tx0 = Math.floor(p.x / TS);
    const tx1 = Math.floor((p.x + PW - 1) / TS);
    const ty0 = Math.floor(p.y / TS);
    const ty1 = Math.floor((p.y + PH - 1) / TS);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = this.tileAt(tx, ty);
        if (t === T.EMPTY || t === T.SOLID) continue;
        const bx = tx * TS;
        const by = ty * TS;
        let k: [number, number, number, number] | null = null;
        switch (t) {
          case T.SPIKE_UP:
            k = [3, 7, 13, 16];
            break;
          case T.SPIKE_DOWN:
            k = [3, 0, 13, 9];
            break;
          case T.SPIKE_LEFT:
            k = [7, 3, 16, 13];
            break;
          case T.SPIKE_RIGHT:
            k = [0, 3, 9, 13];
            break;
          case T.TRAP:
            if (this.tstate[ty * L.w + tx] >= 4) k = [3, 7, 13, 16];
            break;
          case T.ICICLE:
            if (this.tstate[ty * L.w + tx] >= 0) k = [4, 0, 12, 12];
            break;
          case T.GOAL:
            if (p.x < bx + TS && p.x + PW > bx && p.y < by + TS && p.y + PH > by) {
              this.cleared = true;
              this.events.push('clear');
              return;
            }
            break;
        }
        if (k) {
          if (
            p.x < bx + px(k[2]) &&
            p.x + PW > bx + px(k[0]) &&
            p.y < by + px(k[3]) &&
            p.y + PH > by + px(k[1])
          ) {
            this.die();
            if (this.dead) return;
          }
        }
      }
    }
  }

  private overlapP(x: number, y: number, w: number, h: number): boolean {
    const p = this.p;
    return p.x < x + w && p.x + PW > x && p.y < y + h && p.y + PH > y;
  }

  private stompOrDie(e: { y: number; h: number }): boolean {
    const p = this.p;
    const held = (p.prevIn & IN_JUMP) !== 0;
    if (p.grav < 0) {
      // 重力反転中は下から踏む
      if (p.vy < 0 && this.prevY >= e.y + e.h - px(6)) {
        p.vy = held ? JUMP_V : STOMP_BOUNCE;
        p.onGround = false;
        p.ride = -1;
        this.events.push('stomp');
        return true;
      }
      this.die();
      return false;
    }
    if (p.vy > 0 && this.prevY + PH <= e.y + px(6)) {
      p.vy = held ? -JUMP_V : -STOMP_BOUNCE;
      p.onGround = false;
      p.ride = -1;
      this.events.push('stomp');
      return true;
    }
    this.die();
    return false;
  }

  private updateEnts() {
    const p = this.p;
    const L = this.level;
    for (const e of this.ents) {
      if (!e.alive) continue;
      if (e.kind === E_WALKER) {
        if (!e.active) {
          if (Math.abs(e.x - p.x) < 17 * TS) e.active = true;
          else continue;
        }
        // 横移動
        const sp = 128;
        e.x += e.dir * sp;
        const ty0 = Math.floor(e.y / TS);
        const ty1 = Math.floor((e.y + e.h - 1) / TS);
        const front = e.dir > 0 ? Math.floor((e.x + e.w - 1) / TS) : Math.floor(e.x / TS);
        let hit = false;
        for (let ty = ty0; ty <= ty1; ty++) if (this.solid(front, ty)) hit = true;
        if (hit) {
          e.x = e.dir > 0 ? front * TS - e.w : (front + 1) * TS;
          e.dir = -e.dir;
        } else if (e.vy === 0) {
          // 崖で折り返す
          const footTy = Math.floor((e.y + e.h) / TS);
          const fx = e.dir > 0 ? Math.floor((e.x + e.w) / TS) : Math.floor((e.x - 1) / TS);
          if (!this.solid(fx, footTy)) e.dir = -e.dir;
        }
        // 重力
        e.vy = Math.min(e.vy + 64, MAX_FALL);
        e.y += e.vy;
        const tyB = Math.floor((e.y + e.h - 1) / TS);
        const txa = Math.floor(e.x / TS);
        const txb = Math.floor((e.x + e.w - 1) / TS);
        if (this.solid(txa, tyB) || this.solid(txb, tyB)) {
          e.y = tyB * TS - e.h;
          e.vy = 0;
        }
        if (e.y > L.h * TS) {
          e.alive = false;
          continue;
        }
        if (this.overlapP(e.x, e.y, e.w, e.h)) {
          if (this.stompOrDie(e)) e.alive = false;
        }
      } else if (e.kind === E_FLYER) {
        if (this.overlapP(e.x, e.y, e.w, e.h)) {
          if (this.stompOrDie(e)) e.alive = false;
        }
      } else if (e.kind === E_TURRET) {
        if ((this.frame + e.phase) % e.period === 0 && Math.abs(e.x - p.x) < 18 * TS) {
          const bw = px(6);
          this.bullets.push({
            kind: B_TURRET,
            x: e.dir > 0 ? e.x + TS : e.x - bw,
            y: e.y + px(5),
            vx: e.dir * e.speed,
            vy: 0,
            w: bw,
            h: bw,
          });
          this.events.push('shoot');
        }
      }
      if (this.dead) return;
    }
  }

  private updateBullets() {
    const L = this.level;
    const keep: Bullet[] = [];
    for (const b of this.bullets) {
      b.x += b.vx;
      b.y += b.vy;
      if (b.kind === B_RAIN) b.vy = Math.min(b.vy + 16, 1280);
      else if (b.kind === B_ICICLE) b.vy = Math.min(b.vy + 40, 1400);
      else if (b.kind === B_FRAIN) b.vy = Math.min(b.vy + 24, 1100);
      const cx = Math.floor((b.x + b.w / 2) / TS);
      const cy = Math.floor((b.y + b.h / 2) / TS);
      let dead = false;
      if (b.x + b.w < 0 || b.x > L.w * TS || b.y > L.h * TS) dead = true;
      else if (b.kind === B_WAVE) {
        const fx = b.vx > 0 ? Math.floor((b.x + b.w) / TS) : Math.floor(b.x / TS);
        if (this.solid(fx, cy)) dead = true;
      } else if (b.kind === B_RAIN || b.kind === B_ICICLE || b.kind === B_FRAIN) {
        if (this.solid(cx, Math.floor((b.y + b.h) / TS))) dead = true;
      } else if (this.solid(cx, cy)) dead = true;
      if (dead) continue;
      keep.push(b);
      if (!this.dead && this.overlapP(b.x, b.y, b.w, b.h)) this.die();
    }
    this.bullets = keep;
  }

  // ---------- 101面以降のギミック ----------
  private updateNewEnts() {
    const p = this.p;
    for (const e of this.ents) {
      switch (e.kind) {
        case E_CRUSHER:
          this.updateCrusher(e);
          break;
        case E_LASER: {
          const t = (this.frame + e.phase) % e.period;
          const onAt = e.period - e.range;
          if (t === onAt && Math.abs(e.x - p.x) < 16 * TS && Math.abs(e.y - p.y) < 12 * TS) this.events.push('laser');
          if (t >= onAt && this.overlapP(e.x, e.y, e.w, e.h)) this.die();
          break;
        }
        case E_SAW:
          if (this.overlapP(e.x + px(1), e.y + px(1), e.w - px(2), e.h - px(2))) this.die();
          break;
        case E_ORB:
          if (!e.alive) {
            if (--e.tm <= 0) e.alive = true;
          } else if (!p.onGround && p.air === 0 && this.overlapP(e.x, e.y, e.w, e.h)) {
            e.alive = false;
            e.tm = ORB_RESPAWN;
            p.air = 1;
            this.events.push('orb');
          }
          break;
        case E_KEY:
          if (e.alive && this.overlapP(e.x, e.y, e.w, e.h)) {
            e.alive = false;
            this.keys++;
            this.events.push('key');
          }
          break;
      }
      if (this.dead) return;
    }
  }

  /** 圧殺ブロック: 待機 → 揺れる（予兆）→ 落下 → 着地して停止 → ゆっくり戻る → 少し休む */
  private updateCrusher(e: Ent) {
    const p = this.p;
    switch (e.st) {
      case 0: {
        const pcx = p.x + PW / 2;
        if (pcx > e.x - px(6) && pcx < e.x + e.w + px(6) && p.y > e.y && p.y - e.y < 12 * TS) {
          e.st = 1;
          e.tm = CRUSHER_SHAKE;
        }
        break;
      }
      case 1:
        if (--e.tm <= 0) {
          e.st = 2;
          e.vy = 0;
        }
        break;
      case 2: {
        e.vy = Math.min(e.vy + 96, 1408);
        e.y += e.vy;
        const tyB = Math.floor((e.y + e.h - 1) / TS);
        const tx0 = Math.floor(e.x / TS);
        const tx1 = Math.floor((e.x + e.w - 1) / TS);
        let hit = e.y > this.level.h * TS;
        for (let tx = tx0; tx <= tx1 && !hit; tx++) if (this.solid(tx, tyB)) hit = true;
        if (hit) {
          e.y = tyB * TS - e.h;
          e.vy = 0;
          e.st = 3;
          e.tm = 48;
          this.events.push('thud');
        }
        break;
      }
      case 3:
        if (--e.tm <= 0) e.st = 4;
        break;
      case 4:
        e.y -= 112;
        if (e.y <= e.oy) {
          e.y = e.oy;
          e.st = 5;
          e.tm = 30;
        }
        break;
      case 5:
        if (--e.tm <= 0) e.st = 0;
        break;
    }
    if (this.overlapP(e.x + px(1), e.y, e.w - px(2), e.h)) this.die();
  }

  // ---------- 200面 真の最終ボス ----------
  private fbNext() {
    const b = this.fboss!;
    const L = this.level;
    const list = FPAT[b.form - 1];
    const pat = list[b.patIdx % list.length];
    b.patIdx++;
    const f = b.form - 1;
    const pcx = this.p.x + PW / 2;
    const pc = Math.floor(pcx / TS);
    const clampC = (c: number, w: number) => Math.max(1, Math.min(L.w - 1 - w, c));
    switch (pat) {
      case 'slam':
        b.state = 'tele_slam';
        b.timer = [48, 40, 34][f];
        b.targetX = Math.max(TS, Math.min((L.w - 1) * TS - b.w, pcx - b.w / 2));
        break;
      case 'beamLow':
      case 'beamHigh':
        b.state = 'tele_beam';
        b.beamHigh = pat === 'beamHigh';
        b.timer = [66, 56, 48][f];
        this.events.push('warn');
        break;
      case 'pillar':
        b.state = 'tele_pillar';
        b.timer = [56, 56, 48][f];
        b.cols = [pc - 1, pc - 8, pc + 6].map((c) => clampC(c, 2));
        break;
      case 'rain':
        b.state = 'tele_rain';
        b.timer = 52;
        b.cols = [pc - 4, pc - 1, pc + 2, pc + 5].map((c) => clampC(c, 1));
        break;
    }
  }

  private updateFBoss() {
    const b = this.fboss!;
    const p = this.p;
    const L = this.level;
    const f = b.form - 1;
    const minX = TS;
    const maxX = (L.w - 1) * TS - b.w;
    const floorY = FB_FLOOR - b.h;
    const pcx = p.x + PW / 2;
    const follow = (sp: number, tx: number) => {
      const t = Math.max(minX, Math.min(maxX, tx));
      b.x = b.x < t ? Math.min(t, b.x + sp) : Math.max(t, b.x - sp);
    };
    switch (b.state) {
      case 'intro':
        if (--b.timer <= 0) {
          b.state = 'hover';
          b.timer = 30;
        }
        break;
      case 'hover':
        follow(320 + f * 64, pcx - b.w / 2);
        if (--b.timer <= 0) this.fbNext();
        break;
      case 'tele_slam':
        follow(896, b.targetX);
        if (--b.timer <= 0) {
          b.state = 'slam';
          b.vy = 0;
        }
        break;
      case 'slam':
        b.vy = Math.min(b.vy + 112, 1792);
        b.y += b.vy;
        if (b.y >= floorY) {
          b.y = floorY;
          b.vy = 0;
          this.events.push('crash');
          if (b.form >= 2) {
            const ww = px(10);
            const wy = FB_FLOOR - px(10);
            this.bullets.push({ kind: B_WAVE, x: b.x - ww, y: wy, vx: -768, vy: 0, w: ww, h: ww });
            this.bullets.push({ kind: B_WAVE, x: b.x + b.w, y: wy, vx: 768, vy: 0, w: ww, h: ww });
          }
          b.state = 'stun';
          b.timer = [100, 88, 76][f];
        }
        break;
      case 'stun':
        if (--b.timer <= 0) b.state = 'recover';
        break;
      case 'recover':
        b.y -= 512;
        if (b.y <= FB_HOVER_Y) {
          b.y = FB_HOVER_Y;
          b.state = 'hover';
          b.timer = [56, 40, 30][f];
        }
        break;
      case 'tele_beam':
        follow(256, pcx - b.w / 2);
        if (--b.timer <= 0) {
          b.state = 'beam';
          b.timer = 26;
          this.events.push('beam');
        }
        break;
      case 'beam': {
        const [by, bh] = b.beamHigh ? FB_BEAM_HIGH : FB_BEAM_LOW;
        if (this.overlapP(TS, by, (L.w - 2) * TS, bh)) this.die();
        if (--b.timer <= 0) {
          b.state = 'hover';
          b.timer = [40, 30, 24][f];
        }
        break;
      }
      case 'tele_pillar':
        follow(256, pcx - b.w / 2);
        if (--b.timer <= 0) {
          b.state = 'pillar';
          b.timer = 36;
          this.events.push('pillar');
        }
        break;
      case 'pillar':
        for (const c of b.cols) if (this.overlapP(c * TS + px(1), FB_FLOOR - FB_PILLAR_H, 2 * TS - px(2), FB_PILLAR_H)) this.die();
        if (--b.timer <= 0) {
          b.state = 'hover';
          b.timer = 24;
        }
        break;
      case 'tele_rain':
        follow(256, pcx - b.w / 2);
        if (--b.timer <= 0) {
          for (const c of b.cols) this.bullets.push({ kind: B_FRAIN, x: c * TS + px(3), y: px(4), vx: 0, vy: 192, w: px(10), h: px(10) });
          this.events.push('rain');
          b.state = 'hover';
          b.timer = 50;
        }
        break;
      case 'transform':
        b.y = Math.max(FB_HOVER_Y, b.y - 512);
        if (--b.timer <= 0) {
          b.state = 'hover';
          b.timer = 40;
        }
        return;
      case 'dying':
        if (--b.timer <= 0) {
          b.state = 'dead';
          this.cleared = true;
          this.events.push('clear');
        }
        return;
      case 'dead':
        return;
    }

    // プレイヤーとの接触
    if (this.dead || !this.overlapP(b.x + px(2), b.y + px(2), b.w - px(4), b.h - px(2))) return;
    const st = b.state;
    if (st === 'intro' || st === 'recover') return;
    if (st !== 'stun') {
      this.die();
      return;
    }
    const held = (p.prevIn & IN_JUMP) !== 0;
    if (!(p.vy > 0 && this.prevY + PH <= b.y + px(10))) return; // 気絶中は横から触れても平気
    b.hp--;
    p.vy = held ? -JUMP_V - 128 : -STOMP_BOUNCE - 128;
    p.onGround = false;
    this.events.push('fbosshit');
    if (b.hp <= 0) {
      b.state = 'dying';
      b.timer = 180;
      this.bullets = [];
      this.events.push('bossdie');
      return;
    }
    const form = b.hp > 6 ? 1 : b.hp > 3 ? 2 : 3;
    if (form !== b.form) {
      b.form = form;
      b.state = 'transform';
      b.timer = 110;
      b.patIdx = 0;
      this.bullets = [];
      this.events.push('transform');
    } else b.state = 'recover';
  }

  // ---------- ボス ----------
  private nextPattern() {
    const b = this.boss!;
    const p2 = b.hp <= 3;
    const list = p2 ? PAT2 : PAT1;
    const pat = list[b.patIdx % list.length];
    b.patIdx++;
    const pcx = this.p.x + PW / 2;
    const bcx = b.x + b.w / 2;
    b.dir = pcx < bcx ? -1 : 1;
    b.vx = 0;
    b.vy = 0;
    switch (pat) {
      case 'charge':
        b.state = 'tele_charge';
        b.timer = p2 ? 36 : 48;
        break;
      case 'shoot':
        b.state = 'tele_shoot';
        b.timer = 30;
        b.shots = 0;
        break;
      case 'leap': {
        b.state = 'tele_leap';
        b.timer = p2 ? 24 : 32;
        const L = this.level;
        const minX = TS;
        const maxX = (L.w - 1) * TS - b.w;
        b.targetX = Math.max(minX, Math.min(maxX, pcx - b.w / 2));
        break;
      }
      case 'rain': {
        b.state = 'tele_rain';
        b.timer = p2 ? 44 : 50;
        const L = this.level;
        const base = Math.floor(pcx / TS);
        b.rainCols = [-4, -2, 0, 2, 4].map((o) => Math.max(1, Math.min(L.w - 2, base + o)));
        break;
      }
    }
  }

  private bossFloorY(): number {
    // ボスの足元の床
    return 14 * TS - this.boss!.h;
  }

  private updateBoss() {
    const b = this.boss!;
    const p = this.p;
    const L = this.level;
    const p2 = b.hp <= 3;
    const minX = TS;
    const maxX = (L.w - 1) * TS - b.w;
    const floorY = this.bossFloorY();

    switch (b.state) {
      case 'intro':
        if (--b.timer <= 0) this.nextPattern();
        break;
      case 'tele_charge':
        if (--b.timer <= 0) {
          b.state = 'charge';
          b.vx = b.dir * (p2 ? 1280 : 1024);
        }
        break;
      case 'charge':
        b.x += b.vx;
        if (b.x <= minX || b.x >= maxX) {
          b.x = Math.max(minX, Math.min(maxX, b.x));
          b.vx = 0;
          b.state = 'stun';
          b.timer = p2 ? 60 : 84;
          this.events.push('crash');
        }
        break;
      case 'tele_shoot':
        if (--b.timer <= 0) {
          b.state = 'shoot';
          b.timer = 0;
        }
        break;
      case 'shoot': {
        const total = p2 ? 6 : 4;
        const interval = p2 ? 30 : 38;
        if (b.timer <= 0) {
          if (b.shots >= total) {
            b.state = 'stun';
            b.timer = p2 ? 56 : 76;
            break;
          }
          const pattern = p2 ? [0, 1, 0, 1, 0, 0] : [0, 1, 0, 0];
          const high = pattern[b.shots] === 1;
          const pcx = p.x + PW / 2;
          const bcx = b.x + b.w / 2;
          b.dir = pcx < bcx ? -1 : 1;
          const bw = px(8);
          const floor = 14 * TS;
          this.bullets.push({
            kind: B_BOSS,
            x: bcx - bw / 2,
            y: high ? floor - px(30) : floor - px(10),
            vx: b.dir * 640,
            vy: 0,
            w: bw,
            h: bw,
          });
          this.events.push('bossshot');
          b.shots++;
          b.timer = interval;
        } else b.timer--;
        break;
      }
      case 'tele_leap':
        if (--b.timer <= 0) {
          b.state = 'leap';
          const T_AIR = 56;
          b.vx = Math.trunc((b.targetX - b.x) / T_AIR);
          b.vy = -((BOSS_G * T_AIR) / 2);
          this.events.push('bossjump');
        }
        break;
      case 'leap':
        b.x = Math.max(minX, Math.min(maxX, b.x + b.vx));
        b.y += b.vy;
        b.vy += BOSS_G;
        if (b.vy > 0 && b.y >= floorY) {
          b.y = floorY;
          b.vy = 0;
          b.vx = 0;
          const ww = px(10);
          const wy = 14 * TS - px(10);
          this.bullets.push({ kind: B_WAVE, x: b.x - ww, y: wy, vx: -768, vy: 0, w: ww, h: ww });
          this.bullets.push({ kind: B_WAVE, x: b.x + b.w, y: wy, vx: 768, vy: 0, w: ww, h: ww });
          this.events.push('crash');
          b.state = 'stun';
          b.timer = p2 ? 56 : 76;
        }
        break;
      case 'tele_rain':
        if (--b.timer <= 0) {
          const sw = px(10);
          for (const c of b.rainCols) {
            this.bullets.push({ kind: B_RAIN, x: c * TS + px(3), y: px(4), vx: 0, vy: 256, w: sw, h: px(12) });
          }
          this.events.push('rain');
          b.state = 'idle';
          b.timer = 36;
        }
        break;
      case 'idle':
        if (--b.timer <= 0) this.nextPattern();
        break;
      case 'stun':
        if (--b.timer <= 0) this.nextPattern();
        break;
      case 'recover':
        b.x = Math.max(minX, Math.min(maxX, b.x + b.vx));
        b.y += b.vy;
        b.vy += BOSS_G;
        if (b.y >= floorY) {
          b.y = floorY;
          b.vy = 0;
          b.vx = 0;
        }
        if (--b.timer <= 0) {
          if (this.overlapP(b.x, b.y, b.w, b.h)) b.timer = 1;
          else this.nextPattern();
        }
        break;
      case 'dying':
        if (--b.timer <= 0) {
          b.state = 'dead';
          this.cleared = true;
          this.events.push('clear');
        }
        return;
      case 'dead':
        return;
    }

    // プレイヤーとの接触
    if (this.overlapP(b.x, b.y, b.w, b.h)) {
      const st = b.state;
      if (st === 'recover' || st === 'intro') return;
      const held = (p.prevIn & IN_JUMP) !== 0;
      const fromTop = p.vy > 0 && this.prevY + PH <= b.y + px(10);
      if (st === 'stun' && fromTop) {
        b.hp--;
        p.vy = held ? -JUMP_V - 128 : -STOMP_BOUNCE - 128;
        p.onGround = false;
        if (b.hp <= 0) {
          b.state = 'dying';
          b.timer = 150;
          this.bullets = [];
          this.events.push('bossdie');
        } else {
          b.state = 'recover';
          b.timer = 50;
          const pcx = p.x + PW / 2;
          const bcx = b.x + b.w / 2;
          b.vx = bcx < pcx ? -640 : 640;
          if ((b.vx < 0 && b.x <= minX + 2 * TS) || (b.vx > 0 && b.x >= maxX - 2 * TS)) b.vx = -b.vx;
          b.vy = -800;
          this.events.push('bosshit');
        }
      } else if (st !== 'stun') {
        this.die();
      }
    }
  }
}
