// 端末セーブ（localStorage）
import { FINAL_STAGE, SEGMENT_STARTS, needsTicket, toCheckpoint } from '../shared/progress';

export interface SaveData {
  stage: number; // 再開する面（セーブ地点: 1〜80 の各面か 101,121,141,161,181）
  deaths: number; // 累計死亡回数
  best: number; // 到達した最高の面
  name: string;
  clears: number; // 200面クリア回数（テスト用）
  /** 区間の開始面 → その区間を始めるためのサーバー発行チケット（101,121,141,161,181） */
  tickets: Record<string, string>;
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

// 100面版と同じキー（v1）。100面版のセーブ（stage ≤ 80、tickets なし）もそのまま読める
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
  const stage = Number.isInteger(s.stage) ? toCheckpoint(s.stage!) : 1;
  return {
    stage,
    deaths: Number.isInteger(s.deaths) ? Math.max(0, s.deaths!) : 0,
    best: Number.isInteger(s.best) ? Math.max(1, Math.min(FINAL_STAGE, s.best!)) : stage,
    name: typeof s.name === 'string' ? s.name : '',
    clears: Number.isInteger(s.clears) ? s.clears! : 0,
    tickets: cleanTickets(s.tickets),
  };
}

function cleanTickets(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== 'object') return out;
  for (const seg of SEGMENT_STARTS) {
    const t = (v as Record<string, unknown>)[String(seg)];
    if (needsTicket(seg) && typeof t === 'string' && t.length > 0 && t.length <= 200) out[String(seg)] = t;
  }
  return out;
}

export function storeSave(d: SaveData) {
  // ノーセーブ区間の途中は保存しない：保存する面は必ずセーブ地点（区間の途中なら区間の最初）に丸める
  write(SAVE_KEY, { ...d, stage: toCheckpoint(d.stage), tickets: cleanTickets(d.tickets) });
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
