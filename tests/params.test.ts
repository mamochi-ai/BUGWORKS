import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EditorModel } from '../src/edit/EditorModel';
import { PARAM_SPECS, findSpec, formatParam, normalizeParam, paramValue } from '../src/edit/params';
import { PHYSICS_HZ } from '../src/sim/constants';
import { planLauncher } from '../src/sim/launcher';
import type { PlacedDevice } from '../src/sim/layout';
import { loadRapier, type Rapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/Simulation';
import { FLOOR_CHAIN } from './fixtures';

const launcher: PlacedDevice = { id: 'L', type: 'launcher', position: [0, 0, 0], rotationYDeg: 0 };
const spring = (params?: Record<string, number>): PlacedDevice => ({ id: 'S', type: 'spring', position: [0, 0, 1.3], rotationYDeg: 0, params });

describe('設定の定義', () => {
  it('発射機は 速さ・角度・間隔、バネは 打ち上げの速さ・天板の傾き', () => {
    expect(PARAM_SPECS.launcher.map((s) => s.key)).toEqual(['launchSpeed', 'angleDegrees', 'cooldownSeconds']);
    expect(PARAM_SPECS.spring.map((s) => s.key)).toEqual(['launchSpeed', 'tiltDegrees']);
    expect(PARAM_SPECS.rail).toEqual([]);
  });

  it('既定値はどれも範囲内で刻みに合っている', () => {
    for (const d of [launcher, spring()]) {
      for (const spec of PARAM_SPECS[d.type]) {
        const v = paramValue(d, spec.key);
        expect(normalizeParam(spec, v)).toBe(v);
      }
    }
  });

  it('範囲外・刻み外・不正な値は丸める', () => {
    const speed = findSpec('launcher', 'launchSpeed')!;
    expect(normalizeParam(speed, 100)).toBe(8);
    expect(normalizeParam(speed, -3)).toBe(2);
    expect(normalizeParam(speed, 5.3)).toBe(5.5);
    expect(normalizeParam(speed, Number.NaN)).toBe(2);
    expect(normalizeParam(findSpec('spring', 'tiltDegrees')!, 22)).toBe(15);
    expect(formatParam(speed, 5)).toBe('5.0m/s');
    expect(formatParam(findSpec('launcher', 'angleDegrees')!, 45)).toBe('45°');
  });
});

describe('設定の変更（EditorModel）', () => {
  it('変更・丸め・元に戻す', () => {
    const m = new EditorModel([launcher], 1);
    expect(m.setParam('L', 'launchSpeed', 9)).toBe(true);
    expect(paramValue(m.devices[0], 'launchSpeed')).toBe(8);
    expect(m.message?.text).toContain('速さを 8.0m/s');
    m.undo();
    expect(paramValue(m.devices[0], 'launchSpeed')).toBe(5);
  });

  it('同じ値なら変更なし、その装置に無い設定は拒否', () => {
    const m = new EditorModel([launcher], 1);
    expect(m.setParam('L', 'launchSpeed', 5)).toBe(false);
    expect(m.canUndo).toBe(false);
    expect(m.setParam('L', 'tiltDegrees', 15)).toBe(false);
    expect(m.message?.kind).toBe('error');
  });

  it('発射機の角度：レールにつないでいる間は溝が水平（設定値は残る）', () => {
    const m = new EditorModel(FLOOR_CHAIN.devices, 1);
    m.setParam('launcher_1', 'angleDegrees', 60);
    const l = m.devices.find((d) => d.id === 'launcher_1')!;
    expect(paramValue(l, 'angleDegrees')).toBe(60);
    expect(planLauncher(l, m.devices).angle).toBe(0);
    m.remove('rail_1');
    expect(planLauncher(l, m.devices).angle).toBeCloseTo(Math.PI / 3, 9);
  });
});

describe('設定が動きに効く（物理）', () => {
  let R: Rapier;
  const sims: Simulation[] = [];
  beforeAll(async () => {
    R = await loadRapier();
  });
  afterEach(() => {
    while (sims.length) sims.pop()!.dispose();
  });
  const peakAfterSpring = (springSpeed: number) => {
    const s = new Simulation(R, { seed: 1, devices: [{ ...launcher, params: { angleDegrees: 0 } }, spring({ launchSpeed: springSpeed })] });
    sims.push(s);
    let maxY = 0;
    for (let i = 0; i < PHYSICS_HZ * 2; i++) {
      s.step();
      if (s.snapshot().springs[0].launches > 0) maxY = Math.max(maxY, s.readBalls().find((b) => b.id === 0)!.position[1]);
    }
    return maxY;
  };

  it('バネの打ち上げの速さを上げると高く上がる', () => {
    const low = peakAfterSpring(3);
    const high = peakAfterSpring(7);
    expect(high).toBeGreaterThan(low + 1);
  });

  it('発射機の速さを上げると遠くまで飛ぶ（水平の溝）', () => {
    const land = (speed: number) => {
      const s = new Simulation(R, { seed: 1, devices: [{ ...launcher, params: { angleDegrees: 0, launchSpeed: speed } }] });
      sims.push(s);
      for (let i = 0; i < PHYSICS_HZ * 0.6; i++) s.step();
      return s.readBalls().find((b) => b.id === 0)!.position[2];
    };
    expect(land(8)).toBeGreaterThan(land(3) + 1);
  });
});
