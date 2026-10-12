import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BUG_TUNING, IMPLEMENTED_BUGS, facingRepelPairs, wornFrictionFactor } from '../src/sim/bugs';
import { PHYSICS_HZ } from '../src/sim/constants';
import type { PlacedDevice } from '../src/sim/layout';
import { loadRapier, type Rapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/Simulation';
import { FLOOR_CHAIN } from './fixtures';

/**
 * 隠しバグ（D-37）。発動の条件そのものは開発用資料（リポジトリ外）に従う。
 * ここでは「起きる配置では決まった時に起き、起きない配置では起きない」ことと、効果・決定論を確かめる。
 */
const launcherEvery = (sec: number): PlacedDevice[] => FLOOR_CHAIN.devices.map((d) => (d.type === 'launcher' ? { ...d, params: { cooldownSeconds: sec } } : d));
const withGoal: PlacedDevice[] = [...FLOOR_CHAIN.devices, { id: 'goal_1', type: 'goal', position: [0, 0, 3.75], rotationYDeg: 0 }];
const magnetsAt = (z: number, mode = -1): PlacedDevice[] => [
  { id: 'launcher_1', type: 'launcher', position: [0, 0, -3.65], rotationYDeg: 0, params: { cooldownSeconds: 3 } },
  { id: 'rail_1', type: 'rail', position: [0, 0.4, -2], rotationYDeg: 0 },
  { id: 'rail_2', type: 'rail', position: [0, 0.2, 0], rotationYDeg: 0 },
  { id: 'magnet_1', type: 'magnet', position: [-1.5, 0, z], rotationYDeg: 90, params: { mode } },
  { id: 'magnet_2', type: 'magnet', position: [1.5, 0, z], rotationYDeg: 270, params: { mode } },
  { id: 'platform_1', type: 'platform', position: [0, 0, z + 1.1], rotationYDeg: 0, params: { heightMeters: 0.4 } },
];

describe('隠しバグ（定義）', () => {
  it('まず3種（マスター仕様 §10 手順3）', () => {
    expect(IMPLEMENTED_BUGS).toEqual(['BUG-12', 'BUG-16', 'BUG-18']);
  });

  it('向かい合う磁石の組は「しりぞける」同士で、向きが合うときだけ', () => {
    expect(facingRepelPairs(magnetsAt(2).filter((d) => d.type === 'magnet'))).toHaveLength(1);
    expect(facingRepelPairs(magnetsAt(2, 1).filter((d) => d.type === 'magnet'))).toHaveLength(0);
    const turned = magnetsAt(2).filter((d) => d.type === 'magnet').map((d) => (d.id === 'magnet_2' ? { ...d, rotationYDeg: 0 } : d));
    expect(facingRepelPairs(turned)).toHaveLength(0);
  });

  it('摩擦は段階的に下がり、最後は 0（下限）', () => {
    expect(wornFrictionFactor(BUG_TUNING.passesToTrigger - 1)).toBe(1);
    expect(wornFrictionFactor(BUG_TUNING.passesToTrigger)).toBeLessThan(1);
    expect(wornFrictionFactor(BUG_TUNING.passesToTrigger + 5)).toBeLessThan(wornFrictionFactor(BUG_TUNING.passesToTrigger));
    expect(wornFrictionFactor(200)).toBe(0);
  });
});

describe('隠しバグ（物理）', () => {
  let R: Rapier;
  const sims: Simulation[] = [];
  beforeAll(async () => {
    R = await loadRapier();
  });
  afterEach(() => {
    while (sims.length) sims.pop()!.dispose();
  });
  const run = (devices: PlacedDevice[], seconds: number) => {
    const s = new Simulation(R, { seed: 404, devices });
    sims.push(s);
    for (let i = 0; i < PHYSICS_HZ * seconds; i++) s.step();
    return s;
  };
  const ids = (s: Simulation) => s.bugEvents().map((b) => b.id);

  it('BUG-12：起きる配置で起き、効果で球が動き出す。起きるまでの時間は決まっている', () => {
    const s = run(launcherEvery(60), 16);
    const ev = s.bugEvents().find((b) => b.id === 'BUG-12');
    expect(ev).toBeDefined();
    expect(ev!.tick).toBeGreaterThanOrEqual(BUG_TUNING.stillSeconds * PHYSICS_HZ);
    // 発動した場所（縁石の手前）から、部屋の中央へ滑り出している
    const ball = s.readBalls().find((b) => b.id === 0)!;
    expect(ball.position[2]).toBeLessThan(ev!.at[2] - 0.5);
  });

  it('BUG-12：球が次々に来て止まらない配置では、同じ時間では起きない', () => {
    expect(ids(run(launcherEvery(1), 16))).not.toContain('BUG-12');
  });

  it('BUG-16：向かい合う「しりぞける」磁石の間で起き、その後は磁石が球を引きよせる', () => {
    const s = run(magnetsAt(2.2), 12);
    expect(ids(s)).toContain('BUG-16');
    const near = s.readBalls().filter((b) => Math.abs(b.position[2] - 2.2) < 1);
    expect(near.some((b) => Math.abs(b.position[0]) > 0.8)).toBe(true); // 磁石の前まで引きよせられた球がある（しりぞけるままなら中央に押し戻される）
    // 「引きよせる」磁石の組では起きない
    expect(ids(run(magnetsAt(2.2, 1), 8))).not.toContain('BUG-16');
  });

  it('BUG-18：球がたくさん通ったレールで起きる（それまでは起きない）', () => {
    const early = run(withGoal, 15);
    expect(ids(early)).not.toContain('BUG-18');
    const s = run(withGoal, 22);
    expect(ids(s)).toContain('BUG-18');
  });

  it('同じ配置なら毎回同じ tick で起きる（決定論）。リセットで記録が消える', () => {
    const a = run(launcherEvery(60), 14).bugEvents();
    const s = run(launcherEvery(60), 14);
    expect(s.bugEvents()).toEqual(a);
    s.reset();
    expect(s.bugEvents()).toEqual([]);
    for (let i = 0; i < PHYSICS_HZ * 14; i++) s.step();
    expect(s.bugEvents()).toEqual(a);
  });
});

describe('バグ図鑑（記録と一覧）', () => {
  it('40種の一覧。名前と説明を持つのは実装した3種だけ（未実装の内容は配信物に入れない）', async () => {
    const { CODEX } = await import('../src/bugs/codexData');
    expect(CODEX).toHaveLength(40);
    expect(CODEX.filter((c) => c.name).map((c) => c.id)).toEqual([...IMPLEMENTED_BUGS]);
  });

  it('発見を記録する（初めてのときだけ true）。壊れたデータや変なIDは無視', async () => {
    const { loadCodex, recordDiscovery } = await import('../src/bugs/codex');
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(recordDiscovery('BUG-12', new Date(0), s)).toBe(true);
    expect(recordDiscovery('BUG-12', new Date(1), s)).toBe(false);
    expect(Object.keys(loadCodex(s).discovered)).toEqual(['BUG-12']);
    m.set('bugworks.codex.v1', JSON.stringify({ discovered: { 'BUG-12': 'x', hack: 'y', 'BUG-16': 3 } }));
    expect(loadCodex(s).discovered).toEqual({ 'BUG-12': 'x' });
    m.set('bugworks.codex.v1', '{bad');
    expect(loadCodex(s).discovered).toEqual({});
  });
});
