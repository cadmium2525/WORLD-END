// ステージをテキストで表示する開発ツール: npm run preview-stage -- 12
import { T } from '../src/shared/constants';
import { getStage, stageLevel } from '../src/shared/stages';

const CH: Record<number, string> = {
  [T.EMPTY]: '.', [T.SOLID]: '#', [T.BRICK]: '=', [T.SPIKE_UP]: '^', [T.SPIKE_DOWN]: 'v',
  [T.SPIKE_LEFT]: '<', [T.SPIKE_RIGHT]: '>', [T.CRUMBLE]: '%', [T.SWITCH]: 'S', [T.ABLOCK]: 'A',
  [T.BBLOCK]: 'B', [T.TRAP]: '!', [T.GOAL]: 'G', [T.ONEWAY]: '-', [T.TURRET]: 'T',
};
const n = Number(process.argv[2] ?? 1);
const from = Number(process.argv[3] ?? 0);
const to = Number(process.argv[4] ?? 9999);
const L = getStage(n);
console.log(`stage ${n} lv=${stageLevel(n)} w=${L.w}`);
const rows: string[][] = [];
for (let y = 0; y < L.h; y++) {
  const r: string[] = [];
  for (let x = 0; x < L.w; x++) r.push(CH[L.tiles[y * L.w + x]] ?? '?');
  rows.push(r);
}
const tag: Record<string, string> = { walker: 'e', flyer: 'f', platH: '_', platV: '|', boss: 'X' };
for (const e of L.ents) if (tag[e.k]) rows[e.y]?.splice(e.x, 1, tag[e.k]);
let ruler = '';
for (let x = 0; x < L.w; x++) ruler += x % 10 === 0 ? String((x / 10) % 10) : ' ';
console.log(ruler.slice(from, to));
for (const r of rows) console.log(r.join('').slice(from, to));
console.log(JSON.stringify(L.ents.filter(e => e.k !== 'walker')));
