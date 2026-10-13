import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BUG_TUNING, IMPLEMENTED_BUGS, boxCorners, cameraTurned, closedLoops, facingRepelPairs, mirroredLaunchers, nextCornerCount, seeded, touchingCorner, wornFrictionFactor } from '../src/sim/bugs';
import { ROTATOR_SAMPLE_LAYOUT } from '../src/sim/layout';
import { RepeatTracker, WatchTracker } from '../src/bugs/trackers';
import { rotatorRing } from './loops';
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
  it('まず3種（マスター仕様 §10 手順3）に、BUG-03・15・30（D-42）、BUG-01・20・23・27（D-46）を足した10種', () => {
    expect(IMPLEMENTED_BUGS).toEqual(['BUG-01', 'BUG-03', 'BUG-12', 'BUG-15', 'BUG-16', 'BUG-18', 'BUG-20', 'BUG-23', 'BUG-27', 'BUG-30']);
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

describe('隠しバグ（BUG-03・15・30, D-42）', () => {
  let R2: Rapier;
  beforeAll(async () => {
    R2 = await loadRapier();
  });
  const sim = (devices: PlacedDevice[]) => new Simulation(R2, { seed: 404, devices });
  const ids = (s: Simulation) => s.bugEvents().map((b) => b.id);
  const go = (s: Simulation, sec: number) => {
    for (let i = 0; i < PHYSICS_HZ * sec; i++) s.step();
    return s;
  };

  it('BUG-03：閉じたレール（球の通り道の輪）を見つける', () => {
    const loops = closedLoops(rotatorRing());
    expect(loops).toHaveLength(1);
    expect(loops[0].deviceId).toBe('rotator_1');
    expect(closedLoops(FLOOR_CHAIN.devices)).toEqual([]);
  });

  it('BUG-03：起きる配置では毎回同じ tick に起き（決定論）、起きない配置では起きない', () => {
    const a = go(sim(rotatorRing()), 45);
    const ev = a.bugEvents().find((b) => b.id === 'BUG-03');
    expect(ev).toBeDefined();
    expect(go(sim(rotatorRing()), 45).bugEvents()).toEqual(a.bugEvents());
    // 効果が続いている球がある（検証用の状態にも入る）
    expect(a.verifierState().balls.some((b) => b[15] === 1)).toBe(true);
    expect(ids(go(sim(launcherEvery(1)), 20))).not.toContain('BUG-03');
  });

  // 3-2 と同じ：回転台で左へ曲げてゴール
  const turnLeft: PlacedDevice[] = [
    { id: 'launcher_1', type: 'launcher', position: [0, 0, -3.65], rotationYDeg: 0, params: { shots: 1 } },
    { id: 'rail_1', type: 'rail', position: [0, 0.4, -2], rotationYDeg: 0 },
    { id: 'rotator_1', type: 'rotator', position: [0, 0.2, -0.4], rotationYDeg: 0 },
    { id: 'rail_2', type: 'rail', position: [1.6, 0.2, -0.4], rotationYDeg: 90 },
    { id: 'goal_1', type: 'goal', position: [3.25, 0, -0.4], rotationYDeg: 0 },
  ];

  it('BUG-15：準備の判定と、準備された再生で最初の分岐だけ出口が変わること', () => {
    const t = new RepeatTracker();
    const normal = go(sim(turnLeft), 15);
    const print = normal.runFingerprint!;
    expect(print).toBeTruthy();
    expect(go(sim(turnLeft), 15).runFingerprint).toBe(print); // 同じ配置なら同じ要約
    for (let i = 0; i < BUG_TUNING.repeatRuns - 1; i++) t.record(print);
    expect(t.armed).toBe(false);
    t.record('ちがう試行');
    for (let i = 0; i < BUG_TUNING.repeatRuns - 1; i++) t.record(print);
    expect(t.armed).toBe(false);
    t.record(print);
    expect(t.armed).toBe(true);

    expect(normal.goalHits).toBe(1);
    const s = sim(turnLeft);
    s.armBugs({ branchSeed: 404 });
    go(s, 15);
    expect(ids(s)).toEqual(['BUG-15']);
    expect(s.goalHits).toBe(0); // 左のゴールではなく、別の出口へ
    // 準備はリセットで消える（次の再生は元どおり）
    s.reset();
    go(s, 15);
    expect(s.goalHits).toBe(1);
    t.consumed();
    expect(t.armed).toBe(false);
  });

  it('BUG-30：準備の判定（効果の無い装置では準備されない）', () => {
    const w = new WatchTracker();
    const launcher = turnLeft[0];
    for (let i = 0; i < 4; i++) w.observe(launcher);
    w.layoutChanged(turnLeft, turnLeft.map((d) => (d.id === 'launcher_1' ? { ...d, params: { shots: 2 } } : d)));
    w.observe(launcher);
    expect(w.armed).toBeNull();
    for (let i = 0; i < 4; i++) w.observe(launcher);
    expect(w.armed).toBe('launcher_1');
    const rail = turnLeft[1];
    const w2 = new WatchTracker();
    for (let i = 0; i < 10; i++) w2.observe(rail);
    expect(w2.armed).toBeNull();
  });

  it('BUG-30：準備された装置の次の挙動が1回だけ変わる（発射機・スイッチ）', () => {
    const s = sim(FLOOR_CHAIN.devices);
    s.armBugs({ watchedId: 'launcher_1' });
    s.step();
    s.step();
    const fast = Math.hypot(...s.readBalls()[0].linvel);
    expect(ids(s)).toEqual(['BUG-30']);
    const n = sim(FLOOR_CHAIN.devices);
    n.step();
    n.step();
    expect(fast).toBeGreaterThan(Math.hypot(...n.readBalls()[0].linvel) * 1.3);

    const sw: PlacedDevice[] = [
      { id: 'launcher_1', type: 'launcher', position: [0, 0, -3.65], rotationYDeg: 0, params: { shots: 1 } },
      { id: 'rail_1', type: 'rail', position: [0, 0.4, -2], rotationYDeg: 0 },
      { id: 'switch_1', type: 'switch', position: [0, 0.2, -0.5], rotationYDeg: 0 },
    ];
    const a = go(sim(sw), 4);
    expect(a.switchStates().get('switch_1')).toBe(true);
    const b = sim(sw);
    b.armBugs({ watchedId: 'switch_1' });
    go(b, 4);
    expect(b.switchStates().get('switch_1')).toBe(false);
    expect(ids(b)).toEqual(['BUG-30']);
  });
});

describe('隠しバグ（BUG-01・20・23・27, D-46）', () => {
  let R3: Rapier;
  beforeAll(async () => {
    R3 = await loadRapier();
  });
  const ids = (s: Simulation) => s.bugEvents().map((b) => b.id);
  const go = (s: Simulation, sec: number) => {
    for (let i = 0; i < PHYSICS_HZ * sec; i++) s.step();
    return s;
  };

  it('判定の部品：角・速さのそろい方・鏡に映した発射機・カメラの向き', () => {
    const c = boxCorners([{ minX: 0, maxX: 1, minZ: 0, maxZ: 1, minY: 0, maxY: 0.4 }]);
    expect(c).toHaveLength(4);
    expect(touchingCorner(c[0], [-0.05, 0.1, -0.05], 0.06)).toBe(true);
    expect(touchingCorner(c[0], [-0.5, 0.1, -0.5], 0.06)).toBe(false);
    let h = nextCornerCount(undefined, 2);
    h = nextCornerCount(h, 2.05);
    expect(h.count).toBe(2);
    expect(nextCornerCount(h, 2.5).count).toBe(1);
    const L = (x: number, rot: number, params?: Record<string, number>): PlacedDevice => ({ id: `l${x}`, type: 'launcher', position: [x, 0, -3], rotationYDeg: rot, params });
    expect(mirroredLaunchers(L(-1, 0), L(1, 0))).toBe(true);
    expect(mirroredLaunchers(L(-1, 90), L(1, 270))).toBe(true);
    expect(mirroredLaunchers(L(-1, 90), L(1, 90))).toBe(false);
    expect(mirroredLaunchers(L(-1, 0), L(1, 0, { launchSpeed: 6 }))).toBe(false);
    expect(cameraTurned(0, Math.PI)).toBe(true);
    expect(cameraTurned(0.5, 0.5 - Math.PI * 0.9)).toBe(true);
    expect(cameraTurned(0, Math.PI / 2)).toBe(false);
  });

  it('BUG-23：起きる配置では2つの球の位置が入れ替わる。設定がちがえば起きない', () => {
    const pair = (p2?: Record<string, number>): PlacedDevice[] => [
      { id: 'launcher_1', type: 'launcher', position: [-1, 0, -3], rotationYDeg: 0, params: { angleDegrees: 0, shots: 1 } },
      { id: 'launcher_2', type: 'launcher', position: [1, 0, -3], rotationYDeg: 0, params: { angleDegrees: 0, shots: 1, ...p2 } },
    ];
    const s = go(new Simulation(R3, { seed: 404, devices: pair() }), 1);
    expect(ids(s)).toEqual(['BUG-23']);
    const b0 = s.readBalls().find((b) => b.id === 0)!;
    expect(b0.position[0]).toBeGreaterThan(0); // 左の発射機の球が右へ
    expect(ids(go(new Simulation(R3, { seed: 404, devices: pair({ launchSpeed: 6 }) }), 1))).toEqual([]);
  });

  it('BUG-20：起きると、前の出口へ出る球が入口から戻っていく', () => {
    // 3つ目の出口は BUG-15 で作る（最初の分岐が右になる種を探す）
    let seed = 0;
    while (Math.floor(seeded(seed) * 2) !== 1) seed++;
    const s = new Simulation(R3, { seed: 404, devices: [...ROTATOR_SAMPLE_LAYOUT.devices] });
    s.armBugs({ branchSeed: seed });
    go(s, 14);
    expect(ids(s)).toEqual(['BUG-15', 'BUG-20']);
    // 入口から戻る球がある（回転台より手前を、入口の向きへ動く）。起きていない再生では、そうならない
    const goesBack = (sim: Simulation, sec: number) => {
      let seen = false;
      for (let i = 0; i < PHYSICS_HZ * sec; i++) {
        sim.step();
        seen ||= sim.readBalls().some((b) => b.position[2] < -0.9 && b.position[2] > -2.2 && b.linvel[2] < -0.3);
      }
      return seen;
    };
    expect(goesBack(s, 4)).toBe(true);
    const normal = new Simulation(R3, { seed: 404, devices: [...ROTATOR_SAMPLE_LAYOUT.devices] });
    expect(goesBack(normal, 18)).toBe(false);
    expect(ids(normal)).toEqual([]);
  });

  it('BUG-01：起きると、その1回だけはね返る向きが90度回る', () => {
    const devices: PlacedDevice[] = [
      { id: 'launcher_1', type: 'launcher', position: [-4, 0, -4], rotationYDeg: 0, params: { shots: 1, angleDegrees: 0 } },
      { id: 'platform_1', type: 'platform', position: [0, 0, 0], rotationYDeg: 0, params: { heightMeters: 0.4 } },
    ];
    const s = new Simulation(R3, { seed: 404, devices });
    go(s, 1.5); // 球が床に落ちて転がっている
    // 試験のために、同じ球を同じ所から同じ速さで角（-0.8, -0.8）へ何度も向かわせる
    const ball = (s as unknown as { balls: { id: number; body: { setTranslation(v: object, w: boolean): void; setLinvel(v: object, w: boolean): void; setAngvel(v: object, w: boolean): void; linvel(): { x: number; y: number; z: number } } }[] }).balls[0];
    const throwAt = () => {
      ball.body.setTranslation({ x: -1.5, y: 0.06, z: -1.5 }, true);
      ball.body.setLinvel({ x: 2, y: 0, z: 2 }, true);
      ball.body.setAngvel({ x: 2 / 0.06, y: 0, z: -2 / 0.06 }, true);
      for (let i = 0; i < 60; i++) s.step();
    };
    for (let k = 0; k < 3; k++) throwAt();
    expect(ids(s)).not.toContain('BUG-01');
    throwAt();
    expect(ids(s)).toContain('BUG-01');
  });
});

describe('バグ図鑑（記録と一覧）', () => {
  it('40種の一覧。名前と説明を持つのは実装した10種だけ（未実装の内容は配信物に入れない）', async () => {
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
