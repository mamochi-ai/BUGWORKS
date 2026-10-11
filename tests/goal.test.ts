import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EditorModel } from '../src/edit/EditorModel';
import { paramValue } from '../src/edit/params';
import { conflicts, evaluateMove, footprint, surfaceHeightAt } from '../src/edit/placement';
import { getDeviceDef } from '../src/sim/catalog';
import { PHYSICS_HZ } from '../src/sim/constants';
import { GOAL_ZONE, inGoal, platformTop } from '../src/sim/goal';
import { VERTICAL_SLICE_LAYOUT, type PlacedDevice } from '../src/sim/layout';
import { loadRapier, type Rapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/Simulation';

const platform = (z = 0, h = 1): PlacedDevice => ({ id: 'P', type: 'platform', position: [0, 0, z], rotationYDeg: 0, params: { heightMeters: h } });
const goal = (x: number, y: number, z: number): PlacedDevice => ({ id: 'G', type: 'goal', position: [x, y, z], rotationYDeg: 0 });

describe('ゴールと台（定義・配置）', () => {
  it('どちらも仕様JSONに無い試作の装置として定義されている', () => {
    expect(getDeviceDef('goal').prototypeOnly).toBe(true);
    expect(getDeviceDef('platform').prototypeOnly).toBe(true);
  });

  it('ゴールの範囲：台座の上の空間だけ', () => {
    const g = goal(0, 1, 0);
    expect(inGoal(g, [0.2, 1.1, -0.2])).toBe(true);
    expect(inGoal(g, [GOAL_ZONE.half + 0.05, 1.1, 0])).toBe(false);
    expect(inGoal(g, [0, 0.95, 0])).toBe(false);
    expect(inGoal(g, [0, 1 + GOAL_ZONE.height + 0.05, 0])).toBe(false);
  });

  it('台の外形は高さの設定に合わせる', () => {
    expect(footprint(platform(0, 1.4)).maxY).toBeCloseTo(1.4, 9);
    expect(platformTop(platform(0, 0.6))).toBeCloseTo(0.6, 9);
  });

  it('台の上の高さを調べられる（台の外は床）', () => {
    expect(surfaceHeightAt(0, 0.5, [platform()])).toBe(1);
    expect(surfaceHeightAt(0, 2, [platform()])).toBe(0);
  });

  it('ゴールを台の上へドラッグすると台の上面に乗る。台から外すと床に下りる', () => {
    const others = [platform()];
    const on = evaluateMove(goal(3, 0, 3), 0.1, 0.2, others);
    expect(on.ok).toBe(true);
    expect(on.device.position[1]).toBe(1);
    expect(conflicts(on.device, others[0])).toBe(false);
    const off = evaluateMove({ ...on.device }, 3, 3, others);
    expect(off.device.position[1]).toBe(0);
  });

  it('台の高さを変えると、上のゴールも一緒に上がる。高さボタンは使えない', () => {
    const m = new EditorModel([platform(), goal(0, 1, 0)], 1);
    expect(m.setParam('P', 'heightMeters', 1.6)).toBe(true);
    expect(paramValue(m.devices[0], 'heightMeters')).toBe(1.6);
    expect(m.devices[1].position[1]).toBeCloseTo(1.6, 9);
    expect(m.changeHeight('G', 1)).toBe(false);
    expect(m.message?.text).toContain('台');
    m.remove('P');
    expect(m.devices[0].position[1]).toBe(0);
  });

  it('パレットから台・ゴールを追加できる', () => {
    const m = new EditorModel([], 1);
    expect(m.addDevice('platform', 0, 0)).toBe('platform_1');
    expect(m.addDevice('goal', 0, 0)).toBe('goal_1');
  });
});

describe('ゴールと台（物理）', () => {
  let R: Rapier;
  const sims: Simulation[] = [];
  const make = (devices: readonly PlacedDevice[]) => {
    const s = new Simulation(R, { seed: 404, devices: [...devices] });
    sims.push(s);
    return s;
  };
  beforeAll(async () => {
    R = await loadRapier();
  });
  afterEach(() => {
    while (sims.length) sims.pop()!.dispose();
  });

  it('最初の配置：バネで上の段へ送られた球がゴールに入る（クリア）。5秒以内', () => {
    const s = make(VERTICAL_SLICE_LAYOUT.devices);
    while (s.firstGoalTick === null && s.tick < PHYSICS_HZ * 5) s.step();
    expect(s.firstGoalTick).not.toBeNull();
    expect(s.snapshot().goals[0]).toMatchObject({ deviceId: 'goal_1', hits: 1 });
  });

  it('ゴールに入った球は回収され、発射機は上限で止まらずに撃ち続ける', () => {
    const s = make(VERTICAL_SLICE_LAYOUT.devices);
    for (let i = 0; i < PHYSICS_HZ * 30; i++) s.step();
    expect(s.goalHits).toBeGreaterThan(10);
    expect(s.ballCount).toBeLessThan(16);
    expect(s.lostBalls).toBe(0);
  });

  it('台の上に球が乗る（台を素通りしない）', () => {
    // 発射機を台の手前に置き、水平に撃った球が台の上面に落ちて止まる
    const s = make([
      { id: 'L', type: 'launcher', position: [0, 0.6, 0], rotationYDeg: 0, params: { angleDegrees: 0, launchSpeed: 2 } },
      platform(1.6, 1),
    ]);
    for (let i = 0; i < PHYSICS_HZ * 1.5; i++) s.step();
    const b = s.readBalls().find((x) => x.id === 0)!;
    expect(b.position[1]).toBeCloseTo(1.1, 1);
  });

  it('同じ配置なら全tickで一致し、リセットでゴールの記録も消える', () => {
    const a = make(VERTICAL_SLICE_LAYOUT.devices);
    const b = make(VERTICAL_SLICE_LAYOUT.devices);
    const initial = a.snapshot();
    for (let i = 0; i < PHYSICS_HZ * 6; i++) {
      a.step();
      b.step();
    }
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.goalHits).toBeGreaterThan(0);
    a.reset();
    expect(a.snapshot()).toEqual(initial);
    expect(a.firstGoalTick).toBeNull();
  });
});
