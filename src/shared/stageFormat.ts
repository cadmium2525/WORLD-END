// 手作りステージのデータ形式（ステージエディタで作成し、stage-data.json に保存する）
//
// rows: 17行以上（縦に登る面は最大 MAX_HEIGHT 行）の文字列（すべて同じ長さ）。1文字 = 1タイル
//   .  空白        #  地面       =  レンガ
//   ^  上向きトゲ  v  下向きトゲ  <  左向きトゲ  >  右向きトゲ
//   %  崩れる床    S  スイッチ    A  Aブロック（スイッチOFFで実体）  B  Bブロック（ONで実体）
//   !  罠トゲ      G  ゴール      -  すり抜け床  T  砲台（ents にも turret が必要）
//   P  スタート位置（タイルとしては空白）
//   ---- 101面以降 ----
//   J  バネ        }  風→         {  風←         |  上昇気流
//   I  氷の床      Y  つらら      L  コンベア←   R  コンベア→
//   D  扉          U  重力反転    N  重力を戻す
// ents: 敵・移動床などの配置（level.ts の EntSpec と同じ）
// dark: 暗闇の面、chase: 迫る壁・せり上がる溶岩（level.ts の ChaseSpec）

import { ROWS, T } from './constants';
import type { ChaseSpec, EntSpec, Level } from './level';

export interface StageDef {
  rows: string[];
  ents: EntSpec[];
  note?: string; // メモ（ゲームには影響しない）
  dark?: boolean;
  chase?: ChaseSpec;
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
  J: T.SPRING,
  '}': T.WIND_R,
  '{': T.WIND_L,
  '|': T.WIND_U,
  I: T.ICE,
  Y: T.ICICLE,
  L: T.CONV_L,
  R: T.CONV_R,
  D: T.DOOR,
  U: T.GRAV_UP,
  N: T.GRAV_DOWN,
};

export const TILE_TO_CHAR: Record<number, string> = {};
for (const [c, t] of Object.entries(CHAR_TO_TILE)) if (c !== 'P' && TILE_TO_CHAR[t] === undefined) TILE_TO_CHAR[t] = c;

export const MIN_WIDTH = 30;
export const MAX_WIDTH = 400;
export const MAX_HEIGHT = 120;

/** 問題があればエラーメッセージの配列を返す（空なら OK） */
export function checkDef(def: StageDef): string[] {
  const errs: string[] = [];
  if (!Array.isArray(def.rows) || def.rows.length < ROWS || def.rows.length > MAX_HEIGHT) {
    errs.push(`行数は ${ROWS}〜${MAX_HEIGHT} にしてください`);
    return errs;
  }
  const h = def.rows.length;
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
    if (e.k === 'boss' || e.k === 'fboss') errs.push('ボスは配置できません');
    if (e.x < 0 || e.x >= w || e.y < 0 || e.y >= h) errs.push(`${e.k} が範囲外です`);
  }
  return errs;
}

export function defToLevel(stage: number, world: number, def: StageDef): Level {
  const w = def.rows[0].length;
  const h = def.rows.length;
  const tiles = new Uint8Array(w * h);
  let startX = 2;
  let startY = h - 4;
  for (let y = 0; y < h; y++) {
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
  const L: Level = {
    stage,
    world,
    w,
    h,
    tiles,
    ents: (def.ents ?? []).map((e) => ({ ...e })),
    startX,
    startY,
    boss: false,
  };
  if (def.dark) L.dark = true;
  if (def.chase) L.chase = { ...def.chase };
  return L;
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
  const def: StageDef = { rows, ents: L.ents.filter((e) => e.k !== 'boss' && e.k !== 'fboss').map((e) => ({ ...e })) };
  if (L.dark) def.dark = true;
  if (L.chase) def.chase = { ...L.chase };
  return def;
}
