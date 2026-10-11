import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EditorModel } from '../src/edit/EditorModel';
import { paramValue, stepParam, findSpec, formatParam } from '../src/edit/params';
import { evaluateMove, findConnections, footprint } from '../src/edit/placement';
import { PHYSICS_HZ } from '../src/sim/constants';
import { CURVE, CURVE_LENGTH, curveFrame, curvePorts } from '../src/sim/curveGeometry';
import type { PlacedDevice } from '../src/sim/layout';
import { BALL_RADIUS, RAIL_PROFILE, portWorldPosition } from '../src/sim/railGeometry';
import { loadRapier, type Rapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/Simulation';
import { FLOOR_CHAIN } from './fixtures';

const curve = (turn: 1 | -1, pos: [number, number, number] = [3, 0, 3], rot = 0): PlacedDevice => ({
  id: 'C',
  type: 'curve',
  position: pos,
  rotationYDeg: rot,
  params: { turn },
});

/** 発射機 → rail_1 → rail_2 → カーブ（rail_2 の出口に吸着） */
const withCurve = (turn: 1 | -1): PlacedDevice[] => {
  const base = FLOOR_CHAIN.devices.filter((d) => d.id !== 'rail_3');
  const out = portWorldPosition(base.find((d) => d.id === 'rail_2')!, 'ball_out');
  const ev = evaluateMove(curve(turn), out[0] - turn * -0.5, out[2] + 0.75, base);
  if (!ev.snap) throw new Error('カーブが吸着しない: ' + (ev.connectHint ?? ev.problem));
  return [...base, ev.device];
};

describe('カーブレールの形（物理なし）', () => {
  it('弧の両端がポートと一致し、向きが +Z から ±X へ変わる', () => {
    for (const turn of [1, -1] as const) {
      const [pin, pout] = curvePorts(turn);
      const a = curveFrame(turn, 0);
      const b = curveFrame(turn, 1);
      a.pos.forEach((v, i) => expect(v).toBeCloseTo(pin.position[i], 9));
      b.pos.forEach((v, i) => expect(v).toBeCloseTo(pout.position[i], 9));
      expect(a.tangent[2]).toBeGreaterThan(0.99);
      expect(Math.sign(b.tangent[0])).toBe(turn);
    }
  });

  it('長さと高低差は直線レールとほぼ同じ（約2m・0.2m下り）', () => {
    expect(CURVE_LENGTH).toBeCloseTo(1.963, 3);
    expect(CURVE.inY - CURVE.outY).toBeCloseTo(0.2, 9);
  });

  it('外形は 1.5×1.5m、ポートは 0.25m グリッドに乗る', () => {
    const f = footprint(curve(1, [0, 0, 0]));
    expect(f.maxX - f.minX).toBeCloseTo(1.5, 9);
    for (const p of curvePorts(1)) for (const v of [p.position[0], p.position[2]]) expect((v / 0.25) % 1).toBeCloseTo(0, 9);
  });

  it('直線レールの出口に近づけると吸着し、接続される（左右とも）', () => {
    for (const turn of [1, -1] as const) {
      const ds = withCurve(turn);
      expect(findConnections(ds).map((c) => `${c.from.deviceId}>${c.to.deviceId}`)).toContain('rail_2>C');
    }
  });

  it('曲がる向きは設定で 左／右 を切り替えられ、元に戻せる', () => {
    const m = new EditorModel([curve(1)], 1);
    const spec = findSpec('curve', 'turn')!;
    expect(formatParam(spec, paramValue(m.devices[0], 'turn'))).toBe('左');
    expect(stepParam(spec, 1, -1)).toBe(-1);
    expect(m.setParam('C', 'turn', -1)).toBe(true);
    expect(formatParam(spec, paramValue(m.devices[0], 'turn'))).toBe('右');
    m.undo();
    expect(paramValue(m.devices[0], 'turn')).toBe(1);
  });
});

describe('カーブレール（物理あり）', () => {
  let R: Rapier;
  const sims: Simulation[] = [];
  beforeAll(async () => {
    R = await loadRapier();
  });
  afterEach(() => {
    while (sims.length) sims.pop()!.dispose();
  });

  for (const turn of [1, -1] as const) {
    it(`球はカーブを通って ${turn > 0 ? '左（+X）' : '右（-X）'} へ曲がり、溝から外れず、跳ねない`, () => {
      const devices = withCurve(turn);
      const c = devices.find((d) => d.id === 'C')!;
      const s = new Simulation(R, { seed: 1, devices });
      sims.push(s);
      const out = portWorldPosition(c, 'ball_out');
      let onCurveMaxDev = 0;
      let exited = false;
      for (let i = 0; i < PHYSICS_HZ * 4 && !exited; i++) {
        s.step();
        const b = s.readBalls().find((x) => x.id === 0)!;
        const p = b.position;
        // 中心（ワールド）からの距離が半径±(内幅/2 - 球半径)に収まっていれば溝の中
        const center = [c.position[0] + turn * CURVE.half, c.position[2] - CURVE.half];
        const local = [p[0] - c.position[0], p[2] - c.position[2]];
        const inArcRegion = turn * local[0] < CURVE.half && local[1] > -CURVE.half && turn * (p[0] - center[0]) <= 0 && p[2] - center[1] >= 0;
        if (inArcRegion) {
          const r = Math.hypot(p[0] - center[0], p[2] - center[1]);
          onCurveMaxDev = Math.max(onCurveMaxDev, Math.abs(r - CURVE.radius));
          // 走行面からの浮き
          const t = Math.atan2(p[2] - center[1], -turn * (p[0] - center[0])) / (Math.PI / 2);
          const surfY = c.position[1] + CURVE.inY + (CURVE.outY - CURVE.inY) * Math.min(1, Math.max(0, t));
          expect(p[1] - BALL_RADIUS - surfY).toBeLessThan(0.012);
        }
        if (turn * (p[0] - out[0]) > 0.2) exited = true;
      }
      expect(exited).toBe(true);
      expect(onCurveMaxDev).toBeLessThanOrEqual(RAIL_PROFILE.innerWidth / 2 - BALL_RADIUS + 0.005);
      const v = s.readBalls().find((x) => x.id === 0)!.linvel;
      expect(Math.sign(v[0])).toBe(turn);
      expect(Math.abs(v[0])).toBeGreaterThan(Math.abs(v[2]) * 2);
    });
  }

  it('同じ配置なら全tickで一致する', () => {
    const a = new Simulation(R, { seed: 1, devices: withCurve(1) });
    const b = new Simulation(R, { seed: 1, devices: withCurve(1) });
    sims.push(a, b);
    for (let i = 0; i < PHYSICS_HZ * 4; i++) {
      a.step();
      b.step();
    }
    expect(a.snapshot()).toEqual(b.snapshot());
  });
});
