// サーバー結合テスト（ローカルの wrangler dev に対して実行）
//   npx tsx tools/e2e.ts http://localhost:8787
// ※ wrangler dev は --var MIN_TIME_FACTOR:0 で起動する（実時間チェックを省略）
// ボットで 80〜100面の正しい入力ログを作り、サーバーで検証させる。
import { encodeInputs } from '../src/shared/replay';
import { stagesVersion } from '../src/shared/stages';
import { solve } from './solve';

const API = process.argv[2] ?? 'http://localhost:8787';

async function post(path: string, body: unknown) {
  const r = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as Record<string, unknown> };
}

const logs: Record<number, string> = {};
for (let st = 80; st <= 100; st++) {
  const sol = solve(st);
  if (!sol) throw new Error(`solve failed ${st}`);
  logs[st] = encodeInputs(sol);
  process.stdout.write(`${st} `);
}
console.log('\nsolutions ready');

// 不正: 順番飛ばし・偽ログ
{
  const { json } = await post('/api/run/start', { name: 'cheater', ver: stagesVersion() });
  const sid = json.sessionId as string;
  console.log('skip stage ->', (await post('/api/run/stage', { sessionId: sid, stage: 81, log: logs[81] })).json);
  console.log('fake log ->', (await post('/api/run/stage', { sessionId: sid, stage: 80, log: 'AAAA' })).json);
  console.log('after invalid ->', (await post('/api/run/stage', { sessionId: sid, stage: 80, log: logs[80] })).json);
}

async function fullRun(name: string) {
  const { json } = await post('/api/run/start', { name, ver: stagesVersion() });
  const sid = json.sessionId as string;
  let last: unknown = null;
  for (let st = 80; st <= 100; st++) {
    const r = await post('/api/run/stage', { sessionId: sid, stage: st, log: logs[st] });
    if (r.status !== 200) {
      console.log(name, 'stage', st, r.status, r.json);
      return;
    }
    last = r.json;
  }
  console.log(name, '->', JSON.stringify(last));
}
// 2人がほぼ同時に100面をクリア → 勝者は必ず1人
await Promise.all([fullRun('ボットA'), fullRun('ボットB')]);
await fullRun('ボットC');
console.log('state ->', await (await fetch(API + '/api/state')).json());
