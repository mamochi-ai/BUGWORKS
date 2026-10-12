/**
 * 効果音（DECISIONS.md D-40）と BGM（D-44）。音声ファイルは使わず、Web Audio で合成する。
 * iPad などはユーザーが画面に触れるまで音を出せないので、最初の操作で AudioContext を作る。
 * 効果音・BGM の ON/OFF はこの端末に保存する。物理には一切かかわらない。
 * BGM は決まった譜面（4小節をくり返す）を少し先まで予約して鳴らす。再生中は打楽器が加わる。
 */
export type SoundName = 'launch' | 'spring' | 'goal' | 'switch' | 'clear' | 'bug' | 'tap';

const KEY = 'bugworks.settings.v1';

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private _enabled = loadSettings().sound;
  private _bgm = loadSettings().bgm;
  private bgmGain: GainNode | null = null;
  private bgmTimer = 0;
  private bgmStep = 0;
  private bgmNext = 0;
  private _busy = false;
  /** 同じ音を短い間に何度も鳴らさない（球が多いときにうるさくならないように） */
  private last = new Map<SoundName, number>();

  constructor() {
    const unlock = () => {
      this.ensure();
      void this.ctx?.resume();
      this.syncBgm();
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    // 画面を離れたら止め、戻ったら続ける
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  get bgmEnabled(): boolean {
    return this._bgm;
  }

  setBgmEnabled(on: boolean): void {
    this._bgm = on;
    this.save();
    this.syncBgm();
  }

  /** 再生中か（BGM に打楽器を足す） */
  setBusy(busy: boolean): void {
    this._busy = busy;
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ sound: this._enabled, bgm: this._bgm }));
    } catch {
      /* 保存できなくても続ける */
    }
  }

  private syncBgm(): void {
    if (!this.ctx || !this.bgmGain) return;
    const now = this.ctx.currentTime;
    this.bgmGain.gain.cancelScheduledValues(now);
    this.bgmGain.gain.setTargetAtTime(this._bgm ? 1 : 0, now, 0.3);
    if (this._bgm && !this.bgmTimer) {
      this.bgmNext = now + 0.1;
      this.bgmTimer = window.setInterval(() => this.scheduleBgm(), 100);
    } else if (!this._bgm && this.bgmTimer) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = 0;
    }
  }

  /** 少し先（0.3秒）までの音符を予約する */
  private scheduleBgm(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const stepDur = 60 / BGM.bpm / 4;
    if (this.bgmNext < ctx.currentTime) this.bgmNext = ctx.currentTime + 0.05;
    while (this.bgmNext < ctx.currentTime + 0.3) {
      this.bgmNote(this.bgmStep, this.bgmNext, stepDur);
      this.bgmNext += stepDur;
      this.bgmStep = (this.bgmStep + 1) % (16 * BGM.chords.length);
    }
  }

  private bgmNote(step: number, t: number, dur: number): void {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chord = BGM.chords[bar];
    const out = this.bgmGain!;
    // 和音（小節の頭で長く）
    if (s === 0) for (const n of chord) this.voice('triangle', midi(n), t, dur * 15, 0.05, out, 900);
    // ベース（拍の頭）
    if (s % 4 === 0) this.voice('sine', midi(chord[0] - 12), t, dur * 3, s === 0 ? 0.16 : 0.1, out, 400);
    // アルペジオ（決まった並び）
    const arp = BGM.arp[s];
    if (arp >= 0) this.voice('square', midi(chord[arp % chord.length] + 12 * Math.floor(arp / chord.length) + 12), t, dur * 0.9, 0.035, out, 1800);
    // 再生中は打楽器
    if (this._busy && (s === 4 || s === 12)) this.hit(t, 0.05, 0.09, 3200, out);
    if (this._busy && s % 2 === 1) this.hit(t, 0.02, 0.035, 7000, out);
  }

  private voice(type: OscillatorType, freq: number, t: number, dur: number, vol: number, out: AudioNode, cutoff: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.03, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(f).connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private hit(t: number, dur: number, vol: number, cutoff: number, out: AudioNode): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private noiseBuf: AudioBuffer | null = null;
  private noiseBuffer(): AudioBuffer {
    if (this.noiseBuf) return this.noiseBuf;
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * 0.1);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let x = 4242;
    for (let i = 0; i < n; i++) {
      x = (x * 16807) % 2147483647;
      d[i] = (x / 2147483647) * 2 - 1;
    }
    this.noiseBuf = buf;
    return buf;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  setEnabled(on: boolean): void {
    this._enabled = on;
    this.save();
  }

  private ensure(): void {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.25;
    this.master.connect(this.ctx.destination);
    // BGM は効果音より小さく
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.value = 0;
    const bgmLevel = this.ctx.createGain();
    bgmLevel.gain.value = 0.55;
    this.bgmGain.connect(bgmLevel).connect(this.master);
  }

  play(name: SoundName): void {
    if (!this._enabled || !this.ctx || !this.master || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const gap = name === 'clear' || name === 'bug' ? 0.5 : 0.06;
    if (now - (this.last.get(name) ?? -1) < gap) return;
    this.last.set(name, now);
    switch (name) {
      case 'launch':
        this.tone('sine', 140, 70, 0.12, 0.5);
        this.noise(0.05, 0.15, 900);
        break;
      case 'spring':
        this.tone('triangle', 180, 520, 0.22, 0.45);
        break;
      case 'goal':
        this.tone('sine', 880, 880, 0.18, 0.4);
        this.tone('sine', 1320, 1320, 0.28, 0.35, 0.09);
        break;
      case 'switch':
        this.tone('square', 1800, 1200, 0.03, 0.18);
        break;
      case 'tap':
        this.tone('sine', 660, 660, 0.04, 0.15);
        break;
      case 'clear':
        [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.22, 0.45, i * 0.11));
        break;
      case 'bug':
        for (let i = 0; i < 6; i++) this.tone('square', 200 + ((i * 397) % 900), 120 + ((i * 211) % 700), 0.06, 0.25, i * 0.05);
        this.noise(0.35, 0.2, 2400);
        break;
    }
  }

  /** 高さが from → to に変わる短い音 */
  private tone(type: OscillatorType, from: number, to: number, dur: number, vol: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** 短い雑音（決まった並びの値で作る） */
  private noise(dur: number, vol: number, cutoff: number): void {
    const ctx = this.ctx!;
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < n; i++) {
      s = (s * 16807) % 2147483647;
      data[i] = ((s / 2147483647) * 2 - 1) * (1 - i / n);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master!);
    src.start();
  }
}

/** 設定（効果音と BGM。どちらも既定は ON） */
export function loadSettings(s: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): { sound: boolean; bgm: boolean } {
  try {
    const raw = s?.getItem(KEY);
    if (!raw) return { sound: true, bgm: true };
    const d = JSON.parse(raw) as { sound?: unknown; bgm?: unknown };
    return { sound: d.sound !== false, bgm: d.bgm !== false };
  } catch {
    return { sound: true, bgm: true };
  }
}

/** BGM の譜面（研究所の、少しとぼけた夜の作業曲）。和音は MIDI 番号、アルペジオは和音の何番目か（−1 は休み） */
export const BGM = {
  bpm: 92,
  chords: [
    [57, 60, 64], // Am
    [53, 57, 60], // F
    [48, 52, 55], // C
    [55, 59, 62], // G
  ],
  arp: [0, -1, 1, 2, -1, 1, 3, -1, 2, -1, 1, 0, -1, 2, 1, -1],
} as const;

function midi(n: number): number {
  return 440 * Math.pow(2, (n - 69) / 12);
}

/**
 * 物理の状態の変化から、鳴らす音を決める（描画フレームごとに呼ぶ）。
 * 発射・バネ・ゴール・スイッチの回数が増えたら鳴らす。リセットで tick が戻ったら数え直す。
 */
export class SoundWatcher {
  private prev = { tick: -1, fires: 0, springs: 0, goals: 0, toggles: 0 };

  constructor(private readonly sound: Sound) {}

  update(s: { tick: number; fires: number; springs: number; goals: number; toggles: number }): void {
    const p = this.prev;
    if (s.tick < p.tick || p.tick < 0) {
      this.prev = { ...s };
      return;
    }
    if (s.fires > p.fires) this.sound.play('launch');
    if (s.springs > p.springs) this.sound.play('spring');
    if (s.goals > p.goals) this.sound.play('goal');
    if (s.toggles > p.toggles) this.sound.play('switch');
    this.prev = { ...s };
  }
}
