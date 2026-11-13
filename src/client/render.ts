// Canvas 描画（素材ファイルを使わず、すべてコードでドット絵を描く）
import { CRUMBLE_DELAY, PH, PW, SUB, T, TILE, VIEW_H } from '../shared/constants';
import type { Level } from '../shared/level';
import {
  B_BOSS,
  B_FRAIN,
  B_ICICLE,
  B_RAIN,
  B_TURRET,
  B_WAVE,
  CRUSHER_SHAKE,
  E_CRUSHER,
  E_FLYER,
  E_KEY,
  E_LASER,
  E_ORB,
  E_PLAT_H,
  E_PLAT_V,
  E_SAW,
  E_TURRET,
  E_WALKER,
  FB_BEAM_HIGH,
  FB_BEAM_LOW,
  FB_FLOOR,
  FB_PILLAR_H,
  LASER_WARN,
  type Sim,
} from '../shared/sim';

interface Palette {
  sky1: string;
  sky2: string;
  far: string;
  near: string;
  top: string;
  dirt: string;
  dirtDark: string;
  brick: string;
  brickDark: string;
  spike: string;
  star: boolean;
}

export const WORLD_NAMES = [
  'はじまりの草原',
  '夕焼けの丘',
  '砂の回廊',
  '地下洞窟',
  '氷結の谷',
  '夜の森',
  '灼熱火山',
  '機械城塞',
  '虚空回廊',
  '世界の果て',
  // 101面以降
  '天空の浮島',
  '氷の宮殿',
  '鋼鉄の工場',
  '深淵',
  '終焉',
];

const PALETTES: Palette[] = [
  { sky1: '#6ec6f2', sky2: '#d6f1ff', far: '#9fd8c0', near: '#6cbf7a', top: '#5cc04a', dirt: '#8a5a3a', dirtDark: '#6b4128', brick: '#c0703f', brickDark: '#8a4a26', spike: '#e8e8f0', star: false },
  { sky1: '#ff8a5c', sky2: '#ffd79a', far: '#e0927a', near: '#b0605a', top: '#e0a040', dirt: '#8a4a3a', dirtDark: '#6a3428', brick: '#c85a3a', brickDark: '#8a3a24', spike: '#fff0e0', star: false },
  { sky1: '#f2c46e', sky2: '#fff0c8', far: '#e6c08a', near: '#d0a060', top: '#f0d080', dirt: '#c08a50', dirtDark: '#9a6a38', brick: '#b0804a', brickDark: '#805a30', spike: '#ffffff', star: false },
  { sky1: '#1a1626', sky2: '#2e2840', far: '#2a2438', near: '#3a3050', top: '#7a6a9a', dirt: '#4a3e5e', dirtDark: '#342a44', brick: '#6a5a80', brickDark: '#4a3e5e', spike: '#d0c8e8', star: true },
  { sky1: '#8ed0f0', sky2: '#e8f8ff', far: '#c0e4f4', near: '#a0d0ea', top: '#f4fcff', dirt: '#7aaad0', dirtDark: '#5a88b0', brick: '#9cc8e8', brickDark: '#6a9ac0', spike: '#ffffff', star: false },
  { sky1: '#0e1830', sky2: '#24365a', far: '#1a2a40', near: '#16302a', top: '#3a7a4a', dirt: '#2a3a30', dirtDark: '#1a2620', brick: '#4a5a4a', brickDark: '#2a3a2a', spike: '#d8f0e0', star: true },
  { sky1: '#3a0e0e', sky2: '#8a2a10', far: '#5a1a10', near: '#401010', top: '#ff7a20', dirt: '#5a2a1a', dirtDark: '#3a1a10', brick: '#7a3a20', brickDark: '#4a2010', spike: '#ffd0a0', star: false },
  { sky1: '#1e2630', sky2: '#4a5866', far: '#36424e', near: '#2a343e', top: '#9ab0c0', dirt: '#56646e', dirtDark: '#3a4650', brick: '#7a8a96', brickDark: '#4e5c66', spike: '#f0f4f8', star: false },
  { sky1: '#12001e', sky2: '#3a1050', far: '#2a0a3a', near: '#1e0830', top: '#c060ff', dirt: '#3a1a50', dirtDark: '#24103a', brick: '#6a3a8a', brickDark: '#40205a', spike: '#f0d0ff', star: true },
  { sky1: '#000000', sky2: '#2a0000', far: '#140000', near: '#0a0000', top: '#ff2a2a', dirt: '#2a0a0a', dirtDark: '#160404', brick: '#4a1010', brickDark: '#2a0808', spike: '#ffe0e0', star: true },
  // 11 天空の浮島
  { sky1: '#3a8ee8', sky2: '#c8ecff', far: '#ffffff', near: '#e4f4ff', top: '#7ae070', dirt: '#b08a60', dirtDark: '#8a6a44', brick: '#e8d0a0', brickDark: '#b09870', spike: '#ffffff', star: false },
  // 12 氷の宮殿
  { sky1: '#2a3a7a', sky2: '#8ab0e8', far: '#5a74b8', near: '#7a96d0', top: '#e8f6ff', dirt: '#5a78b0', dirtDark: '#40598a', brick: '#a0c4f0', brickDark: '#6a8ec8', spike: '#f0faff', star: true },
  // 13 鋼鉄の工場
  { sky1: '#2a2018', sky2: '#6a4a2a', far: '#3e3226', near: '#2e261e', top: '#d0a040', dirt: '#5a5650', dirtDark: '#3e3a36', brick: '#8a7a60', brickDark: '#5a4e3c', spike: '#ffe8c0', star: false },
  // 14 深淵
  { sky1: '#02040a', sky2: '#0a1a24', far: '#06121a', near: '#040c12', top: '#30c0b0', dirt: '#14262c', dirtDark: '#0a161a', brick: '#24444a', brickDark: '#14282c', spike: '#c0fff4', star: true },
  // 15 終焉
  { sky1: '#100018', sky2: '#4a0a20', far: '#2a0a1a', near: '#1a0610', top: '#f0e0ff', dirt: '#2a1830', dirtDark: '#180c1e', brick: '#5a3a6a', brickDark: '#3a2048', spike: '#fff0f8', star: true },
];

const SPR_PLAYER = [
  '...kkkkkk...',
  '..kwwwwwwk..',
  '.kwwwwwwwwk.',
  '.kwwkwwkwwk.',
  '.kwwkwwkwwk.',
  '.kwwwwwwwwk.',
  '..kkrrrrkk..',
  '.krrrrrrrrk.',
  '.kwkrrrrkwk.',
  '..kwwwwwwk..',
  '..kwwwwwwk..',
  '..kwwkkwwk..',
  '..kkk..kkk..',
  '............',
];

const SPR_WALKER = [
  '....kkkk....',
  '..kkppppkk..',
  '.kppppppppk.',
  '.kpwkppwkpk.',
  'kppwkppwkppk',
  'kppppppppppk',
  'kpppkkkkpppk',
  '.kppppppppk.',
  '..kkkkkkkk..',
  '.kk.k..k.kk.',
  '.kk......kk.',
  '............',
];

const SPR_FLYER = [
  'k..........k',
  'kk..kkkk..kk',
  'kpkkppppkkpk',
  'kpppwkpwkppk',
  '.kppwkpwkpk.',
  '..kppppppk..',
  '...kprrpk...',
  '....kkkk....',
  '............',
  '............',
];

function sprite(ctx: CanvasRenderingContext2D, rows: string[], x: number, y: number, pal: Record<string, string>, flip = false, flipY = false) {
  const w = rows[0].length;
  const h = rows.length;
  for (let j = 0; j < h; j++) {
    const r = rows[j];
    for (let i = 0; i < w; i++) {
      const c = r[i];
      if (c === '.') continue;
      ctx.fillStyle = pal[c];
      ctx.fillRect(x + (flip ? w - 1 - i : i), y + (flipY ? h - 1 - j : j), 1, 1);
    }
  }
}

function h2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  viewW = 480;
  scale = 1;
  private levelCanvas: HTMLCanvasElement | null = null;
  private levelRef: Level | null = null;
  particles: Particle[] = [];
  shake = 0;
  camX = 0;
  camY = 0;
  /** 描画する高さ（ゲームは VIEW_H。エディタは面全体の高さにする） */
  viewH = VIEW_H;
  /** 暗闇を描かない（エディタの編集画面用） */
  noDark = false;
  private darkCanvas: HTMLCanvasElement | null = null;
  private fbHp = -1; // 最終ボスの体力の変化を見て演出する

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  resize(cssW: number, cssH: number) {
    const aspect = cssW / cssH;
    this.viewW = Math.max(400, Math.min(640, Math.round(VIEW_H * aspect)));
    const dpr = window.devicePixelRatio || 1;
    this.scale = Math.max(1, Math.min(4, Math.round((cssH * dpr) / VIEW_H)));
    this.canvas.width = this.viewW * this.scale;
    this.canvas.height = VIEW_H * this.scale;
  }

  pal(world: number): Palette {
    return PALETTES[(world - 1) % PALETTES.length];
  }

  private buildLevel(L: Level) {
    const c = document.createElement('canvas');
    c.width = L.w * TILE;
    c.height = L.h * TILE;
    const g = c.getContext('2d')!;
    const P = this.pal(L.world);
    for (let ty = 0; ty < L.h; ty++) {
      for (let tx = 0; tx < L.w; tx++) {
        const t = L.tiles[ty * L.w + tx];
        const x = tx * TILE;
        const y = ty * TILE;
        const above = ty > 0 ? L.tiles[(ty - 1) * L.w + tx] : T.EMPTY;
        switch (t) {
          case T.SOLID: {
            g.fillStyle = P.dirt;
            g.fillRect(x, y, TILE, TILE);
            const hv = h2(tx, ty);
            g.fillStyle = P.dirtDark;
            g.fillRect(x + (hv % 12) + 1, y + ((hv >> 4) % 12) + 1, 2, 2);
            g.fillRect(x + ((hv >> 8) % 12) + 2, y + ((hv >> 12) % 12) + 2, 1, 1);
            const covered = above === T.SPRING || above === T.ICE || above === T.CONV_L || above === T.CONV_R;
            if (above !== T.SOLID && above !== T.BRICK && !covered) {
              g.fillStyle = P.top;
              g.fillRect(x, y, TILE, 4);
              g.fillStyle = P.dirtDark;
              g.fillRect(x, y + 4, TILE, 1);
              if (hv % 3 === 0) {
                g.fillStyle = P.top;
                g.fillRect(x + (hv % 13), y + 4, 2, 2);
              }
            }
            break;
          }
          case T.BRICK:
            this.brick(g, x, y, P);
            break;
          case T.SPIKE_UP:
          case T.SPIKE_DOWN:
          case T.SPIKE_LEFT:
          case T.SPIKE_RIGHT:
            this.spike(g, x, y, t, P.spike);
            break;
          case T.ONEWAY:
            if (L.world === 11) {
              // 雲の足場
              g.fillStyle = '#ffffff';
              g.fillRect(x, y + 1, TILE, 4);
              g.fillRect(x + 2, y, TILE - 4, 6);
              g.fillStyle = 'rgba(160,200,240,0.8)';
              g.fillRect(x + 1, y + 5, TILE - 2, 1);
            } else {
              g.fillStyle = P.top;
              g.fillRect(x, y, TILE, 4);
            }
            break;
          case T.SPRING:
            g.fillStyle = P.dirt;
            g.fillRect(x, y + 8, TILE, 8);
            g.fillStyle = '#c8c8d0';
            for (let k = 0; k < 3; k++) g.fillRect(x + 3, y + 4 + k * 3, 10, 1);
            g.fillStyle = '#ff5a3a';
            g.fillRect(x + 1, y + 1, 14, 3);
            g.fillStyle = '#ffd0a0';
            g.fillRect(x + 2, y + 1, 12, 1);
            break;
          case T.ICE:
            g.fillStyle = '#b8e4ff';
            g.fillRect(x, y, TILE, TILE);
            g.fillStyle = '#e8f8ff';
            g.fillRect(x, y, TILE, 3);
            g.fillRect(x + 3, y + 5, 2, 6);
            g.fillStyle = '#7ab8e0';
            g.fillRect(x, y + 15, TILE, 1);
            g.fillRect(x + 10, y + 7, 3, 1);
            break;
          case T.CONV_L:
          case T.CONV_R:
            g.fillStyle = '#3a3a40';
            g.fillRect(x, y, TILE, TILE);
            g.fillStyle = '#6a6a74';
            g.fillRect(x, y + 1, TILE, 2);
            g.fillStyle = '#1e1e22';
            g.fillRect(x + 3, y + 7, 10, 6);
            break;
          case T.TURRET:
            g.fillStyle = '#2a2a34';
            g.fillRect(x + 1, y + 2, 14, 14);
            g.fillStyle = '#4a4a5a';
            g.fillRect(x + 2, y + 3, 12, 4);
            g.fillStyle = '#ff4040';
            g.fillRect(x + 6, y + 9, 4, 3);
            g.fillStyle = '#1a1a20';
            g.fillRect(x - 3, y + 4, 5, 6);
            break;
          case T.GOAL:
            if (above !== T.GOAL) {
              g.fillStyle = '#e0e0e0';
              g.fillRect(x + 7, y - 8, 2, TILE * 2 + 8);
              g.fillStyle = '#ffd040';
              g.fillRect(x + 6, y - 11, 4, 4);
            }
            break;
          case T.TRAP: {
            // ほんのわずかな手がかり：地面のひび
            g.fillStyle = 'rgba(0,0,0,0.25)';
            g.fillRect(x + 5, y + 15, 6, 1);
            break;
          }
        }
      }
    }
    this.levelCanvas = c;
    this.levelRef = L;
    this.fbHp = -1;
    // 縦に長い面は最初からプレイヤーの位置にカメラを合わせる
    if (L.h * TILE > this.viewH) {
      this.camY = Math.max(0, Math.min(L.h * TILE - this.viewH, L.startY * TILE - this.viewH * 0.55));
    } else this.camY = 0;
  }

  private brick(g: CanvasRenderingContext2D, x: number, y: number, P: Palette) {
    g.fillStyle = P.brick;
    g.fillRect(x, y, TILE, TILE);
    g.fillStyle = P.brickDark;
    g.fillRect(x, y + 7, TILE, 1);
    g.fillRect(x, y + 15, TILE, 1);
    g.fillRect(x + 7, y, 1, 7);
    g.fillRect(x + 3, y + 8, 1, 7);
    g.fillRect(x + 12, y + 8, 1, 7);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(x, y, TILE, 1);
  }

  private spike(g: CanvasRenderingContext2D, x: number, y: number, t: number, color: string, h = 1) {
    g.fillStyle = color;
    g.beginPath();
    const s = TILE;
    if (t === T.SPIKE_UP) {
      const top = y + s - s * h;
      g.moveTo(x + 1, y + s);
      g.lineTo(x + 4, top + 2 * h);
      g.lineTo(x + 7, y + s);
      g.moveTo(x + 8, y + s);
      g.lineTo(x + 12, top);
      g.lineTo(x + 15, y + s);
    } else if (t === T.SPIKE_DOWN) {
      g.moveTo(x + 1, y);
      g.lineTo(x + 4, y + s - 2);
      g.lineTo(x + 7, y);
      g.moveTo(x + 8, y);
      g.lineTo(x + 12, y + s);
      g.lineTo(x + 15, y);
    } else if (t === T.SPIKE_LEFT) {
      g.moveTo(x + s, y + 1);
      g.lineTo(x, y + 5);
      g.lineTo(x + s, y + 8);
      g.moveTo(x + s, y + 8);
      g.lineTo(x + 2, y + 12);
      g.lineTo(x + s, y + 15);
    } else {
      g.moveTo(x, y + 1);
      g.lineTo(x + s, y + 5);
      g.lineTo(x, y + 8);
      g.moveTo(x, y + 8);
      g.lineTo(x + s - 2, y + 12);
      g.lineTo(x, y + 15);
    }
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.25)';
    if (t === T.SPIKE_UP) g.fillRect(x, y + s - 1, s, 1);
  }

  burst(x: number, y: number, n: number, colors: string[], speed = 3) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.4 + Math.random()) * speed;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, life: 30 + Math.random() * 30, color: colors[i % colors.length] });
    }
  }

  draw(sim: Sim, frameTime: number, debugInfo = false) {
    const L = sim.level;
    if (this.levelRef !== L) this.buildLevel(L);
    const ctx = this.ctx;
    const P = this.pal(L.world);
    const W = this.viewW;
    const VH = this.viewH;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // カメラ
    const p = sim.p;
    const levelW = L.w * TILE;
    const levelH = L.h * TILE;
    const pcx = (p.x + PW / 2) / SUB;
    const pcy = (p.y + PH / 2) / SUB;
    if (levelW <= W) this.camX = -(W - levelW) / 2;
    else {
      const target = pcx - W * 0.4 + p.facing * 24;
      this.camX += (target - this.camX) * 0.12;
      this.camX = Math.max(0, Math.min(levelW - W, this.camX));
    }
    if (levelH <= VH) this.camY = 0;
    else {
      // 縦に長い面: 上に登る面なので、少し上が見えるように
      const target = pcy - VH * (p.grav < 0 ? 0.45 : 0.55);
      this.camY += (target - this.camY) * 0.15;
      this.camY = Math.max(0, Math.min(levelH - VH, this.camY));
    }
    let cx = Math.round(this.camX);
    const camY = Math.round(this.camY);
    let cy = 0;
    if (this.shake > 0) {
      cx += Math.round((Math.random() - 0.5) * this.shake);
      cy += Math.round((Math.random() - 0.5) * this.shake);
      this.shake *= 0.85;
      if (this.shake < 0.5) this.shake = 0;
    }

    // 最終ボスに当てたときの演出（sim のイベントは main 側で消費されるので、体力の変化で判定）
    const fb = sim.fboss;
    if (fb) {
      if (this.fbHp >= 0 && fb.hp < this.fbHp) {
        this.shake = 10;
        this.burst(fb.x / SUB + 24, fb.y / SUB + 4, 24, ['#fff', '#ff4060', '#ffd040', '#a0f0ff']);
      }
      this.fbHp = fb.hp;
    }

    // 背景
    const grd = ctx.createLinearGradient(0, 0, 0, VH);
    grd.addColorStop(0, P.sky1);
    grd.addColorStop(1, P.sky2);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, VH);
    if (P.star) {
      for (let i = 0; i < 60; i++) {
        const hv = h2(i, L.world);
        const sx = (((hv % 2000) - cx * 0.05) % W + W) % W;
        const sy = ((((hv >> 11) % 160) - camY * 0.05) % VH + VH) % VH;
        ctx.fillStyle = (hv >> 3) % 5 === 0 ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.45)';
        ctx.fillRect(Math.floor(sx), Math.floor(sy), 1, 1);
      }
    }
    // 遠景の丘（縦に長い面では下の方だけに見える）
    const hillOff = levelH > VH ? levelH - VH - camY : 0;
    this.hills(ctx, W, cx * 0.2, 150 + hillOff * 0.3, 50, P.far, 0.011, VH);
    this.hills(ctx, W, cx * 0.45, 190 + hillOff * 0.5, 36, P.near, 0.02, VH);

    ctx.save();
    ctx.translate(-cx, cy - camY);

    // 静的タイル
    if (this.levelCanvas) {
      const sx = Math.max(0, cx);
      const sw = Math.min(levelW - sx, W + 2);
      const sh = Math.min(levelH - camY, VH);
      if (sw > 0 && sh > 0) ctx.drawImage(this.levelCanvas, sx, camY, sw, sh, sx, camY, sw, sh);
    }
    if (levelW <= W) {
      ctx.fillStyle = '#000';
      ctx.fillRect(-W, camY, W, VH);
      ctx.fillRect(levelW, camY, W, VH);
    }

    // 動的タイル
    const tx0 = Math.max(0, Math.floor(cx / TILE) - 1);
    const tx1 = Math.min(L.w - 1, Math.ceil((cx + W) / TILE) + 1);
    const ty0 = Math.max(0, Math.floor(camY / TILE) - 1);
    const ty1 = Math.min(L.h - 1, Math.ceil((camY + VH) / TILE) + 1);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * L.w + tx;
        const t = L.tiles[i];
        const x = tx * TILE;
        const y = ty * TILE;
        if (t === T.CRUMBLE) {
          const s = sim.tstate[i];
          if (s < 0) {
            if (s > -20) {
              ctx.fillStyle = 'rgba(255,255,255,0.15)';
              ctx.fillRect(x + 2, y + 2, 12, 12);
            }
            continue;
          }
          const ox = s > 0 ? ((s >> 1) % 2 ? 1 : -1) : 0;
          ctx.fillStyle = s > CRUMBLE_DELAY * 0.6 ? '#c09060' : '#d8a870';
          ctx.fillRect(x + ox, y, TILE, TILE);
          ctx.fillStyle = '#7a5030';
          ctx.fillRect(x + ox, y + 15, TILE, 1);
          ctx.fillRect(x + ox + 4, y + 3, 1, 6);
          ctx.fillRect(x + ox + 5, y + 8, 4, 1);
          ctx.fillRect(x + ox + 10, y + 5, 1, 8);
        } else if (t === T.ABLOCK || t === T.BBLOCK) {
          const on = t === T.ABLOCK ? !sim.switchOn : sim.switchOn;
          const col = t === T.ABLOCK ? '#ff5a8a' : '#4ab0ff';
          if (on) {
            ctx.fillStyle = col;
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(x + 3, y + 3, 10, 10);
            ctx.fillStyle = col;
            ctx.fillRect(x + 5, y + 5, 6, 6);
          } else {
            ctx.strokeStyle = col;
            ctx.globalAlpha = 0.5;
            ctx.setLineDash([2, 2]);
            ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
          }
        } else if (t === T.SWITCH) {
          ctx.fillStyle = '#3a3a48';
          ctx.fillRect(x, y + 6, TILE, 10);
          ctx.fillStyle = sim.switchOn ? '#4ab0ff' : '#ff5a8a';
          ctx.fillRect(x + 3, y + (sim.latch ? 4 : 2), 10, sim.latch ? 2 : 4);
          ctx.fillStyle = '#5a5a6a';
          ctx.fillRect(x + 1, y + 6, 14, 2);
        } else if (t === T.TRAP) {
          const s = sim.tstate[i];
          if (s > 0) this.spike(ctx, x, y, T.SPIKE_UP, '#ff6060', Math.min(1, s / 4));
        } else if (t === T.GOAL && ty > 0 && L.tiles[i - L.w] !== T.GOAL) {
          const wave = Math.floor(frameTime / 8) % 2;
          ctx.fillStyle = '#ff4060';
          ctx.fillRect(x + 9, y - 7, 9, 6 + wave);
          ctx.fillStyle = '#fff';
          ctx.fillRect(x + 12, y - 5, 3, 2);
        } else if (t === T.WIND_R || t === T.WIND_L) {
          // 風の筋（流れる向きに動く）
          const dir = t === T.WIND_R ? 1 : -1;
          const hv = h2(tx, ty);
          const off = (((frameTime * 2 * dir + (hv % 16)) % 16) + 16) % 16;
          ctx.fillStyle = 'rgba(255,255,255,0.10)';
          ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.fillRect(x + off, y + 4 + (hv % 8), 6 - (off > 10 ? off - 10 : 0), 1);
        } else if (t === T.WIND_U) {
          const hv = h2(tx, ty);
          const off = (((-frameTime * 3 + (hv % 16)) % 16) + 16) % 16;
          ctx.fillStyle = 'rgba(200,255,240,0.13)';
          ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = 'rgba(255,255,255,0.6)';
          ctx.fillRect(x + 3 + (hv % 10), y + off, 1, 5 - (off > 11 ? off - 11 : 0));
        } else if (t === T.CONV_L || t === T.CONV_R) {
          // ベルトの矢印が流れる向きに動く
          const dir = t === T.CONV_R ? 1 : -1;
          const off = (((frameTime * dir) % 8) + 8) % 8;
          ctx.fillStyle = '#ffc040';
          for (let k = -8; k < 16; k += 8) {
            const ax = x + k + off;
            if (ax < x || ax > x + 12) continue;
            if (dir > 0) {
              ctx.fillRect(ax, y + 8, 2, 4);
              ctx.fillRect(ax + 2, y + 9, 1, 2);
            } else {
              ctx.fillRect(ax + 1, y + 8, 2, 4);
              ctx.fillRect(ax, y + 9, 1, 2);
            }
          }
        } else if (t === T.ICICLE) {
          const s = sim.tstate[i];
          if (s < 0) continue;
          const ox = s > 0 ? ((s >> 1) % 2 ? 1 : -1) : 0;
          this.icicle(ctx, x + ox, y, s > 0);
        } else if (t === T.DOOR) {
          if (sim.tstate[i] === 0) {
            ctx.fillStyle = '#8a5a20';
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = '#c08a40';
            ctx.fillRect(x + 2, y, 5, TILE);
            ctx.fillRect(x + 9, y, 5, TILE);
            ctx.fillStyle = '#ffd040';
            const below = ty + 1 < L.h ? L.tiles[i + L.w] : T.EMPTY;
            if (below !== T.DOOR) {
              // 鍵穴
              ctx.fillRect(x + 6, y + 4, 4, 4);
              ctx.fillStyle = '#2a1a08';
              ctx.fillRect(x + 7, y + 5, 2, 2);
              ctx.fillRect(x + 7, y + 7, 2, 3);
            }
          } else {
            ctx.strokeStyle = 'rgba(255,208,64,0.35)';
            ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
          }
        } else if (t === T.GRAV_UP || t === T.GRAV_DOWN) {
          const up = t === T.GRAV_UP;
          ctx.fillStyle = up ? 'rgba(200,80,255,0.22)' : 'rgba(80,220,255,0.22)';
          ctx.fillRect(x, y, TILE, TILE);
          const off = Math.floor(frameTime / 3) % 16;
          const ay = up ? y + 15 - off : y + off;
          ctx.fillStyle = up ? '#e0a0ff' : '#a0f0ff';
          ctx.fillRect(x + 7, ay, 2, 2);
          ctx.fillRect(x + 5, ay + (up ? 2 : -2), 6, 1);
        }
      }
    }

    // 敵・移動床
    for (const e of sim.ents) {
      const ex = e.x / SUB;
      const ey = e.y / SUB;
      if (ex + e.w / SUB < cx - 16 || ex > cx + W + 16) continue;
      if (ey + e.h / SUB < camY - 16 || ey > camY + VH + 16) continue;
      if (e.kind === E_PLAT_H || e.kind === E_PLAT_V) {
        const w = e.w / SUB;
        ctx.fillStyle = '#f0e0a0';
        ctx.fillRect(ex, ey, w, 6);
        ctx.fillStyle = '#a08040';
        for (let k = 2; k < w; k += 6) ctx.fillRect(ex + k, ey + 2, 3, 2);
        ctx.fillStyle = '#705020';
        ctx.fillRect(ex, ey + 5, w, 1);
      } else if (e.kind === E_LASER) this.drawLaser(ctx, sim, e, frameTime);
      else if (e.kind === E_CRUSHER) this.drawCrusher(ctx, e, sim, frameTime);
      else if (e.kind === E_SAW) this.drawSaw(ctx, e, frameTime);
      else if (!e.alive) {
        if (e.kind === E_ORB) {
          // 復活待ちのオーブ（うっすら）
          ctx.strokeStyle = 'rgba(160,255,240,0.3)';
          ctx.strokeRect(Math.round(ex) + 6.5, Math.round(ey) + 6.5, 7, 7);
        }
        continue;
      } else if (e.kind === E_WALKER) {
        sprite(ctx, SPR_WALKER, Math.round(ex), Math.round(ey), { k: '#1a1018', p: '#c03a4a', w: '#fff' }, e.dir > 0);
        if (Math.floor(frameTime / 8) % 2) {
          ctx.fillStyle = '#1a1018';
          ctx.fillRect(Math.round(ex) + 4, Math.round(ey) + 10, 4, 1);
        }
      } else if (e.kind === E_FLYER) {
        const flap = Math.floor(frameTime / 6) % 2;
        sprite(ctx, SPR_FLYER, Math.round(ex), Math.round(ey) + flap, { k: '#140c20', p: '#8a4ad0', w: '#fff', r: '#ff4060' });
      } else if (e.kind === E_TURRET) {
        // 発射予兆
        const until = (e.period - ((sim.frame + e.phase) % e.period)) % e.period;
        if (until < 20 && until > 0) {
          ctx.fillStyle = until % 4 < 2 ? '#ffee60' : '#ff4040';
          ctx.fillRect(ex + 6, ey + 9, 4, 3);
        }
      } else if (e.kind === E_ORB) {
        const pulse = Math.floor(frameTime / 8) % 2;
        const X = Math.round(ex) + 4;
        const Y = Math.round(ey) + 4 + (Math.floor(frameTime / 16) % 2);
        ctx.fillStyle = 'rgba(120,255,230,0.35)';
        ctx.fillRect(X - 2, Y - 2, 16, 16);
        ctx.fillStyle = '#40e0c8';
        ctx.fillRect(X + 1, Y + 1, 10, 10);
        ctx.fillStyle = pulse ? '#ffffff' : '#c0fff4';
        ctx.fillRect(X + 3, Y + 3, 6, 6);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(X + 4, Y + 2, 2, 1);
      } else if (e.kind === E_KEY) {
        const X = Math.round(ex);
        const Y = Math.round(ey) + (Math.floor(frameTime / 12) % 2);
        this.keyIcon(ctx, X, Y);
      }
    }

    // ボス
    if (sim.boss) this.drawBoss(ctx, sim, frameTime);
    if (fb) this.drawFBoss(ctx, sim, frameTime);

    // 弾
    for (const b of sim.bullets) {
      const bx = b.x / SUB;
      const by = b.y / SUB;
      const bw = b.w / SUB;
      const bh = b.h / SUB;
      if (b.kind === B_TURRET) {
        ctx.fillStyle = '#ffee60';
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = '#ff7020';
        ctx.fillRect(bx + 1, by + 1, bw - 2, bh - 2);
      } else if (b.kind === B_BOSS) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = '#ff2a6a';
        ctx.fillRect(bx + 1, by + 1, bw - 2, bh - 2);
      } else if (b.kind === B_WAVE) {
        ctx.fillStyle = Math.floor(frameTime / 3) % 2 ? '#ffb040' : '#ff6020';
        ctx.fillRect(bx, by + 2, bw, bh - 2);
        ctx.fillRect(bx + 2, by, bw - 4, 2);
      } else if (b.kind === B_RAIN) {
        this.spike(ctx, bx - 3, by - 2, T.SPIKE_DOWN, '#ff4040');
      } else if (b.kind === B_ICICLE) {
        this.icicle(ctx, bx - 4, by, false);
      } else if (b.kind === B_FRAIN) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = '#c040ff';
        ctx.fillRect(bx + 2, by + 2, bw - 4, bh - 4);
        ctx.fillStyle = 'rgba(200,100,255,0.4)';
        ctx.fillRect(bx + 3, by - 6, bw - 6, 6);
      }
    }

    // プレイヤー
    if (!sim.dead) {
      const x = Math.round(p.x / SUB) - 1;
      const y = Math.round(p.y / SUB);
      const blink = sim.invincible && Math.floor(frameTime / 4) % 2;
      if (!blink) {
        const run = p.onGround && Math.abs(p.vx) > 64 && Math.floor(frameTime / 6) % 2;
        const flipY = p.grav < 0;
        sprite(ctx, SPR_PLAYER, x, y + (run ? (flipY ? 1 : -1) : 0), { k: '#101018', w: '#f4f4ff', r: '#ff3a50' }, p.facing < 0, flipY);
        if (p.air > 0) {
          // 空中ジャンプが使える印
          ctx.fillStyle = Math.floor(frameTime / 4) % 2 ? '#a0fff0' : '#40e0c8';
          ctx.fillRect(x + 1, y + (flipY ? -3 : PH / SUB + 1), 10, 2);
        }
      }
    }

    // パーティクル
    for (const q of this.particles) {
      q.x += q.vx;
      q.y += q.vy;
      q.vy += 0.15;
      q.life--;
      ctx.fillStyle = q.color;
      ctx.fillRect(Math.round(q.x), Math.round(q.y), 2, 2);
    }
    this.particles = this.particles.filter((q) => q.life > 0);

    // 迫る壁・せり上がる溶岩
    if (L.chase) this.drawChase(ctx, sim, frameTime, cx, camY, W, VH);

    if (debugInfo) {
      ctx.strokeStyle = 'rgba(0,255,0,0.8)';
      ctx.strokeRect(p.x / SUB + 0.5, p.y / SUB + 0.5, PW / SUB - 1, PH / SUB - 1);
    }
    ctx.restore();

    // 暗闇
    if (L.dark && !this.noDark) this.drawDark(ctx, sim, cx, camY - cy, W, VH, frameTime);

    // 持っている鍵
    if (sim.keys > 0) {
      for (let k = 0; k < sim.keys; k++) this.keyIcon(ctx, 8 + k * 14, 40);
    }

    // ボスHP
    if (sim.boss && sim.boss.state !== 'dead') {
      const b = sim.boss;
      const bw = 160;
      const x0 = Math.round((W - bw) / 2);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x0 - 2, 34, bw + 4, 8);
      for (let i = 0; i < b.maxHp; i++) {
        ctx.fillStyle = i < b.hp ? '#ff2a4a' : '#402028';
        ctx.fillRect(x0 + i * (bw / b.maxHp) + 1, 36, bw / b.maxHp - 2, 4);
      }
    }
    if (fb && fb.state !== 'dead') {
      const bw = 216;
      const x0 = Math.round((W - bw) / 2);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x0 - 2, 34, bw + 4, 8);
      const seg = bw / fb.maxHp;
      const cols = ['#ff2a4a', '#ff8a20', '#c040ff'];
      for (let i = 0; i < fb.maxHp; i++) {
        ctx.fillStyle = i < fb.hp ? cols[Math.min(2, Math.floor((fb.maxHp - 1 - i) / 3))] : '#402028';
        ctx.fillRect(x0 + i * seg + 1, 36, seg - 2, 4);
      }
    }
  }

  private icicle(g: CanvasRenderingContext2D, x: number, y: number, shaking: boolean) {
    g.fillStyle = shaking ? '#ffffff' : '#d8f4ff';
    g.beginPath();
    g.moveTo(x + 3, y);
    g.lineTo(x + 13, y);
    g.lineTo(x + 8, y + 13);
    g.fill();
    g.fillStyle = '#7ac0f0';
    g.fillRect(x + 8, y + 1, 2, 7);
  }

  private keyIcon(g: CanvasRenderingContext2D, X: number, Y: number) {
    g.fillStyle = '#2a1a08';
    g.fillRect(X, Y, 10, 12);
    g.fillStyle = '#ffd040';
    g.fillRect(X + 1, Y + 1, 8, 5);
    g.fillRect(X + 4, Y + 5, 2, 6);
    g.fillRect(X + 6, Y + 8, 2, 1);
    g.fillRect(X + 6, Y + 10, 2, 1);
    g.fillStyle = '#2a1a08';
    g.fillRect(X + 3, Y + 2, 4, 3);
    g.fillStyle = '#fff6b0';
    g.fillRect(X + 1, Y + 1, 2, 1);
  }

  private drawLaser(ctx: CanvasRenderingContext2D, sim: Sim, e: Sim['ents'][number], ft: number) {
    const t = (sim.frame + e.phase) % e.period;
    const onAt = e.period - e.range;
    const on = t >= onAt;
    const warn = !on && t >= onAt - LASER_WARN;
    const x = e.x / SUB;
    const y = e.y / SUB;
    const w = e.w / SUB;
    const h = e.h / SUB;
    // 発射口（光線の根元）
    const ox = e.dir === 1 ? x - 16 : e.dir === 3 ? x + w : x - 5;
    const oy = e.dir === 2 ? y - 16 : e.dir === 0 ? y + h : y - 5;
    ctx.fillStyle = '#30303a';
    if (e.dir === 1 || e.dir === 3) ctx.fillRect(ox + 2, oy + 2, 12, 12);
    else ctx.fillRect(ox + 2, oy + 2, 12, 12);
    ctx.fillStyle = on ? '#ff3040' : warn && ft % 6 < 3 ? '#ffd040' : '#802028';
    ctx.fillRect(ox + 5, oy + 5, 6, 6);
    if (on) {
      ctx.fillStyle = 'rgba(255,60,80,0.35)';
      ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
      ctx.fillStyle = '#ff3a4a';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#ffe0e4';
      if (w > h) ctx.fillRect(x, y + 2, w, 2);
      else ctx.fillRect(x + 2, y, 2, h);
    } else if (warn) {
      // 予兆: 細い点線
      ctx.fillStyle = ft % 6 < 3 ? 'rgba(255,220,80,0.8)' : 'rgba(255,80,80,0.5)';
      if (w > h) for (let k = 0; k < w; k += 6) ctx.fillRect(x + k, y + 2, 3, 1);
      else for (let k = 0; k < h; k += 6) ctx.fillRect(x + 2, y + k, 1, 3);
    }
  }

  private drawCrusher(ctx: CanvasRenderingContext2D, e: Sim['ents'][number], sim: Sim, ft: number) {
    const shake = e.st === 1 ? ((CRUSHER_SHAKE - e.tm) % 2 ? 1 : -1) : 0;
    const x = Math.round(e.x / SUB) + shake;
    const y = Math.round(e.y / SUB);
    const w = e.w / SUB;
    const h = e.h / SUB;
    // 吊り下げの鎖
    const oy = e.oy / SUB;
    ctx.fillStyle = '#6a7a90';
    for (let k = oy - 16; k < y; k += 4) ctx.fillRect(x + w / 2 - 1, k, 2, 2);
    ctx.fillStyle = '#20304a';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = e.st === 1 || e.st === 2 ? '#c0d8ff' : '#8aa8d8';
    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    ctx.fillStyle = '#e8f4ff';
    ctx.fillRect(x + 2, y + 2, w - 4, 2);
    // 下側のトゲ
    ctx.fillStyle = '#ffffff';
    for (let k = 0; k < w; k += 4) ctx.fillRect(x + k + 1, y + h - 2, 2, 2);
    // 顔（プレイヤーが近いと怒る）
    const near = Math.abs(sim.p.x / SUB - (x + w / 2)) < 48;
    ctx.fillStyle = '#10182a';
    const ey = y + 10;
    ctx.fillRect(x + 6, ey, 6, near || e.st > 0 ? 3 : 5);
    ctx.fillRect(x + w - 12, ey, 6, near || e.st > 0 ? 3 : 5);
    if (near || e.st > 0) {
      ctx.fillRect(x + 5, ey - 2, 7, 1);
      ctx.fillRect(x + w - 12, ey - 2, 7, 1);
    }
    ctx.fillRect(x + 9, y + 20, w - 18, 2);
    void ft;
  }

  private drawSaw(ctx: CanvasRenderingContext2D, e: Sim['ents'][number], ft: number) {
    const cx = (e.x + e.w / 2) / SUB;
    const cy = (e.y + e.h / 2) / SUB;
    // 軌道
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    const ox = e.ox / SUB;
    const oy = e.oy / SUB;
    const tw = e.range / SUB;
    const th = e.period / SUB;
    ctx.strokeRect(ox, oy, Math.max(tw, 0.5), Math.max(th, 0.5));
    ctx.lineWidth = 1;
    const r = 8;
    const a0 = ft * 0.35;
    ctx.fillStyle = '#d8dce4';
    ctx.beginPath();
    for (let k = 0; k < 16; k++) {
      const a = a0 + (k * Math.PI) / 8;
      const rr = k % 2 ? r : r - 3;
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#606878';
    ctx.fillRect(cx - 2, cy - 2, 4, 4);
    ctx.fillStyle = '#ff4040';
    ctx.fillRect(cx - 1, cy - 1, 2, 2);
  }

  private drawChase(ctx: CanvasRenderingContext2D, sim: Sim, ft: number, cx: number, camY: number, W: number, VH: number) {
    const c = sim.level.chase!;
    const pos = sim.chase / SUB;
    if (c.dir === 'right') {
      if (pos < cx - 40) return;
      // 迫る壁（トゲの付いた黒い壁）
      const x0 = cx - 4;
      ctx.fillStyle = '#100810';
      ctx.fillRect(x0, camY, pos - x0, VH);
      ctx.fillStyle = '#ff3050';
      for (let y = Math.floor(camY / 8) * 8; y < camY + VH; y += 8) {
        ctx.beginPath();
        ctx.moveTo(pos, y);
        ctx.lineTo(pos + 6, y + 4);
        ctx.lineTo(pos, y + 8);
        ctx.fill();
      }
      ctx.fillStyle = ft % 10 < 5 ? 'rgba(255,40,80,0.35)' : 'rgba(255,40,80,0.18)';
      ctx.fillRect(pos - 6, camY, 6, VH);
    } else {
      if (pos > camY + VH + 20) {
        // 画面の下にいる間は、近づき具合を画面下端に示す
        const dist = pos - (camY + VH);
        if (dist < 200) {
          ctx.fillStyle = `rgba(255,90,20,${0.15 + (0.35 * (200 - dist)) / 200})`;
          ctx.fillRect(cx, camY + VH - 4, W, 4);
        }
        return;
      }
      // 溶岩
      ctx.fillStyle = '#c02810';
      ctx.fillRect(cx - 4, pos + 3, W + 8, camY + VH - pos + 8);
      ctx.fillStyle = '#ff7a20';
      for (let x = Math.floor(cx / 8) * 8 - 8; x < cx + W + 8; x += 8) {
        const wv = ((x / 8 + Math.floor(ft / 6)) % 2) * 2;
        ctx.fillRect(x, pos + wv, 8, 4);
      }
      ctx.fillStyle = '#ffd040';
      for (let x = Math.floor(cx / 16) * 16; x < cx + W; x += 16) {
        if (h2(x, Math.floor(ft / 10)) % 5 === 0) ctx.fillRect(x + 6, pos + 6, 2, 2);
      }
    }
  }

  private drawDark(ctx: CanvasRenderingContext2D, sim: Sim, cx: number, camY: number, W: number, VH: number, ft: number) {
    if (!this.darkCanvas) this.darkCanvas = document.createElement('canvas');
    const dc = this.darkCanvas;
    if (dc.width !== W || dc.height !== VH) {
      dc.width = W;
      dc.height = VH;
    }
    const g = dc.getContext('2d')!;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, VH);
    g.fillStyle = 'rgba(2,4,8,0.9)';
    g.fillRect(0, 0, W, VH);
    g.globalCompositeOperation = 'destination-out';
    const hole = (x: number, y: number, r: number, a = 1) => {
      const sx = x - cx;
      const sy = y - camY;
      if (sx < -r || sx > W + r || sy < -r || sy > VH + r) return;
      const gr = g.createRadialGradient(sx, sy, r * 0.25, sx, sy, r);
      gr.addColorStop(0, `rgba(0,0,0,${a})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(sx - r, sy - r, r * 2, r * 2);
    };
    const p = sim.p;
    const flick = (ft >> 3) % 3;
    hole((p.x + PW / 2) / SUB, (p.y + PH / 2) / SUB, 76 + flick, 1);
    const L = sim.level;
    for (const e of sim.ents) {
      const ex = (e.x + e.w / 2) / SUB;
      const ey = (e.y + e.h / 2) / SUB;
      if (e.kind === E_ORB && e.alive) hole(ex, ey, 30, 0.9);
      else if (e.kind === E_KEY && e.alive) hole(ex, ey, 24, 0.8);
      else if (e.kind === E_SAW) hole(ex, ey, 22, 0.7);
      else if (e.kind === E_TURRET) hole(ex, ey, 16, 0.5);
      else if (e.kind === E_LASER) {
        const t = (sim.frame + e.phase) % e.period;
        if (t >= e.period - e.range - LASER_WARN) {
          const n = Math.max(1, Math.floor(Math.max(e.w, e.h) / (TILE * SUB)));
          for (let k = 0; k < n; k++) {
            const f = (k + 0.5) / n;
            hole((e.x + (e.w > e.h ? e.w * f : e.w / 2)) / SUB, (e.y + (e.h > e.w ? e.h * f : e.h / 2)) / SUB, 18, 0.7);
          }
        }
      }
    }
    for (const b of sim.bullets) hole((b.x + b.w / 2) / SUB, (b.y + b.h / 2) / SUB, 14, 0.7);
    // ゴールの旗は遠くからでも少し見える
    const tx0 = Math.max(0, Math.floor(cx / TILE) - 4);
    const tx1 = Math.min(L.w - 1, Math.ceil((cx + W) / TILE) + 4);
    const ty0 = Math.max(0, Math.floor(camY / TILE) - 4);
    const ty1 = Math.min(L.h - 1, Math.ceil((camY + VH) / TILE) + 4);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = L.tiles[ty * L.w + tx];
        if (t === T.GOAL && (ty === 0 || L.tiles[(ty - 1) * L.w + tx] !== T.GOAL)) hole(tx * TILE + 8, ty * TILE + 4, 40, 0.9);
        else if (t === T.SPRING || t === T.GRAV_UP || t === T.GRAV_DOWN) hole(tx * TILE + 8, ty * TILE + 8, 12, 0.45);
      }
    }
    ctx.drawImage(dc, 0, 0);
  }

  private drawFBoss(ctx: CanvasRenderingContext2D, sim: Sim, ft: number) {
    const b = sim.fboss!;
    if (b.state === 'dead') return;
    const L = sim.level;
    const st = b.state;
    const blink = ft % 8 < 4;
    // ---- 予兆 ----
    if (st === 'tele_slam') {
      const tx = Math.round(b.targetX / SUB);
      ctx.fillStyle = blink ? 'rgba(255,40,60,0.65)' : 'rgba(255,40,60,0.25)';
      ctx.fillRect(tx, FB_FLOOR / SUB - 4, b.w / SUB, 4);
      ctx.fillStyle = 'rgba(255,40,60,0.12)';
      ctx.fillRect(tx, b.y / SUB + b.h / SUB, b.w / SUB, FB_FLOOR / SUB - (b.y + b.h) / SUB);
    }
    if (st === 'tele_beam' || st === 'beam') {
      const [by, bh] = b.beamHigh ? FB_BEAM_HIGH : FB_BEAM_LOW;
      const y = by / SUB;
      const h = bh / SUB;
      const x0 = TILE;
      const w = (L.w - 2) * TILE;
      if (st === 'tele_beam') {
        ctx.fillStyle = blink ? 'rgba(255,220,60,0.75)' : 'rgba(255,80,60,0.4)';
        for (let k = 0; k < w; k += 8) ctx.fillRect(x0 + k, y + h / 2 - 1, 5, 2);
        // 「跳べ／跳ぶな」が分かる矢印
        ctx.fillStyle = blink ? '#ffe040' : '#ff6040';
        for (const ax of [x0 + 8, x0 + w - 16]) {
          if (b.beamHigh) {
            ctx.fillRect(ax + 3, y + h + 4, 2, 8);
            ctx.fillRect(ax, y + h + 10, 8, 2);
          } else {
            ctx.fillRect(ax + 3, y - 12, 2, 8);
            ctx.fillRect(ax, y - 14, 8, 2);
          }
        }
      } else {
        ctx.fillStyle = 'rgba(255,60,200,0.35)';
        ctx.fillRect(x0, y - 3, w, h + 6);
        ctx.fillStyle = '#ff40c0';
        ctx.fillRect(x0, y, w, h);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x0, y + 3, w, 2);
      }
    }
    if (st === 'tele_pillar' || st === 'pillar') {
      for (const c of b.cols) {
        const x = c * TILE;
        const top = (FB_FLOOR - FB_PILLAR_H) / SUB;
        if (st === 'tele_pillar') {
          ctx.fillStyle = blink ? 'rgba(255,40,60,0.45)' : 'rgba(255,40,60,0.15)';
          ctx.fillRect(x + 1, top, TILE * 2 - 2, FB_PILLAR_H / SUB);
          ctx.fillStyle = '#ff4060';
          ctx.fillRect(x + 1, FB_FLOOR / SUB - 2, TILE * 2 - 2, 2);
        } else {
          for (let k = 0; k < 2; k++) {
            for (let yy = FB_FLOOR / SUB - TILE; yy >= top; yy -= TILE) this.spike(ctx, x + k * TILE, yy, T.SPIKE_UP, '#ff5a7a');
          }
        }
      }
    }
    if (st === 'tele_rain') {
      for (const c of b.cols) {
        ctx.fillStyle = blink ? 'rgba(200,80,255,0.5)' : 'rgba(200,80,255,0.18)';
        ctx.fillRect(c * TILE + 2, TILE, 12, FB_FLOOR / SUB - TILE);
      }
    }
    if (st === 'dying') {
      if (ft % 5 === 0) this.burst(b.x / SUB + Math.random() * 48, b.y / SUB + Math.random() * 40, 8, ['#fff', '#ff4060', '#ffd040', '#c080ff'], 3);
      if (ft % 4 < 2) return;
    }
    if (st === 'transform' && ft % 6 < 3) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(b.x / SUB) - 2, Math.round(b.y / SUB) - 2, b.w / SUB + 4, b.h / SUB + 4);
      return;
    }
    if (st === 'recover' && ft % 4 < 2) return;

    // ---- 本体（48×40）----
    const shakeX = st === 'tele_slam' ? (ft % 2 ? 1 : -1) : 0;
    const X = Math.round(b.x / SUB) + shakeX;
    const Y = Math.round(b.y / SUB);
    const w = b.w / SUB;
    const h = b.h / SUB;
    const form = b.form;
    const body = ['#2a1040', '#3a1018', '#140a28'][form - 1];
    const rim = ['#c060ff', '#ff6030', '#f0f0ff'][form - 1];
    const tele = st.startsWith('tele_');
    // 翼（形態ごとに増える）
    ctx.fillStyle = rim;
    const flap = Math.floor(ft / 8) % 2;
    for (let k = 0; k < form; k++) {
      const wy = Y + 6 + k * 9 + flap;
      ctx.fillRect(X - 8 - k * 3, wy, 8 + k * 3, 3);
      ctx.fillRect(X + w, wy, 8 + k * 3, 3);
    }
    ctx.fillStyle = '#05020a';
    ctx.fillRect(X - 1, Y - 1, w + 2, h + 2);
    ctx.fillStyle = tele && blink ? '#ff3050' : st === 'stun' ? '#5a4a6a' : body;
    ctx.fillRect(X + 1, Y + 1, w - 2, h - 2);
    ctx.fillStyle = rim;
    ctx.fillRect(X + 1, Y + 1, w - 2, 2);
    ctx.fillRect(X + 1, Y + h - 3, w - 2, 2);
    // 角（気絶中は引っ込み、頭の弱点が光る＝踏める合図）
    if (st === 'stun') {
      ctx.fillStyle = ft % 10 < 5 ? '#ffe040' : '#fff6b0';
      ctx.fillRect(X + 6, Y - 2, w - 12, 5);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(X + 12, Y + 14, 8, 8);
      ctx.fillRect(X + w - 20, Y + 14, 8, 8);
      ctx.fillStyle = '#000';
      const o = Math.floor(ft / 6) % 4;
      ctx.fillRect(X + 13 + (o % 2) * 4, Y + 15 + (o >> 1) * 4, 3, 3);
      ctx.fillRect(X + w - 19 + (o % 2) * 4, Y + 15 + (o >> 1) * 4, 3, 3);
      return;
    }
    ctx.fillStyle = '#f0e8ff';
    for (let i = 0; i < 2 + form; i++) {
      const hx = X + 4 + i * Math.floor((w - 8) / (2 + form));
      ctx.beginPath();
      ctx.moveTo(hx, Y + 1);
      ctx.lineTo(hx + 4, Y - 8 - (form === 3 ? 3 : 0));
      ctx.lineTo(hx + 8, Y + 1);
      ctx.fill();
    }
    // 一つ目（プレイヤーを見る）
    const pcx = sim.p.x / SUB;
    const look = pcx < X + w / 2 - 8 ? -3 : pcx > X + w / 2 + 8 ? 3 : 0;
    ctx.fillStyle = '#000';
    ctx.fillRect(X + w / 2 - 9, Y + 10, 18, 14);
    ctx.fillStyle = st === 'tele_beam' || st === 'beam' ? '#ff40c0' : '#ff2040';
    ctx.fillRect(X + w / 2 - 7, Y + 12, 14, 10);
    ctx.fillStyle = '#fff';
    ctx.fillRect(X + w / 2 - 2 + look, Y + 14, 4, 4);
    // 口
    ctx.fillStyle = '#000';
    ctx.fillRect(X + 12, Y + 29, w - 24, 4);
    ctx.fillStyle = '#f0e8ff';
    for (let i = 0; i < 5; i++) ctx.fillRect(X + 13 + i * 5, Y + 29, 2, 2);
  }

  private hills(ctx: CanvasRenderingContext2D, W: number, off: number, base: number, amp: number, color: string, freq: number, VH = VIEW_H) {
    if (base - amp > VH) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, VH);
    for (let x = 0; x <= W; x += 8) {
      const wx = x + off;
      const y = base - amp * (0.5 + 0.3 * Math.sin(wx * freq) + 0.2 * Math.sin(wx * freq * 2.7 + 1.3));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, VH);
    ctx.fill();
  }

  private drawBoss(ctx: CanvasRenderingContext2D, sim: Sim, ft: number) {
    const b = sim.boss!;
    if (b.state === 'dead') return;
    const x = Math.round(b.x / SUB);
    const y = Math.round(b.y / SUB);
    const st = b.state;
    // 予兆の表示
    if (st === 'tele_leap') {
      const tx = Math.round(b.targetX / SUB);
      ctx.fillStyle = ft % 8 < 4 ? 'rgba(255,40,60,0.6)' : 'rgba(255,40,60,0.25)';
      ctx.fillRect(tx, 14 * TILE - 3, 32, 3);
    }
    if (st === 'leap') {
      const tx = Math.round(b.targetX / SUB);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(tx + 2, 14 * TILE - 3, 28, 3);
    }
    if (st === 'tele_rain') {
      for (const c of b.rainCols) {
        ctx.fillStyle = ft % 8 < 4 ? 'rgba(255,40,60,0.55)' : 'rgba(255,40,60,0.2)';
        ctx.fillRect(c * TILE + 2, TILE, 12, 14 * TILE - TILE);
      }
    }
    if (st === 'dying') {
      if (ft % 6 === 0) this.burst(x + Math.random() * 32, y + Math.random() * 32, 6, ['#fff', '#ff4060', '#ffd040'], 2.5);
      if (ft % 4 < 2) return;
    }
    if (st === 'recover' && ft % 4 < 2) return;

    const flash = (st === 'tele_charge' || st === 'tele_shoot' || st === 'tele_leap') && ft % 6 < 3;
    const shakeX = st === 'tele_charge' ? (ft % 2 ? 1 : -1) : 0;
    const crouch = st === 'tele_leap' ? 3 : 0;
    const X = x + shakeX;
    const Y = y + crouch;
    const body = flash ? '#ff3050' : st === 'stun' ? '#6a5a7a' : '#2a1a3a';
    ctx.fillStyle = '#ff3a50';
    ctx.fillRect(X - 1, Y + 1, 34, 32 - crouch);
    ctx.fillStyle = '#0a0410';
    ctx.fillRect(X, Y + 2, 32, 30 - crouch);
    ctx.fillStyle = body;
    ctx.fillRect(X + 2, Y + 4, 28, 26 - crouch);
    // 王冠（とげ）: 気絶中は引っ込み、頭が光る
    if (st !== 'stun') {
      ctx.fillStyle = '#e8e0f0';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(X + 2 + i * 7, Y + 4);
        ctx.lineTo(X + 5.5 + i * 7, Y - 4);
        ctx.lineTo(X + 9 + i * 7, Y + 4);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = ft % 10 < 5 ? '#ffe040' : '#fff6b0';
      ctx.fillRect(X + 4, Y + 1, 24, 4);
      // ぐるぐる目
      ctx.fillStyle = '#fff';
      ctx.fillRect(X + 7, Y + 11, 6, 6);
      ctx.fillRect(X + 19, Y + 11, 6, 6);
      ctx.fillStyle = '#000';
      const o = Math.floor(ft / 6) % 4;
      ctx.fillRect(X + 8 + (o % 2) * 3, Y + 12 + (o >> 1) * 3, 2, 2);
      ctx.fillRect(X + 20 + (o % 2) * 3, Y + 12 + (o >> 1) * 3, 2, 2);
      return;
    }
    // 目
    const look = b.dir < 0 ? -1 : 1;
    ctx.fillStyle = '#ff2040';
    ctx.fillRect(X + 7 + look, Y + 11, 6, 5);
    ctx.fillRect(X + 19 + look, Y + 11, 6, 5);
    ctx.fillStyle = '#fff';
    ctx.fillRect(X + 9 + look * 2, Y + 12, 2, 2);
    ctx.fillRect(X + 21 + look * 2, Y + 12, 2, 2);
    // 口
    ctx.fillStyle = '#0a0410';
    ctx.fillRect(X + 9, Y + 21 - crouch, 14, 3);
    ctx.fillStyle = '#e8e0f0';
    for (let i = 0; i < 4; i++) ctx.fillRect(X + 10 + i * 4, Y + 21 - crouch, 2, 2);
  }

  playerCenter(sim: Sim): { x: number; y: number } {
    return { x: (sim.p.x + PW / 2) / SUB, y: (sim.p.y + PH / 2) / SUB };
  }
}
