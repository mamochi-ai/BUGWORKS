import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PHYSICS_HZ } from '../src/sim/constants';
import { LAUNCHER_SHAPE, MAX_BALLS, RELOAD_SECONDS, launcherParams, planLauncher, plungerCompression } from '../src/sim/launcher';
import { VERTICAL_SLICE_LAYOUT, type PlacedDevice } from '../src/sim/layout';
import { BALL_RADIUS, buildRailTrack, portWorldPosition } from '../src/sim/railGeometry';
import { loadRapier, type Rapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/Simulation';

const base = VERTICAL_SLICE_LAYOUT.devices;
const launcher = base.find((d) => d.type === 'launcher')!;
const lone = (params?: Record<string, number>): PlacedDevice => ({ id: 'L', type: 'launcher', position: [0, 0, 0], rotationYDeg: 0, params });

describe('発射機の形と発射の計画（物理なし）', () => {
  it('初期値は devices.v0.1.json（5m/s・45°・1秒）', () => {
    expect(launcherParams(launcher)).toEqual({ launchSpeed: 5, angleDegrees: 45, cooldownSeconds: 1 });
    expect(planLauncher(launcher, base).periodTicks).toBe(PHYSICS_HZ);
  });

  it('溝の走行面は ball_out と同じ高さで、前端が ball_out', () => {
    const out = portWorldPosition(lone(), 'ball_out');
    expect(LAUNCHER_SHAPE.surfaceY).toBeCloseTo(out[1], 9);
    expect(LAUNCHER_SHAPE.frontZ).toBeCloseTo(out[2], 9);
  });

  it('装填位置は押し板を縮めたときの前面に接し、溝の中にある', () => {
    const S = LAUNCHER_SHAPE;
    expect(S.loadZ - BALL_RADIUS).toBeCloseTo(S.plungerRetractedZ, 9);
    expect(S.loadZ + BALL_RADIUS).toBeLessThan(S.frontZ);
    expect(S.plungerExtendedZ).toBeGreaterThan(S.plungerRetractedZ);
  });

  it('溝の向き（前方・水平）に launchSpeed で押し出す。回すと向きも回る', () => {
    expect(planLauncher(launcher, base).velocity).toEqual([0, 0, 5]);
    expect(planLauncher(launcher, base).feedsRailId).toBe('rail_1');
    const d = { ...lone(), rotationYDeg: 90 };
    const v = planLauncher(d, [d]).velocity;
    expect(v[0]).toBeCloseTo(5, 9);
    expect(Math.abs(v[2])).toBeLessThan(1e-9);
  });

  it('押し板：撃つ前は縮んでいて、撃った瞬間に伸び、装填までに縮みきる', () => {
    expect(plungerCompression(null)).toBe(1);
    expect(plungerCompression(0)).toBe(0);
    expect(plungerCompression(Math.round(RELOAD_SECONDS * PHYSICS_HZ))).toBe(1);
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
  const ball = (s: Simulation, id: number) => s.readBalls().find((b) => b.id === id)!;
  beforeAll(async () => {
    R = await loadRapier();
  });
  afterEach(() => {
    while (sims.length) sims.pop()!.dispose();
  });

  it('初期状態で1個目が溝に装填されていて、再生前は止まっている', () => {
    const s = make();
    expect(s.ballCount).toBe(1);
    const p = ball(s, 0).position;
    const load = planLauncher(launcher, base).loadPoint;
    p.forEach((v, i) => expect(v).toBeCloseTo(load[i], 6));
  });

  it('再生した瞬間に押し出され、溝を通ってレールへ転がり込む', () => {
    const s = make();
    s.step();
    expect(ball(s, 0).linvel[2]).toBeGreaterThan(4);
    for (let i = 0; i < PHYSICS_HZ * 0.5; i++) s.step();
    const p = ball(s, 0).position;
    expect(p[2]).toBeGreaterThan(portWorldPosition(launcher, 'ball_out')[2]); // 溝を出てレール上
    expect(Math.abs(p[0])).toBeLessThan(0.06);
  });

  it('溝からレール、レールからレールの継ぎ目で球が跳ねない（走行面から 1cm 以内）', () => {
    const s = make();
    const tracks = base.filter((d) => d.type === 'rail').map(buildRailTrack);
    const surfaceAt = (z: number) => {
      const t = tracks.find((t) => z >= t.start[2] && z <= t.end[2]);
      if (t) return t.start[1] + ((z - t.start[2]) / (t.end[2] - t.start[2])) * (t.end[1] - t.start[1]);
      return z < tracks[0].start[2] ? LAUNCHER_SHAPE.surfaceY : null;
    };
    let worst = 0;
    for (let i = 0; i < PHYSICS_HZ * 2.2; i++) {
      s.step();
      const p = ball(s, 0).position;
      const surf = surfaceAt(p[2]);
      if (surf !== null) worst = Math.max(worst, p[1] - BALL_RADIUS - surf);
    }
    expect(worst).toBeLessThan(0.01);
  });

  it('撃ったあと装填口から次の球が落ちてきて、溝の上で止まり、1秒後に撃たれる', () => {
    const s = make();
    s.step(); // 発射
    const reload = Math.round(RELOAD_SECONDS * PHYSICS_HZ);
    for (let i = 0; i < reload; i++) s.step();
    expect(s.ballCount).toBe(2);
    const load = planLauncher(launcher, base).loadPoint;
    expect(ball(s, 1).position[1]).toBeGreaterThan(load[1] + 0.1); // 上から落ちてくる
    while (s.tick < PHYSICS_HZ) s.step();
    ball(s, 1).position.forEach((v, i) => expect(v).toBeCloseTo(load[i], 1)); // 溝の上で待機
    s.step(); // tick 120 で発射
    expect(ball(s, 1).linvel[2]).toBeGreaterThan(4);
  });

  it(`球は ${MAX_BALLS} 個で止まり、上限で待機中であることがわかる`, () => {
    const s = make();
    for (let i = 0; i < PHYSICS_HZ * (MAX_BALLS + 3); i++) s.step();
    expect(s.ballCount).toBe(MAX_BALLS);
    expect(s.launcherWaiting).toBe('max_balls');
    expect(s.lostBalls).toBe(0);
  });

  it('装填が間に合わない間隔では撃たずに待ち、続けば装填待ちとして知らせる', () => {
    const s = make([lone({ cooldownSeconds: 2 / PHYSICS_HZ, launchSpeed: 0.3 })]);
    for (let i = 0; i < 6; i++) s.step();
    expect(s.ballCount).toBe(1);
    expect(s.launcherWaiting).toBe('loading');
  });

  it('レールにつながっていない発射機の球は前へ飛び出して床に落ちる', () => {
    const s = make([lone()]);
    for (let i = 0; i < PHYSICS_HZ * 1.5; i++) s.step();
    const p = ball(s, 0).position;
    expect(p[2]).toBeGreaterThan(1.5);
    expect(p[1]).toBeLessThan(0.3);
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
