// ブラウザ（Playwright + Chromium）での進行ルールの自動テスト。
//   1) worker で: npx wrangler dev --var MIN_TIME_FACTOR:0     （テストモード・実時間チェックなし）
//   2) ルートで:  npx tsx tools/browser-progress.ts [API_URL] [ADMIN_TOKEN]
// Vite の開発サーバー（http://localhost:5173、VITE_API_URL=API_URL）はこのスクリプトが起動・終了する。
// Playwright は require('playwright') で読み込む（このリポジトリの依存には入れていない）。
//
// ?debug=1 で公開される window.__game を使い、入力をボットの解答に差し替え、
// ゲームの tick() を実時間より速く回して進める（物理・進行の処理は本物と同じ）。
// 確認する項目:
//   (a) 100面版のセーブ（v1・79面）から続けられ、79→80 でセーブが80になる
//   (b) 80〜100区間で死ぬ／やり直すと80面へ
//   (c) 100面クリアで101面がセーブされ、世界は終わらない（結果画面も出ない）
//   (d) 101〜120区間の途中で死ぬと101面へ、途中で再読込しても101面から
//   (e) 120面クリアで121面がセーブ
//   (f) 200面クリアでのみ結果画面（TEST CLEAR!）
//   (g) 各区間のチケットがサーバーから発行・保存され、公式記録として最後まで検証される
//   (h) セーブを書き換えて181面から始めても、チケットが無ければ「公式記録の対象外」
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FINAL_STAGE } from '../src/shared/progress';
import { decodeInputs, encodeInputs } from '../src/shared/replay';
import { stagesVersion } from '../src/shared/stages';
import { solve } from './solve';

type Page = any;

const API = (process.argv[2] ?? 'http://localhost:8787').replace(/\/$/, '');
const ADMIN = process.argv[3] ?? process.env.ADMIN_TOKEN ?? 'local-admin-token';
const PORT = 5173; // worker の ALLOWED_ORIGINS に入っているポート
const APP = `http://localhost:${PORT}/?debug=1`;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'NG  '} ${label}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`);
}
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

// ---------- ボットの解答（tools/e2e.ts と同じキャッシュを使う） ----------
const cacheFile = resolve(root, `node_modules/.cache/world-end-e2e-${stagesVersion()}.json`);
let logs: Record<string, string> = {};
try {
  logs = JSON.parse(readFileSync(cacheFile, 'utf8')) as Record<string, string>;
} catch {
  /* なければ作る */
}
const sol: Record<number, number[]> = {};
for (let st = 79; st <= FINAL_STAGE; st++) {
  let inputs = logs[st] ? decodeInputs(logs[st]) : null;
  if (!inputs) {
    const s = solve(st) ?? solve(st, 1500, 3);
    if (!s) throw new Error(`ボットが ${st}面を解けませんでした`);
    inputs = decodeInputs(encodeInputs(s))!;
    process.stdout.write(`${st} `);
  }
  sol[st] = inputs;
}
console.log('解答の準備完了');

// ---------- サーバー・Vite ----------
const state = async () => (await (await fetch(`${API}/api/state`)).json()) as { ended: boolean; mode: string };
const reset = await fetch(`${API}/api/admin/reset`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}` } });
if (reset.status !== 200) throw new Error(`世界のリセットに失敗（${reset.status}）。worker を起動しているか確認してください`);
if ((await state()).mode !== 'test') throw new Error('テストモードのサーバーで実行してください');

const vite = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], {
  cwd: root,
  env: { ...process.env, VITE_API_URL: API },
  stdio: ['ignore', 'pipe', 'pipe'],
});
vite.stderr.on('data', (d: Buffer) => process.stderr.write(d));
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
  } catch {
    /* 起動待ち */
  }
  if (i > 100) throw new Error('Vite が起動しません');
  await sleep(200);
}

const req = createRequire(import.meta.url);
const { chromium } = req('playwright');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
const page: Page = await ctx.newPage();
const pageErrors: string[] = [];
page.on('pageerror', (e: Error) => pageErrors.push(e.message));

const SAVE_KEY = 'worldend.save.v1';
const readSave = async () => JSON.parse((await page.evaluate((k: string) => localStorage.getItem(k), SAVE_KEY)) ?? '{}');

/** ページを開き、ボットの入力を仕込む */
async function open() {
  await page.goto(APP);
  await page.waitForFunction(() => (window as any).__game);
  await page.evaluate((s: Record<number, number[]>) => {
    const w = window as any;
    w.__sol = s;
    const g = w.__game;
    g.input.read = () => w.__sol[g.stage]?.[g.log.length] ?? 0;
  }, sol);
}

/** g（window.__game）についての条件式が真になるまで、tick() を回す */
async function until(cond: string, maxTicks = 2_000_000): Promise<any> {
  let total = 0;
  for (;;) {
    const r = await page.evaluate(
      ({ cond, chunk }: { cond: string; chunk: number }) => {
        const g = (window as any).__game;
        const f = new Function('g', `return (${cond});`);
        let n = 0;
        for (; n < chunk; n++) {
          if (f(g)) return { done: true, n, stage: g.stage, mode: g.mode };
          g.tick();
        }
        return { done: false, n, stage: g.stage, mode: g.mode };
      },
      { cond, chunk: 3000 },
    );
    total += r.n;
    if (r.done) return r;
    if (total > maxTicks) throw new Error(`条件 ${cond} に到達しません（stage=${r.stage} mode=${r.mode}）`);
    await sleep(5); // サーバーとの通信を進める
  }
}

/** tick() を回さずに（ゲームを止めたまま）、サーバーとの通信で条件が真になるのを待つ */
async function waitFor(cond: string, timeoutMs = 60_000) {
  await page.waitForFunction((c: string) => new Function('g', `return (${c});`)((window as any).__game), cond, { timeout: timeoutMs });
}

const g = (expr: string) => page.evaluate((e: string) => new Function('g', `return (${e});`)((window as any).__game), expr);
const text = (id: string) => page.evaluate((i: string) => document.getElementById(i)?.textContent ?? '', id);
const visible = (id: string) => page.evaluate((i: string) => !document.getElementById(i)?.classList.contains('hidden'), id);

try {
  // ---------- (a) 100面版のセーブ（79面）から続ける ----------
  await page.goto(APP);
  await page.evaluate((k: string) => localStorage.setItem(k, JSON.stringify({ stage: 79, deaths: 5, best: 79, name: 'ブラウザ', clears: 0 })), SAVE_KEY);
  await open();
  check('(a) 100面版のセーブ（stage 79）を読める', (await g('g.save.stage')) === 79 && (await text('info-save')).includes('STAGE 79'), await text('info-save'));
  await page.click('#btn-continue');
  await until("g.mode === 'play' && g.stage === 79");
  await until("g.mode === 'play' && g.stage === 80");
  const s80 = await readSave();
  check('(a) 79面クリアでセーブが80に', s80.stage === 80, s80);
  check('(a) 80面の HUD が「ノーセーブ中 1 / 21」', (await visible('hud-nosave')) && (await text('hud-run')) === '1 / 21', await text('hud-nosave'));
  check('(g) 80面の区間は公式記録（「公式記録の対象外」は非表示）', !(await visible('hud-unofficial')));

  // ---------- (b) 80〜100区間で死ぬと80へ ----------
  await until("g.mode === 'play' && g.stage === 82");
  check('(b) 82面の HUD が「3 / 21」', (await text('hud-run')) === '3 / 21', await text('hud-run'));
  await g('(g.sim.dead = true, g.kill(true), true)'); // 死亡（トゲ等に当たったのと同じ処理）
  await until("g.mode === 'play'");
  check('(b) 82面で死亡 → 80面へ', (await g('g.stage')) === 80 && (await readSave()).stage === 80, await g('g.stage'));
  await until("g.mode === 'play' && g.stage === 81");
  await g('(g.kill(false), true)'); // やり直し（R キー）
  await until("g.mode === 'play'");
  check('(b) 81面でやり直し → 80面へ', (await g('g.stage')) === 80);

  // ---------- (c) 100面クリアで101がセーブ・世界は終わらない ----------
  await until("g.mode === 'play' && g.stage === 100");
  check('(c) 100面はボス面', await g('g.sim.level.boss === true'));
  await until("g.mode === 'clear' && g.stage === 100");
  const s101 = await readSave();
  check('(c) 100面クリアでセーブが101に', s101.stage === 101, s101.stage);
  check('(c) 「101面に到達 ― セーブされました」', (await text('banner')).includes('101面に到達') && (await text('banner')).includes('セーブされました'), await text('banner'));
  await until("g.mode === 'play' && g.stage === 101");
  check('(c) 100面クリア後は101面へ進む（結果画面なし）', !(await visible('scr-result')) && (await g("g.mode")) === 'play');
  check('(c) 世界は終わらない', (await state()).ended === false);
  await waitFor('!!g.save.tickets["101"]');
  check('(g) 101面のチケットが保存された', typeof (await readSave()).tickets?.['101'] === 'string');
  check('(c) 101面の HUD が「1 / 20」', (await text('hud-run')) === '1 / 20', await text('hud-run'));

  // ---------- (d) 101〜120区間の途中で死ぬ／再読込 → 101 ----------
  await until("g.mode === 'play' && g.stage === 104");
  check('(g) 101〜120区間が公式記録として進行中', await g('g.run && g.run.valid && g.run.segment === 101'), await g('g.run && g.run.reason'));
  await g('(g.sim.dead = true, g.kill(true), true)');
  await until("g.mode === 'play'");
  check('(d) 104面で死亡 → 101面へ', (await g('g.stage')) === 101 && (await readSave()).stage === 101);
  await until("g.mode === 'play' && g.stage === 106");
  await page.reload();
  await open();
  check('(d) 106面の途中で再読込 → タイトルの最終セーブは101', (await g('g.save.stage')) === 101 && (await text('info-save')).includes('STAGE 101'), await text('info-save'));
  check('(d) タイトルに「101〜120面ノーセーブ区間の開始地点」', (await text('info-save')).includes('101〜120面'), await text('info-save'));
  await page.click('#btn-continue');
  await until("g.mode === 'play'");
  check('(d) CONTINUE で101面から', (await g('g.stage')) === 101);

  // ---------- (e) 120クリアで121がセーブ ----------
  await until("g.mode === 'clear' && g.stage === 120");
  check('(e) 120面クリアでセーブが121に', (await readSave()).stage === 121);
  await until("g.mode === 'play' && g.stage === 121");
  await waitFor('!!g.save.tickets["121"]');
  check('(g) 再読込後に始めた101〜120区間でも検証され、121面のチケットが保存された', typeof (await readSave()).tickets?.['121'] === 'string');

  // ---------- (f)(g) 200面まで ----------
  let sawResultEarly = false;
  for (const seg of [141, 161, 181]) {
    await until(`g.mode === 'play' && g.stage === ${seg}`);
    sawResultEarly ||= await visible('scr-result');
    check(`(g) ${seg}面に到達・セーブ`, (await readSave()).stage === seg);
    await waitFor(`!!g.save.tickets["${seg}"]`);
    check(`(g) ${seg}面のチケットが保存された`, true);
  }
  await until("g.mode === 'play' && g.stage === 200");
  check('(f) 199面までに結果画面は出ない', !sawResultEarly && !(await visible('scr-result')));
  check('(f) 200面の HUD が「STAGE 200（FINAL）」・「20 / 20」', (await text('hud-stage')) === 'STAGE 200（FINAL）' && (await text('hud-run')) === '20 / 20');
  check('(g) 181〜200区間が公式記録として進行中', await g('g.run.valid && g.run.segment === 181'), await g('g.run.reason'));
  await until("g.mode === 'result'");
  const title = await text('result-title');
  check('(f)(g) 200面クリアで結果画面「TEST CLEAR!」', title === 'TEST CLEAR!', { title, body: await text('result-body') });
  check('(f) テストモードなので世界は終わらない', (await state()).ended === false);

  // ---------- (h) セーブを書き換えて181から（チケット無し） ----------
  await page.evaluate((k: string) => {
    const s = JSON.parse(localStorage.getItem(k)!);
    s.stage = 181;
    s.tickets = {};
    localStorage.setItem(k, JSON.stringify(s));
  }, SAVE_KEY);
  await open();
  check('(h) タイトルに「チケットなし：公式記録の対象外」', (await text('info-save')).includes('チケットなし'), await text('info-save'));
  await page.click('#btn-continue');
  await until("g.mode === 'play' && g.stage === 181");
  await waitFor('g.run && !g.run.valid');
  check('(h) チケット無しの181面開始は公式記録の対象外', (await g('g.run.reason')).includes('チケット') && (await visible('hud-unofficial')), await g('g.run.reason'));

  // 区間途中の値（例: 150）に書き換えたセーブは区間の最初（141）に丸められる
  await page.evaluate((k: string) => {
    const s = JSON.parse(localStorage.getItem(k)!);
    s.stage = 150;
    localStorage.setItem(k, JSON.stringify(s));
  }, SAVE_KEY);
  await open();
  check('(h) セーブの stage=150 は141に丸められる', (await g('g.save.stage')) === 141);

  check('ページ内のエラーなし', pageErrors.length === 0, pageErrors);
} catch (e) {
  failures++;
  console.log('NG   例外:', (e as Error).message);
  await page.screenshot({ path: resolve(root, 'node_modules/.cache/browser-progress-fail.png') }).catch(() => {});
} finally {
  await browser.close();
  vite.kill();
}
console.log(failures ? `${failures} 件失敗` : 'ALL OK');
process.exit(failures ? 1 : 0);
