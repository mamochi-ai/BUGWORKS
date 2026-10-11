import { describe, expect, it } from 'vitest';
import { FixedStepClock } from '../src/sim/FixedStepClock';
import { PHYSICS_DT, PHYSICS_HZ } from '../src/sim/constants';

describe('FixedStepClock', () => {
  it('物理は120Hz（検証設定JSON由来）', () => {
    expect(PHYSICS_HZ).toBe(120);
    expect(PHYSICS_DT).toBeCloseTo(1 / 120, 12);
  });

  it('60fps描画では1フレーム2tick', () => {
    const c = new FixedStepClock();
    for (let i = 0; i < 100; i++) expect(c.advance(1 / 60).steps).toBe(2);
  });

  it('描画FPSが変わっても1秒あたりのtick数は120', () => {
    for (const fps of [30, 59.94, 60, 90, 120, 144]) {
      const c = new FixedStepClock();
      let total = 0;
      for (let i = 0; i < Math.round(fps * 10); i++) total += c.advance(1 / fps).steps;
      expect(Math.abs(total - 1200)).toBeLessThanOrEqual(1);
    }
  });

  it('補間係数は 0..1', () => {
    const c = new FixedStepClock();
    const r = c.advance(PHYSICS_DT * 1.5);
    expect(r.steps).toBe(1);
    expect(r.alpha).toBeCloseTo(0.5, 6);
  });

  it('長時間停止（タブ復帰等）後も1フレームのtick数は上限内で、捨てた時間を報告する', () => {
    const c = new FixedStepClock(PHYSICS_DT, 16, 0.25);
    const r = c.advance(5);
    expect(r.steps).toBe(16);
    expect(r.droppedSeconds).toBeGreaterThan(4.5);
    expect(c.advance(1 / 60).steps).toBeLessThanOrEqual(3);
  });

  it('速度倍率を反映', () => {
    const c = new FixedStepClock();
    let total = 0;
    for (let i = 0; i < 60; i++) total += c.advance(1 / 60, 0.5).steps;
    expect(total).toBe(60);
  });

  it('不正な経過時間は0として扱う', () => {
    const c = new FixedStepClock();
    expect(c.advance(Number.NaN).steps).toBe(0);
    expect(c.advance(-1).steps).toBe(0);
  });
});
