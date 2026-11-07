// 端末セーブ（localStorage）
import { FINAL_START } from '../shared/constants';

export interface SaveData {
  stage: number; // 再開する面（最大 80）
  deaths: number; // 累計死亡回数
  best: number; // 到達した最高の面
  name: string;
  clears: number; // 100面クリア回数（テスト用）
}

export interface Settings {
  btnScale: number; // 0.6〜1.6
  btnOpacity: number; // 0.15〜1
  insetX: number; // 画面端からの距離(px)
  insetY: number;
  sfx: number;
  bgm: number;
  touch: 'auto' | 'on' | 'off';
}

const SAVE_KEY = 'worldend.save.v1';
const SET_KEY = 'worldend.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  btnScale: 1,
  btnOpacity: 0.45,
  insetX: 24,
  insetY: 20,
  sfx: 0.7,
  bgm: 0.45,
  touch: 'auto',
};

function read<T>(key: string): Partial<T> | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as Partial<T>) : null;
  } catch {
    return null;
  }
}

function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* プライベートモード等 */
  }
}

export function loadSave(): SaveData {
  const s = read<SaveData>(SAVE_KEY) ?? {};
  const stage = Number.isInteger(s.stage) ? Math.max(1, Math.min(FINAL_START, s.stage!)) : 1;
  return {
    stage,
    deaths: Number.isInteger(s.deaths) ? Math.max(0, s.deaths!) : 0,
    best: Number.isInteger(s.best) ? s.best! : stage,
    name: typeof s.name === 'string' ? s.name : '',
    clears: Number.isInteger(s.clears) ? s.clears! : 0,
  };
}

export function storeSave(d: SaveData) {
  // 80〜100面の途中は保存しない：保存できる面は最大でも 80
  write(SAVE_KEY, { ...d, stage: Math.max(1, Math.min(FINAL_START, d.stage)) });
}

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...(read<Settings>(SET_KEY) ?? {}) };
}

export function storeSettings(s: Settings) {
  write(SET_KEY, s);
}

const STATE_KEY = 'worldend.world.v1';
export function cacheWorld(v: unknown) {
  write(STATE_KEY, v);
}
export function cachedWorld<T>(): T | null {
  return read<T>(STATE_KEY) as T | null;
}
