import { describe, expect, it } from 'vitest';
import { mergeLayouts, nextNamespace, renameWithNamespace } from '../src/blueprint/merge';
import { conflicts, findConnections } from '../src/edit/placement';
import { MAGNET_SAMPLE_LAYOUT, SWITCH_SAMPLE_LAYOUT, type PlacedDevice } from '../src/sim/layout';
import { portWorldPosition } from '../src/sim/railGeometry';
import { FLOOR_CHAIN } from './fixtures';

const noConflicts = (d: readonly PlacedDevice[]) => {
  for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) expect(conflicts(d[i], d[j]), `${d[i].id} x ${d[j].id}`).toBe(false);
};

describe('設計図の連結（D-38）', () => {
  it('名前空間：使われていない b2, b3, … を選ぶ', () => {
    expect(nextNamespace([])).toBe('b2');
    expect(nextNamespace([{ id: 'b2_rail_1', type: 'rail', position: [0, 0, 0], rotationYDeg: 0 }])).toBe('b3');
  });

  it('ID を振り直し、スイッチの配線も付け替える', () => {
    const r = renameWithNamespace(SWITCH_SAMPLE_LAYOUT.devices, 'b2', new Set());
    expect(r.map((d) => d.id)).toEqual(SWITCH_SAMPLE_LAYOUT.devices.map((d) => `b2_${d.id}`));
    expect(r.find((d) => d.type === 'switch')!.signalTargets).toEqual(['b2_launcher_2']);
  });

  it('同じ配置どうしは重なるので、重ならない所までずらして足す。全体を検査し直す', () => {
    const m = mergeLayouts(FLOOR_CHAIN.devices, FLOOR_CHAIN.devices, 404);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.offset).not.toEqual([0, 0]);
    expect(m.added).toBe(FLOOR_CHAIN.devices.length);
    expect(m.devices).toHaveLength(FLOOR_CHAIN.devices.length * 2);
    expect(new Set(m.devices.map((d) => d.id)).size).toBe(m.devices.length);
    noConflicts(m.devices);
    // 足した側の中のつながりは保たれる（3本のレールと発射機）
    expect(findConnections(m.devices).filter((c) => c.from.deviceId.startsWith('b2_')).length).toBe(3);
  });

  it('ちょうど出口に入口が来る設計図なら、そのままの位置でつながる（新しい接続を数える）', () => {
    const out = portWorldPosition(FLOOR_CHAIN.devices[3], 'ball_out');
    const tail: PlacedDevice[] = [{ id: 'rail_9', type: 'rail', position: [out[0], out[1] - 0.35 - 0.0, out[2] + 1], rotationYDeg: 0 }];
    // 入口（y+0.35）が出口の高さに合うように
    tail[0].position[1] = out[1] - 0.35;
    const m = mergeLayouts(FLOOR_CHAIN.devices.slice(0, 3), [FLOOR_CHAIN.devices[3]], 404);
    expect(m.ok && m.offset).toEqual([0, 0]);
    expect(m.ok && m.joined).toBe(1);
  });

  it('装置が多すぎる・置ける場所がないときは理由付きで断る', () => {
    const rails = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `rail_${i + 1}`, type: 'rail', position: [(i % 6) * 1.5 - 4, 0.4, Math.floor(i / 6) * 2 - 4], rotationYDeg: 0 }) as PlacedDevice);
    const tooMany = mergeLayouts(rails(36), MAGNET_SAMPLE_LAYOUT.devices, 404);
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.errors[0]).toContain('多すぎます');
    const noRoom = mergeLayouts(rails(30), MAGNET_SAMPLE_LAYOUT.devices.concat(FLOOR_CHAIN.devices.map((d) => ({ ...d, id: `x_${d.id}` }))), 404);
    expect(noRoom.ok).toBe(false);
    if (!noRoom.ok) expect(noRoom.errors[0]).toContain('見つかりません');
    expect(mergeLayouts(FLOOR_CHAIN.devices, [], 404).ok).toBe(false);
  });
});
