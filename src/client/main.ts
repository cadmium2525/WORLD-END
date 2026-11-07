import './style.css';
import { BOSS_STAGE, FINAL_START, VIEW_H } from '../shared/constants';
import { DEFAULT_NAME, validateName } from '../shared/name';
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
};
const errText = (e: unknown) => (e instanceof ApiError ? (ERR_TEXT[e.code] ?? `エラー (${e.code})`) : '不明なエラー');

/** 80〜100面の連続チャレンジ1回分。クリアした面ごとに入力ログをサーバーへ送り検証する */
class FinalRun {
  private sid: Promise<string | null>;
  chain: Promise<void> = Promise.resolve();
  valid: boolean;
  reason = '';
  last: StageResult | null = null;
  lateEnd = false;
  constructor(
    name: string,
    public official: boolean,
    private onFail: (msg: string) => void,
    private onEnded: (w: WorldState) => void,
  ) {
    this.valid = official;
    this.sid = official
      ? startRun(name)
          .then((r) => r.sessionId)
          .catch((e) => {
            this.fail(e);
            return null;
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
    this.sim = new Sim(getStage(Math.min(this.save.stage, 99)));
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
    $('info-save').textContent = s >= FINAL_START ? `STAGE ${s}（${stageLabel(s)}）最後のセーブ地点` : `STAGE ${s}（${stageLabel(s)}）`;
    $('info-deaths').textContent = `${this.save.deaths} 回`;
    const blocked = ONLINE && (this.worldError || !this.world || this.world.ended);
    $<HTMLButtonElement>('btn-continue').disabled = blocked;
    $<HTMLButtonElement>('btn-new').disabled = blocked;
    $<HTMLButtonElement>('btn-continue').textContent = s > 1 ? `CONTINUE（${stageLabel(s)}）` : 'START';
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
        const n = Math.max(1, Math.min(BOSS_STAGE, Number($<HTMLInputElement>('debug-stage').value) || 1));
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
    this.unofficial = debug && (this.invincible || stage > FINAL_START);
    if (!debug) this.invincible = false;
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
    if (stage === FINAL_START) this.newRun();
    if (stage > FINAL_START && !this.run) {
      this.run = new FinalRun(this.save.name || DEFAULT_NAME, false, () => {}, () => {});
      this.run.invalidate('80面から開始していない');
    }
    this.updateHud();
    const w = worldOf(stage);
    if (stage === BOSS_STAGE) this.banner('FINAL STAGE<small>世界の終わり</small>', 2000);
    else this.banner(`STAGE ${stage}<small>${stageLabel(stage)}　${WORLD_NAMES[w - 1]}</small>`, 1400);
    this.sound.playBgm(stage === BOSS_STAGE ? 11 : stage >= FINAL_START ? 10 : w - 1);
  }

  private newRun() {
    const official = ONLINE && !this.unofficial && !this.invincible;
    this.run = new FinalRun(
      this.save.name || DEFAULT_NAME,
      official,
      (msg) => {
        if (this.stage < BOSS_STAGE) this.toast(`このチャレンジは公式記録になりません：${msg}`, 5000);
      },
      (w) => {
        // 100面クリア直後なら結果画面を先に出す
        if (this.stage === BOSS_STAGE && (this.mode === 'clear' || this.mode === 'wait' || this.mode === 'result')) this.world = w;
        else this.showEnded(w);
      },
    );
  }

  private updateHud() {
    $('hud-stage').textContent = this.stage === BOSS_STAGE ? 'FINAL' : `STAGE ${this.stage}（${stageLabel(this.stage)}）`;
    $('hud-deaths').textContent = `☠ ${this.save.deaths}`;
    const ns = this.stage >= FINAL_START;
    $('hud-nosave').classList.toggle('hidden', !ns);
    $('hud-run').textContent = ns ? `${this.stage - FINAL_START + 1} / 21` : '';
  }

  togglePause() {
    if (this.mode === 'play') this.pause();
    else if (this.mode === 'pause') this.resume();
  }

  pause() {
    if (this.mode !== 'play') return;
    this.mode = 'pause';
    this.input.clear();
    $('pause-warn').classList.toggle('hidden', this.stage < FINAL_START);
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
    if (this.stage > FINAL_START) {
      this.banner('80面からやり直し', 1200);
      this.sound.sfx('warn');
    }
  }

  private respawn() {
    const back = this.stage >= FINAL_START ? FINAL_START : this.stage;
    this.startStage(back);
  }

  onClear() {
    this.mode = 'clear';
    const st = this.stage;
    if (st >= FINAL_START && this.run) this.run.submit(st, encodeInputs(this.log));
    if (st < FINAL_START) {
      this.save.stage = st + 1;
      this.save.best = Math.max(this.save.best, st + 1);
      storeSave(this.save);
    } else this.save.best = Math.max(this.save.best, Math.min(st + 1, BOSS_STAGE));
    storeSave(this.save);
    if (st === BOSS_STAGE) {
      this.timer = 30;
    } else {
      this.timer = 50;
      this.banner(st + 1 === FINAL_START ? 'CLEAR!<small>80面に到達 ― ここが最後のセーブ地点</small>' : 'CLEAR!', 900);
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
        if (this.stage === BOSS_STAGE) void this.finishGame();
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
