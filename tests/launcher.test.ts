import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PHYSICS_HZ } from '../src/sim/constants';
import { MAX_BALLS, launcherParams, planLauncher } from '../src/sim/launcher';
import { VERTICAL_SLICE_LAYOUT, type PlacedDevice } from '../src/sim/layout';
import { buildRailTrack } from '../src/sim/railGeometry';
import { loadRapier, type Rapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/Simulation';

const base = VERTICAL_SLICE_LAYOUT.devices;
const launcher = base.find((d) => d.type === 'launcher')!;
const lone = (params?: Record<string, number>): PlacedDevice => ({ id: 'L', type: 'launcher', position: [0, 0, 0], rotationYDeg: 0, params });

describe('発射の計画（物理なし）', () => {
  it('初期値は devices.v0.1.json（5m/s・45°・1秒）', () => {
    expect(launcherParams(launcher)).toEqual({ launchSpeed: 5, angleDegrees: 45, cooldownSeconds: 1 });
    expect(planLauncher(launcher, base).periodTicks).toBe(PHYSICS_HZ);
  });

  it('レールにつながっていれば、レールの向きに 5m/s で送り出す', () => {
    const plan = planLauncher(launcher, base);
    expect(plan.feedsRailId).toBe('rail_1');
    const dir = buildRailTrack(base.find((d) => d.id === 'rail_1')!).dir;
    plan.velocity.forEach((v, i) => expect(v).toBeCloseTo(dir[i] * 5, 9));
  });

  it('つながっていなければ、前方から 45° 上へ撃つ', () => {
    const plan = planLauncher(lone(), [lone()]);
    expect(plan.feedsRailId).toBeNull();
    expect(plan.velocity[0]).toBeCloseTo(0, 9);
    expect(plan.velocity[1]).toBeCloseTo(5 * Math.SQRT1_2, 9);
    expect(plan.velocity[2]).toBeCloseTo(5 * Math.SQRT1_2, 9);
  });

  it('90度回すと撃つ向きも回る', () => {
    const d = { ...lone(), rotationYDeg: 90 };
    const plan = planLauncher(d, [d]);
    expect(plan.velocity[0]).toBeGreaterThan(3);
    expect(Math.abs(plan.velocity[2])).toBeLessThan(1e-9);
  });
});

describe('発射（物理あり）', () => {
  let R: Rapier;
  const sims: Simulation[] = [];
  const make = (devices: PlacedDevice[] = base) => {
    const s = new Simulation(R, { seed: 404, devices });
    sims.push(s);
    return s;
  };
  beforeAll(async () => {
    R = await loadRapier();
  });
  afterEach(() => {
    while (sims.length) sims.pop()!.dispose();
  });

  it('再生前は球が無く、tick 0 で1個目、以後 1秒ごとに1個', () => {
    const s = make();
    expect(s.ballCount).toBe(0);
    s.step();
    expect(s.ballCount).toBe(1);
    for (let i = 1; i < PHYSICS_HZ; i++) s.step();
    expect(s.ballCount).toBe(1);
    s.step();
    expect(s.ballCount).toBe(2);
    for (let i = 0; i < PHYSICS_HZ * 3; i++) s.step();
    expect(s.ballCount).toBe(5);
  });

  it(`球は ${MAX_BALLS} 個で止まり、上限で待機中であることがわかる`, () => {
    const s = make();
    for (let i = 0; i < PHYSICS_HZ * (MAX_BALLS + 3); i++) s.step();
    expect(s.ballCount).toBe(MAX_BALLS);
    expect(s.launcherWaiting).toBe('max_balls');
    expect(s.lostBalls).toBe(0);
  });

  it('発射口に前の球が残っていれば撃たずに待つ（重ねて生成しない）', () => {
    const s = make([lone({ cooldownSeconds: 1 / PHYSICS_HZ, launchSpeed: 0.5, angleDegrees: 0 })]);
    s.step();
    s.step();
    expect(s.ballCount).toBe(1);
    expect(s.launcherWaiting).toBe('blocked');
  });

  it('つながっていない発射機の球は放物線を描いて床に落ちる', () => {
    const s = make([lone()]);
    let maxY = 0;
    for (let i = 0; i < PHYSICS_HZ * 2; i++) {
      s.step();
      const b = s.readBalls().find((x) => x.id === 0)!;
      maxY = Math.max(maxY, b.position[1]);
    }
    const b = s.readBalls().find((x) => x.id === 0)!;
    expect(maxY).toBeGreaterThan(1.2); // 0.75m の出口から上へ
    expect(b.position[2]).toBeGreaterThan(2);
    expect(b.position[1]).toBeLessThan(0.3);
  });

  it('複数の球がある状態でも、同じ配置なら全tickで一致し、リセットで初期状態に戻る', () => {
    const a = make();
    const b = make();
    const initial = a.snapshot();
    for (let i = 0; i < PHYSICS_HZ * 8; i++) {
      a.step();
      b.step();
    }
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.ballCount).toBeGreaterThan(5);
    a.reset();
    expect(a.snapshot()).toEqual(initial);
  });
});
