// 効果音・BGM をすべて WebAudio で合成（音声素材ファイル不要）
type Wave = OscillatorType;

export class Sound {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  sfxVol = 0.7;
  bgmVol = 0.45;
  private bgmTimer: number | null = null;
  private bgmTrack = -1;
  private nextNoteTime = 0;
  private step = 0;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.connect(this.master);
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.connect(this.master);
    this.setVolumes(this.sfxVol, this.bgmVol);
    const len = this.ctx.sampleRate * 0.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    if (this.bgmTrack >= 0) this.startBgmLoop();
  }

  setVolumes(sfx: number, bgm: number) {
    this.sfxVol = sfx;
    this.bgmVol = bgm;
    if (this.sfxGain) this.sfxGain.gain.value = sfx;
    if (this.bgmGain) this.bgmGain.gain.value = bgm * 0.6;
  }

  private tone(f0: number, f1: number, dur: number, wave: Wave = 'square', vol = 0.3, t0 = 0, out?: GainNode) {
    const c = this.ctx;
    if (!c || !this.sfxGain) return;
    const t = c.currentTime + t0;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = wave;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(out ?? this.sfxGain);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol = 0.3, freq = 2000, t0 = 0) {
    const c = this.ctx;
    if (!c || !this.sfxGain || !this.noiseBuf) return;
    const t = c.currentTime + t0;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(100, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.sfxGain);
    s.start(t);
    s.stop(t + dur);
  }

  sfx(name: string) {
    if (!this.ctx) return;
    switch (name) {
      case 'jump':
        this.tone(330, 660, 0.12, 'square', 0.18);
        break;
      case 'stomp':
        this.tone(600, 150, 0.12, 'square', 0.25);
        break;
      case 'die':
        this.noise(0.35, 0.4, 3000);
        this.tone(440, 60, 0.4, 'sawtooth', 0.25);
        break;
      case 'clear':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, f, 0.14, 'square', 0.2, i * 0.08));
        break;
      case 'switch':
        this.tone(900, 900, 0.05, 'square', 0.2);
        this.tone(1300, 1300, 0.06, 'square', 0.2, 0.05);
        break;
      case 'crumble':
        this.noise(0.15, 0.2, 1200);
        break;
      case 'trap':
        this.tone(1500, 800, 0.06, 'square', 0.15);
        break;
      case 'shoot':
        this.tone(220, 110, 0.08, 'square', 0.08);
        break;
      case 'bossshot':
        this.tone(300, 120, 0.12, 'sawtooth', 0.18);
        break;
      case 'bossjump':
        this.tone(120, 300, 0.25, 'triangle', 0.3);
        break;
      case 'crash':
        this.noise(0.3, 0.45, 800);
        this.tone(90, 40, 0.3, 'square', 0.3);
        break;
      case 'rain':
        this.tone(1800, 600, 0.3, 'triangle', 0.15);
        break;
      case 'bosshit':
        this.tone(800, 200, 0.2, 'square', 0.3);
        this.noise(0.15, 0.3, 4000);
        break;
      case 'bossdie':
        for (let i = 0; i < 8; i++) this.noise(0.3, 0.35, 2500, i * 0.18);
        this.tone(400, 30, 1.6, 'sawtooth', 0.3);
        break;
      case 'warn':
        this.tone(880, 880, 0.08, 'square', 0.15);
        this.tone(660, 660, 0.08, 'square', 0.15, 0.1);
        break;
      case 'select':
        this.tone(700, 1000, 0.06, 'square', 0.15);
        break;
      case 'end':
        [392, 330, 262, 196, 131].forEach((f, i) => this.tone(f, f * 0.98, 0.6, 'triangle', 0.25, i * 0.35));
        break;
    }
  }

  // ---------- BGM ----------
  /** track: 0..9 = ワールド, 10 = ノーセーブ区間, 11 = ボス, 12 = タイトル, -1 = 停止 */
  playBgm(track: number) {
    if (track === this.bgmTrack) return;
    this.bgmTrack = track;
    this.step = 0;
    if (this.bgmTimer !== null) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
    if (track >= 0 && this.ctx) this.startBgmLoop();
  }

  private startBgmLoop() {
    if (!this.ctx || this.bgmTimer !== null) return;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.bgmTimer = window.setInterval(() => this.schedule(), 50);
  }

  private schedule() {
    const c = this.ctx;
    if (!c || !this.bgmGain || this.bgmTrack < 0) return;
    if (c.state !== 'running') {
      this.nextNoteTime = c.currentTime + 0.1;
      return;
    }
    const tr = this.bgmTrack;
    const bpm = tr === 11 ? 168 : tr === 10 ? 150 : tr === 12 ? 96 : 116 + tr * 4;
    const stepDur = 60 / bpm / 4;
    while (this.nextNoteTime < c.currentTime + 0.2) {
      this.playStep(tr, this.step, this.nextNoteTime, stepDur);
      this.nextNoteTime += stepDur;
      this.step = (this.step + 1) % 64;
    }
  }

  private note(freq: number, t: number, dur: number, wave: Wave, vol: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = wave;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.bgmGain!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private playStep(tr: number, s: number, t: number, sd: number) {
    const minor = tr >= 3;
    const scale = minor ? [0, 3, 5, 7, 10, 12, 15, 17] : [0, 2, 4, 7, 9, 12, 14, 16];
    const roots = tr === 11 ? [0, 0, 1, 1, -2, -2, -1, -1] : minor ? [0, -4, -2, -5] : [0, 5, -3, 7];
    const base = tr === 11 ? 45 : 48 + (tr % 5);
    const bar = Math.floor(s / 16);
    const root = roots[tr === 11 ? Math.floor(s / 8) % 8 : bar % roots.length];
    const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
    // ベース
    if (s % 4 === 0 || (tr >= 10 && s % 2 === 0)) {
      this.note(midi(base - 12 + root), t, sd * 1.8, 'triangle', 0.35);
    }
    // メロディ（ワールドごとに決まったパターン）
    let h = (tr * 2654435761 + bar * 97 + (s % 16) * 31) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    const play = tr === 12 ? s % 4 === 0 : (h & 7) < (tr >= 10 ? 6 : 4);
    if (play) {
      const deg = scale[(h >>> 4) % scale.length];
      this.note(midi(base + 12 + root + deg), t, sd * 1.6, tr === 12 ? 'triangle' : 'square', 0.12);
    }
    // ハイハット
    if (tr !== 12 && s % 2 === 1 && this.noiseBuf) {
      const c = this.ctx!;
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = c.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 7000;
      const g = c.createGain();
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      src.connect(f);
      f.connect(g);
      g.connect(this.bgmGain!);
      src.start(t);
      src.stop(t + 0.05);
    }
  }
}
