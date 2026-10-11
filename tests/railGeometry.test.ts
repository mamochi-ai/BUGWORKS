import { describe, expect, it } from 'vitest';
import { getDeviceDef } from '../src/sim/catalog';
import { VERTICAL_SLICE_LAYOUT } from '../src/sim/layout';
import { buildRailTrack, portWorldPosition } from '../src/sim/railGeometry';

describe('レール定義とポート', () => {
  it('レール定義は devices.v0.1.json の値を使う', () => {
    const rail = getDeviceDef('rail');
    expect(rail.size).toEqual([0.5, 0.4, 2]);
    expect(rail.params.slopeMeters).toBe(0.2);
    expect(rail.ports.map((p) => p.id)).toEqual(['ball_in', 'ball_out']);
  });

  it('縦切りレイアウトの各レールは ball_out → 次の ball_in で連結している', () => {
    const rails = VERTICAL_SLICE_LAYOUT.devices;
    for (let i = 0; i + 1 < rails.length; i++) {
      const out = portWorldPosition(rails[i], 'ball_out');
      const inn = portWorldPosition(rails[i + 1], 'ball_in');
      for (let k = 0; k < 3; k++) expect(out[k]).toBeCloseTo(inn[k], 9);
    }
  });

  it('Y軸90度回転で前方+Zが+Xへ向く', () => {
    const t = buildRailTrack({ id: 'r', type: 'rail', position: [0, 0, 0], rotationYDeg: 90 });
    expect(t.dir[0]).toBeGreaterThan(0.99);
    expect(t.normal[1]).toBeGreaterThan(0.99);
    expect(t.pitch).toBeCloseTo(Math.atan2(0.2, 2), 9);
  });

  it('slopeMeters を変えると入口の高さが変わる', () => {
    const a = portWorldPosition({ id: 'r', type: 'rail', position: [0, 0, 0], rotationYDeg: 0, params: { slopeMeters: 0.5 } }, 'ball_in');
    expect(a[1]).toBeCloseTo(0.65, 9);
  });
});
