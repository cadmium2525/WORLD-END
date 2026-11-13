// 1〜100面が変わっていないことを確かめる開発ツール。
//   npx tsx tools/stage-hash.ts record   … 基準値を tools/baseline/stages-1-100.json に記録（作業開始前に1回だけ）
//   npx tsx tools/stage-hash.ts check    … 現在の 1〜100面を基準値と比較
// 比較するもの:
//   1. Level（tiles, ents, startX, startY, w, h）のハッシュ
//   2. 基準時点のボット解答（入力ログ）を今の sim で再生したときの、毎フレームの状態のハッシュ
//      （物理定数・既存タイルの判定・敵や移動床・ボスの挙動が変わっていないことの確認）
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decodeInputs, encodeInputs } from '../src/shared/replay';
import { Sim } from '../src/shared/sim';
import { getStage } from '../src/shared/stages';
import { solve } from './solve';

const DIR = new URL('./baseline/', import.meta.url);
const FILE = new URL('./baseline/stages-1-100.json', import.meta.url);

function fnv(): { mix: (n: number) => void; hex: () => string } {
  let h = 0x811c9dc5;
  return {
    mix(n: number) {
      for (let k = 0; k < 4; k++) {
        h ^= (n >>> (k * 8)) & 0xff;
        h = Math.imul(h, 0x01000193) >>> 0;
      }
    },
    hex: () => h.toString(16).padStart(8, '0'),
  };
}

export function levelHash(stage: number): string {
  const L = getStage(stage);
  const f = fnv();
  f.mix(L.w);
  f.mix(L.h);
  f.mix(L.startX);
  f.mix(L.startY);
  f.mix(L.tiles.length);
  for (let i = 0; i < L.tiles.length; i++) f.mix(L.tiles[i]);
  const e = JSON.stringify(L.ents);
  for (let i = 0; i < e.length; i++) f.mix(e.charCodeAt(i));
  return f.hex();
}

function traceHash(stage: number, inputs: number[]): { hash: string; frames: number; cleared: boolean } {
  const s = new Sim(getStage(stage));
  const f = fnv();
  let i = 0;
  for (; i < inputs.length; i++) {
    s.step(inputs[i]);
    const p = s.p;
    f.mix(p.x);
    f.mix(p.y);
    f.mix(p.vx);
    f.mix(p.vy);
    f.mix(p.onGround ? 1 : 0);
    f.mix(s.switchOn ? 1 : 0);
    f.mix(s.bullets.length);
    for (const e of s.ents) {
      f.mix(e.x);
      f.mix(e.y);
      f.mix(e.alive ? 1 : 0);
    }
    for (let k = 0; k < s.tstate.length; k++) if (s.tstate[k]) f.mix(k ^ (s.tstate[k] << 20));
    if (s.boss) {
      f.mix(s.boss.x);
      f.mix(s.boss.y);
      f.mix(s.boss.hp);
    }
    if (s.dead || s.cleared) break;
  }
  return { hash: f.hex(), frames: i + 1, cleared: s.cleared };
}

interface Rec {
  level: string;
  log: string;
  trace: string;
  frames: number;
}

const mode = process.argv[2] ?? 'check';
if (mode === 'record') {
  mkdirSync(DIR, { recursive: true });
  const out: Record<number, Rec> = {};
  for (let st = 1; st <= 100; st++) {
    let sol = solve(st);
    if (!sol) sol = solve(st, 1500, 3);
    if (!sol) throw new Error(`stage ${st} unsolved`);
    const t = traceHash(st, sol);
    out[st] = { level: levelHash(st), log: encodeInputs(sol), trace: t.hash, frames: t.frames };
    console.log(st, out[st].level, t.hash, t.frames, t.cleared);
  }
  writeFileSync(FILE, JSON.stringify(out, null, 1) + '\n');
  console.log('recorded');
} else {
  const base = JSON.parse(readFileSync(FILE, 'utf8')) as Record<number, Rec>;
  let bad = 0;
  for (let st = 1; st <= 100; st++) {
    const b = base[st];
    const lh = levelHash(st);
    const t = traceHash(st, decodeInputs(b.log)!);
    const ok = lh === b.level && t.hash === b.trace && t.frames === b.frames && t.cleared;
    if (!ok) {
      bad++;
      console.log(`stage ${st}: MISMATCH level ${lh}/${b.level} trace ${t.hash}/${b.trace} frames ${t.frames}/${b.frames} cleared=${t.cleared}`);
    }
  }
  console.log(bad ? `${bad} MISMATCH` : 'stages 1-100: level hash 100/100 一致, replay trace 100/100 一致');
  process.exitCode = bad ? 1 : 0;
}
