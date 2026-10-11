import { describe, expect, it } from 'vitest';
import { railVisualProfile } from '../src/render/railVisualProfile';
import { BALL_RADIUS, RAIL_PROFILE } from '../src/sim/railGeometry';
import { getDeviceDef } from '../src/sim/catalog';

describe('レールの見た目の断面（物理形状との整合）', () => {
  const p = railVisualProfile();

  it('走行面に乗った鉄球は2本の支持管にちょうど接する（浮きもめり込みもしない）', () => {
    const d = Math.hypot(p.carrier.x, BALL_RADIUS - p.carrier.y);
    expect(d).toBeCloseTo(BALL_RADIUS + p.carrier.radius, 9);
  });

  it('ガード管の内面は物理の側壁の内面と一致する', () => {
    expect(p.guard.x - p.guard.radius).toBeCloseTo(RAIL_PROFILE.innerWidth / 2, 9);
  });

  it('金具は鉄球の通り道をふさがず、外形はレール幅（devices.v0.1.json）に収まる', () => {
    const inner = p.collar.cheekX - p.collar.cheekWidth / 2;
    const outer = p.collar.cheekX + p.collar.cheekWidth / 2;
    expect(inner).toBeGreaterThan(RAIL_PROFILE.innerWidth / 2);
    expect(outer).toBeLessThanOrEqual(getDeviceDef('rail').size[0] / 2);
  });
});
