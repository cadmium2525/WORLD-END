// 面の多様性を機械的に測る開発ツール: npx tsx tools/diversity.ts [開始面=101] [終了面=199] [--quiet]
//
// 各面について「面の型・主役・使っているギミックの集合・大きさ」を出し、
// 似すぎている面の組を警告する。警告があれば終了コード 1。
//
// 警告の条件:
//   1. 同じ型が3面以上続く
//   2. となりの面との類似度が 0.75 以上
//   3. 範囲全体で類似度 0.85 以上の組（ほぼ同じ面）
//   4. 同じワールドで「型・主役・長さの区分」がすべて同じ面がある
//   5. 同じビート列の面がある
//   6. 新ギミックの初登場の面で、そのギミックが主役でない／他の新ギミックと一緒に出る（導入は単独で）
import { T } from '../src/shared/constants';
import type { Level } from '../src/shared/level';
import { getStage, worldOf } from '../src/shared/stages';
import { MECH_NAMES, NEW_MECHS, TYPE_NAMES, designOf, type Mech, type StageDesign } from '../src/shared/stages2';

/** 面に実際に入っているギミック（設計表ではなく、できあがった Level から調べる） */
export function mechsOf(L: Level): Set<Mech> {
  const m = new Set<Mech>();
  for (let i = 0; i < L.tiles.length; i++) {
    switch (L.tiles[i]) {
      case T.SPRING:
        m.add('spring');
        break;
      case T.WIND_L:
      case T.WIND_R:
      case T.WIND_U:
        m.add('wind');
        break;
      case T.ONEWAY:
        m.add('cloud');
        break;
      case T.ICE:
        m.add('ice');
        break;
      case T.ICICLE:
        m.add('icicle');
        break;
      case T.CONV_L:
      case T.CONV_R:
        m.add('conveyor');
        break;
      case T.DOOR:
        m.add('key');
        break;
      case T.GRAV_UP:
      case T.GRAV_DOWN:
        m.add('grav');
        break;
      case T.CRUMBLE:
        m.add('crumble');
        break;
      case T.SWITCH:
        m.add('switch');
        break;
      case T.TURRET:
        m.add('turret');
        break;
      case T.SPIKE_UP:
      case T.SPIKE_DOWN:
      case T.SPIKE_LEFT:
      case T.SPIKE_RIGHT:
        m.add('spike');
        break;
    }
  }
  for (const e of L.ents) {
    if (e.k === 'platH' || e.k === 'platV') m.add('plat');
    else if (e.k in MECH_NAMES) m.add(e.k as Mech);
  }
  if (L.dark) m.add('dark');
  if (L.chase) m.add(L.chase.dir === 'right' ? 'wall' : 'lava');
  return m;
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni === 0 ? 1 : inter / uni;
}

/** 面の大きさ（横の長さ。縦に登る面は高さを横に換算） */
function sizeOf(L: Level): number {
  return L.h > 17 ? L.h * 2 : L.w;
}
function sizeClass(n: number): string {
  return n < 70 ? 'S' : n < 120 ? 'M' : 'L';
}

interface Info {
  stage: number;
  ds: StageDesign;
  mechs: Set<Mech>;
  beats: Set<string>;
  size: number;
}

export function similarity(a: Info, b: Info): number {
  const len = Math.min(a.size, b.size) / Math.max(a.size, b.size);
  return (
    0.35 * jaccard(a.mechs, b.mechs) +
    0.25 * jaccard(a.beats, b.beats) +
    0.2 * (a.ds.type === b.ds.type ? 1 : 0) +
    0.1 * (a.ds.star === b.ds.star ? 1 : 0) +
    0.1 * len
  );
}

const isMain = process.argv[1]?.endsWith('diversity.ts');
if (isMain) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const quiet = process.argv.includes('--quiet');
  const a = Number(args[0] ?? 101);
  const b = Number(args[1] ?? 199);
  const infos: Info[] = [];
  for (let st = a; st <= b; st++) {
    const ds = designOf(st);
    if (!ds) continue;
    const L = getStage(st);
    infos.push({ stage: st, ds, mechs: mechsOf(L), beats: new Set(ds.beats.map((x) => x.split('.')[0])), size: sizeOf(L) });
  }
  const warns: string[] = [];
  if (!quiet) console.log('面   W  型              主役              大きさ  ギミック');
  for (let i = 0; i < infos.length; i++) {
    const f = infos[i];
    if (!quiet) {
      const ms = [...f.mechs].map((m) => MECH_NAMES[m]).join('・');
      const adj = i > 0 ? similarity(infos[i - 1], f).toFixed(2) : '    ';
      console.log(
        `${f.stage}  ${worldOf(f.stage)}  ${TYPE_NAMES[f.ds.type].padEnd(8, '　')}  ${MECH_NAMES[f.ds.star].padEnd(8, '　')}  ${sizeClass(f.size)}${String(f.size).padStart(4)}  前と${adj}  ${ms}`,
      );
    }
    // 1. 同じ型が3面続く
    if (i >= 2 && infos[i - 1].ds.type === f.ds.type && infos[i - 2].ds.type === f.ds.type) {
      warns.push(`${f.stage - 2}〜${f.stage}面: 同じ型（${TYPE_NAMES[f.ds.type]}）が3面続いています`);
    }
    // 2. となりとの類似度
    if (i >= 1) {
      const s = similarity(infos[i - 1], f);
      if (s >= 0.75) warns.push(`${f.stage - 1}面と${f.stage}面が似すぎています（類似度 ${s.toFixed(2)}）`);
    }
  }
  for (let i = 0; i < infos.length; i++) {
    for (let j = i + 1; j < infos.length; j++) {
      const x = infos[i];
      const y = infos[j];
      const s = similarity(x, y);
      if (j > i + 1 && s >= 0.85) warns.push(`${x.stage}面と${y.stage}面がほぼ同じです（類似度 ${s.toFixed(2)}）`);
      if (
        worldOf(x.stage) === worldOf(y.stage) &&
        x.ds.type === y.ds.type &&
        x.ds.star === y.ds.star &&
        sizeClass(x.size) === sizeClass(y.size)
      ) {
        warns.push(`${x.stage}面と${y.stage}面: 型・主役・長さが同じ組み合わせです（${TYPE_NAMES[x.ds.type]}・${MECH_NAMES[x.ds.star]}・${sizeClass(x.size)}）`);
      }
      if (x.ds.beats.join(' ') === y.ds.beats.join(' ')) warns.push(`${x.stage}面と${y.stage}面: ビート列が同じです`);
    }
  }
  // 6. 新ギミックの導入
  const seen = new Set<Mech>();
  for (const f of infos) {
    const fresh = NEW_MECHS.filter((m) => f.mechs.has(m) && !seen.has(m));
    for (const m of fresh) {
      if (f.ds.star !== m) warns.push(`${f.stage}面: 新ギミック「${MECH_NAMES[m]}」の初登場なのに主役になっていません`);
    }
    if (fresh.length > 1) warns.push(`${f.stage}面: 新ギミックが同時に${fresh.length}つ初登場しています（${fresh.map((m) => MECH_NAMES[m]).join('・')}）`);
    // 導入面にはほかの新ギミックを混ぜない（既出の新ギミックも）
    if (fresh.length === 1) {
      const others = NEW_MECHS.filter((m) => m !== fresh[0] && f.mechs.has(m));
      if (others.length) warns.push(`${f.stage}面: 「${MECH_NAMES[fresh[0]]}」の導入面に他の新ギミック（${others.map((m) => MECH_NAMES[m]).join('・')}）が入っています`);
    }
    for (const m of fresh) seen.add(m);
  }
  // 全体の統計
  const typeCount = new Map<string, number>();
  for (const f of infos) typeCount.set(f.ds.type, (typeCount.get(f.ds.type) ?? 0) + 1);
  let adjSum = 0;
  for (let i = 1; i < infos.length; i++) adjSum += similarity(infos[i - 1], infos[i]);
  console.log(`型の内訳: ${[...typeCount].map(([t, n]) => `${TYPE_NAMES[t as keyof typeof TYPE_NAMES]} ${n}`).join(' / ')}`);
  console.log(`となりの面との類似度の平均: ${(adjSum / Math.max(1, infos.length - 1)).toFixed(3)}`);
  if (warns.length) {
    for (const w of warns) console.log(`警告: ${w}`);
    console.log(`警告 ${warns.length} 件`);
    process.exitCode = 1;
  } else console.log('警告 0 件');
}
