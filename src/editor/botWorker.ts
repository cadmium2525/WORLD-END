// エディタのボット検証（画面が固まらないよう Web Worker で実行）
import { solveLevel } from '../shared/solver';
import { defToLevel, type StageDef } from '../shared/stageFormat';

self.onmessage = (ev: MessageEvent<{ stage: number; world: number; def: StageDef }>) => {
  const { stage, world, def } = ev.data;
  const L = defToLevel(stage, world, def);
  const t0 = performance.now();
  let r = solveLevel(L);
  if (!r.inputs) {
    const r2 = solveLevel(L, 1500, 3);
    r = r2.inputs || r2.bestX > r.bestX ? r2 : r;
  }
  self.postMessage({ inputs: r.inputs, bestX: r.bestX, ms: performance.now() - t0 });
};
