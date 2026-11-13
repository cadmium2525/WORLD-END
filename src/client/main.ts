import './style.css';
import { VIEW_H } from '../shared/constants';
import { DEFAULT_NAME, validateName } from '../shared/name';
import {
  FINAL_STAGE,
  NOSAVE_START,
  isCheckpoint,
  isNoSave,
  needsTicket,
  segmentEnd,
  segmentIndex,
  segmentLength,
  segmentPos,
  segmentStart,
} from '../shared/progress';
import { encodeInputs } from '../shared/replay';
import { Sim } from '../shared/sim';
import { getStage, stageLabel, worldOf } from '../shared/stages';
import { ApiError, ONLINE, getState, startRun, submitStage, type StageResult, type WorldState } from './api';
import { Sound } from './audio';
import { Input } from './input';
import { Renderer, WORLD_NAMES } from './render';
import { DEFAULT_SETTINGS, cacheWorld, cachedWorld, loadSave, loadSettings, storeSave, storeSettings, type Settings } from './save';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const STEP_MS = 1000 / 60;
const POLL_MS = 150_000;

// テスト用機能（面選択・無敵・スキップ）。本番では VITE_ALLOW_DEBUG=false でビルドすると完全に無効。
const DEBUG = import.meta.env.VITE_ALLOW_DEBUG !== 'false' && new URLSearchParams(location.search).has('debug');

type Mode = 'title' | 'play' | 'pause' | 'dead' | 'clear' | 'wait' | 'result' | 'ended';

const ERR_TEXT: Record<string, string> = {
  network: 'サーバーと通信できませんでした',
  too_slow: '時間がかかりすぎました（一時停止・中断が長すぎます）',
  too_fast: '記録の時間が不自然です',
  invalid_replay: 'プレイ記録の検証に失敗しました',
  bad_stage: '面の順番が正しくありません',
  bad_session: 'チャレンジの有効期限が切れました',
  world_ended: '世界はすでに終わっています',
  bad_name: 'その名前は使えません',
  rate_limited: 'アクセスが集中しています',
  version_mismatch: 'ゲームのステージがサーバーと一致しません（ページを再読込してください）',
  no_ticket: 'この区間を始めるためのチケットがありません（前の区間をサーバーで検証できていません）',
  ticket_required: 'この区間を始めるためのチケットがありません',
  bad_ticket: 'チケットが正しくありません',
  ticket_wrong_segment: 'チケットが別の区間のものです',
  ticket_key_missing: 'サーバーの設定が不完全です（チケットの署名鍵が未設定）',
  bad_segment: '区間の指定が正しくありません',
};
const errText = (e: unknown) => (e instanceof ApiError ? (ERR_TEXT[e.code] ?? `エラー (${e.code})`) : '不明なエラー');

/** 面の表示名（200面は FINAL、それ以外のボス面は BOSS） */
function label(stage: number): string {
  if (stage === FINAL_STAGE) return 'FINAL';
  if (getStage(stage).boss) return 'BOSS';
  return stageLabel(stage);
}

/**
 * BGM トラック: 0..9 = ワールド1〜10、10 = 80〜99面、11 = 100面ボス、12 = タイトル、
 * 13..17 = 101〜199面（区間ごと）、18 = 200面（最終ボス）
 */
function bgmTrack(stage: number): number {
  if (stage === FINAL_STAGE) return 18;
  if (getStage(stage).boss) return 11;
  if (stage >= 101) return 12 + segmentIndex(stage);
  if (stage >= NOSAVE_START) return 10;
  return worldOf(stage) - 1;
}

/**
 * ノーセーブ区間（80〜100 / 101〜120 / … / 181〜200）の挑戦1回分。
 * 区間の最初の面でサーバーのセッションを始め、クリアした面ごとに入力ログを送って検証する。
 * 101面以降の区間は、前の区間の最後で発行されたチケットを添えて開始する。
 */
class FinalRun {
  private sid: Promise<string | null>;
  chain: Promise<void> = Promise.resolve();
  valid: boolean;
  reason = '';
  last: StageResult | null = null;
  lateEnd = false;
  constructor(
    name: string,
    public segment: number,
    public official: boolean,
    ticket: Promise<string | null>,
    private onFail: (msg: string) => void,
    private onEnded: (w: WorldState) => void,
    private onTicket: (segment: number, ticket: string) => void,
  ) {
    this.valid = official;
    this.sid = official
      ? ticket.then(async (t) => {
          if (needsTicket(segment) && !t) {
            this.fail(new ApiError('no_ticket', 0));
            return null;
          }
          try {
            return (await startRun(name, segment, t)).sessionId;
          } catch (e) {
            this.fail(e);
            return null;
          }
        })
      : Promise.resolve(null);
  }
  private fail(e: unknown) {
    if (!this.valid) return;
    this.valid = false;
    this.reason = errText(e);
    if (e instanceof ApiError && e.code === 'world_ended') {
      this.lateEnd = true;
      void getState().then(this.onEnded, () => {});
    }
    this.onFail(this.reason);
  }
  invalidate(reason: string) {
    if (!this.valid) return;
    this.valid = false;
    this.reason = reason;
  }
  submit(stage: number, log: string) {
    this.chain = this.chain.then(async () => {
      if (!this.valid) return;
      const sid = await this.sid;
      if (!sid || !this.valid) return;
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await submitStage(sid, stage, log);
          this.last = r;
          if (r.segmentCleared && r.ticket && r.next) this.onTicket(r.next, r.ticket);
          if (r.world?.ended && r.result !== 'winner') this.onEnded(r.world);
          return;
        } catch (e) {
          if (e instanceof ApiError && e.code === 'network' && attempt < 3) {
            await new Promise((ok) => setTimeout(ok, 1500 * (attempt + 1)));
            continue;
          }
          this.fail(e);
          return;
        }
      }
    });
  }
}

class Game {
  canvas = $<HTMLCanvasElement>('game');
  renderer = new Renderer(this.canvas);
  sound = new Sound();
  input = new Input($('dpad'), $('jump'));
  save = loadSave();
  settings: Settings = loadSettings();
  mode: Mode = 'title';
  stage = 1;
  sim: Sim = new Sim(getStage(1));
  log: number[] = [];
  timer = 0;
  ft = 0;
  world: WorldState | null = null;
  worldError = false;
  run: FinalRun | null = null;
  invincible = false;
  unofficial = false; // デバッグ機能を使ったチャレンジ
  private acc = 0;
  private last = performance.now();
  private bannerTimer = 0;
  private toastTimer = 0;
  private pollTimer = 0;
  private sizeKey = '';
  private failNotice = ''; // 同じ区間・同じ理由の「公式記録の対象外」を死ぬたびに出さないため

  constructor() {
    this.applySettings();
    this.bindUi();
    this.input.onPause = () => this.togglePause();
    this.input.onRetry = () => {
      if (this.mode === 'play') this.kill(false);
    };
    this.input.onAnyInput = () => this.sound.unlock();
    window.addEventListener('pointerdown', () => this.sound.unlock(), { capture: true });
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'play') this.pause();
    });
    matchMedia('(orientation: portrait) and (pointer: coarse)').addEventListener('change', (e) => {
      if (e.matches && this.mode === 'play') this.pause();
    });
    this.resize();

    const cached = cachedWorld<WorldState>();
    if (ONLINE && cached?.ended) this.showEnded(cached);
    else this.showTitle();
    void this.refreshWorld();
    this.pollTimer = window.setInterval(() => {
      if (this.mode !== 'ended') void this.refreshWorld();
    }, POLL_MS);
    requestAnimationFrame((t) => this.frame(t));
    if (DEBUG) (window as unknown as { __game: Game }).__game = this;
  }

  // ---------- 世界の状態 ----------
  async refreshWorld(): Promise<boolean> {
    if (!ONLINE) {
      this.world = { ended: false, winnerName: null, endedAt: null, mode: 'test' };
      this.worldError = false;
      this.updateTitle();
      return true;
    }
    try {
      const w = await getState();
      this.world = w;
      this.worldError = false;
      cacheWorld(w);
      if (w.ended && this.mode !== 'result' && this.mode !== 'wait') this.showEnded(w);
      this.updateTitle();
      return true;
    } catch {
      this.worldError = true;
      this.updateTitle();
      return false;
    }
  }

  showEnded(w: WorldState) {
    this.world = w;
    cacheWorld(w);
    this.mode = 'ended';
    this.sound.playBgm(-1);
    this.hideScreens();
    $('hud').classList.add('hidden');
    $('touch').classList.add('hidden');
    $('end-name').textContent = w.winnerName ?? '???';
    $('end-date').textContent = w.endedAt
      ? new Date(w.endedAt).toLocaleString('ja-JP', { dateStyle: 'long', timeStyle: 'medium' })
      : '';
    $('scr-end').classList.remove('hidden');
    window.clearInterval(this.pollTimer);
  }

  // ---------- UI ----------
  private hideScreens() {
    document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  }

  private show(id: string) {
    this.hideScreens();
    $(id).classList.remove('hidden');
  }

  showTitle() {
    if (this.mode === 'ended') return;
    this.mode = 'title';
    this.run = null;
    this.show('scr-title');
    $('hud').classList.add('hidden');
    $('touch').classList.add('hidden');
    $('banner').classList.add('hidden');
    this.sim = new Sim(getStage(this.save.stage));
    this.sound.playBgm(12);
    this.updateTitle();
  }

  updateTitle() {
    const st = $('world-status');
    let text: string;
    let cls: string;
    if (!ONLINE) {
      text = '● オフラインモード（サーバー未接続・テスト用）';
      cls = 'offline';
    } else if (this.worldError) {
      text = '● サーバーに接続できません（開始・再開できません）';
      cls = 'error';
    } else if (!this.world) {
      text = '確認中…';
      cls = '';
    } else if (this.world.ended) {
      text = '● 世界は終了しました';
      cls = 'ended';
    } else if (this.world.mode === 'test') {
      text = '● テストモード（クリアしても世界は終わりません）';
      cls = 'test';
    } else {
      text = '● 世界は存続中 ― 挑戦受付中';
      cls = 'open';
    }
    st.textContent = text;
    st.className = `status ${cls}`;
    const s = this.save.stage;
    let info = `STAGE ${s}（${label(s)}）`;
    if (isNoSave(s)) {
      info += `　${s}〜${segmentEnd(s)}面ノーセーブ区間の開始地点`;
      if (ONLINE && needsTicket(s) && !this.save.tickets[String(s)]) info += '（チケットなし：公式記録の対象外）';
    }
    $('info-save').textContent = info;
    $('info-deaths').textContent = `${this.save.deaths} 回`;
    const blocked = ONLINE && (this.worldError || !this.world || this.world.ended);
    $<HTMLButtonElement>('btn-continue').disabled = blocked;
    $<HTMLButtonElement>('btn-new').disabled = blocked;
    $<HTMLButtonElement>('btn-continue').textContent = s > 1 ? `CONTINUE（${label(s)}）` : 'START';
    $('btn-new').classList.toggle('hidden', s <= 1);
  }

  private bindUi() {
    const nameEl = $<HTMLInputElement>('name');
    nameEl.value = this.save.name;
    nameEl.addEventListener('change', () => {
      const v = validateName(nameEl.value);
      if (v === null) {
        this.toast('その名前は使えません（12文字まで・記号や不適切な語は不可）');
        nameEl.value = this.save.name;
        return;
      }
      this.save.name = v === DEFAULT_NAME ? '' : v;
      nameEl.value = this.save.name;
      storeSave(this.save);
    });

    $('btn-continue').addEventListener('click', () => void this.begin(this.save.stage));
    $('btn-new').addEventListener('click', () => {
      if (!confirm('はじめからプレイしますか？（セーブ位置が1面に戻ります。累計死亡回数は残ります）')) return;
      this.save.stage = 1;
      this.save.tickets = {};
      storeSave(this.save);
      void this.begin(1);
    });
    $('btn-howto').addEventListener('click', () => this.show('scr-howto'));
    $('btn-settings').addEventListener('click', () => this.openSettings());
    document.querySelectorAll('.screen .back').forEach((b) =>
      b.addEventListener('click', () => {
        this.applySettings();
        if (this.mode === 'pause') this.show('scr-pause');
        else this.showTitle();
      }),
    );

    // 設定
    const bindRange = (id: string, key: keyof Settings) => {
      const el = $<HTMLInputElement>(id);
      el.addEventListener('input', () => {
        (this.settings[key] as number) = Number(el.value);
        storeSettings(this.settings);
        this.applySettings(true);
      });
    };
    bindRange('set-scale', 'btnScale');
    bindRange('set-opacity', 'btnOpacity');
    bindRange('set-insetx', 'insetX');
    bindRange('set-insety', 'insetY');
    bindRange('set-sfx', 'sfx');
    bindRange('set-bgm', 'bgm');
    $<HTMLSelectElement>('set-touch').addEventListener('change', (e) => {
      this.settings.touch = (e.target as HTMLSelectElement).value as Settings['touch'];
      storeSettings(this.settings);
      this.applySettings(true);
    });
    $('btn-set-reset').addEventListener('click', () => {
      this.settings = { ...DEFAULT_SETTINGS };
      storeSettings(this.settings);
      this.openSettings();
    });

    // 一時停止
    $('btn-pause').addEventListener('click', () => this.togglePause());
    $('btn-resume').addEventListener('click', () => this.resume());
    $('btn-retry').addEventListener('click', () => {
      this.resume();
      this.kill(false);
    });
    $('btn-quit').addEventListener('click', () => this.showTitle());
    $('btn-result-ok').addEventListener('click', () => {
      if (this.world?.ended && ONLINE) this.showEnded(this.world);
      else this.showTitle();
    });

    // デバッグ
    if (DEBUG) {
      $('debug-box').classList.remove('hidden');
      $('btn-debug-skip').classList.remove('hidden');
      $('btn-debug-go').addEventListener('click', () => {
        const n = Math.max(1, Math.min(FINAL_STAGE, Number($<HTMLInputElement>('debug-stage').value) || 1));
        this.invincible = $<HTMLInputElement>('debug-inv').checked;
        void this.begin(n, true);
      });
      $('btn-debug-skip').addEventListener('click', () => {
        this.unofficial = true;
        this.run?.invalidate('テスト機能（スキップ）を使用');
        this.resume();
        this.sim.cleared = true;
        this.onClear();
      });
    }
  }

  private openSettings() {
    const s = this.settings;
    $<HTMLInputElement>('set-scale').value = String(s.btnScale);
    $<HTMLInputElement>('set-opacity').value = String(s.btnOpacity);
    $<HTMLInputElement>('set-insetx').value = String(s.insetX);
    $<HTMLInputElement>('set-insety').value = String(s.insetY);
    $<HTMLInputElement>('set-sfx').value = String(s.sfx);
    $<HTMLInputElement>('set-bgm').value = String(s.bgm);
    $<HTMLSelectElement>('set-touch').value = s.touch;
    this.show('scr-settings');
    this.applySettings(true);
  }

  private touchEnabled(): boolean {
    if (this.settings.touch === 'on') return true;
    if (this.settings.touch === 'off') return false;
    return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  }

  private applySettings(preview = false) {
    const s = this.settings;
    const r = document.documentElement.style;
    r.setProperty('--btn-scale', String(s.btnScale));
    r.setProperty('--btn-opacity', String(s.btnOpacity));
    r.setProperty('--inset-x', `${s.insetX}px`);
    r.setProperty('--inset-y', `${s.insetY}px`);
    this.sound.setVolumes(s.sfx, s.bgm);
    const playing = this.mode === 'play' || this.mode === 'dead' || this.mode === 'clear';
    $('touch').classList.toggle('hidden', !(preview || (playing && this.touchEnabled())));
  }

  toast(msg: string, ms = 3500) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.add('hidden'), ms);
  }

  banner(html: string, ms = 1500) {
    const b = $('banner');
    b.innerHTML = html;
    b.classList.remove('hidden');
    clearTimeout(this.bannerTimer);
    if (ms > 0) this.bannerTimer = window.setTimeout(() => b.classList.add('hidden'), ms);
  }

  private resize() {
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    this.renderer.resize(vw, vh);
    const ratio = this.renderer.viewW / VIEW_H;
    let h = vh;
    let w = h * ratio;
    if (w > vw) {
      w = vw;
      h = w / ratio;
    }
    this.canvas.style.width = `${Math.floor(w)}px`;
    this.canvas.style.height = `${Math.floor(h)}px`;
  }

  // ---------- ゲーム進行 ----------
  async begin(stage: number, debug = false) {
    this.sound.unlock();
    if (ONLINE) {
      const ok = await this.refreshWorld();
      if (!ok) {
        this.toast('サーバーに接続できないため、開始できません。通信環境を確認してください。');
        return;
      }
      if (this.world?.ended) return;
    }
    // テスト用の面選択は、ノーセーブ区間の途中から始めた場合と無敵の場合だけ非公式
    this.unofficial = debug && (this.invincible || stage !== segmentStart(stage));
    if (!debug) this.invincible = false;
    this.failNotice = '';
    this.hideScreens();
    $('hud').classList.remove('hidden');
    this.startStage(stage);
  }

  private startStage(stage: number) {
    this.stage = stage;
    this.sim = new Sim(getStage(stage), { invincible: this.invincible });
    this.log = [];
    this.mode = 'play';
    this.acc = 0;
    this.applySettings();
    const seg = segmentStart(stage);
    if (!isNoSave(stage)) this.run = null;
    else if (stage === seg) this.newRun(seg);
    else if (!this.run || this.run.segment !== seg) {
      this.run = new FinalRun(this.save.name || DEFAULT_NAME, seg, false, Promise.resolve(null), () => {}, () => {}, () => {});
      this.run.invalidate(`${seg}面から開始していない`);
    }
    this.updateHud();
    const w = worldOf(stage);
    const L = getStage(stage);
    if (stage === FINAL_STAGE) this.banner('FINAL STAGE<small>世界の終わり</small>', 2000);
    else if (L.boss) this.banner(`STAGE ${stage}<small>BOSS　${WORLD_NAMES[w - 1] ?? ''}</small>`, 2000);
    else if (isNoSave(stage) && stage === seg)
      this.banner(`STAGE ${stage}<small>${stageLabel(stage)}　ここから${segmentEnd(stage)}面までノーセーブ</small>`, 1800);
    else this.banner(`STAGE ${stage}<small>${stageLabel(stage)}　${WORLD_NAMES[w - 1] ?? ''}</small>`, 1400);
    this.sound.playBgm(bgmTrack(stage));
  }

  private newRun(seg: number) {
    const official = ONLINE && !this.unofficial && !this.invincible;
    // チケットは前の区間の最後の送信で届く（届くまで待ってから開始を申請する）
    const prev = this.run?.chain ?? Promise.resolve();
    const ticket = needsTicket(seg) ? prev.then(() => this.save.tickets[String(seg)] ?? null) : Promise.resolve(null);
    const run: FinalRun = new FinalRun(
      this.save.name || DEFAULT_NAME,
      seg,
      official,
      ticket,
      (msg) => {
        const key = `${seg}:${msg}`;
        if (this.stage < FINAL_STAGE && key !== this.failNotice) this.toast(`この区間は公式記録の対象外です：${msg}`, 5000);
        this.failNotice = key;
        if (this.run === run) this.updateHud();
      },
      (w) => {
        // 200面クリア直後なら結果画面を先に出す
        if (this.stage === FINAL_STAGE && (this.mode === 'clear' || this.mode === 'wait' || this.mode === 'result')) this.world = w;
        else this.showEnded(w);
      },
      (next, t) => {
        this.save.tickets[String(next)] = t;
        storeSave(this.save);
      },
    );
    this.run = run;
  }

  private updateHud() {
    const st = this.stage;
    $('hud-stage').textContent = st === FINAL_STAGE ? 'FINAL' : `STAGE ${st}（${label(st)}）`;
    $('hud-deaths').textContent = `☠ ${this.save.deaths}`;
    const ns = isNoSave(st);
    $('hud-nosave').classList.toggle('hidden', !ns);
    $('hud-run').textContent = ns ? `${segmentPos(st)} / ${segmentLength(st)}` : '';
    $('hud-unofficial').classList.toggle('hidden', !(ns && ONLINE && this.run && !this.run.valid));
  }

  togglePause() {
    if (this.mode === 'play') this.pause();
    else if (this.mode === 'pause') this.resume();
  }

  pause() {
    if (this.mode !== 'play') return;
    this.mode = 'pause';
    this.input.clear();
    const ns = isNoSave(this.stage);
    $('pause-warn').classList.toggle('hidden', !ns);
    if (ns)
      $('pause-warn').textContent =
        `ノーセーブ区間です（${segmentStart(this.stage)}〜${segmentEnd(this.stage)}面）。タイトルに戻ると${segmentStart(this.stage)}面からやり直しになります。` +
        '長時間の一時停止は公式記録の対象外になります（1面あたり約45秒まで）。';
    this.show('scr-pause');
    $('touch').classList.add('hidden');
  }

  resume() {
    if (this.mode !== 'pause') return;
    this.hideScreens();
    this.mode = 'play';
    this.acc = 0;
    this.last = performance.now();
    this.applySettings();
  }

  /** 死亡 or やり直し */
  kill(byDeath: boolean) {
    if (this.mode !== 'play') return;
    if (!byDeath) {
      this.sim.dead = true;
      this.sound.sfx('die');
    }
    this.save.deaths++;
    storeSave(this.save);
    this.updateHud();
    const c = this.renderer.playerCenter(this.sim);
    this.renderer.burst(c.x, c.y, 28, ['#fff', '#ff3a50', '#ffd040']);
    this.renderer.shake = 6;
    if (navigator.vibrate) navigator.vibrate(40);
    this.mode = 'dead';
    this.timer = 40;
    if (isNoSave(this.stage) && this.stage > segmentStart(this.stage)) {
      this.banner(`${segmentStart(this.stage)}面からやり直し`, 1200);
      this.sound.sfx('warn');
    }
  }

  /** 死亡後の復帰: ノーセーブ区間なら区間の最初へ、それ以外はその面の最初へ */
  private respawn() {
    this.startStage(segmentStart(this.stage));
  }

  onClear() {
    this.mode = 'clear';
    const st = this.stage;
    if (isNoSave(st) && this.run) this.run.submit(st, encodeInputs(this.log));
    const next = st + 1;
    if (st < FINAL_STAGE) {
      // 次の面がセーブ地点（2〜80面、101,121,141,161,181面）ならセーブ
      if (isCheckpoint(next)) this.save.stage = next;
      this.save.best = Math.max(this.save.best, next);
    }
    storeSave(this.save);
    if (st === FINAL_STAGE) {
      this.timer = 30;
    } else if (next === NOSAVE_START || (isNoSave(next) && isCheckpoint(next))) {
      // 区間の最初の面に到達（80面 / 100面ボス撃破後の101面 / 121面 …）
      const boss = getStage(st).boss;
      this.timer = boss ? 120 : 80;
      this.banner(
        `${boss ? 'BOSS CLEAR!' : 'CLEAR!'}<small>${next}面に到達 ― セーブされました（ここから${segmentEnd(next)}面までノーセーブ）</small>`,
        boss ? 2200 : 1600,
      );
    } else {
      this.timer = 50;
      this.banner('CLEAR!', 900);
    }
  }

  private async finishGame() {
    this.mode = 'wait';
    this.save.clears++;
    storeSave(this.save);
    $('touch').classList.add('hidden');
    this.banner('世界の終わりを確定しています…', 0);
    const run = this.run;
    if (run) await run.chain;
    $('banner').classList.add('hidden');
    let title = '';
    let body = '';
    if (!ONLINE) {
      title = 'CLEAR!';
      body = 'オフラインモードでのクリアです（公式記録ではありません）。サーバーを接続すると、ここでサーバーにクリア申請が送られます。';
    } else if (run?.lateEnd || (run?.last?.result === 'too_late')) {
      title = '一歩、遅かった…';
      body = '世界はすでに、別の誰かの手で終わっていた。';
      if (run?.last?.world) this.world = run.last.world;
      if (!this.world?.ended) {
        try {
          this.world = await getState();
        } catch {
          /* 結果画面のあとで再取得 */
        }
      }
    } else if (!run || !run.valid || !run.last) {
      title = 'CLEAR!';
      body = `ただし公式記録になりませんでした：${run?.reason || '検証できませんでした'}`;
    } else if (run.last.result === 'winner') {
      title = 'あなたが世界を終わらせた';
      body = `${this.save.name || DEFAULT_NAME} の名は、終わった世界に永遠に刻まれる。`;
      this.sound.sfx('end');
      if (run.last.world) this.world = run.last.world;
    } else if (run.last.result === 'test_clear') {
      title = 'TEST CLEAR!';
      body = 'サーバーでの検証に成功しました。現在はテストモードのため、世界は終了しません。本番モードでは、この瞬間に世界が終わります。';
    }
    if (!title) {
      title = 'CLEAR!';
      body = 'サーバーの応答を確認できませんでした。';
    }
    $('result-title').textContent = title;
    $('result-body').textContent = body;
    this.mode = 'result';
    this.show('scr-result');
    $('hud').classList.add('hidden');
  }

  // ---------- メインループ ----------
  private frame(now: number) {
    const dt = Math.min(100, now - this.last);
    this.last = now;
    if (this.mode === 'play' || this.mode === 'dead' || this.mode === 'clear') {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP_MS && n < 4) {
        this.tick();
        this.acc -= STEP_MS;
        n++;
      }
      if (n >= 4) this.acc = 0; // 処理落ち時はゲーム全体をゆっくりにする（物理は変えない）
    }
    this.ft++;
    if (this.ft % 30 === 0) {
      const key = `${window.innerWidth}x${window.innerHeight}x${window.visualViewport?.width}`;
      if (key !== this.sizeKey) {
        this.sizeKey = key;
        this.resize();
      }
    }
    this.renderer.draw(this.sim, this.ft, DEBUG && this.invincible);
    requestAnimationFrame((t) => this.frame(t));
  }

  private tick() {
    if (this.mode === 'play') {
      const inp = this.input.read();
      this.sim.step(inp);
      this.log.push(inp);
      this.handleEvents();
      if (this.sim.dead) this.kill(true);
      else if (this.sim.cleared) this.onClear();
    } else if (this.mode === 'dead') {
      if (--this.timer <= 0) this.respawn();
    } else if (this.mode === 'clear') {
      // ボス撃破後の演出中も描画を進める
      if (--this.timer <= 0) {
        if (this.stage === FINAL_STAGE) void this.finishGame();
        else this.startStage(this.stage + 1);
      }
    }
  }

  private handleEvents() {
    const s = this.sim;
    for (const ev of s.events) {
      this.sound.sfx(ev);
      if (ev === 'stomp') {
        const c = this.renderer.playerCenter(s);
        this.renderer.burst(c.x, c.y + 8, 10, ['#fff', '#ffd040']);
      } else if (ev === 'crash') this.renderer.shake = 8;
      else if (ev === 'bosshit') {
        this.renderer.shake = 10;
        const b = s.boss!;
        this.renderer.burst(b.x / 256 + 16, b.y / 256 + 4, 20, ['#fff', '#ff4060', '#ffd040']);
      } else if (ev === 'bossdie') this.renderer.shake = 16;
      else if (ev === 'clear') {
        const c = this.renderer.playerCenter(s);
        this.renderer.burst(c.x, c.y, 20, ['#ffd040', '#fff', '#60e0ff'], 2);
      }
    }
  }
}

new Game();
