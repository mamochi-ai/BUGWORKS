import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EditorModel } from '../src/edit/EditorModel';
import { conflicts, findConnections, footprint } from '../src/edit/placement';
import { PHYSICS_HZ } from '../src/sim/constants';
import { LOOP_SAMPLE_LAYOUT, type PlacedDevice } from '../src/sim/layout';
import { LOOP, loopFrame } from '../src/sim/loopGeometry';
import { buildRailTrack, localPort, portWorldPosition } from '../src/sim/railGeometry';
import { loadRapier, type Rapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/Simulation';

const byId = (id: string) => LOOP_SAMPLE_LAYOUT.devices.find((d) => d.id === id)!;
describe('上り坂・斜めの直線レール・ループ（定義と配置）', () => {
  it('上り坂：下る高さをマイナスにすると、入口が出口より低い', () => {
    const r: PlacedDevice = { id: 'R', type: 'rail', position: [0, 0.5, 0], rotationYDeg: 0, params: { slopeMeters: -0.3 } };
    expect(portWorldPosition(r, 'ball_out')[1] - portWorldPosition(r, 'ball_in')[1]).toBeCloseTo(0.3, 9);
    expect(buildRailTrack(r).dir[1]).toBeGreaterThan(0);
  });

  it('斜めの直線レール：入口・出口が 45°の向き。外形は斜めの長方形を囲む箱', () => {
    const r: PlacedDevice = { id: 'R', type: 'rail', position: [0, 0, 0], rotationYDeg: 0, params: { lengthMeters: 2, lean: 1 } };
    const out = localPort(r, 'ball_out');
    expect(out.direction[0]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(out.direction[2]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(out.position[0]).toBeCloseTo(Math.SQRT1_2, 9);
    const f = footprint(r);
    expect(f.maxX - f.minX).toBeCloseTo(f.maxZ - f.minZ, 9);
    expect(f.maxX - f.minX).toBeGreaterThan(Math.SQRT2);
    // 右に傾けると逆向き
    expect(localPort({ ...r, params: { lean: -1 } }, 'ball_out').direction[0]).toBeLessThan(0);
  });

  it('斜めのレールは 45°の曲がり始めと曲がり終わりにつながる（見本）', () => {
    const c = findConnections(LOOP_SAMPLE_LAYOUT.devices).map((x) => `${x.from.deviceId}>${x.to.deviceId}`);
    expect(c).toEqual(expect.arrayContaining(['curve_1>rail_4', 'rail_4>curve_2', 'rail_2>loop_1', 'loop_1>rail_3']));
  });

  it('向き（まっすぐ／斜め）を変えても入口は動かない。元に戻せる', () => {
    const r: PlacedDevice = { id: 'R', type: 'rail', position: [0, 0.5, 0], rotationYDeg: 0 };
    const m = new EditorModel([r], 1);
    const before = portWorldPosition(r, 'ball_in');
    expect(m.setParam('R', 'lean', -1)).toBe(true);
    const after = portWorldPosition(m.devices[0], 'ball_in');
    for (let i = 0; i < 3; i++) expect(after[i]).toBeCloseTo(before[i], 9);
    m.undo();
    expect(m.devices[0].params?.lean).toBeUndefined();
  });

  it('ループ：入口から縦に1周し、横に0.5mずれた所から出る。てっぺんでは走行面が下を向く', () => {
    const top = loopFrame(0.5, 0.5);
    expect(top.pos[1]).toBeCloseTo(LOOP.inY - LOOP.drop / 2 + 1, 9);
    expect(top.normal[1]).toBeLessThan(-0.99);
    const end = loopFrame(0.5, 1);
    expect(end.pos[0]).toBeCloseTo(LOOP.shift, 9);
    expect(end.pos[2]).toBeCloseTo(0, 9);
    const lp: PlacedDevice = { id: 'L', type: 'loop', position: [0, 0, 0], rotationYDeg: 0, params: { radius: 0.5 } };
    expect(footprint(lp).maxY).toBeGreaterThan(1.3);
  });

  it('見本は重ならない', () => {
    const d = LOOP_SAMPLE_LAYOUT.devices;
    for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) expect(conflicts(d[i], d[j])).toBe(false);
  });
});

describe('上り坂・斜めの直線レール・ループ（物理）', () => {
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

  it('見本：ループを1周し、上り坂と斜めのレールを通って7秒以内にゴール', () => {
    const s = run(LOOP_SAMPLE_LAYOUT.devices, 7);
    expect(s.firstGoalTick).not.toBeNull();
    expect(s.lostBalls).toBe(0);
  });

  it('球はループのてっぺん（裏側の半分の上）を通る', () => {
    const s = new Simulation(R, { seed: 404, devices: [...LOOP_SAMPLE_LAYOUT.devices] });
    sims.push(s);
    const lp = byId('loop_1');
    let backTop = false;
    for (let i = 0; i < PHYSICS_HZ * 4; i++) {
      s.step();
      const b = s.readBalls().find((x) => x.id === 0);
      if (b && b.position[1] > lp.position[1] + LOOP.inY + 0.5 && b.position[2] < lp.position[2] - 0.1) backTop = true;
    }
    expect(backTop).toBe(true);
  });

  it('勢いが足りないと：上り坂 0.4m は上りきれない', () => {
    // 上り坂を 0.4m にし、ループの出口とつながるよう、上り坂から先を 0.3m 上げる
    const steep = LOOP_SAMPLE_LAYOUT.devices.map((d) =>
      d.id === 'rail_3'
        ? { ...d, position: [d.position[0], d.position[1] + 0.3, d.position[2]] as PlacedDevice['position'], params: { ...d.params, slopeMeters: -0.4 } }
        : ['curve_1', 'rail_4', 'curve_2'].includes(d.id)
          ? { ...d, position: [d.position[0], d.position[1] + 0.3, d.position[2]] as PlacedDevice['position'] }
          : d,
    );
    expect(findConnections(steep)).toHaveLength(7);
    expect(run(steep, 7).goalHits).toBe(0);
  });

  it('勢いが足りないと：ループのてっぺんまで届かずに戻る', () => {
    // 床置きの発射機（ゆっくり）→ 平らなレール → ループ
    const devices: PlacedDevice[] = [
      { id: 'launcher_1', type: 'launcher', position: [0, 0, -3.65], rotationYDeg: 0, params: { launchSpeed: 3 } },
      { id: 'rail_1', type: 'rail', position: [0, 0.6, -2], rotationYDeg: 0, params: { slopeMeters: 0 } },
    ];
    const outR1 = portWorldPosition(devices[1], 'ball_out');
    devices.push({ id: 'loop_1', type: 'loop', position: [outR1[0], outR1[1] - LOOP.inY, outR1[2]], rotationYDeg: 0, params: { radius: 0.5 } });
    expect(findConnections(devices)).toHaveLength(2);
    const s = new Simulation(R, { seed: 404, devices });
    sims.push(s);
    const lp = devices[2];
    let backTop = false;
    for (let i = 0; i < PHYSICS_HZ * 4; i++) {
      s.step();
      const b = s.readBalls().find((x) => x.id === 0);
      if (b && b.position[1] > lp.position[1] + LOOP.inY + 0.5 && b.position[2] < lp.position[2] - 0.1) backTop = true;
    }
    expect(backTop).toBe(false);
  });

  it('同じ配置なら毎回同じ動き（決定論）', () => {
    const a = run(LOOP_SAMPLE_LAYOUT.devices, 5).snapshot();
    expect(run(LOOP_SAMPLE_LAYOUT.devices, 5).snapshot()).toEqual(a);
  });
});
