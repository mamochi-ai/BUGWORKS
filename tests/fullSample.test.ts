import { describe, expect, it } from 'vitest';
import { FULL_SAMPLE_LAYOUT } from '../src/sim/fullSample';
import { PLACEMENT, checkPlacement, findConnections } from '../src/edit/placement';
import { parseBlueprint, toBlueprint } from '../src/blueprint/blueprint';
import { loadRapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/Simulation';
import { PHYSICS_HZ } from '../src/sim/constants';

/** 見本「全部のせ」（D-52）：発射機1台・ゴール1つの一本道に、全種類の装置を上限近くまで並べても、こわれない */
describe('見本「全部のせ」', () => {
  const d = FULL_SAMPLE_LAYOUT.devices;
  const count = (t: string) => d.filter((x) => x.type === t).length;
  const params = (t: string, k: string) => new Set(d.filter((x) => x.type === t).map((x) => x.params?.[k]));

  it('上限（100個）以内で上限近く。発射機とゴールは1つずつで、全種類の装置と設定の違いを使う', () => {
    expect(d.length).toBeLessThanOrEqual(PLACEMENT.maxDevices);
    expect(d.length).toBeGreaterThanOrEqual(90);
    expect(count('launcher')).toBe(1);
    expect(count('goal')).toBe(1);
    expect(new Set(d.map((x) => x.type))).toEqual(
      new Set(['launcher', 'rail', 'curve', 'loop', 'paddle', 'gearbox', 'shaft', 'bridge', 'switch', 'magnet', 'rotator', 'spring', 'platform', 'goal']),
    );
    expect(params('loop', 'radius')).toEqual(new Set([0.35, 0.5]));
    expect(params('rail', 'lengthMeters')).toEqual(new Set([1, 2, 3]));
    expect([...params('rail', 'slopeMeters')].some((v) => (v ?? 0) < 0)).toBe(true); // 上り坂
    expect(d.some((x) => x.type === 'rail' && x.params?.lean)).toBe(true); // 斜め
    expect(params('curve', 'arc')).toEqual(new Set([0, 1, 2]));
    expect(params('curve', 'turn')).toEqual(new Set([1, -1]));
    expect(params('rotator', 'direction')).toEqual(new Set([1, -1]));
    expect(params('magnet', 'mode')).toEqual(new Set([1, -1]));
    expect(params('gearbox', 'gearRatio').size).toBeGreaterThanOrEqual(3);
  });

  it('重ならず研究所の中にあり、発射機からゴールの手前まで一本につながっている。設計図として読み直せる', () => {
    for (const x of d) expect(checkPlacement(x, d.filter((y) => y !== x)).problem, x.id).toBeUndefined();
    expect(new Set(d.map((x) => x.id)).size).toBe(d.length);
    const ball = findConnections(d).filter((c) => c.type === 'ball');
    const next = new Map(ball.map((c) => [c.from.deviceId, c.to.deviceId]));
    let at = 'launcher_1';
    let steps = 0;
    while (next.has(at) && steps < 200) {
      at = next.get(at)!;
      steps++;
    }
    const onPath = ['rail', 'curve', 'loop', 'paddle', 'bridge', 'switch', 'rotator'].reduce((n, t) => n + count(t), 0);
    expect(steps).toBe(onPath); // 道の上の装置をすべて通る
    expect(findConnections(d).filter((c) => c.type === 'shaft').length).toBeGreaterThanOrEqual(6);
    expect(parseBlueprint(JSON.stringify(toBlueprint(d, 404, { title: '全部のせ' }))).ok).toBe(true);
  });

  it('再生すると、球が最後まで通ってゴールに入る（場外に落ちる球はない）', async () => {
    const R = await loadRapier();
    const s = new Simulation(R, { seed: 404, devices: d });
    for (let i = 0; i < PHYSICS_HZ * 100 && s.goalHits < 2; i++) s.step();
    expect(s.goalHits).toBeGreaterThanOrEqual(2);
    expect(s.lostBalls).toBe(0);
    s.dispose();
  }, 120_000);
});
