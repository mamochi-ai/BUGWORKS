import { MAX_FRAME_SECONDS, MAX_STEPS_PER_FRAME, PHYSICS_DT } from './constants';

export interface ClockAdvance {
  /** このフレームで実行すべき物理ステップ数 */
  steps: number;
  /** 描画補間係数 0..1（前tick→現tick） */
  alpha: number;
  /** 上限超過で捨てたシミュレーション時間（秒）。0以外なら処理落ち */
  droppedSeconds: number;
}

/**
 * 可変フレームの実時間を固定刻みの物理ステップ数に変換するアキュムレータ。
 * 物理（tick）と描画（フレーム）を分離するための唯一の接点。副作用なしでテスト可能。
 */
export class FixedStepClock {
  private accumulator = 0;

  constructor(
    readonly dt: number = PHYSICS_DT,
    readonly maxStepsPerFrame: number = MAX_STEPS_PER_FRAME,
    readonly maxFrameSeconds: number = MAX_FRAME_SECONDS,
  ) {}

  advance(realSeconds: number, speed = 1): ClockAdvance {
    let dropped = 0;
    let frame = Number.isFinite(realSeconds) && realSeconds > 0 ? realSeconds : 0;
    if (frame > this.maxFrameSeconds) {
      dropped += (frame - this.maxFrameSeconds) * speed;
      frame = this.maxFrameSeconds;
    }
    this.accumulator += frame * speed;

    // 浮動小数誤差で 2*dt が 1.9999..*dt になり1tick遅れるのを防ぐ
    const eps = this.dt * 1e-6;
    let steps = Math.floor((this.accumulator + eps) / this.dt);
    if (steps > this.maxStepsPerFrame) {
      dropped += (steps - this.maxStepsPerFrame) * this.dt;
      steps = this.maxStepsPerFrame;
    }
    this.accumulator = Math.max(0, this.accumulator - steps * this.dt);
    if (this.accumulator >= this.dt) {
      // 上限で打ち切った残りは持ち越さない（追いつこうとして重くなり続けるのを防ぐ）
      this.accumulator = this.accumulator % this.dt;
    }
    return { steps, alpha: Math.min(1, this.accumulator / this.dt), droppedSeconds: dropped };
  }

  reset(): void {
    this.accumulator = 0;
  }
}
