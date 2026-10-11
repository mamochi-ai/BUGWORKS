import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PHYSICS_HZ } from '../src/sim/constants';
import type { PlacedDevice } from '../src/sim/layout';
import { BALL_RADIUS } from '../src/sim/railGeometry';
import { loadRapier, type Rapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/Simulation';
import { EditorModel } from '../src/edit/EditorModel';
import { VERTICAL_SLICE_LAYOUT } from '../src/sim/layout';
import { SPRING_SHAPE, SPRING_TILTS, canCapture, compressionAt, planSpring, springParams } from '../src/sim/spring';

const spring = (z: number, params?: Record<string, number>, rot = 0): PlacedDevice => ({
  id: 'S',
  type: 'spring',
  position: [0, 0, z],
  rotationYDeg: rot,
  params,
});
const launcher: PlacedDevice = { id: 'L', type: 'launcher', position: [0, 0, 0], rotationYDeg: 0 };

describe('バネの計画（物理なし）', () => {
  it('JSON の値（反発 0.85・縮み 0.25m）と、新しい値（打ち上げ 5m/s・傾き 0°）', () => {
    expect(springParams(spring(0))).toEqual({ restitution: 0.85, maxCompression: 0.25, launchSpeed: 5, tiltDegrees: 0 });
    expect(SPRING_TILTS).toEqual([0, 15, 30]);
  });

  it('天板の上面中心は impact ポート、傾けると後ろの辺を軸に前が下がり、法線が前へ傾く', () => {
    const p0 = planSpring(spring(0));
    expect(p0.top).toEqual(SPRING_SHAPE.topCenter);
    expect(p0.normal[1]).toBeCloseTo(1, 9);
    const p30 = planSpring(spring(0, { tiltDegrees: 30 }));
    expect(p30.normal[1]).toBeCloseTo(Math.cos(Math.PI / 6), 9);
    expect(p30.normal[2]).toBeCloseTo(0.5, 9);
    // 後ろの辺（a = -0.3）の高さは傾けても 0.65 のまま
    const backEdgeY = p30.top[1] + p30.along[1] * -SPRING_SHAPE.plateHalf[2];
    expect(backEdgeY).toBeCloseTo(0.65, 9);
    const r90 = planSpring(spring(0, { tiltDegrees: 30 }, 90));
    expect(r90.normal[0]).toBeCloseTo(0.5, 9);
  });

  it('天板の上に乗った球だけを受け止める', () => {
    const p = planSpring(spring(0));
    const on: [number, number, number] = [0.1, 0.65 + BALL_RADIUS + 0.005, -0.1];
    expect(canCapture(p, on, [0, -1, 0], BALL_RADIUS)).toBe(true);
    expect(canCapture(p, [0.35, on[1], 0], [0, -1, 0], BALL_RADIUS)).toBe(false); // 天板の外
    expect(canCapture(p, [0, 0.65 + BALL_RADIUS + 0.1, 0], [0, -1, 0], BALL_RADIUS)).toBe(true); // 天板の上の空間
    expect(canCapture(p, [0, 0.65 + BALL_RADIUS + 0.3, 0], [0, -1, 0], BALL_RADIUS)).toBe(false); // 高すぎる
    expect(canCapture(p, on, [0, 4, 0], BALL_RADIUS)).toBe(false); // 離れていく球（打ち上げ直後など）
  });

  it('縮み：縮む間に 0→0.25m、戻る間に 0.25→0m', () => {
    const p = planSpring(spring(0));
    expect(compressionAt('compress', 0, p)).toBe(0);
    expect(compressionAt('compress', p.compressTicks, p)).toBeCloseTo(0.25, 9);
    expect(compressionAt('recover', 0, p)).toBeCloseTo(0.25, 9);
    expect(compressionAt('recover', p.recoverTicks, p)).toBe(0);
  });
});

describe('バネ（物理あり）', () => {
  let R: Rapier;
  const sims: Simulation[] = [];
  const make = (devices: PlacedDevice[]) => {
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

  /** 発射機の水平な球をバネが受け止め、打ち上げるまでを追う */
  const runShot = (s: Simulation) => {
    let launchedAt = -1;
    let maxY = 0;
    let captured = false;
    for (let i = 0; i < PHYSICS_HZ * 2; i++) {
      s.step();
      const st = s.snapshot().springs[0];
      if (st.heldBallId === 0) captured = true;
      if (launchedAt < 0 && st.launches > 0) launchedAt = s.tick;
      const b = s.readBalls().find((x) => x.id === 0)!;
      if (launchedAt > 0) maxY = Math.max(maxY, b.position[1]);
    }
    return { launchedAt, maxY, captured };
  };

  it('落ちてきた球を受け止めて縮み、真上へ打ち上げる（上の段に届く高さ）', () => {
    const s = make([launcher, spring(1.3)]);
    const r = runShot(s);
    expect(r.captured).toBe(true);
    expect(r.launchedAt).toBeGreaterThan(0);
    // 5m/s で真上 → 天板から約1.27m上。上の段（1m）を越える
    expect(r.maxY).toBeGreaterThan(0.65 + 1.0);
  });

  it('受け止めている間、球は天板と一緒に下がり、縮みきった瞬間に法線の向きへ 5m/s', () => {
    const s = make([launcher, spring(1.3, { tiltDegrees: 30 })]);
    let lowest = 10;
    let vAtLaunch: number[] | null = null;
    for (let i = 0; i < PHYSICS_HZ * 1.5 && !vAtLaunch; i++) {
      s.step();
      const st = s.snapshot().springs[0];
      const b = s.readBalls().find((x) => x.id === 0)!;
      if (st.heldBallId === 0) lowest = Math.min(lowest, b.position[1]);
      if (st.launches > 0) vAtLaunch = b.linvel;
    }
    expect(lowest).toBeLessThan(0.65 + BALL_RADIUS - 0.15); // 0.25m 縮む（傾きのぶん少し浅い）
    expect(vAtLaunch).not.toBeNull();
    // 1tick 分の重力で少し減るだけで、ほぼ (0, 5cos30°, 5sin30°)
    expect(vAtLaunch![1]).toBeCloseTo(5 * Math.cos(Math.PI / 6), 0);
    expect(vAtLaunch![2]).toBeCloseTo(2.5, 0);
  });

  it('傾けると前へ飛ぶ：30°は 0°より遠くに落ちる', () => {
    const landZ = (tilt: number) => {
      const s = make([launcher, spring(1.3, { tiltDegrees: tilt })]);
      for (let i = 0; i < PHYSICS_HZ * 1.6; i++) s.step();
      return s.readBalls().find((x) => x.id === 0)!.position[2];
    };
    expect(landZ(30)).toBeGreaterThan(landZ(0) + 0.8);
  });

  it('戻っている間に落ちてきた球は受け止めず、反発係数で跳ね返る', () => {
    const s = make([launcher, spring(1.3)]);
    let sawRecoverWithBallBounce = false;
    for (let i = 0; i < PHYSICS_HZ * 6; i++) {
      s.step();
      const st = s.snapshot().springs[0];
      if (st.phase === 'recover' && st.heldBallId === null) sawRecoverWithBallBounce = true;
    }
    expect(sawRecoverWithBallBounce).toBe(true);
    expect(s.snapshot().springs[0].launches).toBeGreaterThan(1);
  });

  it('同じ配置なら全tickで一致し、リセットで初期状態に戻る', () => {
    const a = make([launcher, spring(1.3, { tiltDegrees: 15 })]);
    const b = make([launcher, spring(1.3, { tiltDegrees: 15 })]);
    const initial = a.snapshot();
    for (let i = 0; i < PHYSICS_HZ * 5; i++) {
      a.step();
      b.step();
    }
    expect(a.snapshot()).toEqual(b.snapshot());
    a.reset();
    expect(a.snapshot()).toEqual(initial);
  });

  it('最初の配置：レールを下りた球はバネに落ち、打ち上げられて上の段（床から1.5m）より高く上がる。毎秒1回', () => {
    const s = make(VERTICAL_SLICE_LAYOUT.devices);
    let maxY = 0;
    for (let i = 0; i < PHYSICS_HZ * 6; i++) {
      s.step();
      const b = s.readBalls().find((x) => x.id === 0)!;
      if (s.snapshot().springs[0].launches > 0) maxY = Math.max(maxY, b.position[1]);
    }
    expect(maxY).toBeGreaterThan(1.5);
    expect(s.snapshot().springs[0].launches).toBeGreaterThanOrEqual(4);
    expect(s.lostBalls).toBe(0);
  });
});

describe('バネの編集', () => {
  it('傾きを変えられ、元に戻せる', () => {
    const m = new EditorModel([spring(0)], 1);
    expect(m.setParam('S', 'tiltDegrees', 30)).toBe(true);
    expect(springParams(m.devices[0]).tiltDegrees).toBe(30);
    expect(m.message?.text).toContain('天板の傾き');
    m.undo();
    expect(springParams(m.devices[0]).tiltDegrees).toBe(0);
  });

  it('パレットから追加でき、他の装置と重ならない場所に置かれる', () => {
    const m = new EditorModel(VERTICAL_SLICE_LAYOUT.devices, 1);
    const id = m.addDevice('spring', 0, 3.5)!;
    expect(id).toBe('spring_2');
    const d = m.devices.find((x) => x.id === id)!;
    expect(d.position[2] === 3.5 && d.position[0] === 0).toBe(false);
  });
});
