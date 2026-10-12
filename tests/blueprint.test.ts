import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BLUEPRINT_SCHEMA_VERSION, MAX_BLUEPRINT_CHARS, blueprintToJson, cleanTitle, fileNameFor, parseBlueprint, toBlueprint } from '../src/blueprint/blueprint';
import { MAX_SAVED, listSaved, removeSaved, saveBlueprint } from '../src/blueprint/store';
import { EditorModel } from '../src/edit/EditorModel';
import { findConnections } from '../src/edit/placement';
import { PHYSICS_HZ, PHYSICS_PROFILE } from '../src/sim/constants';
import * as layouts from '../src/sim/layout';
import type { PlacedDevice, SliceLayout } from '../src/sim/layout';
import { loadRapier, type Rapier } from '../src/sim/rapier';
import { Simulation } from '../src/sim/Simulation';
import { SimulationController } from '../src/sim/SimulationController';
import { StageController } from '../src/stage/StageController';
import { findStage } from '../src/stage/stages';

const samples = Object.entries(layouts).filter(([k]) => k.endsWith('_LAYOUT')) as [string, SliceLayout][];
const json = (devices: readonly PlacedDevice[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ ...JSON.parse(blueprintToJson(toBlueprint(devices, 404, { title: 't' }))), ...extra });
const errorsOf = (text: string) => {
  const r = parseBlueprint(text);
  return r.ok ? [] : r.errors.join(' ');
};
const rail: PlacedDevice = { id: 'rail_1', type: 'rail', position: [0, 0.4, 0], rotationYDeg: 0 };

describe('設計図JSON（書き出し）', () => {
  it('マスター仕様 §7 のルートキーを持ち、接続を配置から記録する。ステージなら stageId', () => {
    const bp = toBlueprint(layouts.SWITCH_SAMPLE_LAYOUT.devices, 404, { title: 'テスト', stageId: '1-5', now: new Date('2026-10-12T00:00:00Z') });
    for (const k of ['schemaVersion', 'engineVersion', 'physicsProfile', 'seed', 'devices', 'connections', 'ports', 'initialState']) expect(bp).toHaveProperty(k);
    expect(bp.schemaVersion).toBe(BLUEPRINT_SCHEMA_VERSION);
    expect(bp.physicsProfile).toBe(PHYSICS_PROFILE);
    expect(bp.stageId).toBe('1-5');
    expect(bp.connections).toHaveLength(findConnections(layouts.SWITCH_SAMPLE_LAYOUT.devices).length);
    expect(bp.devices.find((d) => d.id === 'switch_1')?.signalTargets).toEqual(['launcher_2']);
    expect(bp.createdAt).toBe('2026-10-12T00:00:00.000Z');
  });

  for (const [name, layout] of samples) {
    it(`往復で同じ配置に戻る：${name}`, () => {
      const r = parseBlueprint(json(layout.devices));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.warnings).toEqual([]);
      expect(r.devices).toEqual(layout.devices.map((d) => JSON.parse(JSON.stringify(d))));
    });
  }

  it('名前は制御文字を除いて40文字まで。ファイル名に使えない文字は置き換える', () => {
    expect(cleanTitle('  あ\u0007い\n  ')).toBe('あい');
    expect(cleanTitle('x'.repeat(100))).toHaveLength(40);
    expect(fileNameFor('a/b:c')).toBe('bugworks-a_b_c.json');
  });
});

describe('設計図JSON（読み込みの検査）', () => {
  it('JSON でない・形が違う・大きすぎるものは理由付きで断る', () => {
    expect(errorsOf('{')).toContain('JSON として読めません');
    expect(errorsOf('[]')).toContain('設計図の形ではありません');
    expect(errorsOf('x'.repeat(MAX_BLUEPRINT_CHARS + 1))).toContain('大きすぎます');
  });

  it('__proto__ などの危ないキーは断る', () => {
    expect(errorsOf(json([rail]).replace('"devices"', '"__proto__":{"x":1},"devices"'))).toContain('使えないキー');
    expect(errorsOf(json([rail]).replace('"rotationYDeg"', '"constructor":1,"rotationYDeg"'))).toContain('使えないキー');
  });

  it('版が違う・知らない装置・重複ID・変なIDは断る', () => {
    expect(errorsOf(json([rail], { schemaVersion: '9.0.0' }))).toContain('読めません');
    expect(errorsOf(json([rail], { schemaVersion: undefined }))).toContain('schemaVersion');
    expect(errorsOf(json([rail]).replace('"type":"rail"', '"type":"teleporter"'))).toContain('知らない装置');
    expect(errorsOf(json([rail, { ...rail, position: [2, 0.4, 0] }]))).toContain('重複');
    expect(errorsOf(json([{ ...rail, id: '<script>' }]))).toContain('ID が正しくありません');
  });

  it('位置・向き・設定の範囲外は断る', () => {
    expect(errorsOf(json([{ ...rail, position: [99, 0, 0] }]))).toContain('研究所の外');
    expect(errorsOf(json([{ ...rail, position: [0, -1, 0] }]))).toContain('研究所の外');
    expect(errorsOf(json([{ ...rail, rotationYDeg: 45 }]))).toContain('向き');
    expect(errorsOf(json([{ ...rail, params: { slopeMeters: 5 } }]))).toContain('範囲外');
    expect(errorsOf(json([{ ...rail, params: { slopeMeters: 0.25 } }]))).toContain('刻み');
    expect(errorsOf(json([rail]).replace('"position":[', '"position":["x",'))).toContain('位置');
  });

  it('装置の数の上限を超えるものは断る', () => {
    const many = Array.from({ length: 41 }, (_, i) => ({ ...rail, id: `rail_${i + 1}`, position: [(i % 6) - 3, 0.4, Math.floor(i / 6) - 3] as PlacedDevice['position'] }));
    expect(errorsOf(json(many))).toContain('多すぎます');
  });

  it('配線：相手がいない・受けられない相手は断る。スイッチ以外は配線を持てない', () => {
    const sw: PlacedDevice = { id: 'switch_1', type: 'switch', position: [2, 0, 0], rotationYDeg: 0, signalTargets: ['nobody'] };
    expect(errorsOf(json([rail, sw]))).toContain('ありません');
    expect(errorsOf(json([rail, { ...sw, signalTargets: ['rail_1'] }]))).toContain('受けられません');
    expect(errorsOf(json([rail]).replace('"rotationYDeg"', '"signalTargets":["rail_1"],"rotationYDeg"'))).toContain('スイッチだけ');
  });

  it('知らない項目・物理の版の違い・接続の食い違いは注意として知らせて読み込む', () => {
    const r = parseBlueprint(json([rail], { physicsProfile: 'other', hello: 1, connections: [{ from: { deviceId: 'a', portId: 'b' }, to: { deviceId: 'c', portId: 'd' } }] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const w = r.warnings.join(' ');
    expect(w).toContain('物理のルール');
    expect(w).toContain('hello');
    expect(w).toContain('接続の記録');
  });

  it('読み込んだ配置は元に戻せる（自由研究）', () => {
    const ed = new EditorModel(layouts.VERTICAL_SLICE_LAYOUT.devices, 1);
    const r = parseBlueprint(json(layouts.GEAR_SAMPLE_LAYOUT.devices));
    if (!r.ok) throw new Error('parse');
    ed.loadLayout(r.devices, 'x');
    expect(ed.devices.map((d) => d.id)).toEqual(layouts.GEAR_SAMPLE_LAYOUT.devices.map((d) => d.id));
    ed.undo();
    expect(ed.devices.map((d) => d.id)).toEqual(layouts.VERTICAL_SLICE_LAYOUT.devices.map((d) => d.id));
  });
});

describe('この端末への保存', () => {
  const fake = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it('保存・一覧・同じ名前は上書き・消す', () => {
    const s = fake();
    expect(saveBlueprint('A', '{}', s, new Date(1)).ok).toBe(true);
    expect(saveBlueprint('B', '{}', s, new Date(2)).ok).toBe(true);
    expect(saveBlueprint('A', '{"x":1}', s, new Date(3)).ok).toBe(true);
    const list = listSaved(s);
    expect(list.map((x) => x.title)).toEqual(['A', 'B']);
    expect(list[0].json).toBe('{"x":1}');
    removeSaved(list[1].id, s);
    expect(listSaved(s).map((x) => x.title)).toEqual(['A']);
  });

  it(`${MAX_SAVED}件を超えたら古いものから消える。保存できない環境では理由を返す`, () => {
    const s = fake();
    for (let i = 0; i < MAX_SAVED + 3; i++) saveBlueprint(`n${i}`, '{}', s, new Date(i + 1));
    expect(listSaved(s)).toHaveLength(MAX_SAVED);
    expect(listSaved(s)[0].title).toBe(`n${MAX_SAVED + 2}`);
    expect(saveBlueprint('x', '{}', null).ok).toBe(false);
    const full = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    const r = saveBlueprint('x', '{}', full);
    expect(r.ok).toBe(false);
  });

  it('壊れた保存データは無視する', () => {
    const s = fake();
    s.setItem('bugworks.blueprints.v1', '{bad');
    expect(listSaved(s)).toEqual([]);
    s.setItem('bugworks.blueprints.v1', JSON.stringify([{ id: 1 }, { id: 'a', title: 't', savedAt: 's', json: '{}' }]));
    expect(listSaved(s)).toHaveLength(1);
  });
});

describe('ステージ 1-5：ゴールのあと保存でクリア', () => {
  let R: Rapier;
  const sims: Simulation[] = [];
  beforeAll(async () => {
    R = await loadRapier();
  });
  afterEach(() => {
    while (sims.length) sims.pop()!.dispose();
  });

  const setup = () => {
    const editor = new EditorModel([], 404);
    const sim = new Simulation(R, editor.layout);
    sims.push(sim);
    const ctl = new SimulationController(sim);
    editor.onChange((k) => k === 'layout' && ctl.applyLayout(editor.layout));
    const stage = new StageController(editor, ctl, sim, { seed: 404, devices: [] });
    // 1-5 はロックされているので、前のステージをクリアした記録を入れる代わりに直接開始できるようにする
    (stage as unknown as { progress: { cleared: string[] } }).progress = { cleared: ['1-1', '1-2', '1-3', '1-4'] };
    const clears: string[] = [];
    stage.onChange((c) => c === 'clear' && clears.push(stage.current!.id));
    expect(stage.start('1-5')).toBe(true);
    return { editor, sim, ctl, stage, clears };
  };

  it('ゴールに入れる前に保存してもクリアしない。ゴールのあと（リセットしてから）保存するとクリア', () => {
    const { editor, sim, ctl, stage, clears } = setup();
    stage.markSaved();
    expect(stage.events().blueprint_saved).toBe(false);
    for (const d of findStage('1-5')!.solution) editor.addDevice(d.type, d.position[0], d.position[2]);
    // 解き方の位置へ置き直す（追加はおおよその位置に置かれるため）
    for (const d of findStage('1-5')!.solution) {
      const placed = editor.devices.find((x) => x.type === d.type && !editor.isLocked(x.id))!;
      if (d.params) for (const [k, v] of Object.entries(d.params)) editor.setParam(placed.id, k, v);
      const ev = editor.previewMove(placed.id, d.position[0], d.position[2])!;
      editor.commitMove(placed.id, ev);
    }
    ctl.togglePlay();
    for (let i = 0; i < PHYSICS_HZ * 6 && !sim.events().ball_enter_goal; i++) {
      ctl.stepOnce();
      stage.update();
    }
    expect(sim.events().ball_enter_goal).toBe(true);
    expect(clears).toEqual([]);
    ctl.reset();
    stage.update();
    expect(stage.events().ball_enter_goal).toBe(true); // 保存のステージではゴールを覚えておく
    stage.markSaved();
    expect(clears).toEqual(['1-5']);
  });
});
