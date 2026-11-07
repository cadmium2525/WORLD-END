import { stagesVersion } from '../shared/stages';
// 状態API（Cloudflare Workers）との通信
export interface WorldState {
  ended: boolean;
  winnerName: string | null;
  endedAt: number | null;
  mode: 'test' | 'live';
}

export const API_URL: string = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
export const ONLINE = API_URL.length > 0;

async function call<T>(path: string, body?: unknown, timeoutMs = 8000): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(API_URL + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac.signal,
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new ApiError(json.error ?? `http_${res.status}`, res.status);
    return json;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('network', 0);
  } finally {
    clearTimeout(timer);
  }
}

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

export function getState(): Promise<WorldState> {
  return call<WorldState>('/api/state');
}

export function startRun(name: string): Promise<{ sessionId: string }> {
  return call('/api/run/start', { name, ver: stagesVersion() });
}

export interface StageResult {
  ok: boolean;
  next?: number;
  result?: 'winner' | 'test_clear' | 'too_late';
  world?: WorldState;
}

export function submitStage(sessionId: string, stage: number, log: string): Promise<StageResult> {
  return call('/api/run/stage', { sessionId, stage, log }, 15000);
}
