import { FixedStepClock } from './FixedStepClock';
import type { Simulation } from './Simulation';

export type RunState = 'ready' | 'running' | 'paused';

export const SPEED_OPTIONS = [0.25, 0.5, 1, 2] as const;

export interface FrameResult {
  stepsRun: number;
  alpha: number;
  droppedSeconds: number;
}

/**
 * 再生/一時停止/リセット/1ステップの状態機械。
 * UIはこのクラスの操作だけを呼び、物理ワールドへ直接触れない。
 */
export class SimulationController {
  private _state: RunState = 'ready';
  private _speed = 1;
  readonly clock = new FixedStepClock();
  private listeners = new Set<() => void>();

  constructor(readonly sim: Simulation) {}

  get state(): RunState {
    return this._state;
  }

  get speed(): number {
    return this._speed;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  play(): void {
    if (this._state === 'running') return;
    this.clock.reset();
    this.setState('running');
  }

  pause(): void {
    if (this._state !== 'running') return;
    this.setState('paused');
  }

  togglePlay(): void {
    if (this._state === 'running') this.pause();
    else this.play();
  }

  /** 一時停止中/初期状態で1tickだけ進める */
  stepOnce(): void {
    if (this._state === 'running') this.pause();
    this.sim.step();
    this.setState('paused');
  }

  reset(): void {
    this.sim.reset();
    this.clock.reset();
    this.setState('ready');
  }

  setSpeed(speed: number): void {
    this._speed = speed;
    this.emit();
  }

  cycleSpeed(): void {
    const i = SPEED_OPTIONS.indexOf(this._speed as (typeof SPEED_OPTIONS)[number]);
    this.setSpeed(SPEED_OPTIONS[(i + 1) % SPEED_OPTIONS.length]);
  }

  /** 描画フレームごとに呼ぶ。経過実時間から必要なtick数だけ物理を進める */
  frame(realSeconds: number): FrameResult {
    if (this._state !== 'running') return { stepsRun: 0, alpha: 1, droppedSeconds: 0 };
    const adv = this.clock.advance(realSeconds, this._speed);
    for (let i = 0; i < adv.steps; i++) this.sim.step();
    return { stepsRun: adv.steps, alpha: adv.alpha, droppedSeconds: adv.droppedSeconds };
  }

  private setState(s: RunState): void {
    this._state = s;
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
