// WORLD END 状態API（Cloudflare Workers + D1）
//
// GET  /api/state            世界の状態
// POST /api/run/start        ノーセーブ区間（80〜100 / 101〜120 / … / 181〜200）の挑戦開始（セッション発行）
//                            101面以降の区間は、直前の区間をクリアしたときに発行されたチケットが必要
// POST /api/run/stage        クリアした面の入力ログを送信 → サーバーで再生して検証
//                            区間の最後の面なら次の区間用のチケットを発行
//                            200面の検証に成功した最初の1名で世界が終了（MODE=live の場合）
// POST /api/admin/reset      世界を初期化（要 ADMIN_TOKEN）
// GET  /api/admin/clears     検証済みクリア一覧（要 ADMIN_TOKEN）

import { validateName } from '../../src/shared/name';
import { FINAL_STAGE, SEGMENT_STARTS, needsTicket, segmentEnd } from '../../src/shared/progress';
import { decodeInputs, verifyStage } from '../../src/shared/replay';
import { stagesVersion } from '../../src/shared/stages';

export interface Env {
  DB: D1Database;
  MODE?: string; // "test" | "live"
  ALLOWED_ORIGINS?: string;
  ADMIN_TOKEN?: string;
  TICKET_SECRET?: string; // チケット署名鍵（secret）。未設定なら ADMIN_TOKEN を流用
  STAGE_SLACK_SEC?: string; // 1面あたりの許容猶予（一時停止・通信遅延）
  MIN_TIME_FACTOR?: string; // 早すぎる記録の判定係数（既定 0.9。ローカルテスト以外で変更しない）
}

const SESSION_TTL_MS = 3 * 60 * 60 * 1000;
const MAX_LOG_CHARS = 40_000;
// 区間の最初で死ぬたびに新しいセッションになるため、ある程度多めに許す
const MAX_STARTS_PER_10MIN = 120;
const SECRET_MIN_LEN = 16;

interface WorldRow {
  ended: number;
  winner_name: string | null;
  ended_at: number | null;
}
interface SessionRow {
  id: string;
  name: string;
  segment: number;
  run_id: string;
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

// ---------------- チケット（HMAC-SHA256 署名） ----------------
//
// 形式: "<区間の開始面>.<ランダムID 32桁hex>.<発行時刻 ms>.<署名 base64url>"
// 署名対象: "world-end-ticket:v1:<MODE>:<区間の開始面>:<ランダムID>:<発行時刻>"
// - 区間の開始面が署名に入っているので、別の区間への流用・書き換えはできない
// - MODE が署名に入っているので、テストモードで得たチケットは本番モードでは使えない
// - ランダムID は 80面の挑戦開始時に作られ、200面まで引き継がれる（名前には依存しない）
// - 同じチケットは何度でも使える（区間の途中で死ぬたびに、区間の最初から始め直すため）

interface Ticket {
  seg: number;
  rid: string;
  iat: number;
}

let keyCache: { secret: string; key: Promise<CryptoKey> } | null = null;

function ticketSecret(env: Env): string | null {
  if (env.TICKET_SECRET && env.TICKET_SECRET.length >= SECRET_MIN_LEN) return env.TICKET_SECRET;
  if (env.ADMIN_TOKEN && env.ADMIN_TOKEN.length >= SECRET_MIN_LEN) return env.ADMIN_TOKEN;
  return null;
}

function ticketKey(secret: string): Promise<CryptoKey> {
  if (keyCache?.secret !== secret) {
    keyCache = {
      secret,
      key: crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
        'verify',
      ]),
    };
  }
  return keyCache.key;
}

const ticketMessage = (env: Env, t: Ticket) => new TextEncoder().encode(`world-end-ticket:v1:${mode(env)}:${t.seg}:${t.rid}:${t.iat}`);

function b64url(buf: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function issueTicket(env: Env, secret: string, seg: number, rid: string, now: number): Promise<string> {
  const t: Ticket = { seg, rid, iat: now };
  const sig = await crypto.subtle.sign('HMAC', await ticketKey(secret), ticketMessage(env, t));
  return `${seg}.${rid}.${now}.${b64url(sig)}`;
}

/** 署名が正しければ中身を返す。形式不正・改ざんは null */
async function readTicket(env: Env, secret: string, raw: string): Promise<Ticket | null> {
  if (raw.length > 200) return null;
  const m = /^(\d{2,3})\.([0-9a-f]{32})\.(\d{1,15})\.([A-Za-z0-9_-]{43})$/.exec(raw);
  if (!m) return null;
  const t: Ticket = { seg: Number(m[1]), rid: m[2], iat: Number(m[3]) };
  if (String(t.seg) !== m[1] || String(t.iat) !== m[3]) return null; // 先頭0などの別表記を拒否
  const sig = unb64url(m[4]);
  if (!sig || sig.length !== 32) return null;
  const ok = await crypto.subtle.verify('HMAC', await ticketKey(secret), sig, ticketMessage(env, t));
  return ok ? t : null;
}

// ---------------- ハンドラ ----------------

async function startRun(req: Request, env: Env): Promise<Response> {
  const b = await body<{ name?: string; ver?: string; segment?: number; ticket?: string }>(req);
  if (!b) return fail(req, env, 'bad_request');
  // segment 省略は旧クライアント（80面からの挑戦）として扱う
  const seg = b.segment ?? 80;
  if (!Number.isInteger(seg) || !SEGMENT_STARTS.includes(seg)) return fail(req, env, 'bad_segment');
  const secret = ticketSecret(env);
  if (!secret) return fail(req, env, 'ticket_key_missing', 503);
  // 区間の面データがサーバーと一致しているか（その区間の分だけ照合）
  if (b.ver !== stagesVersion(seg, segmentEnd(seg))) return fail(req, env, 'version_mismatch', 409);
  const name = validateName(b.name ?? '');
  if (name === null) return fail(req, env, 'bad_name');

  let runId: string;
  if (needsTicket(seg)) {
    if (typeof b.ticket !== 'string' || b.ticket.length === 0) return fail(req, env, 'ticket_required', 403);
    const t = await readTicket(env, secret, b.ticket);
    if (!t) return fail(req, env, 'bad_ticket', 403);
    if (t.seg !== seg) return fail(req, env, 'ticket_wrong_segment', 403);
    runId = t.rid;
  } else runId = randomId();

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
      'INSERT INTO sessions (id, name, ip_hash, segment, run_id, next_stage, total_frames, created_at, last_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)',
    ).bind(id, name, ip, seg, runId, seg, now, now),
  ]);
  return json(req, env, { sessionId: id, segment: seg, end: segmentEnd(seg) });
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
  const end = segmentEnd(s.segment);
  if (b.stage !== s.next_stage || b.stage! > end) return fail(req, env, 'bad_stage', 409);
  const secret = ticketSecret(env);
  if (!secret) return fail(req, env, 'ticket_key_missing', 503);

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

  if (b.stage! < end) return json(req, env, { ok: true, next: b.stage! + 1 });

  if (end !== FINAL_STAGE) {
    // ---- 区間クリア（100, 120, 140, 160, 180面）→ 次の区間のチケットを発行 ----
    await env.DB.prepare("UPDATE sessions SET status = 'cleared' WHERE id = ?").bind(s.id).run();
    const ticket = await issueTicket(env, secret, end + 1, s.run_id, now);
    return json(req, env, { ok: true, next: end + 1, segmentCleared: true, ticket });
  }

  // ---- 200面クリア ----
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
          return json(req, env, { ...worldJson(await readWorld(env), env), finalStage: FINAL_STAGE });
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
