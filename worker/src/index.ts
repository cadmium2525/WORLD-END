// WORLD END 状態API（Cloudflare Workers + D1）
//
// GET  /api/state            世界の状態
// POST /api/run/start        80面からの連続チャレンジ開始（セッション発行）
// POST /api/run/stage        クリアした面の入力ログを送信 → サーバーで再生して検証
//                            100面の検証に成功した最初の1名で世界が終了（MODE=live の場合）
// POST /api/admin/reset      世界を初期化（要 ADMIN_TOKEN）
// GET  /api/admin/clears     検証済みクリア一覧（要 ADMIN_TOKEN）

import { BOSS_STAGE, FINAL_START } from '../../src/shared/constants';
import { validateName } from '../../src/shared/name';
import { decodeInputs, verifyStage } from '../../src/shared/replay';

export interface Env {
  DB: D1Database;
  MODE?: string; // "test" | "live"
  ALLOWED_ORIGINS?: string;
  ADMIN_TOKEN?: string;
  STAGE_SLACK_SEC?: string; // 1面あたりの許容猶予（一時停止・通信遅延）
  MIN_TIME_FACTOR?: string; // 早すぎる記録の判定係数（既定 0.9。ローカルテスト以外で変更しない）
}

const SESSION_TTL_MS = 3 * 60 * 60 * 1000;
const MAX_LOG_CHARS = 40_000;
const MAX_STARTS_PER_10MIN = 40;

interface WorldRow {
  ended: number;
  winner_name: string | null;
  ended_at: number | null;
}
interface SessionRow {
  id: string;
  name: string;
  next_stage: number;
  total_frames: number;
  created_at: number;
  last_at: number;
  status: string;
}

let stateCache: { at: number; body: WorldRow } | null = null;

const mode = (env: Env): 'test' | 'live' => (env.MODE === 'live' ? 'live' : 'test');

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes('*') || allowed.includes(origin);
  return {
    'access-control-allow-origin': ok ? origin || '*' : allowed[0] ?? '',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function json(req: Request, env: Env, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors(req, env) },
  });
}

const fail = (req: Request, env: Env, error: string, status = 400) => json(req, env, { error }, status);

async function readWorld(env: Env, fresh = false): Promise<WorldRow> {
  const now = Date.now();
  if (!fresh && stateCache && now - stateCache.at < 5000) return stateCache.body;
  const row = await env.DB.prepare('SELECT ended, winner_name, ended_at FROM world WHERE id = 1').first<WorldRow>();
  const body = row ?? { ended: 0, winner_name: null, ended_at: null };
  stateCache = { at: now, body };
  return body;
}

function worldJson(w: WorldRow, env: Env) {
  return { ended: w.ended === 1, winnerName: w.winner_name, endedAt: w.ended_at, mode: mode(env) };
}

async function hashIp(req: Request): Promise<string> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`world-end:${ip}`));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function isAdmin(req: Request, env: Env): boolean {
  const t = env.ADMIN_TOKEN;
  if (!t || t.length < 16) return false;
  return req.headers.get('authorization') === `Bearer ${t}`;
}

async function body<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    if (text.length > MAX_LOG_CHARS + 1000) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// ---------------- ハンドラ ----------------

async function startRun(req: Request, env: Env): Promise<Response> {
  const b = await body<{ name?: string }>(req);
  const name = validateName(b?.name ?? '');
  if (name === null) return fail(req, env, 'bad_name');
  const w = await readWorld(env, true);
  if (w.ended) return json(req, env, { error: 'world_ended', world: worldJson(w, env) }, 409);

  const now = Date.now();
  const ip = await hashIp(req);
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE ip_hash = ? AND created_at > ?')
    .bind(ip, now - 10 * 60 * 1000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_STARTS_PER_10MIN) return fail(req, env, 'rate_limited', 429);

  const id = randomId();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE last_at < ?').bind(now - SESSION_TTL_MS),
    env.DB.prepare(
      'INSERT INTO sessions (id, name, ip_hash, next_stage, total_frames, created_at, last_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
    ).bind(id, name, ip, FINAL_START, now, now),
  ]);
  return json(req, env, { sessionId: id });
}

async function submitStage(req: Request, env: Env): Promise<Response> {
  const b = await body<{ sessionId?: string; stage?: number; log?: string }>(req);
  if (!b || typeof b.sessionId !== 'string' || typeof b.log !== 'string' || !Number.isInteger(b.stage)) {
    return fail(req, env, 'bad_request');
  }
  if (b.log.length > MAX_LOG_CHARS) return fail(req, env, 'invalid_replay');
  const now = Date.now();
  const s = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(b.sessionId).first<SessionRow>();
  if (!s || s.status !== 'active' || now - s.last_at > SESSION_TTL_MS) return fail(req, env, 'bad_session', 404);
  if (b.stage !== s.next_stage) return fail(req, env, 'bad_stage', 409);

  const w = await readWorld(env, true);
  if (w.ended) return json(req, env, { error: 'world_ended', world: worldJson(w, env) }, 409);

  // 入力ログを再生して、本当にその面をクリアしたか検証
  const inputs = decodeInputs(b.log);
  if (!inputs) return fail(req, env, 'invalid_replay');
  const v = verifyStage(b.stage!, inputs);
  if (!v.ok) {
    await env.DB.prepare("UPDATE sessions SET status = 'invalid' WHERE id = ?").bind(s.id).run();
    return fail(req, env, 'invalid_replay', 422);
  }

  // 実時間との整合性チェック（一時停止・中断しすぎ／早すぎる記録を弾く）
  const slackMs = (Number(env.STAGE_SLACK_SEC) || 45) * 1000;
  const stageMs = (v.frames * 1000) / 60;
  if (now - s.last_at > stageMs * 1.5 + slackMs) {
    await env.DB.prepare("UPDATE sessions SET status = 'timeout' WHERE id = ?").bind(s.id).run();
    return fail(req, env, 'too_slow', 422);
  }
  const totalFrames = s.total_frames + v.frames;
  const minFactor = env.MIN_TIME_FACTOR !== undefined ? Number(env.MIN_TIME_FACTOR) : 0.9;
  if (now - s.created_at < ((totalFrames * 1000) / 60) * minFactor - 5000) {
    await env.DB.prepare("UPDATE sessions SET status = 'invalid' WHERE id = ?").bind(s.id).run();
    return fail(req, env, 'too_fast', 422);
  }

  // 進行を1面進める（同じ面の二重送信は next_stage 条件で弾かれる）
  const upd = await env.DB.prepare(
    'UPDATE sessions SET next_stage = next_stage + 1, total_frames = ?, last_at = ? WHERE id = ? AND next_stage = ?',
  )
    .bind(totalFrames, now, s.id, b.stage)
    .run();
  if (upd.meta.changes !== 1) return fail(req, env, 'bad_stage', 409);

  if (b.stage !== BOSS_STAGE) return json(req, env, { ok: true, next: b.stage! + 1 });

  // ---- 100面クリア ----
  const m = mode(env);
  const stmts = [
    env.DB.prepare("UPDATE sessions SET status = 'cleared' WHERE id = ?").bind(s.id),
    env.DB.prepare('INSERT INTO clears (session_id, name, mode, total_frames, cleared_at) VALUES (?, ?, ?, ?, ?)').bind(
      s.id,
      s.name,
      m,
      totalFrames,
      now,
    ),
  ];
  if (m === 'test') {
    await env.DB.batch(stmts);
    return json(req, env, { ok: true, result: 'test_clear', world: worldJson(await readWorld(env, true), env) });
  }
  // 本番: 世界がまだ終わっていない場合だけ終了させる（原子的な条件付き更新 → 勝者は必ず1人）
  const res = await env.DB.batch([
    env.DB.prepare(
      'UPDATE world SET ended = 1, winner_name = ?, winner_session = ?, ended_at = ? WHERE id = 1 AND ended = 0',
    ).bind(s.name, s.id, now),
    ...stmts,
  ]);
  const won = res[0].meta.changes === 1;
  const after = await readWorld(env, true);
  return json(req, env, { ok: true, result: won ? 'winner' : 'too_late', world: worldJson(after, env) });
}

async function adminReset(req: Request, env: Env): Promise<Response> {
  if (!isAdmin(req, env)) return fail(req, env, 'forbidden', 403);
  await env.DB.batch([
    env.DB.prepare('UPDATE world SET ended = 0, winner_name = NULL, winner_session = NULL, ended_at = NULL WHERE id = 1'),
    env.DB.prepare('DELETE FROM sessions'),
  ]);
  stateCache = null;
  return json(req, env, { ok: true, world: worldJson(await readWorld(env, true), env) });
}

async function adminClears(req: Request, env: Env): Promise<Response> {
  if (!isAdmin(req, env)) return fail(req, env, 'forbidden', 403);
  const r = await env.DB.prepare('SELECT * FROM clears ORDER BY id DESC LIMIT 100').all();
  return json(req, env, { clears: r.results });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req, env) });
    const url = new URL(req.url);
    try {
      switch (`${req.method} ${url.pathname}`) {
        case 'GET /':
        case 'GET /api/state':
          return json(req, env, worldJson(await readWorld(env), env));
        case 'POST /api/run/start':
          return await startRun(req, env);
        case 'POST /api/run/stage':
          return await submitStage(req, env);
        case 'POST /api/admin/reset':
          return await adminReset(req, env);
        case 'GET /api/admin/clears':
          return await adminClears(req, env);
        default:
          return fail(req, env, 'not_found', 404);
      }
    } catch (e) {
      console.error(e);
      return fail(req, env, 'server_error', 500);
    }
  },
} satisfies ExportedHandler<Env>;
