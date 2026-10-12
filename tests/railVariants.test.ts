import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EditorModel } from '../src/edit/EditorModel';
import { findConnections, footprint } from '../src/edit/placement';
import { PHYSICS_HZ } from '../src/sim/constants';
import { curveShape, shapePorts } from '../src/sim/curveGeometry';
import type { PlacedDevice } from '../src/sim/layout';
import { localPort, portWorldPosition } from '../src/sim/railGeometry';
import { loadRapier, type Rapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/Simulation';
import type { Vec3 } from '../src/sim/catalog';

const rail = (id: string, pos: Vec3, params?: Record<string, number>, rot = 0): PlacedDevice => ({ id, type: 'rail', position: pos, rotationYDeg: rot, params });
const curve = (id: string, params: Record<string, number>, rot = 0): PlacedDevice => ({ id, type: 'curve', position: [0, 0, 0], rotationYDeg: rot, params });
/** 相手の出口に入口が合う位置へ置く */
const attach = (d: PlacedDevice, prev: PlacedDevice): PlacedDevice => {
  const target = portWorldPosition(prev, 'ball_out');
  const local = portWorldPosition({ ...d, position: [0, 0, 0] }, 'ball_in');
  return { ...d, position: [target[0] - local[0], target[1] - local[1], target[2] - local[2]] };
};
/** 床置きの発射機とレール2本（rail_2 の出口：z=1, 高さ0.35m） */
const HEAD: PlacedDevice[] = [
  { id: 'launcher_1', type: 'launcher', position: [0, 0, -3.65], rotationYDeg: 0 },
  rail('rail_1', [0, 0.4, -2]),
  rail('rail_2', [0, 0.2, 0]),
];
const near = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6;

describe('直線レールの長さと坂（定義・配置）', () => {
  it('長さ 1/2/3m：入口と出口は長さの半分の位置。外形も長さに合わせる', () => {
    for (const L of [1, 2, 3]) {
      const r = rail('R', [0, 0, 0], { lengthMeters: L });
      expect(localPort(r, 'ball_in').position[2]).toBeCloseTo(-L / 2, 9);
      expect(localPort(r, 'ball_out').position[2]).toBeCloseTo(L / 2, 9);
      const f = footprint(r);
      expect(f.maxZ - f.minZ).toBeCloseTo(L, 9);
    }
    // 90°回すと外形も回る
    const f = footprint(rail('R', [0, 0, 0], { lengthMeters: 3 }, 90));
    expect(f.maxX - f.minX).toBeCloseTo(3, 9);
  });

  it('下る高さ 0〜0.6m：入口の高さ＝出口＋下る高さ', () => {
    for (const s of [0, 0.3, 0.6]) {
      const r = rail('R', [0, 0, 0], { slopeMeters: s });
      expect(portWorldPosition(r, 'ball_in')[1] - portWorldPosition(r, 'ball_out')[1]).toBeCloseTo(s, 9);
    }
  });

  it('長さや坂を変えても入口の位置は変わらない（手前とのつながりが保たれる）。元に戻せる', () => {
    const m = new EditorModel(HEAD, 1);
    const before = portWorldPosition(m.devices[2], 'ball_in');
    expect(m.setParam('rail_2', 'lengthMeters', 3)).toBe(true);
    expect(near(portWorldPosition(m.devices[2], 'ball_in'), before)).toBe(true);
    expect(m.setParam('rail_2', 'slopeMeters', 0.4)).toBe(true);
    expect(near(portWorldPosition(m.devices[2], 'ball_in'), before)).toBe(true);
    expect(findConnections(m.devices).map((c) => c.to.deviceId)).toContain('rail_2');
    m.undo();
    m.undo();
    expect(m.devices[2].position).toEqual([0, 0.2, 0]);
  });

  it('床より下になる坂は理由付きで拒否', () => {
    const m = new EditorModel([rail('R', [0, 0.1, 0])], 1);
    expect(m.setParam('R', 'slopeMeters', 0.6)).toBe(false);
    expect(m.message?.text).toContain('床');
  });
});

describe('急なカーブと45°カーブ（定義・配置）', () => {
  it('急なカーブ：外形 1×1m、ポートは 0.25m グリッド', () => {
    const c = curve('C', { radius: 0.75 });
    const f = footprint(c);
    expect(f.maxX - f.minX).toBeCloseTo(1, 9);
    expect(f.maxZ - f.minZ).toBeCloseTo(1, 9);
    for (const p of shapePorts(curveShape(c))) for (const v of [p.position[0], p.position[2]]) expect((v / 0.25) % 1).toBeCloseTo(0, 9);
  });

  for (const radius of [1.25, 0.75]) {
    it(`45°（半径${radius}m）：曲がり始め＋曲がり終わりで 90°カーブと同じ向きに出る。つなぐ位置はグリッド上`, () => {
      const start = attach(curve('S', { radius, arc: 1 }), HEAD[2]);
      const end = attach(curve('E', { radius, arc: 2 }), start);
      for (const v of [end.position[0], end.position[2]]) expect((v / 0.25) % 1).toBeCloseTo(0, 6);
      // 出口は +X 向き（左に 90°）
      expect(localPort(end, 'ball_out').direction).toEqual([1, 0, 0]);
      expect(findConnections([...HEAD, start, end]).map((c) => `${c.from.deviceId}>${c.to.deviceId}`)).toEqual(
        expect.arrayContaining(['rail_2>S', 'S>E']),
      );
    });
  }

  it('45°：左の曲がり始め＋右の曲がり終わり（90°回す）で隣の列へ車線変更できる', () => {
    const start = attach(curve('S', { arc: 1, turn: 1 }), HEAD[2]);
    // 右に曲がる曲がり終わりを回して、斜めの入口を合わせる
    const end = [0, 90, 180, 270]
      .map((rot) => attach(curve('E', { arc: 2, turn: -1 }, rot), start))
      .find((e) => findConnections([start, e]).length === 1)!;
    expect(end).toBeDefined();
    const out = portWorldPosition(end, 'ball_out');
    const dir = localPort(end, 'ball_out').direction;
    // まっすぐ（+Z）に戻り、横にずれている
    const yaw = (end.rotationYDeg * Math.PI) / 180;
    expect(Math.abs(dir[0] * Math.cos(yaw) + dir[2] * Math.sin(yaw))).toBeLessThan(1e-9);
    expect(out[0]).toBeGreaterThan(0.5);
  });

  it('角度・曲がり方を変えても入口の位置は変わらない', () => {
    const c = attach(curve('C', {}), HEAD[2]);
    const m = new EditorModel([...HEAD, c], 1);
    const before = portWorldPosition(c, 'ball_in');
    for (const [k, v] of [['turn', -1], ['radius', 0.75], ['arc', 1]] as const) {
      expect(m.setParam('C', k, v)).toBe(true);
      expect(near(portWorldPosition(m.devices[3], 'ball_in'), before)).toBe(true);
    }
  });
});

describe('新しいレールの物理', () => {
  let R: Rapier;
  const sims: Simulation[] = [];
  beforeAll(async () => {
    R = await loadRapier();
  });
  afterEach(() => {
    while (sims.length) sims.pop()!.dispose();
  });
  /** 最初の球の通り道（0.05秒ごと） */
  const trace = (devices: PlacedDevice[], seconds: number) => {
    const s = new Simulation(R, { seed: 404, devices });
    sims.push(s);
    const path: Vec3[] = [];
    for (let i = 0; i < PHYSICS_HZ * seconds; i++) {
      s.step();
      const b = s.readBalls().find((x) => x.id === 0);
      if (i % 6 === 0 && b) path.push(b.position);
    }
    return { s, path };
  };

  it('坂がきついほど速く下る（0.6m の坂は 0.2m より出口で速い）', () => {
    // 0.6m 下っても床より上に収まるよう、高い位置から始める
    const high: PlacedDevice[] = [
      { id: 'launcher_1', type: 'launcher', position: [0, 0.6, -3.65], rotationYDeg: 0 },
      rail('rail_1', [0, 1.0, -2]),
      rail('rail_2', [0, 0.8, 0]),
    ];
    const speedAtEnd = (slope: number) => {
      const r3 = attach(rail('rail_3', [0, 0, 0], { slopeMeters: slope }), high[2]);
      expect(r3.position[1]).toBeGreaterThanOrEqual(0);
      const s = new Simulation(R, { seed: 404, devices: [...high, r3] });
      sims.push(s);
      const endZ = portWorldPosition(r3, 'ball_out')[2];
      for (let i = 0; i < PHYSICS_HZ * 4; i++) {
        s.step();
        const b = s.readBalls().find((x) => x.id === 0);
        if (b && b.position[2] > endZ - 0.1) return Math.hypot(...b.linvel);
      }
      return 0;
    };
    expect(speedAtEnd(0.6)).toBeGreaterThan(speedAtEnd(0.2) + 0.3);
  });

  it('水平（0m）の 1m レールも勢いで渡りきる', () => {
    const r3 = attach(rail('rail_3', [0, 0, 0], { slopeMeters: 0, lengthMeters: 1 }), HEAD[2]);
    const { path } = trace([...HEAD, r3], 3);
    expect(Math.max(...path.map((p) => p[2]))).toBeGreaterThan(portWorldPosition(r3, 'ball_out')[2]);
  });

  const runsThrough = (pieces: PlacedDevice[]) => {
    const { s, path } = trace([...HEAD, ...pieces], 4);
    const last = pieces[pieces.length - 1];
    const out = portWorldPosition(last, 'ball_out');
    const dir = localPort(last, 'ball_out').direction;
    const yaw = (last.rotationYDeg * Math.PI) / 180;
    const wd: Vec3 = [dir[0] * Math.cos(yaw) + dir[2] * Math.sin(yaw), 0, -dir[0] * Math.sin(yaw) + dir[2] * Math.cos(yaw)];
    // 出口を通り過ぎた（出口から先へ進んだ）点があるか、場外に落ちていないか
    const passed = path.some((p) => (p[0] - out[0]) * wd[0] + (p[2] - out[2]) * wd[2] > 0.2 && Math.abs((p[0] - out[0]) * wd[2] - (p[2] - out[2]) * wd[0]) < 0.4);
    return { passed, lost: s.lostBalls };
  };

  it('急なカーブ（左右）を球が外れずに曲がって出る', () => {
    for (const turn of [1, -1]) {
      const r = runsThrough([attach(curve('C', { radius: 0.75, turn }), HEAD[2])]);
      expect(r.passed).toBe(true);
    }
  });

  it('45°の曲がり始め＋曲がり終わりを球が外れずに通る（90°・車線変更）', () => {
    const start = attach(curve('S', { arc: 1 }), HEAD[2]);
    expect(runsThrough([start, attach(curve('E', { arc: 2 }), start)]).passed).toBe(true);
    const lane = [0, 90, 180, 270].map((rot) => attach(curve('E', { arc: 2, turn: -1 }, rot), start)).find((e) => findConnections([start, e]).length === 1)!;
    expect(runsThrough([start, lane]).passed).toBe(true);
    const sStart = attach(curve('S', { arc: 1, radius: 0.75 }), HEAD[2]);
    expect(runsThrough([sStart, attach(curve('E', { arc: 2, radius: 0.75 }), sStart)]).passed).toBe(true);
  });
});

describe('見本「いろいろなレール」', () => {
  it('全部つながっていて重ならず、球が6秒以内にゴールに入る', async () => {
    const { RAIL_SAMPLE_LAYOUT } = await import('../src/sim/layout');
    const { conflicts } = await import('../src/edit/placement');
    const d = RAIL_SAMPLE_LAYOUT.devices;
    expect(findConnections(d)).toHaveLength(6);
    for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) expect(conflicts(d[i], d[j])).toBe(false);
    const R = await loadRapier();
    const s = new Simulation(R, { seed: 404, devices: [...d] });
    for (let i = 0; i < PHYSICS_HZ * 6; i++) s.step();
    expect(s.firstGoalTick).not.toBeNull();
    expect(s.lostBalls).toBe(0);
    s.dispose();
  });
});
