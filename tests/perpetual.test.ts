import { beforeAll, describe, expect, it } from 'vitest';
import { PerpetualVerifier, compareStates, normalizeState, type ExternalInputs, type Machine, type MachineState } from '../src/perpetual/verify';
import { SimMachine } from '../src/perpetual/simMachine';
import { canonicalBlueprint, makeCertificate, DISCLAIMER } from '../src/perpetual/certificate';
import { loadRapier, type Rapier } from '../src/sim/rapier';
import type { PlacedDevice } from '../src/sim/layout';
import { FLOOR_CHAIN } from './fixtures';
import { rotatorRing } from './loops';

/**
 * 永久機関の検証（D-41）。判定の流れは作り物の機械で、物理とのつなぎは本物のシミュレーションで確かめる。
 * 偽の合格を出さないことを優先する（静止・出力なし・外の力・ずれていく・上限）。
 */
const SMALL = { warmupSteps: 30, maxSteps: 4000, snapshotEverySteps: 10 };

/** 1球が周期 period で同じ道を回る作り物の機械 */
class FakeMachine implements Machine {
  tick = 0;
  ext: ExternalInputs = { launcher: 0, spring: 0, rotator: 0, magnet: 0 };
  out = 0;
  constructor(
    private readonly opts: { period: number; drift?: number; outputEvery?: number; externalEvery?: number; still?: boolean; limit?: boolean; balls?: number },
  ) {}
  step(): void {
    this.tick++;
    if (this.opts.outputEvery && this.tick % this.opts.outputEvery === 0) this.out++;
    if (this.opts.externalEvery && this.tick % this.opts.externalEvery === 0) this.ext = { ...this.ext, rotator: this.ext.rotator + 1 };
  }
  state(): MachineState {
    const p = this.opts.period;
    const ph = ((this.tick % p) / p) * 2 * Math.PI;
    const r = 1 + (this.opts.drift ?? 0) * this.tick;
    const n = this.opts.balls ?? 1;
    const balls = Array.from({ length: n }, (_, i) => {
      const a = ph + (i * 2 * Math.PI) / n;
      if (this.opts.still) return [i, 0.1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0];
      return [r * Math.cos(a), 0.1, r * Math.sin(a), 0, Math.sin(a / 2), 0, Math.cos(a / 2), -Math.sin(a), 0, Math.cos(a), 0, 1, 0, 0];
    });
    return { balls, exact: [n], approx: [] };
  }
  outputs(): number {
    return this.out;
  }
  external(): ExternalInputs {
    return { ...this.ext };
  }
  bugs(): string[] {
    return ['BUG-03'];
  }
  ballLimitHit(): boolean {
    return !!this.opts.limit;
  }
}

const run = (m: Machine, cfg = SMALL) => {
  const v = new PerpetualVerifier(m, cfg);
  let r = null;
  for (let i = 0; i < 1000 && !r; i++) r = v.run(97); // 何回に分けても同じ
  return r!;
};

describe('永久機関の検証（判定の流れ）', () => {
  it('同じ状態に戻り、毎周期に出力があり、外の力がなければ認定（周期は tick 単位で正確）', () => {
    const r = run(new FakeMachine({ period: 137, outputEvery: 137 }));
    expect(r.status).toBe('VERIFIED');
    expect(r.periodSteps).toBe(137);
    expect(r.outputEventsPerCycle).toEqual([1, 1, 1]);
    expect(r.bugs).toEqual(['BUG-03']);
  });

  it('分け方が違っても同じ結果（決定論）', () => {
    const a = new PerpetualVerifier(new FakeMachine({ period: 137, outputEvery: 137 }), SMALL);
    let ra = null;
    while (!ra) ra = a.run(1);
    expect(ra).toEqual(run(new FakeMachine({ period: 137, outputEvery: 137 })));
  });

  it('止まっている機械は認定しない', () => {
    const r = run(new FakeMachine({ period: 50, still: true }));
    expect(r.status).toBe('FAILED');
    expect(r.reason).toContain('止まって');
  });

  it('出力がない（空回り）なら認定しない', () => {
    const r = run(new FakeMachine({ period: 80 }));
    expect(r.status).toBe('FAILED');
    expect(r.reason).toContain('出力');
  });

  it('外の力（回転台のモーターなど）を使っていたら認定しない', () => {
    const r = run(new FakeMachine({ period: 80, outputEvery: 80, externalEvery: 40 }));
    expect(r.status).toBe('FAILED');
    expect(r.reason).toContain('回転台');
  });

  it('少しずつずれていく（見かけのくり返し）は認定しない → 時間切れで判定できない', () => {
    const r = run(new FakeMachine({ period: 80, outputEvery: 80, drift: 0.00002 }));
    expect(r.status).toBe('INCONCLUSIVE');
  });

  it('球の数が上限に達した機械は判定できない', () => {
    const r = run(new FakeMachine({ period: 80, outputEvery: 80, limit: true }));
    expect(r.status).toBe('INCONCLUSIVE');
    expect(r.reason).toContain('上限');
  });

  it('球は ID ではなく位置で対応づける（並び順が違っても同じ状態）', () => {
    const s = new FakeMachine({ period: 100, balls: 3 });
    s.tick = 10;
    const a = s.state();
    const b: MachineState = { ...a, balls: [a.balls[2], a.balls[0], a.balls[1]] };
    expect(compareStates(normalizeState(a), normalizeState(b))).toBeNull();
    const c: MachineState = { ...a, balls: a.balls.map((x, i) => (i === 0 ? [x[0] + 0.01, ...x.slice(1)] : x)) };
    expect(compareStates(normalizeState(a), normalizeState(c))).toBe('球の位置');
  });
});

describe('永久機関の検証（物理）', () => {
  let R: Rapier;
  beforeAll(async () => {
    R = await loadRapier();
  });
  const verify = (devices: PlacedDevice[], cfg = {}) => {
    const m = new SimMachine(R, { seed: 404, devices });
    const v = new PerpetualVerifier(m, cfg);
    let r = null;
    while (!r) r = v.run(2000);
    m.dispose();
    return r;
  };

  it('球がゴールに入って止まった機械：止まっているので不成立', () => {
    const devices: PlacedDevice[] = [
      ...FLOOR_CHAIN.devices.map((d) => (d.type === 'launcher' ? { ...d, params: { shots: 1 } } : d)),
      { id: 'goal_1', type: 'goal', position: [0, 0, 3.75], rotationYDeg: 0 },
    ];
    const r = verify(devices);
    expect(r.status).toBe('FAILED');
    expect(r.reason).toContain('止まって');
  });

  it('撃ち続ける発射機は、球が上限に達して判定できない（黙って合格させない）', () => {
    const r = verify(FLOOR_CHAIN.devices, { maxSteps: 6000 });
    expect(r.status).not.toBe('VERIFIED');
  });

  it('回転台の輪（隠しバグも起きる）でも、回転台のモーターは外の力なので不成立', () => {
    const r = verify(rotatorRing());
    expect(r.bugs).toContain('BUG-03');
    expect(r.status).toBe('FAILED');
    expect(r.reason).toContain('回転台');
  }, 120_000);
});

describe('検証証明書', () => {
  it('仕様の例と同じ項目。設計図のハッシュは題名・日時に左右されない', async () => {
    const result = { status: 'VERIFIED' as const, reason: '', tick: 1, maxSteps: 1, candidatePeriod: 960, confirmedCycles: 3, outputEvents: 6, bugs: ['BUG-03'], periodSteps: 960, outputEventsPerCycle: [2, 2, 2] };
    const c = await makeCertificate(result, FLOOR_CHAIN.devices, 404, '無限ループ試作機', new Date('2026-10-12T00:00:00Z'));
    expect(c).toMatchObject({ certificateVersion: '0.1', status: 'VERIFIED', verificationMethod: 'bounded_periodic_replay', seed: 404, periodSteps: 960, periodSeconds: 8, confirmedCycles: 3, outputEventsPerCycle: [2, 2, 2], triggeredBugIds: ['BUG-03'], disclaimer: DISCLAIMER });
    expect(c.blueprintSha256).toMatch(/^[0-9a-f]{64}$/);
    const again = await makeCertificate(result, FLOOR_CHAIN.devices, 404, '別の名前', new Date('2027-01-01T00:00:00Z'));
    expect(again.blueprintSha256).toBe(c.blueprintSha256);
    expect(canonicalBlueprint(FLOOR_CHAIN.devices, 404)).not.toBe(canonicalBlueprint(FLOOR_CHAIN.devices, 405));
  });
});
