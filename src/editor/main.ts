// ステージエディタ
import '../client/style.css';
import './editor.css';
import { BOSS_STAGE, ROWS, T, TILE, VIEW_H } from '../shared/constants';
import type { EntSpec, Level } from '../shared/level';
import { Sim } from '../shared/sim';
import { MAX_WIDTH, MIN_WIDTH, checkDef, defToLevel, levelToDef, type StageDef } from '../shared/stageFormat';
import { CUSTOM_STAGES, generatedStage, stageLabel, worldOf } from '../shared/stages';
import { Input } from '../client/input';
import { Renderer, WORLD_NAMES } from '../client/render';

const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;
const DRAFT_KEY = 'worldend.editor.drafts.v1';
const LAST_KEY = 'worldend.editor.last.v1';

// ---------------- 下書き ----------------
function loadDrafts(): Record<string, StageDef> {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') as Record<string, StageDef>;
  } catch {
    return {};
  }
}
function saveDrafts(d: Record<string, StageDef>) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    msg('下書きを保存できませんでした（ブラウザの保存領域）');
  }
}

// ---------------- ツール ----------------
interface Tool {
  id: string; // タイル文字 / 'ent:walker' / 'select' / 'erase'
  label: string;
  key?: string;
  color: string;
}
const TOOLS: { group: string; items: Tool[] }[] = [
  {
    group: '基本',
    items: [
      { id: 'select', label: '選択・移動', key: '9', color: '#8080ff' },
      { id: 'erase', label: '消しゴム', key: '0', color: '#555' },
      { id: 'P', label: 'スタート', key: '8', color: '#f4f4ff' },
      { id: 'G', label: 'ゴール', key: '7', color: '#ff4060' },
    ],
  },
  {
    group: '地形',
    items: [
      { id: '#', label: '地面', key: '1', color: '#8a5a3a' },
      { id: '=', label: 'レンガ', key: '2', color: '#c0703f' },
      { id: '-', label: 'すり抜け床', color: '#5cc04a' },
    ],
  },
  {
    group: 'トゲ・罠',
    items: [
      { id: '^', label: 'トゲ ↑', key: '3', color: '#e8e8f0' },
      { id: 'v', label: 'トゲ ↓', key: '4', color: '#e8e8f0' },
      { id: '<', label: 'トゲ ←', color: '#e8e8f0' },
      { id: '>', label: 'トゲ →', color: '#e8e8f0' },
      { id: '!', label: '罠トゲ（隠れ）', color: '#ff6060' },
    ],
  },
  {
    group: 'ギミック',
    items: [
      { id: '%', label: '崩れる床', key: '5', color: '#d8a870' },
      { id: 'S', label: 'スイッチ', color: '#3a3a48' },
      { id: 'A', label: 'Aブロック', color: '#ff5a8a' },
      { id: 'B', label: 'Bブロック', color: '#4ab0ff' },
    ],
  },
  {
    group: '敵・移動床',
    items: [
      { id: 'ent:walker', label: '歩く敵', key: '6', color: '#c03a4a' },
      { id: 'ent:flyer', label: '飛ぶ敵', color: '#8a4ad0' },
      { id: 'ent:turret', label: '砲台', color: '#2a2a34' },
      { id: 'ent:platH', label: '横移動床', color: '#f0e0a0' },
      { id: 'ent:platV', label: '縦移動床', color: '#f0e0a0' },
    ],
  },
];

const ENT_NAMES: Record<string, string> = {
  walker: '歩く敵',
  flyer: '飛ぶ敵',
  turret: '砲台',
  platH: '横移動床',
  platV: '縦移動床',
};

function defaultEnt(k: string, x: number, y: number): EntSpec | null {
  switch (k) {
    case 'walker':
      return { k: 'walker', x, y, dir: -1 };
    case 'flyer':
      return { k: 'flyer', x, y, range: 4, speed: 128, phase: 0 };
    case 'turret':
      return { k: 'turret', x, y, dir: -1, period: 100, phase: 0, speed: 384 };
    case 'platH':
      return { k: 'platH', x, y, w: 3, range: 4, speed: 144, phase: 0 };
    case 'platV':
      return { k: 'platV', x, y, w: 2, range: 5, speed: 128, phase: 0 };
  }
  return null;
}

/** 配置物が占める範囲（タイル） */
function entRect(e: EntSpec): [number, number, number, number] {
  switch (e.k) {
    case 'flyer':
      return [e.x, e.y, 1, e.range + 1];
    case 'platH':
      return [e.x, e.y, e.w + e.range, 1];
    case 'platV':
      return [e.x, e.y - e.range, e.w, e.range + 1];
    default:
      return [e.x, e.y, 1, 1];
  }
}

// ---------------- 状態 ----------------
let drafts = loadDrafts();
let stage = 1;
let grid: string[][] = []; // [y][x]
let ents: EntSpec[] = [];
let tool = '#';
let selected = -1;
let selCol = -1;
let zoom = 2;
let undoStack: string[] = [];
let redoStack: string[] = [];
let hover: [number, number] | null = null;
let botWorker: Worker | null = null;

const canvas = $<HTMLCanvasElement>('ed-canvas');
const renderer = new Renderer(canvas);

const width = () => grid[0]?.length ?? 0;
const toDef = (): StageDef => ({ rows: grid.map((r) => r.join('')), ents: ents.map((e) => ({ ...e })) });
function fromDef(d: StageDef) {
  grid = d.rows.map((r) => r.split(''));
  ents = d.ents.map((e) => ({ ...e }));
  selected = -1;
}
const snapshot = () => JSON.stringify(toDef());

function msg(text: string) {
  $('ed-msg').textContent = text;
}

function currentLevel(): Level {
  return defToLevel(stage, worldOf(stage), toDef());
}

// ---------------- 読み込み・保存 ----------------
function sourceOf(n: number): 'draft' | 'repo' | 'gen' {
  if (drafts[String(n)]) return 'draft';
  if (CUSTOM_STAGES[String(n)]) return 'repo';
  return 'gen';
}

function loadStage(n: number) {
  stage = n;
  const d = drafts[String(n)] ?? CUSTOM_STAGES[String(n)] ?? levelToDef(generatedStage(n));
  fromDef(JSON.parse(JSON.stringify(d)) as StageDef);
  undoStack = [];
  redoStack = [];
  selCol = -1;
  try {
    localStorage.setItem(LAST_KEY, String(n));
  } catch {
    /* noop */
  }
  $('ed-bot-result').textContent = '';
  refreshAll();
}

function commit() {
  // 変更を下書きに保存
  drafts[String(stage)] = toDef();
  saveDrafts(drafts);
  refreshAll();
}

function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > 200) undoStack.shift();
  redoStack = [];
}

function undo() {
  const s = undoStack.pop();
  if (!s) return;
  redoStack.push(snapshot());
  fromDef(JSON.parse(s) as StageDef);
  commit();
}

function redo() {
  const s = redoStack.pop();
  if (!s) return;
  undoStack.push(snapshot());
  fromDef(JSON.parse(s) as StageDef);
  commit();
}

// ---------------- 表示 ----------------
function buildStageSelect() {
  const sel = $<HTMLSelectElement>('ed-stage');
  sel.innerHTML = '';
  for (let n = 1; n < BOSS_STAGE; n++) {
    const o = document.createElement('option');
    o.value = String(n);
    const src = sourceOf(n);
    const mark = src === 'draft' ? ' ✎下書き' : src === 'repo' ? ' ★手作り' : '';
    o.textContent = `${n}（${stageLabel(n)}）${mark}`;
    sel.appendChild(o);
  }
  sel.value = String(stage);
}

function refreshAll() {
  buildStageSelect();
  const src = sourceOf(stage);
  const badge = $('ed-source');
  badge.textContent = src === 'draft' ? '下書き（未反映）' : src === 'repo' ? '手作り（反映済み）' : '自動生成';
  badge.className = `badge ${src}`;
  $('ed-info').innerHTML = `${stage}面（${stageLabel(stage)}）${WORLD_NAMES[worldOf(stage) - 1]}<br>幅 ${width()} 列 ／ 配置物 ${ents.length} 個`;
  const errs = checkDef(toDef());
  $('ed-errors').innerHTML = errs.length
    ? errs.map((e) => `<div class="err">⚠ ${e}</div>`).join('')
    : '<div class="ok">✓ 形式OK</div>';
  $<HTMLButtonElement>('ed-undo').disabled = undoStack.length === 0;
  $<HTMLButtonElement>('ed-redo').disabled = redoStack.length === 0;
  $<HTMLButtonElement>('ed-discard').disabled = src !== 'draft';
  $('ed-col-label').textContent = selCol >= 0 ? `（選択中：${selCol}列目）` : '（クリックで選択）';
  renderProps();
  draw();
}

function draw() {
  const L = currentLevel();
  const sim = new Sim(L);
  const W = L.w * TILE;
  renderer.viewW = W;
  renderer.scale = zoom;
  renderer.camX = 0;
  canvas.width = W * zoom;
  canvas.height = VIEW_H * zoom;
  canvas.style.width = `${W * zoom}px`;
  canvas.style.height = `${VIEW_H * zoom}px`;
  renderer.draw(sim, 0);
  const ctx = renderer.ctx;
  ctx.setTransform(zoom, 0, 0, zoom, 0, 0);

  // グリッド
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  for (let x = 0; x <= L.w; x++) {
    ctx.moveTo(x * TILE, 0);
    ctx.lineTo(x * TILE, VIEW_H);
  }
  for (let y = 0; y <= ROWS; y++) {
    ctx.moveTo(0, y * TILE);
    ctx.lineTo(W, y * TILE);
  }
  ctx.stroke();
  // 10列ごとの目盛り
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '7px sans-serif';
  for (let x = 0; x < L.w; x += 10) {
    ctx.fillRect(x * TILE, 0, 1 / zoom, VIEW_H);
    ctx.fillText(String(x), x * TILE + 2, 8);
  }

  // 選択列
  if (selCol >= 0) {
    ctx.fillStyle = 'rgba(120,120,255,0.15)';
    ctx.fillRect(selCol * TILE, 0, TILE, VIEW_H);
  }

  // スタート・罠・A/B を見やすく
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < L.w; x++) {
      const c = grid[y][x];
      if (c === 'P') {
        ctx.strokeStyle = '#60ff90';
        ctx.lineWidth = 1;
        ctx.strokeRect(x * TILE + 0.5, y * TILE + 0.5, TILE - 1, TILE - 1);
        ctx.fillStyle = '#60ff90';
        ctx.fillText('START', x * TILE - 4, y * TILE - 2);
      } else if (c === '!') {
        ctx.fillStyle = 'rgba(255,60,60,0.45)';
        ctx.beginPath();
        ctx.moveTo(x * TILE + 2, y * TILE + 16);
        ctx.lineTo(x * TILE + 8, y * TILE + 6);
        ctx.lineTo(x * TILE + 14, y * TILE + 16);
        ctx.fill();
      } else if (c === 'B') {
        ctx.strokeStyle = '#4ab0ff';
        ctx.lineWidth = 1;
        ctx.strokeRect(x * TILE + 1.5, y * TILE + 1.5, TILE - 3, TILE - 3);
      }
    }
  }

  // 配置物の範囲
  ents.forEach((e, i) => {
    const [x, y, w, h] = entRect(e);
    ctx.setLineDash([3, 2]);
    ctx.strokeStyle = i === selected ? '#ffe060' : 'rgba(255,255,255,0.5)';
    ctx.lineWidth = i === selected ? 1.5 : 1;
    ctx.strokeRect(x * TILE + 0.5, y * TILE + 0.5, w * TILE - 1, h * TILE - 1);
    ctx.setLineDash([]);
    if (e.k === 'walker' || e.k === 'turret') {
      ctx.fillStyle = i === selected ? '#ffe060' : '#fff';
      ctx.fillText(e.dir < 0 ? '←' : '→', e.x * TILE + 4, e.y * TILE - 1);
    }
  });

  // カーソル
  if (hover) {
    const [hx, hy] = hover;
    ctx.strokeStyle = '#ffe060';
    ctx.lineWidth = 1;
    ctx.strokeRect(hx * TILE + 0.5, hy * TILE + 0.5, TILE - 1, TILE - 1);
  }
}

// ---------------- パレット ----------------
function buildPalette() {
  const pal = $('ed-palette');
  for (const g of TOOLS) {
    const h = document.createElement('h4');
    h.textContent = g.group;
    pal.appendChild(h);
    for (const t of g.items) {
      const b = document.createElement('button');
      b.dataset.tool = t.id;
      const sw = document.createElement('canvas');
      sw.width = 10;
      sw.height = 10;
      const c = sw.getContext('2d')!;
      c.fillStyle = t.color;
      c.fillRect(1, 1, 8, 8);
      b.appendChild(sw);
      b.appendChild(document.createTextNode(t.label));
      if (t.key) {
        const k = document.createElement('kbd');
        k.textContent = t.key;
        b.appendChild(k);
      }
      b.addEventListener('click', () => setTool(t.id));
      pal.appendChild(b);
    }
  }
}

function setTool(id: string) {
  tool = id;
  document.querySelectorAll<HTMLButtonElement>('#ed-palette button').forEach((b) => b.classList.toggle('on', b.dataset.tool === id));
  canvas.style.cursor = id === 'select' ? 'pointer' : 'crosshair';
}

// ---------------- 編集操作 ----------------
function entAt(x: number, y: number): number {
  // 原点が一致するものを優先
  for (let i = ents.length - 1; i >= 0; i--) if (ents[i].x === x && ents[i].y === y) return i;
  for (let i = ents.length - 1; i >= 0; i--) {
    const [ex, ey, w, h] = entRect(ents[i]);
    if (x >= ex && x < ex + w && y >= ey && y < ey + h) return i;
  }
  return -1;
}

function setCell(x: number, y: number, c: string) {
  if (x < 0 || y < 0 || x >= width() || y >= ROWS) return;
  const old = grid[y][x];
  if (old === c) return;
  if (old === 'T') ents = ents.filter((e) => !(e.k === 'turret' && e.x === x && e.y === y));
  if (c === 'P') {
    for (const r of grid) for (let i = 0; i < r.length; i++) if (r[i] === 'P') r[i] = '.';
  }
  grid[y][x] = c;
}

function erase(x: number, y: number) {
  const i = entAt(x, y);
  if (i >= 0 && ents[i].k !== 'turret') {
    ents.splice(i, 1);
    selected = -1;
    return;
  }
  setCell(x, y, '.');
}

function apply(x: number, y: number, first: boolean) {
  if (tool === 'erase') return erase(x, y);
  if (tool === 'select') return;
  if (tool.startsWith('ent:')) {
    if (!first) return;
    const k = tool.slice(4);
    if (k === 'turret') {
      setCell(x, y, 'T');
      ents.push(defaultEnt(k, x, y)!);
    } else {
      ents.push(defaultEnt(k, x, y)!);
    }
    selected = ents.length - 1;
    return;
  }
  if (tool === 'G') {
    setCell(x, y, 'G');
    if (y > 0) setCell(x, y - 1, 'G');
    return;
  }
  if (tool === 'P' && !first) return;
  setCell(x, y, tool);
}

let dragging: 'paint' | 'erase' | 'move' | null = null;
let moveOffset: [number, number] = [0, 0];
let lastCell = '';

function cellOf(ev: PointerEvent): [number, number] {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor((ev.clientX - r.left) / (TILE * zoom));
  const y = Math.floor((ev.clientY - r.top) / (TILE * zoom));
  return [Math.max(0, Math.min(width() - 1, x)), Math.max(0, Math.min(ROWS - 1, y))];
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (ev) => {
  ev.preventDefault();
  canvas.setPointerCapture(ev.pointerId);
  const [x, y] = cellOf(ev);
  selCol = x;
  pushUndo();
  lastCell = `${x},${y}`;
  if (ev.button === 2 || tool === 'erase') {
    dragging = 'erase';
    erase(x, y);
  } else if (tool === 'select') {
    selected = entAt(x, y);
    if (selected >= 0) {
      dragging = 'move';
      moveOffset = [x - ents[selected].x, y - ents[selected].y];
    }
  } else {
    dragging = 'paint';
    apply(x, y, true);
  }
  refreshAll();
});
canvas.addEventListener('pointermove', (ev) => {
  const [x, y] = cellOf(ev);
  hover = [x, y];
  $('ed-pos').textContent = `列 ${x} ／ 行 ${y}`;
  const key = `${x},${y}`;
  if (dragging && key !== lastCell) {
    lastCell = key;
    if (dragging === 'erase') erase(x, y);
    else if (dragging === 'paint') apply(x, y, false);
    else if (dragging === 'move' && selected >= 0) {
      const e = ents[selected];
      const nx = Math.max(0, Math.min(width() - 1, x - moveOffset[0]));
      const ny = Math.max(0, Math.min(ROWS - 1, y - moveOffset[1]));
      if (e.k === 'turret') {
        if (grid[e.y][e.x] === 'T') grid[e.y][e.x] = '.';
        grid[ny][nx] = 'T';
      }
      e.x = nx;
      e.y = ny;
    }
    draw();
  } else draw();
});
const endDrag = () => {
  if (!dragging) return;
  dragging = null;
  if (undoStack.length && undoStack[undoStack.length - 1] === snapshot()) undoStack.pop();
  commit();
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', () => {
  hover = null;
  draw();
});

// ---------------- 列の操作 ----------------
function insertCol(at: number) {
  if (width() >= MAX_WIDTH) return msg(`幅は最大 ${MAX_WIDTH} 列です`);
  pushUndo();
  // 挿入する列は左隣の地面の形をコピー（地面・レンガだけ）
  for (const r of grid) {
    const left = r[Math.max(0, at - 1)] ?? '.';
    r.splice(at, 0, left === '#' || left === '=' ? left : '.');
  }
  for (const e of ents) if (e.x >= at) e.x++;
  commit();
}

function deleteCol(at: number) {
  if (width() <= MIN_WIDTH) return msg(`幅は最小 ${MIN_WIDTH} 列です`);
  pushUndo();
  for (const r of grid) r.splice(at, 1);
  ents = ents.filter((e) => e.x !== at);
  for (const e of ents) if (e.x > at) e.x--;
  if (selCol >= width()) selCol = width() - 1;
  selected = -1;
  commit();
}

// ---------------- プロパティ ----------------
function renderProps() {
  const box = $('ed-props');
  if (selected < 0 || !ents[selected]) {
    box.innerHTML = '<p class="hint">「選択・移動」ツールで敵や移動床をクリックすると、ここで設定を変えられます（ドラッグで移動）。</p>';
    return;
  }
  const e = ents[selected] as unknown as Record<string, number | string>;
  const fields: [string, string, string, number, number, number][] = []; // key, label, hint, min, max, step
  const k = e.k as string;
  if (k === 'walker' || k === 'turret') fields.push(['dir', '向き', '', -1, 1, 2]);
  if (k === 'platH' || k === 'platV') fields.push(['w', '幅（タイル）', '', 1, 8, 1]);
  if (k !== 'walker' && k !== 'turret') fields.push(['range', '移動距離（タイル）', '', 1, 16, 1]);
  if (k !== 'walker') fields.push(['speed', '速さ（px/フレーム）', k === 'turret' ? '弾の速さ' : '', 0.25, 6, 0.125]);
  if (k === 'turret') fields.push(['period', '発射間隔（フレーム）', '60 = 1秒', 20, 600, 1]);
  if (k !== 'walker') fields.push(['phase', '開始タイミング（フレーム）', '同じ種類の動きをずらす', 0, 999, 1]);

  let html = `<p><strong>${ENT_NAMES[k] ?? k}</strong>（列 ${e.x}・行 ${e.y}）</p>`;
  for (const [key, label, hint, min, max, step] of fields) {
    if (key === 'dir') {
      html += `<label>${label}<select data-key="dir"><option value="-1"${e.dir === -1 ? ' selected' : ''}>← 左</option><option value="1"${e.dir === 1 ? ' selected' : ''}>→ 右</option></select></label>`;
    } else {
      const v = key === 'speed' ? Number(e.speed) / 256 : Number(e[key]);
      html += `<label>${label}<input type="number" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${v}" /></label>`;
      if (hint) html += `<label><span></span><small>${hint}</small></label>`;
    }
  }
  html += '<div class="btns"><button id="ed-ent-del" class="danger">この配置物を削除</button></div>';
  box.innerHTML = html;
  box.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]').forEach((el) =>
    el.addEventListener('change', () => {
      const key = el.dataset.key!;
      let v = Number(el.value);
      if (!Number.isFinite(v)) return;
      pushUndo();
      if (key === 'speed') v = Math.max(16, Math.round(v * 256));
      else v = Math.round(v);
      (ents[selected] as unknown as Record<string, number>)[key] = v;
      commit();
    }),
  );
  $('ed-ent-del').addEventListener('click', () => {
    pushUndo();
    const ent = ents[selected];
    if (ent.k === 'turret' && grid[ent.y][ent.x] === 'T') grid[ent.y][ent.x] = '.';
    ents.splice(selected, 1);
    selected = -1;
    commit();
  });
}

// ---------------- テストプレイ ----------------
const playLayer = $('ed-playlayer');
const playCanvas = $<HTMLCanvasElement>('game');
const playRenderer = new Renderer(playCanvas);
const input = new Input($('dpad'), $('jump'));
let playing = false;
let playSim: Sim | null = null;
let playLevel: Level | null = null;
let playInputs: number[] | null = null; // ボットの再生用
let playFrame = 0;
let playDeaths = 0;
let playTimer = 0;
let playState: 'play' | 'dead' | 'clear' = 'play';

function standY(L: Level, x: number): number {
  for (let y = 1; y < L.h; y++) {
    const t = L.tiles[y * L.w + x];
    const above = L.tiles[(y - 1) * L.w + x];
    const solid = t === T.SOLID || t === T.BRICK || t === T.CRUMBLE || t === T.ONEWAY || t === T.SWITCH || t === T.TURRET;
    if (solid && (above === T.EMPTY || above === T.GOAL)) return y - 1;
  }
  return -1;
}

function startPlay(fromCol: number | null, inputs: number[] | null = null) {
  const errs = checkDef(toDef()).filter((e) => !e.includes('ゴール'));
  if (errs.length) return msg(`テストできません：${errs[0]}`);
  const L = currentLevel();
  if (fromCol !== null && fromCol >= 0) {
    const y = standY(L, fromCol);
    if (y < 0) return msg('その列には立てる場所がありません');
    L.startX = fromCol;
    L.startY = y;
  }
  playLevel = L;
  playInputs = inputs;
  playDeaths = 0;
  resetPlay();
  playing = true;
  playLayer.classList.remove('hidden');
  const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  $('touch').classList.toggle('hidden', !touch || !!inputs);
  resizePlay();
  last = performance.now();
  requestAnimationFrame(loop);
}

function resetPlay() {
  playSim = new Sim(playLevel!, { invincible: $<HTMLInputElement>('ed-inv').checked && !playInputs });
  playFrame = 0;
  playState = 'play';
  playRenderer.camX = 0;
}

function stopPlay() {
  playing = false;
  playLayer.classList.add('hidden');
  $('banner').classList.add('hidden');
}

function resizePlay() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  playRenderer.resize(vw, vh);
  const ratio = playRenderer.viewW / VIEW_H;
  let h = vh;
  let w = h * ratio;
  if (w > vw) {
    w = vw;
    h = w / ratio;
  }
  playCanvas.style.width = `${Math.floor(w)}px`;
  playCanvas.style.height = `${Math.floor(h)}px`;
}
window.addEventListener('resize', () => playing && resizePlay());

function banner(text: string, ms: number) {
  const b = $('banner');
  b.innerHTML = text;
  b.classList.remove('hidden');
  setTimeout(() => b.classList.add('hidden'), ms);
}

let last = 0;
let acc = 0;
let ft = 0;
function loop(now: number) {
  if (!playing) return;
  acc += Math.min(100, now - last);
  last = now;
  let n = 0;
  while (acc >= 1000 / 60 && n < 4) {
    tickPlay();
    acc -= 1000 / 60;
    n++;
  }
  if (n >= 4) acc = 0;
  ft++;
  playRenderer.draw(playSim!, ft, $<HTMLInputElement>('ed-inv').checked);
  const secs = (playFrame / 60).toFixed(1);
  $('ed-play-info').textContent = `${stage}面 テストプレイ${playInputs ? '（ボットの再生）' : ''}　${secs}秒　☠ ${playDeaths}`;
  requestAnimationFrame(loop);
}

function tickPlay() {
  const s = playSim!;
  if (playState === 'play') {
    const inp = playInputs ? (playInputs[playFrame] ?? 0) : input.read();
    s.step(inp);
    playFrame++;
    if (s.dead) {
      playDeaths++;
      playState = 'dead';
      playTimer = 35;
      const c = playRenderer.playerCenter(s);
      playRenderer.burst(c.x, c.y, 24, ['#fff', '#ff3a50', '#ffd040']);
    } else if (s.cleared) {
      playState = 'clear';
      playTimer = 90;
      banner(`CLEAR!<small>${(playFrame / 60).toFixed(1)}秒 ／ 死亡 ${playDeaths} 回</small>`, 1500);
    }
  } else if (--playTimer <= 0) {
    if (playState === 'clear' && playInputs) stopPlay();
    else resetPlay();
  }
}

input.onPause = () => playing && stopPlay();
input.onRetry = () => {
  if (playing) resetPlay();
};
$('ed-play-exit').addEventListener('click', stopPlay);

// ---------------- ボット検証 ----------------
function runBot() {
  const errs = checkDef(toDef());
  if (errs.length) return msg(`検証できません：${errs[0]}`);
  botWorker?.terminate();
  botWorker = new Worker(new URL('./botWorker.ts', import.meta.url), { type: 'module' });
  const out = $('ed-bot-result');
  out.innerHTML = '🤖 検証中…（数秒〜1分）';
  const n = stage;
  botWorker.onmessage = (ev: MessageEvent<{ inputs: number[] | null; bestX: number; ms: number }>) => {
    const { inputs, bestX } = ev.data;
    if (n !== stage) return;
    if (inputs) {
      out.innerHTML = `<span style="color:#70e0a0">✓ ボットがクリア（${(inputs.length / 60).toFixed(1)}秒）</span><br><button id="ed-bot-watch">ボットの動きを見る</button>`;
      $('ed-bot-watch').addEventListener('click', () => startPlay(null, inputs));
    } else {
      const col = Math.floor(bestX / (TILE * 256));
      out.innerHTML = `<span style="color:#ff8090">✗ ボットはクリアできませんでした（${col}列目あたりで止まる）</span><br><small>※ボットは完璧ではありません。人間なら行ける場合もあるので、テストプレイで確認してください。</small>`;
      selCol = col;
      draw();
    }
    botWorker?.terminate();
    botWorker = null;
  };
  botWorker.postMessage({ stage: n, world: worldOf(n), def: toDef() });
}

// ---------------- 書き出し・取り込み ----------------
function exportText(): string {
  const all: Record<string, StageDef> = { ...CUSTOM_STAGES, ...drafts };
  const keys = Object.keys(all)
    .map(Number)
    .filter((k) => k >= 1 && k < BOSS_STAGE)
    .sort((a, b) => a - b);
  // 1行1列で見やすい JSON にする
  const parts = keys.map((k) => {
    const d = all[String(k)];
    const rows = d.rows.map((r) => `      ${JSON.stringify(r)}`).join(',\n');
    const es = d.ents.map((e) => `      ${JSON.stringify(e)}`).join(',\n');
    return `  "${k}": {\n    "rows": [\n${rows}\n    ],\n    "ents": [${es ? `\n${es}\n    ` : ''}]\n  }`;
  });
  return `{\n${parts.join(',\n')}\n}\n`;
}

$('ed-export').addEventListener('click', () => {
  const bad = Object.entries(drafts).filter(([, d]) => checkDef(d).length > 0);
  $<HTMLTextAreaElement>('ed-export-text').value = exportText();
  $('ed-modal').classList.remove('hidden');
  if (bad.length) msg(`形式エラーのある下書き（${bad.map(([k]) => k).join(', ')}面）はゲームでは自動生成に置き換わります`);
});
$('ed-export-close').addEventListener('click', () => $('ed-modal').classList.add('hidden'));
$('ed-export-copy').addEventListener('click', async () => {
  const t = $<HTMLTextAreaElement>('ed-export-text');
  try {
    await navigator.clipboard.writeText(t.value);
  } catch {
    t.select();
    document.execCommand('copy');
  }
  msg('コピーしました');
});
$('ed-export-dl').addEventListener('click', () => {
  const blob = new Blob([exportText()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'stage-data.json';
  a.click();
  URL.revokeObjectURL(a.href);
});
$('ed-import').addEventListener('click', () => $('ed-import-file').click());
$<HTMLInputElement>('ed-import-file').addEventListener('change', async (ev) => {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text()) as Record<string, StageDef>;
    let n = 0;
    for (const [k, d] of Object.entries(data)) {
      if (Array.isArray(d?.rows) && Array.isArray(d?.ents)) {
        drafts[k] = d;
        n++;
      }
    }
    saveDrafts(drafts);
    loadStage(stage);
    msg(`${n} 面分を下書きに取り込みました`);
  } catch {
    msg('JSON を読み込めませんでした');
  }
  (ev.target as HTMLInputElement).value = '';
});

// ---------------- ボタン・キー ----------------
$<HTMLSelectElement>('ed-stage').addEventListener('change', (e) => loadStage(Number((e.target as HTMLSelectElement).value)));
$<HTMLSelectElement>('ed-zoom').addEventListener('change', (e) => {
  zoom = Number((e.target as HTMLSelectElement).value);
  draw();
});
$('ed-undo').addEventListener('click', undo);
$('ed-redo').addEventListener('click', redo);
$('ed-play').addEventListener('click', () => startPlay(null));
$('ed-play-col').addEventListener('click', () => (selCol >= 0 ? startPlay(selCol) : msg('先に列をクリックして選んでください')));
$('ed-bot').addEventListener('click', runBot);
$('ed-col-ins').addEventListener('click', () => insertCol(Math.max(0, selCol)));
$('ed-col-del').addEventListener('click', () => selCol >= 0 && deleteCol(selCol));
$('ed-col-add').addEventListener('click', () => {
  for (let i = 0; i < 5; i++) insertCol(width());
});
$('ed-col-rm').addEventListener('click', () => {
  for (let i = 0; i < 5; i++) deleteCol(width() - 1);
});
$('ed-from-gen').addEventListener('click', () => {
  if (!confirm('いまの内容を、自動生成の面で置き換えますか？（「戻す」で元に戻せます）')) return;
  pushUndo();
  fromDef(levelToDef(generatedStage(stage)));
  commit();
});
$('ed-clear').addEventListener('click', () => {
  if (!confirm('地面だけのまっさらな面にしますか？（「戻す」で元に戻せます）')) return;
  pushUndo();
  const w = Math.max(MIN_WIDTH, 60);
  grid = [];
  for (let y = 0; y < ROWS; y++) grid.push(Array.from({ length: w }, () => (y >= 14 ? '#' : '.')));
  grid[13][2] = 'P';
  grid[13][w - 4] = 'G';
  grid[12][w - 4] = 'G';
  ents = [];
  selected = -1;
  commit();
});
$('ed-discard').addEventListener('click', () => {
  if (!confirm('この面の下書きを破棄して、反映済み（または自動生成）の状態に戻しますか？')) return;
  delete drafts[String(stage)];
  saveDrafts(drafts);
  loadStage(stage);
});

window.addEventListener('keydown', (e) => {
  if (playing) return;
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'p') startPlay(null);
  else if (k === 'i' && selCol >= 0) insertCol(selCol);
  else if (k === 'x' && selCol >= 0) deleteCol(selCol);
  else if ((k === 'delete' || k === 'backspace') && selected >= 0) $('ed-ent-del')?.click();
  else {
    for (const g of TOOLS) for (const t of g.items) if (t.key === e.key) setTool(t.id);
  }
});

// ---------------- 起動 ----------------
buildPalette();
setTool('#');
const lastStage = Number(localStorage.getItem(LAST_KEY) ?? '1');
loadStage(lastStage >= 1 && lastStage < BOSS_STAGE ? lastStage : 1);

