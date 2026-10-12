import config from '../../spec/master/reference/BUGWORKS_perpetual_spec/verification.config.v0.1.json';
import { PHYSICS_HZ } from '../sim/constants';

/**
 * 永久機関の検証（永久機関成立判定仕様 v0.1 / マスター仕様 §5 / DECISIONS.md D-41）。
 * 手順：
 *   1. ウォームアップ（始動）のあと、snapshotEverySteps ごとに状態を「基準」として残す
 *   2. 毎 tick、今の状態に近い基準を探す（離散の状態の一致と、数値の要約での絞り込み。ここは候補探しだけ）
 *   3. 見つかったら数値で照合（位置・向き・速度・角速度・装置の状態・バグの状態・物体の数。球の ID には頼らない）
 *   4. 候補の周期を 3 周期くり返して、毎回同じ状態に戻ること・毎周期に出力があること・外の力を使っていないことを確かめる
 * 判定は「決められた条件の下での、有限回の確認」であり、永遠に動くことの証明ではない。
 */
export type VerifyStatus = 'NOT_TESTED' | 'RUNNING' | 'CANDIDATE' | 'VERIFIED' | 'INCONCLUSIVE' | 'FAILED' | 'INCOMPATIBLE';

export const VERIFY_CONFIG = {
  warmupSteps: config.simulation.warmupSteps,
  maxSteps: config.simulation.maxSteps,
  snapshotEverySteps: config.simulation.snapshotEverySteps,
  confirmationCycles: config.simulation.confirmationCycles,
  positionTolerance: config.comparison.positionToleranceMeters,
  linearVelocityTolerance: config.comparison.linearVelocityToleranceMps,
  angularVelocityTolerance: config.comparison.angularVelocityToleranceRadps,
  orientationTolerance: config.comparison.orientationToleranceRadians,
  minimumOutputEventsPerCycle: config.requirements.minimumOutputEventsPerCycle,
  /** 装置の角度など、連続の状態の許容差（rad / 比率） */
  approxTolerance: config.comparison.orientationToleranceRadians,
  /** これより遅い球しかなければ「止まっている」 */
  staticSpeed: config.comparison.linearVelocityToleranceMps,
} as const;

export type VerifyConfig = { -readonly [K in keyof typeof VERIFY_CONFIG]: number };

/** 比べる状態。balls は球ごとに [位置3, 向き4(四元数), 速度3, 角速度3, ほかは一致が必要な値…] */
export interface MachineState {
  balls: number[][];
  exact: number[];
  approx: number[];
}

/** 外の力の内訳（回数） */
export interface ExternalInputs {
  launcher: number;
  spring: number;
  rotator: number;
  magnet: number;
}

/** 検証する機械（物理シミュレーションの包み） */
export interface Machine {
  readonly tick: number;
  step(): void;
  state(): MachineState;
  outputs(): number;
  external(): ExternalInputs;
  /** これまでに発動した隠しバグ（発動順、重複なし） */
  bugs(): string[];
  /** 球の数が上限に達して、増やせなかったことがあるか */
  ballLimitHit(): boolean;
}

export interface VerifyProgress {
  status: VerifyStatus;
  tick: number;
  maxSteps: number;
  /** 調べている周期の候補（tick） */
  candidatePeriod: number | null;
  /** 確認できた周期の数 */
  confirmedCycles: number;
  outputEvents: number;
  bugs: string[];
}

export interface VerifyResult extends VerifyProgress {
  status: 'VERIFIED' | 'INCONCLUSIVE' | 'FAILED' | 'INCOMPATIBLE';
  /** 判定の理由（画面に出す） */
  reason: string;
  periodSteps: number | null;
  outputEventsPerCycle: number[];
}

interface Anchor {
  tick: number;
  state: MachineState;
  exactKey: string;
  sum: number;
  outputs: number;
  external: ExternalInputs;
}

const EXTERNAL_TEXT: Record<keyof ExternalInputs, string> = {
  launcher: '発射機',
  spring: 'バネ',
  rotator: '回転台のモーター',
  magnet: 'スイッチで切り替わる磁石',
};

/** 球を位置で並べる（ID に頼らない対応付け）。1cm 単位で x → z → y の順 */
export function normalizeState(s: MachineState): MachineState {
  const k = (b: number[]) => [Math.round(b[0] * 100), Math.round(b[2] * 100), Math.round(b[1] * 100)];
  const balls = [...s.balls].sort((a, b) => {
    const ka = k(a);
    const kb = k(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
  });
  return { balls, exact: s.exact, approx: s.approx };
}

/** 2つの四元数の向きの差（rad） */
function quatAngle(a: number[], i: number, b: number[]): number {
  const dot = Math.abs(a[i] * b[i] + a[i + 1] * b[i + 1] + a[i + 2] * b[i + 2] + a[i + 3] * b[i + 3]);
  return 2 * Math.acos(Math.min(1, dot));
}

/** 数値の照合。一致しなければ理由（どこが違ったか）、一致なら null */
export function compareStates(a: MachineState, b: MachineState, c: VerifyConfig = VERIFY_CONFIG): string | null {
  if (a.balls.length !== b.balls.length) return '物体の数';
  if (a.exact.length !== b.exact.length || a.exact.some((v, i) => v !== b.exact[i])) return '装置・バグの状態';
  if (a.approx.length !== b.approx.length || a.approx.some((v, i) => Math.abs(v - b.approx[i]) > c.approxTolerance)) return '装置の角度';
  for (let n = 0; n < a.balls.length; n++) {
    const x = a.balls[n];
    const y = b.balls[n];
    if (x.length !== y.length) return '球の状態';
    if (Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) > c.positionTolerance) return '球の位置';
    if (quatAngle(x, 3, y) > c.orientationTolerance) return '球の向き';
    if (Math.hypot(x[7] - y[7], x[8] - y[8], x[9] - y[9]) > c.linearVelocityTolerance) return '球の速度';
    if (Math.hypot(x[10] - y[10], x[11] - y[11], x[12] - y[12]) > c.angularVelocityTolerance) return '球の回転';
    for (let i = 13; i < x.length; i++) if (x[i] !== y[i]) return '球ごとのバグの状態';
  }
  return null;
}

/** 候補探しの要約（離散の状態はそのまま文字に、連続の状態は1つの数に） */
function summarize(s: MachineState): { exactKey: string; sum: number } {
  let sum = 0;
  for (const b of s.balls) sum += b[0] + 3 * b[1] + 7 * b[2] + 11 * b[7] + 13 * b[8] + 17 * b[9];
  for (const v of s.approx) sum += v;
  const extra = s.balls.map((b) => b.slice(13).join(',')).join('|');
  return { exactKey: `${s.balls.length};${s.exact.join(',')};${extra}`, sum };
}

/** 要約の差の許容（誤差がすべて許容いっぱいでも、候補から漏れないように） */
function sumTolerance(s: MachineState, c: VerifyConfig): number {
  return s.balls.length * (11 * c.positionTolerance + 41 * c.linearVelocityTolerance) + s.approx.length * c.approxTolerance + 1e-9;
}

function externalDiff(a: ExternalInputs, b: ExternalInputs): (keyof ExternalInputs)[] {
  return (Object.keys(a) as (keyof ExternalInputs)[]).filter((k) => b[k] !== a[k]);
}

/**
 * 少しずつ進める検証（画面が固まらないよう、呼ぶ側が1回に進める tick 数を決める）。
 * 決定論：同じ機械なら、何回に分けて進めても同じ結果になる。
 */
export class PerpetualVerifier {
  private anchors = new Map<string, Anchor[]>();
  private cand: { anchor: Anchor; period: number; next: number; cycles: number; perCycle: number[]; lastOutputs: number } | null = null;
  private _result: VerifyResult | null = null;
  private rejected = 0;
  private lastReject = '';
  readonly config: VerifyConfig;

  constructor(
    private readonly machine: Machine,
    config: Partial<VerifyConfig> = {},
  ) {
    this.config = { ...VERIFY_CONFIG, ...config };
  }

  get result(): VerifyResult | null {
    return this._result;
  }

  progress(): VerifyProgress {
    if (this._result) return this._result;
    return {
      status: this.cand ? 'CANDIDATE' : 'RUNNING',
      tick: this.machine.tick,
      maxSteps: this.config.maxSteps,
      candidatePeriod: this.cand?.period ?? null,
      confirmedCycles: this.cand?.cycles ?? 0,
      outputEvents: this.machine.outputs(),
      bugs: this.machine.bugs(),
    };
  }

  /** 最大 budget tick 進める。終わったら結果を返す */
  run(budget: number): VerifyResult | null {
    for (let i = 0; i < budget && !this._result; i++) this.tickOnce();
    return this._result;
  }

  private finish(status: VerifyResult['status'], reason: string, periodSteps: number | null = null, perCycle: number[] = []): void {
    this._result = {
      status,
      reason,
      tick: this.machine.tick,
      maxSteps: this.config.maxSteps,
      candidatePeriod: periodSteps,
      confirmedCycles: perCycle.length,
      outputEvents: this.machine.outputs(),
      bugs: this.machine.bugs(),
      periodSteps,
      outputEventsPerCycle: perCycle,
    };
  }

  private tickOnce(): void {
    const c = this.config;
    const m = this.machine;
    m.step();
    const t = m.tick;
    if (t >= c.maxSteps) {
      const why = this.rejected > 0 ? `くり返しに見える所はありましたが、${this.lastReject}が少しずつずれていきました` : 'くり返しが見つかりませんでした（周期が長すぎるか、同じ状態に戻っていません）';
      this.finish('INCONCLUSIVE', `${(c.maxSteps / PHYSICS_HZ).toFixed(0)}秒ぶん調べても判定できませんでした：${why}`);
      return;
    }
    if (t < c.warmupSteps) return;
    const state = normalizeState(m.state());

    if (this.cand) {
      if (t < this.cand.next) return;
      this.confirm(state);
      return;
    }

    const { exactKey, sum } = summarize(state);
    const list = this.anchors.get(exactKey);
    if (list) {
      const tol = sumTolerance(state, c);
      // 新しい基準から順に（短い周期を優先）
      for (let i = list.length - 1; i >= 0; i--) {
        const a = list[i];
        const period = t - a.tick;
        if (period < c.snapshotEverySteps) continue;
        if (Math.abs(a.sum - sum) > tol) continue;
        if (compareStates(a.state, state, c) !== null) continue;
        const out = m.outputs();
        this.cand = { anchor: a, period, next: t + period, cycles: 1, perCycle: [out - a.outputs], lastOutputs: out };
        // 1周期目（基準 → 今）で外の力を使っていたら、それ以上は調べない
        if (this.checkExternal()) return;
        return;
      }
    }
    if ((t - c.warmupSteps) % c.snapshotEverySteps === 0) {
      const anchor: Anchor = { tick: t, state, exactKey, sum, outputs: m.outputs(), external: m.external() };
      const l = list ?? [];
      l.push(anchor);
      this.anchors.set(exactKey, l);
    }
  }

  /** 候補の周期の外の力を調べる。使っていたら不成立にして true */
  private checkExternal(): boolean {
    const cand = this.cand!;
    const used = externalDiff(cand.anchor.external, this.machine.external());
    if (used.length === 0) return false;
    this.finish('FAILED', `くり返し動いていますが、外の力（${used.map((k) => EXTERNAL_TEXT[k]).join('・')}）を使っています。力の源にできるのは隠しバグだけです`, cand.period);
    return true;
  }

  private confirm(state: MachineState): void {
    const c = this.config;
    const cand = this.cand!;
    const m = this.machine;
    const diff = compareStates(cand.anchor.state, state, c);
    if (diff !== null) {
      this.rejected++;
      this.lastReject = diff;
      this.cand = null;
      return;
    }
    const out = m.outputs();
    cand.perCycle.push(out - cand.lastOutputs);
    cand.lastOutputs = out;
    cand.cycles++;
    cand.next += cand.period;
    if (this.checkExternal()) return;
    // 基準の周期（1周期目）に加えて confirmationCycles 回くり返したら判定
    if (cand.cycles <= c.confirmationCycles) return;
    const cycles = cand.perCycle.slice(1);
    if (m.ballLimitHit()) {
      this.finish('INCONCLUSIVE', '球の数が上限に達したため、判定できませんでした（増え続ける機械は確かめられません）', cand.period, cycles);
      return;
    }
    if (cycles.every((n) => n === 0)) {
      const still = state.balls.every((b) => Math.hypot(b[7], b[8], b[9]) < c.staticSpeed);
      this.finish('FAILED', still ? '止まっています。止まったままの機械は永久機関になりません' : '同じ動きをくり返していますが、出力（羽根車を回す・スイッチを切り替える）がありません', cand.period, cycles);
      return;
    }
    if (cycles.some((n) => n < c.minimumOutputEventsPerCycle)) {
      this.finish('FAILED', '出力のない周期があります（毎周期、羽根車を回すかスイッチを切り替える必要があります）', cand.period, cycles);
      return;
    }
    this.finish('VERIFIED', '外の力を使わずに、同じ動きと出力をくり返しました', cand.period, cycles);
  }
}
