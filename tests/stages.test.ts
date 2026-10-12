import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { conflicts, findConnections } from '../src/edit/placement';
import { PHYSICS_HZ } from '../src/sim/constants';
import type { PlacedDevice } from '../src/sim/layout';
import { loadRapier, type Rapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/Simulation';
import { STAGES, STICKY_EVENTS, unlockState, type StageDef } from '../src/stage/stages';

const playable = STAGES.filter((s) => !s.comingSoon);

/** 1回の再生で、必要な出来事がすべて起きたか（起きた時刻も） */
function play(R: Rapier, devices: PlacedDevice[], stage: StageDef, seconds: number) {
  const s = new Simulation(R, { seed: 404, devices });
  let clearedAt: number | null = null;
  for (let i = 0; i < PHYSICS_HZ * seconds && clearedAt === null; i++) {
    s.step();
    const ev = s.events();
    // 保存などの「覚えておく出来事」は物理では起きないので、ここでは物理の出来事だけを見る
    if (stage.required.filter((e) => !STICKY_EVENTS.includes(e)).every((e) => ev[e as keyof typeof ev])) clearedAt = s.tick / PHYSICS_HZ;
  }
  const events = s.events();
  s.dispose();
  return { clearedAt, events };
}

describe('ステージの定義', () => {
  it('v0.1 の 1-1〜1-5。1-5 はゴールのあと設計図を保存するとクリア', () => {
    expect(STAGES.slice(0, 5).map((s) => `${s.id} ${s.name}`)).toEqual(['1-1 はじめの一歩', '1-2 バネでジャンプ', '1-3 曲がって運ぶ', '1-4 歯車で動かす', '1-5 設計図を保存']);
    const s15 = STAGES.find((s) => s.id === '1-5')!;
    expect(s15.comingSoon).toBeUndefined();
    expect(s15.required).toEqual(['ball_enter_goal', 'blueprint_saved']);
  });

  for (const st of playable) {
    it(`${st.id}：解き方は置ける数の範囲内で、他の装置と重ならない`, () => {
      const counts: Record<string, number> = {};
      for (const d of st.solution) counts[d.type] = (counts[d.type] ?? 0) + 1;
      for (const [type, n] of Object.entries(counts)) expect(n).toBeLessThanOrEqual(st.inventory[type as keyof typeof st.inventory] ?? 0);
      const all = [...st.devices, ...st.solution];
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(conflicts(all[i], all[j])).toBe(false);
      expect(new Set(all.map((d) => d.id)).size).toBe(all.length);
    });
  }

  it('置いた装置はつながる（1-1・1-3・1-4）', () => {
    const conn = (st: StageDef) => findConnections([...st.devices, ...st.solution]).map((c) => `${c.from.deviceId}>${c.to.deviceId}`);
    expect(conn(STAGES[0])).toEqual(expect.arrayContaining(['rail_1>rail_2', 'rail_2>rail_3']));
    expect(conn(STAGES[2])).toContain('rail_2>curve_1');
    expect(conn(STAGES[3])).toEqual(expect.arrayContaining(['paddle_1>gearbox_1', 'gearbox_1>shaft_1', 'shaft_1>bridge_1']));
  });
});

describe('ステージは解けて、置かなければ解けない（物理）', () => {
  let R: Rapier;
  beforeAll(async () => {
    R = await loadRapier();
  });
  afterEach(() => undefined);

  for (const st of playable) {
    it(`${st.id} ${st.name}：解き方どおりに置くとクリア`, () => {
      const r = play(R, [...st.devices, ...st.solution], st, 12);
      expect(r.clearedAt, JSON.stringify(r.events)).not.toBeNull();
    });

    it(`${st.id} ${st.name}：何も置かなければクリアできない`, () => {
      const r = play(R, [...st.devices], st, 12);
      expect(r.clearedAt).toBeNull();
    });
  }
});

import { EditorModel } from '../src/edit/EditorModel';

describe('ステージ中の編集の制限', () => {
  const st = STAGES[0];
  const make = () => {
    const m = new EditorModel([], 404);
    m.startStage(st.devices, st.inventory, 'start');
    return m;
  };

  it('最初からある装置は、動かす・回す・消す・設定を変えることができない', () => {
    const m = make();
    expect(m.isLocked('rail_1')).toBe(true);
    expect(m.previewMove('rail_1', 2, 2)).toBeNull();
    expect(m.rotate('rail_1')).toBe(false);
    expect(m.remove('rail_1')).toBe(false);
    expect(m.changeHeight('rail_1', 1)).toBe(false);
    expect(m.setParam('launcher_1', 'launchSpeed', 6)).toBe(false);
    expect(m.message?.text).toContain('動かせません');
    expect(m.devices).toHaveLength(st.devices.length);
  });

  it('置ける装置と数が決まっている（使い切ると置けない、消すとまた置ける）', () => {
    const m = make();
    expect(m.remaining('rail')).toBe(1);
    expect(m.addDevice('spring', 3, 3)).toBeNull();
    const id = m.addDevice('rail', 3, 3)!;
    expect(id).toBe('rail_4');
    expect(m.remaining('rail')).toBe(0);
    expect(m.addDevice('rail', 3, 3)).toBeNull();
    expect(m.message?.text).toContain('もうありません');
    expect(m.remove(id)).toBe(true);
    expect(m.remaining('rail')).toBe(1);
  });

  it('自分で置いた装置は自由に動かせ、元に戻せる。最初の配置より前には戻らない', () => {
    const m = make();
    const id = m.addDevice('rail', 3, 3)!;
    const ev = m.previewMove(id, 0, 0)!;
    expect(m.commitMove(id, ev)).toBe(true);
    m.undo();
    m.undo();
    expect(m.canUndo).toBe(false);
    expect(m.devices).toHaveLength(st.devices.length);
  });

  it('ステージ中は見本を読み込めない。自由研究に戻すと制限がなくなる', () => {
    const m = make();
    m.loadLayout([], 'x');
    expect(m.devices).toHaveLength(st.devices.length);
    m.startFree([], 'free');
    expect(m.inStage).toBe(false);
    expect(m.remaining('spring')).toBe(Infinity);
  });
});

describe('アンロック順（順番に解放, D-27）', () => {
  it('最初は 1-1 だけ遊べる。ロック中は理由が出る', () => {
    expect(unlockState('1-1', []).unlocked).toBe(true);
    for (const id of ['1-2', '1-3', '1-4', '1-5']) expect(unlockState(id, []).unlocked).toBe(false);
    expect(unlockState('1-2', []).reason).toBe('1-1「はじめの一歩」をクリアすると遊べます');
  });

  it('ひとつ前をクリアすると次が開く（飛ばして開くことはない）', () => {
    expect(unlockState('1-2', ['1-1']).unlocked).toBe(true);
    expect(unlockState('1-3', ['1-1']).unlocked).toBe(false);
    expect(unlockState('1-4', ['1-1', '1-2', '1-3']).unlocked).toBe(true);
    // 前のステージの記録が無ければ、後ろだけクリア済みでも開かない
    expect(unlockState('1-3', ['1-2']).unlocked).toBe(false);
  });

  it('無いステージは遊べない', () => {
    expect(unlockState('9-9', ['1-1']).unlocked).toBe(false);
  });
});

describe('ステージ2：ひと工夫しないと解けない', () => {
  let R: Rapier;
  beforeAll(async () => {
    R = await loadRapier();
  });
  const st = (id: string) => STAGES.find((s) => s.id === id)!;
  const withSolution = (id: string, change: (d: PlacedDevice) => PlacedDevice) => [...st(id).devices, ...st(id).solution.map(change)];

  it('2-1 / 2-2 / 2-5：バネを置いただけ（傾き0°・強さ 5m/s のまま）では届かない', () => {
    for (const id of ['2-1', '2-2', '2-5']) {
      const devices = withSolution(id, (d) => (d.type === 'spring' ? { ...d, params: {} } : d));
      expect(play(R, devices, st(id), 8).clearedAt, id).toBeNull();
    }
  });

  it('2-4：スイッチを置いても磁石に配線しないと、磁石が球をそらしてゴールしない', () => {
    const devices = withSolution('2-4', (d) => ({ ...d, signalTargets: [] }));
    const r = play(R, devices, st('2-4'), 10);
    expect(r.events.switch_on).toBe(true);
    expect(r.events.ball_enter_goal).toBe(false);
  });
});
