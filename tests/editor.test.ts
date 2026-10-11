import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EditorModel } from '../src/edit/EditorModel';
import {
  PLACEMENT,
  checkPlacement,
  conflicts,
  evaluateMove,
  findConnections,
  overlaps,
} from '../src/edit/placement';
import { PHYSICS_HZ } from '../src/sim/constants';
import { VERTICAL_SLICE_LAYOUT, type PlacedDevice } from '../src/sim/layout';
import { portWorldPosition } from '../src/sim/railGeometry';
import { loadRapier, type Rapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/Simulation';

const base = VERTICAL_SLICE_LAYOUT.devices;
/** 発射機を除いたレールだけ（rail_1, rail_2, rail_3） */
const rails = base.filter((d) => d.type === 'rail');
const rail = (id: string, x: number, y: number, z: number, rot = 0): PlacedDevice => ({
  id,
  type: 'rail',
  position: [x, y, z],
  rotationYDeg: rot,
});
const near = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6;

describe('接続', () => {
  it('初期レイアウトは 発射機→rail_1→rail_2→rail_3 の3か所で接続', () => {
    const c = findConnections(base).map((x) => `${x.from.deviceId}>${x.to.deviceId}`);
    expect(c.sort()).toEqual(['launcher_1>rail_1', 'rail_1>rail_2', 'rail_2>rail_3']);
  });

  it('発射機と接続したレールは外形がわずかに重なるが、重なりとして扱わない', () => {
    const launcher = base.find((d) => d.type === 'launcher')!;
    expect(overlaps(launcher, rails[0])).toBe(true);
    expect(checkPlacement(launcher, rails).ok).toBe(true);
  });

  it('つながっていない発射機がレールに重なるのは不可', () => {
    const launcher = { ...base.find((d) => d.type === 'launcher')!, position: [0, 0, -2.5] as [number, number, number] };
    expect(checkPlacement(launcher, rails).problem).toBe('overlap');
  });

  it('発射機の出口をレールの入口に近づけると吸着する', () => {
    const launcher = { ...base.find((d) => d.type === 'launcher')!, position: [3, 0, 3] as [number, number, number] };
    const r = evaluateMove(launcher, 0.1, -3.5, rails);
    expect(r.ok).toBe(true);
    expect(r.snap?.other).toEqual({ deviceId: 'rail_1', portId: 'ball_in' });
  });
});

describe('ドラッグ中の吸着と配置チェック', () => {
  const others = rails;

  it('先頭レールの入口の近くに持っていくと、出口を入口に合わせて吸着する（高さも合わせる）', () => {
    const moving = rail('rail_9', 3, 0, 3);
    const target = portWorldPosition(rails[0], 'ball_in');
    const r = evaluateMove(moving, target[0] + 0.2, target[2] - 1.1, others);
    expect(r.ok).toBe(true);
    expect(r.snap?.other).toEqual({ deviceId: 'rail_1', portId: 'ball_in' });
    expect(near(portWorldPosition(r.device, 'ball_out'), target)).toBe(true);
    expect(r.device.position[1]).toBeCloseTo(0.6, 9);
    expect(r.device.position[2]).toBeCloseTo(-4, 9);
  });

  it('末尾レールの出口に吸着すると床より低くなる場合は吸着せず、理由を返す', () => {
    const moving = rail('rail_9', 3, 0, 3);
    const out = portWorldPosition(rails[2], 'ball_out');
    const r = evaluateMove(moving, out[0], out[2] + 1, others);
    expect(r.snap).toBeUndefined();
    expect(r.connectHint).toContain('床より低く');
  });

  it('向きが合わないポートの近くでは吸着せず、回転を促す', () => {
    const moving = rail('rail_9', 3, 0, 3, 90);
    const target = portWorldPosition(rails[0], 'ball_in');
    // 90度回したレールの出口はローカル +X 側にあるので、その出口が入口に来る位置へ持っていく
    const r = evaluateMove(moving, target[0] - 1, target[2], others);
    expect(r.snap).toBeUndefined();
    expect(r.connectHint).toContain('回転');
  });

  it('他のレールと重なる位置には置けない', () => {
    const r = evaluateMove(rail('rail_9', 3, 0, 3), 0.25, 2, others);
    expect(r.ok).toBe(false);
    expect(r.problem).toBe('overlap');
  });

  it('床の外には置けない', () => {
    const r = evaluateMove(rail('rail_9', 3, 0, 3), 5.75, 0, others);
    expect(r.ok).toBe(false);
    expect(r.problem).toBe('out_of_bounds');
  });

  it('位置は 0.25m グリッドに合わせる', () => {
    const r = evaluateMove(rail('rail_9', 3, 0, 3), 3.11, 2.62, others);
    expect(r.device.position[0]).toBeCloseTo(3, 9);
    expect(r.device.position[2]).toBeCloseTo(2.5, 9);
  });

  it('連結したレールは端が接するだけで「重なり」にはならない', () => {
    expect(overlaps(rails[0], rails[1])).toBe(false);
  });
});

describe('EditorModel', () => {
  const make = () => new EditorModel(base, 404);

  it('レールを追加すると空き場所に置かれ、選択される', () => {
    const m = make();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) ids.push(m.addDevice('rail', 0, 0)!);
    expect(new Set(ids).size).toBe(8);
    expect(m.selectedId).toBe(ids[7]);
    const ds = m.devices;
    for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) expect(conflicts(ds[i], ds[j])).toBe(false);
  });

  it('上限数を超えて追加できない', () => {
    const m = make();
    while (m.devices.length < PLACEMENT.maxDevices) expect(m.addDevice('rail', 0, 0)).not.toBeNull();
    expect(m.addDevice('rail', 0, 0)).toBeNull();
    expect(m.message?.kind).toBe('error');
  });

  it('移動→元に戻す→やり直す', () => {
    const m = make();
    const before = JSON.stringify(m.devices);
    const ev = m.previewMove('rail_3', 3, 3)!;
    expect(m.commitMove('rail_3', ev)).toBe(true);
    const after = JSON.stringify(m.devices);
    expect(after).not.toBe(before);
    m.undo();
    expect(JSON.stringify(m.devices)).toBe(before);
    m.redo();
    expect(JSON.stringify(m.devices)).toBe(after);
  });

  it('置けない位置への移動は反映されず、理由が表示される', () => {
    const m = make();
    const before = JSON.stringify(m.devices);
    expect(m.commitMove('rail_3', m.previewMove('rail_3', 0, 0)!)).toBe(false);
    expect(JSON.stringify(m.devices)).toBe(before);
    expect(m.message?.text).toContain('重なって');
  });

  it('回転・高さ変更・削除', () => {
    const m = make();
    expect(m.rotate('rail_3')).toBe(true);
    expect(m.devices.find((d) => d.id === 'rail_3')!.rotationYDeg).toBe(90);
    expect(m.changeHeight('rail_3', -1)).toBe(false); // 床より下
    expect(m.changeHeight('rail_3', 2)).toBe(true);
    expect(m.devices.find((d) => d.id === 'rail_3')!.position[1]).toBeCloseTo(0.4, 9);
    m.select('rail_3');
    expect(m.remove('rail_3')).toBe(true);
    expect(m.selectedId).toBeNull();
    expect(m.devices.map((d) => d.id)).toEqual(['launcher_1', 'rail_1', 'rail_2']);
  });

  it('重なる回転はできない', () => {
    const m = new EditorModel([rail('a', 0, 0, 0), rail('b', 1, 0, 0)], 1);
    expect(m.rotate('a')).toBe(false);
    expect(m.message?.text).toContain('重なって');
  });

  it('変更のたびに layout を通知する', () => {
    const m = make();
    const kinds: string[] = [];
    m.onChange((k) => kinds.push(k));
    m.addDevice('rail', 0, 0);
    expect(kinds).toContain('layout');
  });
});

describe('編集後の物理', () => {
  let R: Rapier;
  const sims: Simulation[] = [];
  beforeAll(async () => {
    R = await loadRapier();
  });
  afterEach(() => {
    while (sims.length) sims.pop()!.dispose();
  });

  it('レールを1本外すと、球はその手前のレールの端から床へ降りる', () => {
    const m = new EditorModel(base, 404);
    m.remove('rail_2');
    const s = new Simulation(R, m.layout);
    sims.push(s);
    for (let i = 0; i < PHYSICS_HZ * 4; i++) s.step();
    const first = s.readBalls().find((b) => b.id === 0)!;
    expect(first.position[2]).toBeGreaterThan(portWorldPosition(rails[0], 'ball_out')[2]);
    expect(first.position[1]).toBeCloseTo(0.1, 1);
    expect(s.lostBalls).toBe(0);
  });

  it('setLayout 後の状態は、同じ配置で新しく作ったワールドと一致する', () => {
    const m = new EditorModel(base, 404);
    m.remove('rail_1');
    const a = new Simulation(R, VERTICAL_SLICE_LAYOUT);
    sims.push(a);
    for (let i = 0; i < 100; i++) a.step();
    a.setLayout(m.layout);
    const b = new Simulation(R, m.layout);
    sims.push(b);
    for (let i = 0; i < 300; i++) {
      a.step();
      b.step();
    }
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it('装置が1台もなくても動き、球は出ない', () => {
    const s = new Simulation(R, { seed: 1, devices: [] });
    sims.push(s);
    for (let i = 0; i < 120; i++) s.step();
    expect(s.ballCount).toBe(0);
  });
});
