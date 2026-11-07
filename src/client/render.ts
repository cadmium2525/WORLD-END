// Canvas 描画（素材ファイルを使わず、すべてコードでドット絵を描く）
import { CRUMBLE_DELAY, PH, PW, SUB, T, TILE, VIEW_H } from '../shared/constants';
import type { Level } from '../shared/level';
import { B_BOSS, B_RAIN, B_TURRET, B_WAVE, E_FLYER, E_PLAT_H, E_PLAT_V, E_TURRET, E_WALKER, type Sim } from '../shared/sim';

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

function sprite(ctx: CanvasRenderingContext2D, rows: string[], x: number, y: number, pal: Record<string, string>, flip = false) {
  const w = rows[0].length;
  for (let j = 0; j < rows.length; j++) {
    const r = rows[j];
    for (let i = 0; i < w; i++) {
      const c = r[i];
      if (c === '.') continue;
      ctx.fillStyle = pal[c];
      ctx.fillRect(x + (flip ? w - 1 - i : i), y + j, 1, 1);
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
            if (above !== T.SOLID && above !== T.BRICK) {
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
            g.fillStyle = P.top;
            g.fillRect(x, y, TILE, 4);
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
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // カメラ
    const p = sim.p;
    const levelW = L.w * TILE;
    const pcx = (p.x + PW / 2) / SUB;
    if (levelW <= W) this.camX = -(W - levelW) / 2;
    else {
      const target = pcx - W * 0.4 + p.facing * 24;
      this.camX += (target - this.camX) * 0.12;
      this.camX = Math.max(0, Math.min(levelW - W, this.camX));
    }
    let cx = Math.round(this.camX);
    let cy = 0;
    if (this.shake > 0) {
      cx += Math.round((Math.random() - 0.5) * this.shake);
      cy += Math.round((Math.random() - 0.5) * this.shake);
      this.shake *= 0.85;
      if (this.shake < 0.5) this.shake = 0;
    }

    // 背景
    const grd = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    grd.addColorStop(0, P.sky1);
    grd.addColorStop(1, P.sky2);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, VIEW_H);
    if (P.star) {
      for (let i = 0; i < 60; i++) {
        const hv = h2(i, L.world);
        const sx = (((hv % 2000) - cx * 0.05) % W + W) % W;
        const sy = (hv >> 11) % 160;
        ctx.fillStyle = (hv >> 3) % 5 === 0 ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.45)';
        ctx.fillRect(Math.floor(sx), sy, 1, 1);
      }
    }
    this.hills(ctx, W, cx * 0.2, 150, 50, P.far, 0.011);
    this.hills(ctx, W, cx * 0.45, 190, 36, P.near, 0.02);

    ctx.save();
    ctx.translate(-cx, cy);

    // 静的タイル
    if (this.levelCanvas) {
      const sx = Math.max(0, cx);
      const sw = Math.min(levelW - sx, W + 2);
      if (sw > 0) ctx.drawImage(this.levelCanvas, sx, 0, sw, VIEW_H, sx, 0, sw, VIEW_H);
    }
    if (levelW <= W) {
      ctx.fillStyle = '#000';
      ctx.fillRect(-W, 0, W, VIEW_H);
      ctx.fillRect(levelW, 0, W, VIEW_H);
    }

    // 動的タイル
    const tx0 = Math.max(0, Math.floor(cx / TILE) - 1);
    const tx1 = Math.min(L.w - 1, Math.ceil((cx + W) / TILE) + 1);
    for (let ty = 0; ty < L.h; ty++) {
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
        }
      }
    }

    // 敵・移動床
    for (const e of sim.ents) {
      const ex = e.x / SUB;
      const ey = e.y / SUB;
      if (ex + e.w / SUB < cx - 16 || ex > cx + W + 16) continue;
      if (e.kind === E_PLAT_H || e.kind === E_PLAT_V) {
        const w = e.w / SUB;
        ctx.fillStyle = '#f0e0a0';
        ctx.fillRect(ex, ey, w, 6);
        ctx.fillStyle = '#a08040';
        for (let k = 2; k < w; k += 6) ctx.fillRect(ex + k, ey + 2, 3, 2);
        ctx.fillStyle = '#705020';
        ctx.fillRect(ex, ey + 5, w, 1);
      } else if (!e.alive) continue;
      else if (e.kind === E_WALKER) {
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
      }
    }

    // ボス
    if (sim.boss) this.drawBoss(ctx, sim, frameTime);

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
      }
    }

    // プレイヤー
    if (!sim.dead) {
      const x = Math.round(p.x / SUB) - 1;
      const y = Math.round(p.y / SUB);
      const blink = sim.invincible && Math.floor(frameTime / 4) % 2;
      if (!blink) {
        const run = p.onGround && Math.abs(p.vx) > 64 && Math.floor(frameTime / 6) % 2;
        sprite(ctx, SPR_PLAYER, x, y - (run ? 1 : 0), { k: '#101018', w: '#f4f4ff', r: '#ff3a50' }, p.facing < 0);
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

    if (debugInfo) {
      ctx.strokeStyle = 'rgba(0,255,0,0.8)';
      ctx.strokeRect(p.x / SUB + 0.5, p.y / SUB + 0.5, PW / SUB - 1, PH / SUB - 1);
    }
    ctx.restore();

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
  }

  private hills(ctx: CanvasRenderingContext2D, W: number, off: number, base: number, amp: number, color: string, freq: number) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, VIEW_H);
    for (let x = 0; x <= W; x += 8) {
      const wx = x + off;
      const y = base - amp * (0.5 + 0.3 * Math.sin(wx * freq) + 0.2 * Math.sin(wx * freq * 2.7 + 1.3));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, VIEW_H);
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
