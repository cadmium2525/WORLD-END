// 手作りステージのデータ形式（ステージエディタで作成し、stage-data.json に保存する）
//
// rows: 17行の文字列（すべて同じ長さ）。1文字 = 1タイル
//   .  空白        #  地面       =  レンガ
//   ^  上向きトゲ  v  下向きトゲ  <  左向きトゲ  >  右向きトゲ
//   %  崩れる床    S  スイッチ    A  Aブロック（スイッチOFFで実体）  B  Bブロック（ONで実体）
//   !  罠トゲ      G  ゴール      -  すり抜け床  T  砲台（ents にも turret が必要）
//   P  スタート位置（タイルとしては空白）
// ents: 敵・移動床などの配置（level.ts の EntSpec と同じ）

import { ROWS, T } from './constants';
import type { EntSpec, Level } from './level';

export interface StageDef {
  rows: string[];
  ents: EntSpec[];
  note?: string; // メモ（ゲームには影響しない）
}

export const CHAR_TO_TILE: Record<string, number> = {
  '.': T.EMPTY,
  '#': T.SOLID,
  '=': T.BRICK,
  '^': T.SPIKE_UP,
  v: T.SPIKE_DOWN,
  '<': T.SPIKE_LEFT,
  '>': T.SPIKE_RIGHT,
  '%': T.CRUMBLE,
  S: T.SWITCH,
  A: T.ABLOCK,
  B: T.BBLOCK,
  '!': T.TRAP,
  G: T.GOAL,
  '-': T.ONEWAY,
  T: T.TURRET,
  P: T.EMPTY,
};

export const TILE_TO_CHAR: Record<number, string> = {};
for (const [c, t] of Object.entries(CHAR_TO_TILE)) if (c !== 'P' && TILE_TO_CHAR[t] === undefined) TILE_TO_CHAR[t] = c;

export const MIN_WIDTH = 30;
export const MAX_WIDTH = 400;

/** 問題があればエラーメッセージの配列を返す（空なら OK） */
export function checkDef(def: StageDef): string[] {
  const errs: string[] = [];
  if (!Array.isArray(def.rows) || def.rows.length !== ROWS) {
    errs.push(`行数が ${ROWS} ではありません`);
    return errs;
  }
  const w = def.rows[0].length;
  if (w < MIN_WIDTH || w > MAX_WIDTH) errs.push(`幅は ${MIN_WIDTH}〜${MAX_WIDTH} にしてください（現在 ${w}）`);
  let starts = 0;
  let goals = 0;
  def.rows.forEach((r, y) => {
    if (r.length !== w) errs.push(`${y + 1}行目の長さが違います`);
    for (const c of r) {
      if (!(c in CHAR_TO_TILE)) errs.push(`使えない文字「${c}」（${y + 1}行目）`);
      if (c === 'P') starts++;
      if (c === 'G') goals++;
    }
  });
  if (starts !== 1) errs.push('スタート位置（P）はちょうど1つ必要です');
  if (goals === 0) errs.push('ゴール（G）がありません');
  for (const e of def.ents ?? []) {
    if (e.k === 'boss') errs.push('ボスは配置できません');
    if (e.x < 0 || e.x >= w || e.y < 0 || e.y >= ROWS) errs.push(`${e.k} が範囲外です`);
  }
  return errs;
}

export function defToLevel(stage: number, world: number, def: StageDef): Level {
  const w = def.rows[0].length;
  const tiles = new Uint8Array(w * ROWS);
  let startX = 2;
  let startY = 13;
  for (let y = 0; y < ROWS; y++) {
    const r = def.rows[y];
    for (let x = 0; x < w; x++) {
      const c = r[x] ?? '.';
      tiles[y * w + x] = CHAR_TO_TILE[c] ?? T.EMPTY;
      if (c === 'P') {
        startX = x;
        startY = y;
      }
    }
  }
  return {
    stage,
    world,
    w,
    h: ROWS,
    tiles,
    ents: (def.ents ?? []).map((e) => ({ ...e })),
    startX,
    startY,
    boss: false,
  };
}

export function levelToDef(L: Level): StageDef {
  const rows: string[] = [];
  for (let y = 0; y < L.h; y++) {
    let r = '';
    for (let x = 0; x < L.w; x++) {
      if (x === L.startX && y === L.startY) r += 'P';
      else r += TILE_TO_CHAR[L.tiles[y * L.w + x]] ?? '.';
    }
    rows.push(r);
  }
  return { rows, ents: L.ents.filter((e) => e.k !== 'boss').map((e) => ({ ...e })) };
}
