import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EditorModel } from '../src/edit/EditorModel';
import { findSpec, formatParam, paramValue } from '../src/edit/params';
import { evaluateMove, findConnections, footprint } from '../src/edit/placement';
import { PHYSICS_HZ } from '../src/sim/constants';
import { BRIDGE, PADDLE, SHAFT_Y, bridgeTargetAngle, inPaddleZone, solveDrive } from '../src/sim/drive';
import { GEAR_SAMPLE_LAYOUT, type PlacedDevice } from '../src/sim/layout';
import { portWorldPosition } from '../src/sim/railGeometry';
import { loadRapier, type Rapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/Simulation';

const L = GEAR_SAMPLE_LAYOUT.devices;
const byId = (id: string) => L.find((d) => d.id === id)!;

describe('回転を伝える装置（物理なし）', () => {
  it('見本の配置：球の道と、羽根車→歯車装置→軸→可動橋の軸がつながっている', () => {
    const c = findConnections(L).map((x) => `${x.type}:${x.from.deviceId}>${x.to.deviceId}`);
    expect(c).toEqual(
      expect.arrayContaining([
        'ball:rail_1>paddle_1',
        'ball:paddle_1>rail_2',
        'ball:rail_2>bridge_1',
        'shaft:paddle_1>gearbox_1',
        'shaft:gearbox_1>shaft_1',
        'shaft:shaft_1>bridge_1',
      ]),
    );
  });

  it('羽根車・可動橋の軸は、装置の高さによらず床から 0.65m', () => {
    expect(portWorldPosition(byId('paddle_1'), 'shaft_out')[1]).toBeCloseTo(SHAFT_Y, 9);
    expect(portWorldPosition({ ...byId('paddle_1'), position: [0, 1.7, 0] }, 'shaft_out')[1]).toBeCloseTo(SHAFT_Y, 9);
    expect(portWorldPosition(byId('bridge_1'), 'shaft_in')[1]).toBeCloseTo(SHAFT_Y, 9);
  });

  it('回転の伝わり：歯車装置は入力×ギア比、軸はそのまま、可動橋は入力を受け取る', () => {
    const links = findConnections(L)
      .filter((c) => c.type === 'shaft')
      .map((c) => ({ from: c.from.deviceId, to: c.to.deviceId }));
    const r = solveDrive(L, links, (id) => (id === 'paddle_1' ? 1 : 0));
    expect(r.output.get('gearbox_1')).toBeCloseTo(2, 9);
    expect(r.output.get('shaft_1')).toBeCloseTo(2, 9);
    expect(r.input.get('bridge_1')).toBeCloseTo(2, 9);
  });

  it('つながりが輪になっていても止まる', () => {
    const r = solveDrive(L, [{ from: 'gearbox_1', to: 'shaft_1' }, { from: 'shaft_1', to: 'gearbox_1' }], () => 0);
    expect(r.output.get('gearbox_1')).toBe(0);
  });

  it('可動橋：入力が 180° 回ると下りきる', () => {
    expect(bridgeTargetAngle(0)).toBeCloseTo(BRIDGE.openRad, 9);
    expect(bridgeTargetAngle(Math.PI / 2)).toBeCloseTo(BRIDGE.openRad / 2, 9);
    expect(bridgeTargetAngle(Math.PI)).toBe(0);
    expect(bridgeTargetAngle(10)).toBe(0);
  });

  it('羽根車の数える範囲：走行面の上の中央だけ', () => {
    const p = byId('paddle_1');
    const surf = p.position[1] + (PADDLE.inY + PADDLE.outY) / 2;
    expect(inPaddleZone(p, [0, surf + 0.1, p.position[2]])).toBe(true);
    expect(inPaddleZone(p, [0, surf + 0.1, p.position[2] + 0.4])).toBe(false);
    expect(inPaddleZone(p, [0, surf + 0.5, p.position[2]])).toBe(false);
  });

  it('軸を歯車装置の出口に近づけると吸着する（高さは床のまま）', () => {
    const others = L.filter((d) => d.id !== 'shaft_1');
    const moving: PlacedDevice = { id: 'shaft_9', type: 'shaft', position: [3, 0, 3], rotationYDeg: 0, params: { lengthMeters: 0.5 } };
    const r = evaluateMove(moving, 0.8, 1.7, others);
    // 0.5m の軸は歯車装置の出口と可動橋の入口のちょうど間に入る（どちらに吸着しても同じ位置）
    expect(r.ok).toBe(true);
    expect(r.device.position).toEqual([0.75, 0, 1.75]);
    const c = findConnections([...others, r.device]).map((x) => `${x.from.deviceId}>${x.to.deviceId}`);
    expect(c).toEqual(expect.arrayContaining(['gearbox_1>shaft_9', 'shaft_9>bridge_1']));
  });

  it('設定：ギア比は選択肢、軸の長さで外形とポートが変わる', () => {
    const spec = findSpec('gearbox', 'gearRatio')!;
    expect(formatParam(spec, paramValue(byId('gearbox_1'), 'gearRatio'))).toBe('2倍');
    const m = new EditorModel([{ id: 'shaft_1', type: 'shaft', position: [0, 0, 0], rotationYDeg: 0 }], 1);
    expect(m.setParam('shaft_1', 'lengthMeters', 1.5)).toBe(true);
    const s = m.devices[0];
    expect(footprint(s).maxZ - footprint(s).minZ).toBeCloseTo(1.5, 9);
    expect(portWorldPosition(s, 'shaft_out')[2] - portWorldPosition(s, 'shaft_in')[2]).toBeCloseTo(1.5, 9);
  });

  it('見本を読み込める（元に戻せる）', () => {
    const m = new EditorModel([], 1);
    m.loadLayout(L, 'test');
    expect(m.devices).toHaveLength(L.length);
    m.undo();
    expect(m.devices).toHaveLength(0);
  });
});

describe('回転を伝える装置（物理あり）', () => {
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

  it('1個目の球で羽根車が 90° 回り、2倍で 180° 伝わって可動橋が下りきる', () => {
    const s = make(L);
    while (s.snapshot().paddles[0].passes === 0 && s.tick < PHYSICS_HZ * 3) s.step();
    expect(s.snapshot().paddles[0].passes).toBe(1);
    for (let i = 0; i < PHYSICS_HZ * 1.5; i++) s.step();
    const sn = s.snapshot();
    expect(sn.bridges[0].input).toBeGreaterThanOrEqual(Math.PI - 1e-9);
    expect(sn.bridges[0].angle).toBe(0);
  });

  it('1個目は橋が下りる前に着いて落ち、2個目以降が橋を渡ってゴールに入る', () => {
    const s = make(L);
    for (let i = 0; i < PHYSICS_HZ * 8; i++) s.step();
    const first = s.readBalls().find((b) => b.id === 0);
    expect(first).toBeDefined(); // 1個目はゴールで回収されていない（床に落ちた）
    expect(first!.position[1]).toBeCloseTo(0.1, 1);
    expect(s.goalHits).toBeGreaterThanOrEqual(4);
  });

  it('可動橋が上がったままなら（軸を外すと）球は渡れない', () => {
    const s = make(L.filter((d) => d.id !== 'shaft_1'));
    for (let i = 0; i < PHYSICS_HZ * 8; i++) s.step();
    expect(s.snapshot().bridges[0].angle).toBeCloseTo(BRIDGE.openRad, 9);
    expect(s.goalHits).toBe(0);
  });

  it('同じ配置なら全tickで一致し、リセットで初期状態に戻る', () => {
    const a = make(L);
    const b = make(L);
    const initial = a.snapshot();
    for (let i = 0; i < PHYSICS_HZ * 5; i++) {
      a.step();
      b.step();
    }
    expect(a.snapshot()).toEqual(b.snapshot());
    a.reset();
    expect(a.snapshot()).toEqual(initial);
  });
});
