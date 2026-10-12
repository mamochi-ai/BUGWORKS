/**
 * 効果音（DECISIONS.md D-40）。音声ファイルは使わず、Web Audio で短い音を合成する。
 * iPad などはユーザーが画面に触れるまで音を出せないので、最初の操作で AudioContext を作る。
 * 音の ON/OFF はこの端末に保存する。物理には一切かかわらない。
 */
export type SoundName = 'launch' | 'spring' | 'goal' | 'switch' | 'clear' | 'bug' | 'tap';

const KEY = 'bugworks.settings.v1';

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private _enabled = loadEnabled();
  /** 同じ音を短い間に何度も鳴らさない（球が多いときにうるさくならないように） */
  private last = new Map<SoundName, number>();

  constructor() {
    const unlock = () => {
      this.ensure();
      void this.ctx?.resume();
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
  }

  get enabled(): boolean {
    return this._enabled;
  }

  setEnabled(on: boolean): void {
    this._enabled = on;
    try {
      localStorage.setItem(KEY, JSON.stringify({ sound: on }));
    } catch {
      /* 保存できなくても続ける */
    }
  }

  private ensure(): void {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.25;
    this.master.connect(this.ctx.destination);
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

function loadEnabled(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return true;
    const d = JSON.parse(raw) as { sound?: unknown };
    return d.sound !== false;
  } catch {
    return true;
  }
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
