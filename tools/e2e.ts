// サーバー結合テスト（ローカルの wrangler dev に対して実行）
//   npx tsx tools/e2e.ts [API_URL] [ADMIN_TOKEN]
//   既定: http://localhost:8787 / local-admin-token（worker/.dev.vars.example と同じ）
// ※ wrangler dev は --var MIN_TIME_FACTOR:0 で起動する（実時間チェックを省略）
//   本番モードの確認は --var MODE:live も付けて起動する（テストの最初に世界をリセットする）
//
// ボットで 80〜200面の正しい入力ログを作り、サーバーで検証させる。
// ボットの解答は node_modules/.cache/ にステージのハッシュ付きで保存し、2回目以降は再利用する。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FINAL_STAGE, NOSAVE_START, SEGMENT_STARTS, segmentEnd } from '../src/shared/progress';
import { encodeInputs } from '../src/shared/replay';
import { stagesVersion } from '../src/shared/stages';
import { solve } from './solve';

const API = (process.argv[2] ?? 'http://localhost:8787').replace(/\/$/, '');
const ADMIN = process.argv[3] ?? process.env.ADMIN_TOKEN ?? 'local-admin-token';

type Json = Record<string, unknown>;
async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Json };
}
const getState = async () => (await (await fetch(API + '/api/state')).json()) as Json;

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'NG  '} ${label}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`);
}
function expectError(label: string, r: { status: number; json: Json }, code: string) {
  check(`${label}（${code}）`, r.json.error === code, { status: r.status, ...r.json });
}

// ---------- ボットの解答 ----------
const ver = (seg: number) => stagesVersion(seg, segmentEnd(seg));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cacheFile = resolve(root, `node_modules/.cache/world-end-e2e-${stagesVersion()}.json`);
let logs: Record<number, string> = {};
try {
  logs = JSON.parse(readFileSync(cacheFile, 'utf8')) as Record<number, string>;
} catch {
  /* 初回 */
}
const t0 = Date.now();
for (let st = NOSAVE_START; st <= FINAL_STAGE; st++) {
  if (logs[st]) continue;
  const sol = solve(st) ?? solve(st, 1500, 3);
  if (!sol) throw new Error(`ボットが ${st}面を解けませんでした`);
  logs[st] = encodeInputs(sol);
  process.stdout.write(`${st} `);
  mkdirSync(dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(logs));
}
console.log(`\n解答の準備完了（${((Date.now() - t0) / 1000).toFixed(1)}s）`);

// ---------- 準備 ----------
const reset = await post('/api/admin/reset', {}, { authorization: `Bearer ${ADMIN}` });
check('世界をリセット', reset.status === 200, reset.json);
const mode = (await getState()).mode as string;
console.log(`サーバーのモード: ${mode}`);

const start = (name: string, segment: number | undefined, ticket?: string, v?: string) =>
  post('/api/run/start', { name, ver: v ?? ver(segment ?? 80), ...(segment === undefined ? {} : { segment }), ...(ticket ? { ticket } : {}) });
const stage = (sessionId: string, st: number, log = logs[st]) => post('/api/run/stage', { sessionId, stage: st, log });

/** 区間を最初から最後まで送る。最後の面の結果（チケット or 世界終了の結果）を返す */
async function playSegment(name: string, seg: number, ticket: string | undefined, beforeLast?: () => Promise<void>) {
  const s = await start(name, seg, ticket);
  if (s.status !== 200) return { error: `start ${seg}`, ...s };
  const sid = s.json.sessionId as string;
  const end = segmentEnd(seg);
  for (let st = seg; st <= end; st++) {
    if (st === end && beforeLast) await beforeLast();
    const r = await stage(sid, st);
    if (r.status !== 200) return { error: `stage ${st}`, ...r };
    if (st < end && r.json.next !== st + 1) return { error: `next ${st}`, ...r };
    if (st === end) return { sid, ...r };
  }
  throw new Error('unreachable');
}

// ---------- 不正の拒否（区間の開始） ----------
expectError('101面の区間をチケット無しで開始 → 拒否', await start('cheater', 101), 'ticket_required');
expectError('181面の区間をチケット無しで開始 → 拒否', await start('cheater', 181), 'ticket_required');
expectError('でたらめなチケットで181面を開始 → 拒否', await start('cheater', 181, `181.${'0'.repeat(32)}.1700000000000.${'A'.repeat(43)}`), 'bad_ticket');
expectError('区間の開始面ではない面（90）を指定 → 拒否', await start('cheater', 90), 'bad_segment');
expectError('ステージのハッシュ違い → 拒否', await start('cheater', 80, undefined, 'deadbeef'), 'version_mismatch');
expectError('101〜120区間に80〜100区間のハッシュを送る → 拒否', await start('cheater', 101, 'x', ver(80)), 'version_mismatch');

// ---------- 不正の拒否（面の送信） ----------
{
  const s = await start('cheater', 80);
  const sid = s.json.sessionId as string;
  check('80面の区間はチケット無しで開始できる', s.status === 200 && typeof sid === 'string', s.json);
  expectError('面の順番飛ばし（80の次に81ではなく82）', (await stage(sid, 80)).status === 200 ? await stage(sid, 82) : { status: 0, json: {} }, 'bad_stage');
  expectError('別の面の入力ログ（81面に82面のログ）', await stage(sid, 81, logs[82]), 'invalid_replay');
  expectError('検証失敗のあとは同じセッションで続けられない', await stage(sid, 81), 'bad_session');
}
{
  const s = await start('cheater2', 80);
  const sid = s.json.sessionId as string;
  expectError('偽ログ（AAAA）', await stage(sid, 80, 'AAAA'), 'invalid_replay');
}
{
  // 旧クライアント（segment を送らない）は 80面からの挑戦として扱う
  const s = await post('/api/run/start', { name: 'old-client', ver: ver(80) });
  check('segment 省略の開始は 80面の区間', s.status === 200 && s.json.segment === 80, s.json);
}

// ---------- 全6区間を通す（ボットA） ----------
const tickets: Record<number, string> = {};
let ticket: string | undefined;
for (const seg of SEGMENT_STARTS) {
  const r = await playSegment('ボットA', seg, ticket, undefined);
  const end = segmentEnd(seg);
  if (end < FINAL_STAGE) {
    const ok = r.status === 200 && r.json.segmentCleared === true && r.json.next === end + 1 && typeof r.json.ticket === 'string';
    check(`${seg}〜${end}面を検証 → ${end + 1}面のチケット発行`, ok, ok ? { next: r.json.next, ticket: String(r.json.ticket).slice(0, 24) + '…' } : r);
    if (!ok) break;
    ticket = r.json.ticket as string;
    tickets[end + 1] = ticket;
    if (end === 100) check('100面クリアでは世界は終わらない', (await getState()).ended === false && r.json.result === undefined);
    if (end === 120) {
      // 区間を終えたセッションでは、次の区間の面は送れない
      expectError('区間を終えたセッションで121面を送る', await stage((r as { sid: string }).sid, 121), 'bad_session');
    }
  } else {
    const expected = mode === 'live' ? 'winner' : 'test_clear';
    check(`181〜200面を検証 → ${expected}`, r.status === 200 && r.json.result === expected, r.json);
    const w = await getState();
    check(mode === 'live' ? 'live: 世界が終了した' : 'test: 世界は終わらない', mode === 'live' ? w.ended === true : w.ended === false, w);
  }
}

// ---------- チケットの改ざん・流用・再利用 ----------
if (mode === 'test' && tickets[121] && tickets[141]) {
  const t121 = tickets[121];
  const [seg, rid, iat, sig] = t121.split('.');
  expectError('121面のチケットで141面の区間を開始（流用）', await start('cheater', 141, t121), 'ticket_wrong_segment');
  expectError('チケットの区間番号を書き換え（121→141）', await start('cheater', 141, ['141', rid, iat, sig].join('.')), 'bad_ticket');
  expectError('チケットのIDを書き換え', await start('cheater', 121, [seg, rid.replace(/^./, rid[0] === 'a' ? 'b' : 'a'), iat, sig].join('.')), 'bad_ticket');
  expectError('チケットの発行時刻を書き換え', await start('cheater', 121, [seg, rid, String(Number(iat) + 1), sig].join('.')), 'bad_ticket');
  expectError('チケットの署名を書き換え', await start('cheater', 121, [seg, rid, iat, (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)].join('.')), 'bad_ticket');
  const a = await start('ボットA', 121, t121);
  const b = await start('ボットA', 121, t121);
  check('同じチケットで何度でも区間を始め直せる（死亡後のやり直し）', a.status === 200 && b.status === 200, [a.json, b.json]);
  const other = await start('別の名前', 141, tickets[141]);
  check('チケットは名前に依存しない', other.status === 200, other.json);
  // 再利用したセッションでも区間の最後まで検証できる
  const r = await playSegment('ボットA', 141, tickets[141]);
  check('再利用したチケットで141〜160面を検証 → 161面のチケット', r.status === 200 && r.json.next === 161 && typeof r.json.ticket === 'string', r.status === 200 ? undefined : r);
}

// ---------- 本番モード: 2人がほぼ同時に200面をクリア → 勝者は必ず1人 ----------
if (mode === 'live') {
  // ボットA が終わらせた世界をリセットして、B と C で競争する
  await post('/api/admin/reset', {}, { authorization: `Bearer ${ADMIN}` });
  // 181面のチケットを使って 181〜199面まで進め、200面だけ同時に送る
  let arrived = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((ok) => (release = ok));
  const barrier = async () => {
    if (++arrived === 2) release();
    await gate;
  };
  const [rb, rc] = await Promise.all([
    playSegment('ボットB', 181, tickets[181], barrier),
    playSegment('ボットC', 181, tickets[181], barrier),
  ]);
  // 負けた側は、検証後の条件付き UPDATE で負ければ too_late、検証前の確認で世界の終了に気づけば world_ended
  const outcome = (r: { json: Json }) => (r.json.result as string | undefined) ?? (r.json.error as string);
  const winners = [rb, rc].filter((r) => outcome(r) === 'winner').length;
  const loser = [rb, rc].find((r) => outcome(r) !== 'winner');
  check(
    '同時に200面をクリア → 勝者はちょうど1人・もう1人は too_late / world_ended',
    winners === 1 && !!loser && ['too_late', 'world_ended'].includes(outcome(loser)),
    [outcome(rb), outcome(rc)],
  );
  const w = await getState();
  const winner = rb.json.result === 'winner' ? 'ボットB' : 'ボットC';
  check(`世界の勝者は ${winner}`, w.ended === true && w.winnerName === winner, w);
  // 世界が終わったあとは開始できない
  const late = await start('ボットD', 181, tickets[181]);
  expectError('世界の終了後は区間を開始できない', late, 'world_ended');
}

const clears = await (await fetch(API + '/api/admin/clears', { headers: { authorization: `Bearer ${ADMIN}` } })).json();
console.log('clears ->', JSON.stringify(clears).slice(0, 300));
console.log('state ->', JSON.stringify(await getState()));
console.log(failures ? `${failures} 件失敗` : 'ALL OK');
process.exitCode = failures ? 1 : 0;
