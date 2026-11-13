// 開発ツールの共通処理
import type { Level } from '../src/shared/level';
import { Sim } from '../src/shared/sim';
import { TILE_TO_CHAR } from '../src/shared/stageFormat';

/** ステージをテキストにする（stageFormat の文字＋配置物の記号） */
export function previewLevel(L: Level, from = 0, to = 9999): string {
  const rows: string[][] = [];
  for (let y = 0; y < L.h; y++) {
    const r: string[] = [];
    for (let x = 0; x < L.w; x++) r.push(TILE_TO_CHAR[L.tiles[y * L.w + x]] ?? '?');
    rows.push(r);
  }
  const tag: Record<string, string> = {
    walker: 'e', flyer: 'f', platH: '_', platV: '^', boss: 'X', fboss: 'X',
    crusher: 'C', laser: '*', saw: '@', orb: 'o', key: 'k',
  };
  for (const e of L.ents) if (tag[e.k] && rows[e.y]) rows[e.y][e.x] = tag[e.k];
  if (rows[L.startY]) rows[L.startY][L.startX] = 'P';
  let ruler = '';
  for (let x = 0; x < L.w; x++) ruler += x % 10 === 0 ? String((x / 10) % 10) : ' ';
  return [ruler.slice(from, to), ...rows.map((r) => r.join('').slice(from, to))].join('\n');
}

/** 入力ログを再生して、最後のフレームでクリアするか */
export function verifyLevel(L: Level, inputs: number[]): { ok: boolean; frames: number; reason?: string } {
  const sim = new Sim(L);
  for (let i = 0; i < inputs.length; i++) {
    sim.step(inputs[i]);
    if (sim.dead) return { ok: false, frames: i + 1, reason: 'dead' };
    if (sim.cleared) return i === inputs.length - 1 ? { ok: true, frames: inputs.length } : { ok: false, frames: i + 1, reason: 'trailing' };
  }
  return { ok: false, frames: inputs.length, reason: 'not_cleared' };
}
