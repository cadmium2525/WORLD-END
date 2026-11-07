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
}

export const E_WALKER = 0;
export const E_FLYER = 1;
export const E_TURRET = 2;
export const E_PLAT_H = 3;
export const E_PLAT_V = 4;

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
}

export const B_TURRET = 0;
export const B_BOSS = 1;
export const B_WAVE = 2;
export const B_RAIN = 3;

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

  constructor(level?: Level, opts: SimOptions = {}) {
    if (!level) return; // clone 用
    this.level = level;
    this.invincible = !!opts.invincible;
    this.tstate = new Int16Array(level.w * level.h);
    for (let i = 0; i < level.tiles.length; i++) {
      const t = level.tiles[i];
      if (t === T.CRUMBLE || t === T.TRAP) this.special.push(i);
    }
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
      }
      this.ents.push(e);
    }
    this.placePlatforms(0);
    for (const e of this.ents) {
      e.dx = 0;
      e.dy = 0;
    }
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

  private die() {
    if (this.invincible || this.cleared) return;
    if (this.boss && (this.boss.state === 'dying' || this.boss.state === 'dead')) return;
    this.dead = true;
    this.events.push('die');
  }

  // ---------- 1フレーム進める ----------
  step(input: number) {
    this.events = [];
    if (this.dead || this.cleared) return;
    this.frame++;
    const p = this.p;
    const L = this.level;

    this.placePlatforms(this.frame);

    // 移動床に乗っていれば一緒に動く
    if (p.ride >= 0) {
      const e = this.ents[p.ride];
      this.moveX(e.dx);
      if (e.dy !== 0) {
        if (e.dy < 0) this.moveY(e.dy);
        else p.y += e.dy;
      }
    }
    this.prevY = p.y;

    // --- 入力 ---
    const left = (input & IN_LEFT) !== 0;
    const right = (input & IN_RIGHT) !== 0;
    const jump = (input & IN_JUMP) !== 0;
    const jumpPressed = jump && (p.prevIn & IN_JUMP) === 0;
    p.prevIn = input;
    const dir = (right ? 1 : 0) - (left ? 1 : 0);

    const acc = p.onGround ? ACC_GROUND : ACC_AIR;
    const dec = p.onGround ? DEC_GROUND : DEC_AIR;
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
      p.vy = -JUMP_V;
      p.jumpBuf = 0;
      p.coyote = 0;
      p.onGround = false;
      p.ride = -1;
      this.events.push('jump');
    }

    p.vy += p.vy < 0 && jump ? G_HOLD : G_FALL;
    if (p.vy > MAX_FALL) p.vy = MAX_FALL;

    // --- 移動 ---
    this.moveX(p.vx);
    const wasGround = p.onGround;
    p.ride = -1;
    p.onGround = this.moveY(p.vy);
    if (p.onGround && !wasGround) this.events.push('land');

    // --- 足元のタイル（崩れる床・スイッチ） ---
    let onSwitch = false;
    if (p.onGround && p.ride < 0) {
      const ty = Math.floor((p.y + PH) / TS);
      const tx0 = Math.floor(p.x / TS);
      const tx1 = Math.floor((p.x + PW - 1) / TS);
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = this.tileAt(tx, ty);
        if (t === T.CRUMBLE) {
          const i = ty * L.w + tx;
          if (this.tstate[i] === 0) this.tstate[i] = 1;
        } else if (t === T.SWITCH) onSwitch = true;
      }
    }
    if (onSwitch && !this.latch) {
      this.switchOn = !this.switchOn;
      this.events.push('switch');
    }
    this.latch = onSwitch;

    this.updateSpecialTiles();
    this.updateEnts();
    if (this.boss) this.updateBoss();
    this.updateBullets();
    if (this.dead) return;

    // --- 判定 ---
    if (p.y > L.h * TS) {
      this.die();
      if (this.invincible) {
        p.y = 0;
        p.vy = 0;
      }
      return;
    }
    this.checkTiles();
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

  private stompOrDie(e: { y: number }): boolean {
    const p = this.p;
    const held = (p.prevIn & IN_JUMP) !== 0;
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
      const cx = Math.floor((b.x + b.w / 2) / TS);
      const cy = Math.floor((b.y + b.h / 2) / TS);
      let dead = false;
      if (b.x + b.w < 0 || b.x > L.w * TS || b.y > L.h * TS) dead = true;
      else if (b.kind === B_WAVE) {
        const fx = b.vx > 0 ? Math.floor((b.x + b.w) / TS) : Math.floor(b.x / TS);
        if (this.solid(fx, cy)) dead = true;
      } else if (b.kind === B_RAIN) {
        if (this.solid(cx, Math.floor((b.y + b.h) / TS))) dead = true;
      } else if (this.solid(cx, cy)) dead = true;
      if (dead) continue;
      keep.push(b);
      if (!this.dead && this.overlapP(b.x, b.y, b.w, b.h)) this.die();
    }
    this.bullets = keep;
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
