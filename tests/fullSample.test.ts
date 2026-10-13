import { describe, expect, it } from 'vitest';
import { FULL_SAMPLE_LAYOUT } from '../src/sim/fullSample';
import { PLACEMENT, checkPlacement, findConnections } from '../src/edit/placement';
import { parseBlueprint, toBlueprint } from '../src/blueprint/blueprint';
import { loadRapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/Simulation';
import { PHYSICS_HZ } from '../src/sim/constants';

/** 見本「全部のせ」（D-52）：上限近くまで並べても、置き方・設計図・物理がこわれない */
describe('見本「全部のせ」', () => {
  const d = FULL_SAMPLE_LAYOUT.devices;

  it('上限（100個）以内で上限近く。いろいろな装置を使い、重ならず研究所の中にある', () => {
    expect(d.length).toBeLessThanOrEqual(PLACEMENT.maxDevices);
    expect(d.length).toBeGreaterThanOrEqual(PLACEMENT.maxDevices - 5);
    expect(new Set(d.map((x) => x.type))).toEqual(new Set(['launcher', 'rail', 'paddle', 'switch', 'loop', 'goal', 'magnet']));
    for (const x of d) expect(checkPlacement(x, d.filter((y) => y !== x)).problem, x.id).toBeUndefined();
    expect(new Set(d.map((x) => x.id)).size).toBe(d.length);
  });

  it('各レーンはつながっていて、設計図として書き出して読み直せる', () => {
    // 発射機と9個の部品の 9 個のつながりが 7 本
    expect(findConnections(d).filter((c) => c.type === 'ball')).toHaveLength(63);
    const re = parseBlueprint(JSON.stringify(toBlueprint(d, 404, { title: '全部のせ' })));
    expect(re.ok).toBe(true);
  });

  it('再生すると、7本のレーンすべてでゴールに入り、場外に落ちる球がない', async () => {
    const R = await loadRapier();
    const s = new Simulation(R, { seed: 404, devices: d });
    for (let i = 0; i < PHYSICS_HZ * 10; i++) s.step();
    for (const g of s.snapshot().goals) expect(g.hits, g.deviceId).toBeGreaterThan(0);
    expect(s.lostBalls).toBe(0);
    s.dispose();
  });
});
