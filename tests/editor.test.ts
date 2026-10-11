import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EditorModel } from '../src/edit/EditorModel';
import {
  PLACEMENT,
  chooseBallStart,
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
const rail = (id: string, x: number, y: number, z: number, rot = 0): PlacedDevice => ({
  id,
  type: 'rail',
  position: [x, y, z],
  rotationYDeg: rot,
});
const near = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6;

describe('接続と鉄球の開始位置', () => {
  it('初期レイアウトは rail_1→rail_2→rail_3 の2か所で接続', () => {
    const c = findConnections(base).map((x) => `${x.from.deviceId}>${x.to.deviceId}`);
    expect(c.sort()).toEqual(['rail_1>rail_2', 'rail_2>rail_3']);
  });

  it('鉄球はつながっていない入口のうち最も高いレールに置く', () => {
    expect(chooseBallStart(base)).toBe('rail_1');
    expect(chooseBallStart(base.filter((d) => d.id !== 'rail_1'))).toBe('rail_2');
    expect(chooseBallStart([])).toBeNull();
  });

  it('同じ高さなら配置順が先のもの', () => {
    expect(chooseBallStart([rail('b', 2, 0, 0), rail('a', -2, 0, 0)])).toBe('b');
  });
});

describe('ドラッグ中の吸着と配置チェック', () => {
  const others = base;

  it('先頭レールの入口の近くに持っていくと、出口を入口に合わせて吸着する（高さも合わせる）', () => {
    const moving = rail('rail_9', 3, 0, 3);
    const target = portWorldPosition(base[0], 'ball_in');
    const r = evaluateMove(moving, target[0] + 0.2, target[2] - 1.1, others);
    expect(r.ok).toBe(true);
    expect(r.snap?.other).toEqual({ deviceId: 'rail_1', portId: 'ball_in' });
    expect(near(portWorldPosition(r.device, 'ball_out'), target)).toBe(true);
    expect(r.device.position[1]).toBeCloseTo(0.6, 9);
    expect(r.device.position[2]).toBeCloseTo(-4, 9);
  });

  it('末尾レールの出口に吸着すると床より低くなる場合は吸着せず、理由を返す', () => {
    const moving = rail('rail_9', 3, 0, 3);
    const out = portWorldPosition(base[2], 'ball_out');
    const r = evaluateMove(moving, out[0], out[2] + 1, others);
    expect(r.snap).toBeUndefined();
    expect(r.connectHint).toContain('床より低く');
  });

  it('向きが合わないポートの近くでは吸着せず、回転を促す', () => {
    const moving = rail('rail_9', 3, 0, 3, 90);
    const target = portWorldPosition(base[0], 'ball_in');
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
    expect(overlaps(base[0], base[1])).toBe(false);
  });
});

describe('EditorModel', () => {
  const make = () => new EditorModel(base, 404);

  it('レールを追加すると空き場所に置かれ、選択される', () => {
    const m = make();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) ids.push(m.addRail(0, 0)!);
    expect(new Set(ids).size).toBe(8);
    expect(m.selectedId).toBe(ids[7]);
    const ds = m.devices;
    for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) expect(overlaps(ds[i], ds[j])).toBe(false);
  });

  it('上限数を超えて追加できない', () => {
    const m = make();
    while (m.devices.length < PLACEMENT.maxDevices) expect(m.addRail(0, 0)).not.toBeNull();
    expect(m.addRail(0, 0)).toBeNull();
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
    expect(m.devices.map((d) => d.id)).toEqual(['rail_1', 'rail_2']);
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
    m.addRail(0, 0);
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

  it('先頭の前に吸着したレールから鉄球が転がり、4本を通って床に降りる', () => {
    const m = new EditorModel(base, 404);
    const id = m.addRail(4, 4)!;
    const target = portWorldPosition(base[0], 'ball_in');
    expect(m.commitMove(id, m.previewMove(id, target[0], target[2] - 1)!)).toBe(true);

    const s = new Simulation(R, m.layout);
    sims.push(s);
    const z0 = s.readBall().position[2];
    expect(z0).toBeLessThan(target[2]);
    for (let i = 0; i < PHYSICS_HZ * 12; i++) s.step();
    const p = s.readBall().position;
    expect(p[2]).toBeGreaterThan(portWorldPosition(base[2], 'ball_out')[2]);
    expect(p[1]).toBeCloseTo(0.1, 2);
    expect(s.outOfBounds).toBe(false);
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

  it('レールが1本もなくても動く', () => {
    const s = new Simulation(R, { seed: 1, devices: [] });
    sims.push(s);
    for (let i = 0; i < 120; i++) s.step();
    expect(s.readBall().position[1]).toBeCloseTo(0.1, 2);
  });
});
