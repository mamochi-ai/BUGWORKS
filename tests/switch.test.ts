import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EditorModel } from '../src/edit/EditorModel';
import { findConnections, rolePorts } from '../src/edit/placement';
import { getDeviceDef } from '../src/sim/catalog';
import { PHYSICS_HZ } from '../src/sim/constants';
import { MAGNET_SAMPLE_LAYOUT, SWITCH_SAMPLE_LAYOUT, type PlacedDevice } from '../src/sim/layout';
import { loadRapier, type Rapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/Simulation';
import { acceptsSignal, signalSources } from '../src/sim/switch';

const byId = (devices: readonly PlacedDevice[], id: string) => devices.find((d) => d.id === id)!;

describe('スイッチ（定義と配線のデータ）', () => {
  it('試作の装置：1mのレールと同じ入口・出口、信号の出口', () => {
    const def = getDeviceDef('switch');
    expect(def.prototypeOnly).toBe(true);
    expect(rolePorts({ id: 's', type: 'switch', position: [0, 0, 0], rotationYDeg: 0 }).map((p) => p.portId)).toEqual(['ball_in', 'ball_out']);
    expect(def.ports.find((p) => p.id === 'signal_out')?.type).toBe('signal');
  });

  it('見本：レールの間にスイッチがつながっている', () => {
    const c = findConnections(SWITCH_SAMPLE_LAYOUT.devices).map((x) => `${x.from.deviceId}>${x.to.deviceId}`);
    expect(c).toContain('rail_2>switch_1');
  });

  it('信号を受けられるのは発射機と磁石だけ。存在しない相手・受けられない相手は無視', () => {
    expect(acceptsSignal('launcher')).toBe(true);
    expect(acceptsSignal('magnet')).toBe(true);
    expect(acceptsSignal('rotator')).toBe(true);
    expect(acceptsSignal('rail')).toBe(false);
    const sw: PlacedDevice = { id: 'S', type: 'switch', position: [0, 0, 0], rotationYDeg: 0, signalTargets: ['L', 'R', 'X'] };
    const devices: PlacedDevice[] = [sw, { id: 'L', type: 'launcher', position: [3, 0, 0], rotationYDeg: 0 }, { id: 'R', type: 'rail', position: [-3, 0, 0], rotationYDeg: 0 }];
    expect([...signalSources(devices)]).toEqual([['L', ['S']]]);
  });
});

describe('スイッチ（配線の操作）', () => {
  const make = () => new EditorModel(SWITCH_SAMPLE_LAYOUT.devices, 1);

  it('配線する→発射機をタップでつながる。もう一度で外れる。元に戻せる', () => {
    const ed = make();
    expect(ed.startWiring('switch_1')).toBe(true);
    expect(ed.wiringFrom).toBe('switch_1');
    ed.select('launcher_1');
    expect(ed.wiringFrom).toBeNull();
    expect(byId(ed.devices, 'switch_1').signalTargets).toEqual(['launcher_2', 'launcher_1']);
    expect(ed.selectedId).not.toBe('launcher_1');
    ed.startWiring('switch_1');
    ed.select('launcher_2');
    expect(byId(ed.devices, 'switch_1').signalTargets).toEqual(['launcher_1']);
    expect(ed.message?.text).toContain('外しました');
    ed.undo();
    expect(byId(ed.devices, 'switch_1').signalTargets).toEqual(['launcher_2', 'launcher_1']);
  });

  it('受けられない装置をタップすると理由が出て、つながらない。何もない所のタップでやめる', () => {
    const ed = make();
    ed.startWiring('switch_1');
    ed.select('rail_1');
    expect(ed.message?.text).toContain('発射機・磁石・回転装置');
    expect(byId(ed.devices, 'switch_1').signalTargets).toEqual(['launcher_2']);
    ed.startWiring('switch_1');
    ed.select(null);
    expect(ed.wiringFrom).toBeNull();
    expect(ed.message?.text).toBe('配線をやめました');
  });

  it('スイッチ以外は配線できない。相手を消すと配線も外れ、元に戻すと戻る', () => {
    const ed = make();
    expect(ed.startWiring('rail_1')).toBe(false);
    ed.remove('launcher_2');
    expect(byId(ed.devices, 'switch_1').signalTargets).toEqual([]);
    ed.undo();
    expect(byId(ed.devices, 'switch_1').signalTargets).toEqual(['launcher_2']);
  });

  it('ステージの固定のスイッチは配線を変えられない', () => {
    const ed = make();
    ed.startStage(SWITCH_SAMPLE_LAYOUT.devices, {}, 'test');
    expect(ed.startWiring('switch_1')).toBe(false);
    expect(ed.toggleWire('switch_1', 'launcher_1')).toBe(false);
  });
});

describe('スイッチ（物理と信号）', () => {
  let R: Rapier;
  const sims: Simulation[] = [];
  beforeAll(async () => {
    R = await loadRapier();
  });
  afterEach(() => {
    while (sims.length) sims.pop()!.dispose();
  });
  const sim = (devices: readonly PlacedDevice[]) => {
    const s = new Simulation(R, { seed: 404, devices: [...devices] });
    sims.push(s);
    return s;
  };
  const stepTo = (s: Simulation, seconds: number) => {
    while (s.tick < seconds * PHYSICS_HZ) s.step();
  };
  const fired = (s: Simulation, id: string) => s.snapshot().launchers.find((l) => l.deviceId === id)!.lastFireTick;

  it('最初は OFF。球が通るたびに ON↔OFF が切り替わる', () => {
    const s = sim(SWITCH_SAMPLE_LAYOUT.devices);
    expect(s.switchStates().get('switch_1')).toBe(false);
    stepTo(s, 2);
    expect(s.switchStates().get('switch_1')).toBe(true);
    stepTo(s, 5);
    expect(s.switchStates().get('switch_1')).toBe(false);
    stepTo(s, 8);
    expect(s.switchStates().get('switch_1')).toBe(true);
    expect(s.snapshot().switches[0].toggles).toBe(3);
  });

  it('配線された発射機は OFF の間は撃たず、ON の間だけいつもの間隔で撃つ', () => {
    const s = sim(SWITCH_SAMPLE_LAYOUT.devices);
    stepTo(s, 1.2);
    expect(fired(s, 'launcher_2')).toBeNull();
    stepTo(s, 4.2);
    const onTick = fired(s, 'launcher_2')!;
    expect(onTick).not.toBeNull();
    stepTo(s, 7);
    // OFF の間（4.3秒〜7.3秒）は撃たない
    expect(fired(s, 'launcher_2')).toBeLessThan(4.4 * PHYSICS_HZ);
    stepTo(s, 10);
    // 右のゴールには ON の間に撃った球だけが入る（左右とも場外に落ちない）
    const goals = s.snapshot().goals;
    expect(goals.find((g) => g.deviceId === 'goal_1')!.hits).toBe(3);
    expect(goals.find((g) => g.deviceId === 'goal_2')!.hits).toBe(4);
    expect(s.lostBalls).toBe(0);
  });

  it('配線が無ければ今までどおり（発射機はすぐ撃つ）', () => {
    const devices = SWITCH_SAMPLE_LAYOUT.devices.map((d) => (d.type === 'switch' ? { ...d, signalTargets: [] } : d));
    const s = sim(devices);
    stepTo(s, 0.5);
    expect(fired(s, 'launcher_2')).toBe(0);
  });

  it('配線された磁石は OFF の間は効かない', () => {
    // 磁石の見本で、磁石を（球が通らない）スイッチに配線すると、ずっと OFF なのでゴールしない
    const devices: PlacedDevice[] = [
      ...MAGNET_SAMPLE_LAYOUT.devices,
      { id: 'switch_9', type: 'switch', position: [-3, 0, 0], rotationYDeg: 0, signalTargets: ['magnet_1'] },
    ];
    const s = sim(devices);
    stepTo(s, 6);
    expect(s.goalHits).toBe(0);
  });

  it('同じ配置なら毎回同じ動き（決定論）。リセットで初めから', () => {
    const a = sim(SWITCH_SAMPLE_LAYOUT.devices);
    stepTo(a, 6);
    const b = sim(SWITCH_SAMPLE_LAYOUT.devices);
    stepTo(b, 6);
    expect(b.snapshot()).toEqual(a.snapshot());
    b.reset();
    expect(b.switchStates().get('switch_1')).toBe(false);
    stepTo(b, 6);
    expect(b.snapshot()).toEqual(a.snapshot());
  });
});
