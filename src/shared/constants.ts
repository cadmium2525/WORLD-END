// ゲーム全体で共有する定数。
// シミュレーションはすべて整数（1px = 256 サブピクセル）で計算し、
// ブラウザと Cloudflare Workers で完全に同じ結果になるようにしている。

export const TILE = 16; // 1タイル = 16px
export const SUB = 256; // 1px = 256 サブピクセル
export const TS = TILE * SUB; // 1タイル（サブピクセル）

export const ROWS = 17; // ステージの高さ（タイル）
export const VIEW_W = 480; // 論理解像度
export const VIEW_H = ROWS * TILE; // 272

export const FPS = 60;

// 面数・セーブ地点などの進行ルールは progress.ts（FINAL_STAGE / segmentStart など）を使う
export const TOTAL_STAGES = 200;
/** 100面（ボス面。撃破しても世界は終わらず101面へ進む）。最終面は progress.ts の FINAL_STAGE */
export const BOSS_STAGE = 100;

// 入力ビット
export const IN_LEFT = 1;
export const IN_RIGHT = 2;
export const IN_JUMP = 4;

// プレイヤー物理（サブピクセル単位）
export const PW = 10 * SUB; // 当たり判定 幅
export const PH = 14 * SUB; // 当たり判定 高さ
export const RUN_MAX = 512; // 2.0 px/f
export const ACC_GROUND = 64;
export const DEC_GROUND = 96;
export const ACC_AIR = 40;
export const DEC_AIR = 24;
export const JUMP_V = 1178; // 4.6 px/f
export const G_HOLD = 51; // 上昇中にジャンプ押しっぱなし
export const G_FALL = 128; // それ以外
export const MAX_FALL = 1536; // 6 px/f
export const COYOTE = 5;
export const JUMP_BUFFER = 6;
export const STOMP_BOUNCE = 900;

// タイル種別
export const T = {
  EMPTY: 0,
  SOLID: 1,
  BRICK: 2,
  SPIKE_UP: 3,
  SPIKE_DOWN: 4,
  SPIKE_LEFT: 5,
  SPIKE_RIGHT: 6,
  CRUMBLE: 7,
  SWITCH: 8,
  ABLOCK: 9, // スイッチOFFで実体
  BBLOCK: 10, // スイッチONで実体
  TRAP: 11, // 近づくと飛び出すトゲ
  GOAL: 12,
  ONEWAY: 13, // 下からすり抜けられる足場
  TURRET: 14, // 砲台（固体）
} as const;
export type TileId = (typeof T)[keyof typeof T];

export const CRUMBLE_DELAY = 22; // 乗ってから崩れるまで
export const CRUMBLE_RESPAWN = 180; // 崩れてから復活まで
