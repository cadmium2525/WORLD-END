// ボットの解答（入力列）を JSON で出力: npx tsx tools/dump-solutions.ts 80 100 > out.json
import { solve } from './solve';
const a = Number(process.argv[2] ?? 80);
const b = Number(process.argv[3] ?? a);
const out: Record<number, number[]> = {};
for (let s = a; s <= b; s++) {
  const r = solve(s);
  if (!r) throw new Error(`stage ${s} unsolved`);
  out[s] = r;
}
console.log(JSON.stringify(out));
