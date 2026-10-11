import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PHYSICS_HZ } from '../src/sim/constants';
import { VERTICAL_SLICE_LAYOUT } from '../src/sim/layout';
import { BALL_RADIUS, RAIL_PROFILE } from '../src/sim/railGeometry';
import { loadRapier, type Rapier } from '../src/sim/rapier';
import { Simulation, type SimSnapshot } from '../src/sim/Simulation';
import { SimulationController } from '../src/sim/SimulationController';

let R: Rapier;
const sims: Simulation[] = [];
const make = () => {
  const s = new Simulation(R, VERTICAL_SLICE_LAYOUT);
  sims.push(s);
  return s;
};
const run = (s: Simulation, ticks: number): SimSnapshot[] => {
  const out: SimSnapshot[] = [];
  for (let i = 0; i < ticks; i++) {
    s.step();
    out.push(s.snapshot());
  }
  return out;
};

beforeAll(async () => {
  R = await loadRapier();
});
afterEach(() => {
  while (sims.length) sims.pop()!.dispose();
});

describe('Simulation（ヘッドレス）', () => {
  it('同一レイアウトから2回走らせると全tickで状態がビット一致する（同一プロセス内）', () => {
    const a = run(make(), PHYSICS_HZ * 6);
    const b = run(make(), PHYSICS_HZ * 6);
    expect(b).toEqual(a);
  });

  it('リセット後の再生は初回と一致する', () => {
    const s = make();
    const first = run(s, PHYSICS_HZ * 4);
    s.reset();
    expect(s.tick).toBe(0);
    const second = run(s, PHYSICS_HZ * 4);
    expect(second).toEqual(first);
  });

  it('途中でリセットしても初期状態に戻る', () => {
    const s = make();
    const initial = s.snapshot();
    run(s, 137);
    s.reset();
    expect(s.snapshot()).toEqual(initial);
  });

  it('最初の球はレール上を +Z 方向へ進み、レール幅からはみ出さない', () => {
    const s = make();
    s.step();
    const first = () => s.readBalls().find((b) => b.id === 0)!;
    const z0 = first().position[2];
    const maxX = RAIL_PROFILE.innerWidth / 2 - BALL_RADIUS + 1e-3;
    const last = s.tracks[s.tracks.length - 1];
    let leftRailAt = -1;
    for (let i = 0; i < PHYSICS_HZ * 8; i++) {
      s.step();
      const p = first().position;
      if (leftRailAt < 0 && p[2] > last.end[2]) leftRailAt = s.tick;
      if (leftRailAt < 0) expect(Math.abs(p[0])).toBeLessThanOrEqual(maxX);
    }
    expect(leftRailAt).toBeGreaterThan(0);
    // 発射速度 5m/s で 6m のレールを 1〜3 秒で抜ける（極端に速い/遅い挙動の検出）
    expect(leftRailAt / PHYSICS_HZ).toBeGreaterThan(0.8);
    expect(leftRailAt / PHYSICS_HZ).toBeLessThan(3);
    expect(first().position[2]).toBeGreaterThan(z0 + 6);
  });

  it('レールを出た鉄球は研究所の床に降り、場外に落ちない', () => {
    const s = make();
    run(s, PHYSICS_HZ * 20);
    expect(s.lostBalls).toBe(0);
    const first = s.readBalls().find((b) => b.id === 0)!;
    expect(first.position[1]).toBeCloseTo(BALL_RADIUS, 1);
    for (const b of s.readBalls()) {
      expect(Math.abs(b.position[0])).toBeLessThan(6);
      expect(Math.abs(b.position[2])).toBeLessThan(6);
    }
  });

  it('値はすべて有限（NaN/Infinityなし）', () => {
    const s = make();
    for (const snap of run(s, PHYSICS_HZ * 10)) {
      for (const b of snap.balls) {
        for (const v of [...b.position, ...b.linvel, ...b.angvel, ...b.rotation]) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});

describe('SimulationController（再生/一時停止/リセット）', () => {
  it('初期状態では時間が進まない', () => {
    const c = new SimulationController(make());
    c.frame(1);
    expect(c.sim.tick).toBe(0);
    expect(c.state).toBe('ready');
  });

  it('再生中は経過時間に応じて進み、一時停止で止まる', () => {
    const c = new SimulationController(make());
    c.play();
    for (let i = 0; i < 60; i++) c.frame(1 / 60);
    expect(c.sim.tick).toBe(120);
    c.pause();
    c.frame(1);
    expect(c.sim.tick).toBe(120);
    expect(c.state).toBe('paused');
  });

  it('1ステップ実行は1tickだけ進め、一時停止になる', () => {
    const c = new SimulationController(make());
    c.stepOnce();
    c.stepOnce();
    expect(c.sim.tick).toBe(2);
    expect(c.state).toBe('paused');
  });

  it('描画FPSが違っても同じtick数なら同じ状態になる（描画と物理の分離）', () => {
    const a = new SimulationController(make());
    const b = new SimulationController(make());
    a.play();
    b.play();
    for (let i = 0; i < 30 * 3; i++) a.frame(1 / 30);
    for (let i = 0; i < 144 * 3; i++) b.frame(1 / 144);
    expect(Math.abs(a.sim.tick - b.sim.tick)).toBeLessThanOrEqual(1);
    const n = Math.min(a.sim.tick, b.sim.tick);
    const ref = make();
    run(ref, n);
    const pick = a.sim.tick === n ? a.sim : b.sim;
    expect(pick.snapshot()).toEqual(ref.snapshot());
  });

  it('再生→停止→リセットを繰り返しても状態が破綻しない', () => {
    const c = new SimulationController(make());
    const initial = c.sim.snapshot();
    for (let k = 0; k < 20; k++) {
      c.play();
      for (let i = 0; i < 7 + k; i++) c.frame(1 / 60);
      c.pause();
      c.reset();
      expect(c.state).toBe('ready');
      expect(c.sim.snapshot()).toEqual(initial);
    }
  });
});
