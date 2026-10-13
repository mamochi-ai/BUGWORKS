import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EditorModel } from '../src/edit/EditorModel';
import { PARAM_SPECS, paramValue } from '../src/edit/params';
import { conflicts, findConnections, rolePorts } from '../src/edit/placement';
import { getDeviceDef } from '../src/sim/catalog';
import { PHYSICS_HZ } from '../src/sim/constants';
import { ROTATOR_SAMPLE_LAYOUT, type PlacedDevice } from '../src/sim/layout';
import { loadRapier, type Rapier } from '../src/sim/rapier';
import { ROTATOR, alignedWithEntry, exitFor, rotatorParams, travelDir } from '../src/sim/rotator';
import { Simulation, parkStep } from '../src/sim/Simulation';

const rot = (params?: Record<string, number>): PlacedDevice => ({ id: 'T', type: 'rotator', position: [0, 0, 0], rotationYDeg: 0, params });
const hits = (s: Simulation) => Object.fromEntries(s.snapshot().goals.map((g) => [g.deviceId, g.hits]));
const withoutSwitchWire = ROTATOR_SAMPLE_LAYOUT.devices.map((d) => (d.type === 'switch' ? { ...d, signalTargets: [] } : d));

describe('回転装置（定義）', () => {
  it('仕様JSONの値（秒速30°）と、試作で追加した球の入口・出口（前・左・右）。軸の入口は使わない', () => {
    const def = getDeviceDef('rotator');
    expect(def.size).toEqual([1.2, 0.55, 1.2]);
    expect(rotatorParams(rot())).toEqual({ degreesPerSecond: 30, direction: 1, batterySeconds: 0 });
    expect(rolePorts(rot()).map((p) => p.portId)).toEqual(['ball_in', 'ball_out', 'ball_left_out', 'ball_right_out']);
  });

  it('レールが入口の向きにそろうのは 0° と 180°（まっすぐ）', () => {
    expect(alignedWithEntry(0)).toBe(true);
    expect(alignedWithEntry(Math.PI)).toBe(true);
    expect(alignedWithEntry(Math.PI / 2)).toBe(false);
    expect(alignedWithEntry(0.1)).toBe(false);
  });

  it('球の進む向き：回っていなければ前、左回りに90°で左（+X）、右回りに90°で右', () => {
    expect(exitFor(travelDir(0))).toBe('front');
    expect(exitFor(travelDir(Math.PI / 2))).toBe('left');
    expect(exitFor(travelDir(-Math.PI / 2))).toBe('right');
    expect(exitFor(travelDir(Math.PI))).toBeNull(); // 入口へは戻さない
    expect(exitFor(travelDir(0.3))).toBeNull();
  });

  it('OFF になったら、まっすぐの向き（180°ごと）まで回ってから止まる', () => {
    expect(parkStep(0, 0.01)).toBe(0);
    expect(parkStep(Math.PI - 0.005, 0.01)).toBeCloseTo(0.005, 12);
    expect(parkStep(1, 0.01)).toBe(0.01);
    expect(parkStep(-Math.PI + 0.005, -0.01)).toBeCloseTo(-0.005, 12);
  });

  it('設定：回る速さ・回る向き。元に戻せる。スイッチから配線できる', () => {
    expect(PARAM_SPECS.rotator.map((s) => s.key)).toEqual(['degreesPerSecond', 'direction', 'batterySeconds']);
    const ed = new EditorModel(ROTATOR_SAMPLE_LAYOUT.devices, 1);
    expect(ed.setParam('rotator_1', 'direction', -1)).toBe(true);
    expect(paramValue(ed.devices.find((d) => d.id === 'rotator_1')!, 'direction')).toBe(-1);
    ed.undo();
    expect(ed.startWiring('switch_1')).toBe(true);
    ed.select('rotator_1');
    expect(ed.devices.find((d) => d.id === 'switch_1')!.signalTargets).toEqual([]);
  });

  it('見本：入口・前・左の出口がつながり、重ならない', () => {
    const d = ROTATOR_SAMPLE_LAYOUT.devices;
    const c = findConnections(d).map((x) => `${x.from.deviceId}/${x.from.portId}>${x.to.deviceId}`);
    expect(c).toEqual(expect.arrayContaining(['rail_1/ball_out>rotator_1', 'rotator_1/ball_out>rail_2', 'rotator_1/ball_left_out>rail_3']));
    for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) expect(conflicts(d[i], d[j])).toBe(false);
  });
});

describe('回転装置（物理）', () => {
  let R: Rapier;
  const sims: Simulation[] = [];
  beforeAll(async () => {
    R = await loadRapier();
  });
  afterEach(() => {
    while (sims.length) sims.pop()!.dispose();
  });
  const run = (devices: readonly PlacedDevice[], seconds: number) => {
    const s = new Simulation(R, { seed: 404, devices: [...devices] });
    sims.push(s);
    for (let i = 0; i < PHYSICS_HZ * seconds; i++) s.step();
    return s;
  };

  it('見本：スイッチが ON の間は左へ、OFF の間はまっすぐ。左と前のゴールに交互に入る', () => {
    const s = run(ROTATOR_SAMPLE_LAYOUT.devices, 13);
    expect(hits(s)).toEqual({ goal_1: 2, goal_2: 2 });
    expect(s.lostBalls).toBe(0);
  });

  it('止まっている台（OFF のまま）なら、球はまっすぐ前へ', () => {
    // スイッチを外し、代わりに球の通らないスイッチを配線（ずっと OFF）
    const devices: PlacedDevice[] = [
      ...withoutSwitchWire,
      { id: 'switch_9', type: 'switch', position: [-3, 0, 2], rotationYDeg: 0, signalTargets: ['rotator_1'] },
    ];
    const s = run(devices, 8);
    expect(hits(s).goal_2).toBe(0);
    expect(hits(s).goal_1).toBeGreaterThanOrEqual(2);
    expect(s.snapshot().rotators[0].angle).toBe(0);
  });

  it('電池（D-45）：決まった秒数が過ぎるとモーターが止まり、台はその向きのまま動かない。0 はずっと動く', () => {
    expect(rotatorParams({ id: 'r', type: 'rotator', position: [0, 0, 0], rotationYDeg: 0 }).batterySeconds).toBe(0);
    const bat = withoutSwitchWire.map((d) => (d.type === 'rotator' ? { ...d, params: { ...d.params, batterySeconds: 2 } } : d));
    const s = run(bat, 2.5);
    const a = s.rotatorAngles().get('rotator_1')!;
    expect(a).toBeGreaterThan(0);
    for (let i = 0; i < PHYSICS_HZ; i++) s.step();
    expect(s.rotatorAngles().get('rotator_1')).toBe(a);
    const forever = run(withoutSwitchWire, 2.5);
    const b = forever.rotatorAngles().get('rotator_1')!;
    for (let i = 0; i < PHYSICS_HZ; i++) forever.step();
    expect(forever.rotatorAngles().get('rotator_1')).toBeGreaterThan(b);
  });

  it('送り出した球は、すべらずに転がる回り方で出る（速さが落ちない）', () => {
    const s = new Simulation(R, { seed: 404, devices: [...withoutSwitchWire] });
    sims.push(s);
    let released: number | null = null;
    for (let i = 0; i < PHYSICS_HZ * 10 && released === null; i++) {
      const before = s.snapshot().rotators[0].releases;
      s.step();
      if (s.snapshot().rotators[0].releases > before) released = s.tick;
    }
    expect(released).not.toBeNull();
    for (let i = 0; i < 12; i++) s.step(); // 0.1 秒後
    // 送り出した球（いちばん速い球）は、0.1 秒たっても送り出しの速さに近い（すべると 5/7 ほどに落ちる）
    const fastest = Math.max(...s.readBalls().map((x) => Math.hypot(...x.linvel)));
    expect(fastest).toBeGreaterThan(ROTATOR.releaseSpeed * 0.85);
  });

    it('配線なしなら回り続け、球は入口で待ってから左へ出る。右回りなら右へ', () => {
    const s = run(withoutSwitchWire, 10);
    expect(hits(s).goal_1).toBe(0);
    expect(hits(s).goal_2).toBeGreaterThanOrEqual(2);
    // 右回り：右の出口（−X）には何もないので床へ落ちる（前・左のゴールには入らない）
    const right = run(
      withoutSwitchWire.map((d) => (d.type === 'rotator' ? { ...d, params: { ...d.params, direction: -1 } } : d)),
      8,
    );
    expect(right.goalHits).toBe(0);
    const ball = right.readBalls().map((b) => b.position[0]);
    expect(Math.min(...ball, 0)).toBeLessThan(-ROTATOR.half);
  });

  it('同じ配置なら毎回同じ動き（決定論）。リセットで台も初めの向きに戻る', () => {
    const a = run(ROTATOR_SAMPLE_LAYOUT.devices, 7).snapshot();
    const s = run(ROTATOR_SAMPLE_LAYOUT.devices, 7);
    expect(s.snapshot()).toEqual(a);
    s.reset();
    expect(s.snapshot().rotators[0].angle).toBe(0);
    for (let i = 0; i < PHYSICS_HZ * 7; i++) s.step();
    expect(s.snapshot()).toEqual(a);
  });
});
