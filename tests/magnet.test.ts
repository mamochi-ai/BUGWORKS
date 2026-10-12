import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EditorModel } from '../src/edit/EditorModel';
import { PARAM_SPECS, formatParam, paramValue } from '../src/edit/params';
import { rolePorts, seatOnSurface } from '../src/edit/placement';
import { getDeviceDef } from '../src/sim/catalog';
import { PHYSICS_HZ } from '../src/sim/constants';
import { MAGNET_SAMPLE_LAYOUT, type PlacedDevice } from '../src/sim/layout';
import { MAGNET, magnetAccel, magnetParams, magnetPole } from '../src/sim/magnet';
import { loadRapier, type Rapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/Simulation';

const magnet = (params?: Record<string, number>, rot = 0): PlacedDevice => ({ id: 'M', type: 'magnet', position: [0, 0, 0], rotationYDeg: rot, params });
const len = (v: number[]) => Math.hypot(v[0], v[1], v[2]);

describe('磁石装置（定義と力）', () => {
  it('仕様JSONの値：半径1.5m・最大20N・引きよせる。enable（信号）ポートはまだ使わない', () => {
    const def = getDeviceDef('magnet');
    expect(def.prototypeOnly).toBeUndefined();
    expect(def.size).toEqual([1, 1.2, 0.8]);
    expect(magnetParams(magnet())).toEqual({ mode: 1, maxForceNewton: 20, radius: 1.5 });
    expect(rolePorts(magnet())).toEqual([]);
  });

  it('磁極は前面（ローカル+Z）。回転に合わせて向きが変わる', () => {
    expect(magnetPole(magnet())).toEqual(MAGNET.pole);
    const p = magnetPole(magnet(undefined, 90));
    expect(p[0]).toBeCloseTo(MAGNET.pole[2], 9);
    expect(p[2]).toBeCloseTo(0, 9);
  });

  it('引きよせる：磁極へ向かう。近いほど強く、半径の外では0', () => {
    const m = magnet();
    const pole = magnetPole(m);
    const near = magnetAccel(m, [pole[0], pole[1], pole[2] + 0.3])!;
    const far = magnetAccel(m, [pole[0], pole[1], pole[2] + 1.0])!;
    expect(near[2]).toBeLessThan(0);
    expect(Math.abs(near[0])).toBeLessThan(1e-12);
    expect(len(near)).toBeGreaterThan(len(far));
    // 20N を基準の鉄球（2kg）で割った加速度 × (1 − 0.3/1.5)²
    expect(len(near)).toBeCloseTo((20 / MAGNET.REF_MASS_KG) * 0.8 ** 2, 9);
    expect(magnetAccel(m, [pole[0], pole[1], pole[2] + 1.5])).toBeNull();
    expect(magnetAccel(m, [pole[0], pole[1], pole[2] + 2])).toBeNull();
  });

  it('しりぞける：同じ大きさで向きが逆', () => {
    const pole = magnetPole(magnet());
    const p: [number, number, number] = [pole[0] + 0.4, pole[1], pole[2] + 0.4];
    const a = magnetAccel(magnet(), p)!;
    const r = magnetAccel(magnet({ mode: -1 }), p)!;
    for (let i = 0; i < 3; i++) expect(r[i]).toBeCloseTo(-a[i], 12);
  });

  it('台（床）の上に置く装置。高さは手で変えない', () => {
    const plat: PlacedDevice = { id: 'P', type: 'platform', position: [0, 0, 0], rotationYDeg: 0, params: { heightMeters: 0.6 } };
    expect(seatOnSurface({ ...magnet(), position: [0, 2, 0] }, [plat]).position[1]).toBeCloseTo(0.6, 9);
  });

  it('設定：向き（引きよせる/しりぞける）・強さ・届く距離。元に戻せる', () => {
    expect(PARAM_SPECS.magnet.map((s) => s.key)).toEqual(['mode', 'maxForceNewton', 'radius']);
    const radius = PARAM_SPECS.magnet.find((s) => s.key === 'radius')!;
    expect(formatParam(radius, 2.25)).toBe('2.25m');
    const ed = new EditorModel([magnet()], 1);
    expect(ed.setParam('M', 'mode', -1)).toBe(true);
    expect(paramValue(ed.devices[0], 'mode')).toBe(-1);
    expect(ed.message?.text).toContain('しりぞける');
    ed.undo();
    expect(paramValue(ed.devices[0], 'mode')).toBe(1);
  });
});

describe('磁石装置（物理）', () => {
  let R: Rapier;
  const sims: Simulation[] = [];
  beforeAll(async () => {
    R = await loadRapier();
  });
  afterEach(() => {
    while (sims.length) sims.pop()!.dispose();
  });
  const run = (devices: PlacedDevice[], seconds: number) => {
    const s = new Simulation(R, { seed: 404, devices });
    sims.push(s);
    for (let i = 0; i < PHYSICS_HZ * seconds; i++) s.step();
    return s;
  };
  const withMagnet = (params: Record<string, number>) =>
    MAGNET_SAMPLE_LAYOUT.devices.map((d) => (d.type === 'magnet' ? { ...d, params: { ...d.params, ...params } } : d));

  it('見本：床を転がる球を磁石が引きよせ、5秒以内に磁石の前のゴールに入る', () => {
    const s = run(MAGNET_SAMPLE_LAYOUT.devices, 6);
    expect(s.firstGoalTick).not.toBeNull();
    expect(s.firstGoalTick! / PHYSICS_HZ).toBeLessThan(5);
    expect(s.lostBalls).toBe(0);
  });

  it('磁石が無い・しりぞける・届かないときはゴールしない', () => {
    expect(run(MAGNET_SAMPLE_LAYOUT.devices.filter((d) => d.type !== 'magnet'), 6).goalHits).toBe(0);
    expect(run(withMagnet({ mode: -1 }), 6).goalHits).toBe(0);
    expect(run(withMagnet({ radius: 0.5 }), 6).goalHits).toBe(0);
  });

  it('同じ配置なら毎回同じ動き（決定論）。リセットで初めからやり直せる', () => {
    const a = run(MAGNET_SAMPLE_LAYOUT.devices, 4).snapshot();
    const s = run(MAGNET_SAMPLE_LAYOUT.devices, 4);
    expect(s.snapshot()).toEqual(a);
    s.reset();
    for (let i = 0; i < PHYSICS_HZ * 4; i++) s.step();
    expect(s.snapshot()).toEqual(a);
  });
});
