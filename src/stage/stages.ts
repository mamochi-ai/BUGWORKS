import type { DeviceType, PlacedDevice } from '../sim/layout';

/**
 * ステージ（DECISIONS.md D-26）。ステージ1配置資料 v0.1 の流れ（1-1〜1-5）を基準にする（2026-10-11 ユーザー判断）。
 * 座標は資料の blockout ではなく、このゲームの装置寸法に合わせて作り直した（資料の座標は未検証の仮置きのため）。
 *
 * - devices：最初から置いてある装置（固定。動かせない）
 * - inventory：プレイヤーが置ける装置と数
 * - required：通常クリアに必要な出来事（ステージ資料の requiredEvents）。隠しバグは必要条件にしない
 * - solution：解き方の一例（自動テストで「解ける」ことを確かめるためだけに使い、画面には出さない）
 */
export type StageEvent = 'ball_enter_goal' | 'spring_triggered' | 'paddle_turned' | 'bridge_connected' | 'switch_on' | 'blueprint_saved';

/** 1回の再生ではなく、ステージの間ずっと覚えておく出来事（設計図の保存はリセットしてから行うため） */
export const STICKY_EVENTS: readonly StageEvent[] = ['blueprint_saved'];

export const EVENT_TEXT: Record<StageEvent, string> = {
  ball_enter_goal: '球がゴールに入る',
  spring_triggered: 'バネで球を打ち上げる',
  paddle_turned: '球で羽根車を回す',
  bridge_connected: '可動橋をつなぐ',
  switch_on: 'スイッチを ON にする',
  blueprint_saved: '設計図を保存する（この端末かファイルへ）',
};

export interface StageDef {
  id: string;
  name: string;
  objective: string;
  /** S-404 のひとこと（ヒントだけ。答えは言わない） */
  hint: string;
  devices: PlacedDevice[];
  inventory: Partial<Record<DeviceType, number>>;
  required: StageEvent[];
  solution: PlacedDevice[];
  /** まだ遊べない（必要な機能が無い） */
  comingSoon?: string;
}

/** 床置きの発射機と、0.2m ずつ下る直線レール（z=-2 / 0 / 2） */
const launcher: PlacedDevice = { id: 'launcher_1', type: 'launcher', position: [0, 0, -3.65], rotationYDeg: 0 };
const rail = (id: string, y: number, z: number): PlacedDevice => ({ id, type: 'rail', position: [0, y, z], rotationYDeg: 0 });

export const STAGES: StageDef[] = [
  {
    id: '1-1',
    name: 'はじめの一歩',
    objective: '途切れたレールをつないで、球をゴールに届けよう',
    hint: '空いているところ、気になりますね。',
    devices: [launcher, rail('rail_1', 0.4, -2), rail('rail_3', 0, 2), { id: 'goal_1', type: 'goal', position: [0, 0, 3.75], rotationYDeg: 0 }],
    inventory: { rail: 1 },
    required: ['ball_enter_goal'],
    solution: [rail('rail_2', 0.2, 0)],
  },
  {
    id: '1-2',
    name: 'バネでジャンプ',
    objective: 'バネで段差を越えて、上の段のゴールへ',
    hint: '反発力って便利ですね。',
    devices: [
      { ...launcher, position: [0, 0.6, -3.65] },
      rail('rail_1', 1.0, -2),
      rail('rail_2', 0.8, 0),
      rail('rail_3', 0.6, 2),
      { id: 'platform_1', type: 'platform', position: [0, 0, 4.75], rotationYDeg: 0, params: { heightMeters: 1 } },
      { id: 'goal_1', type: 'goal', position: [0, 1, 5], rotationYDeg: 0 },
    ],
    inventory: { spring: 1 },
    required: ['spring_triggered', 'ball_enter_goal'],
    solution: [{ id: 'spring_1', type: 'spring', position: [0, 0, 3.5], rotationYDeg: 0, params: { tiltDegrees: 15 } }],
  },
  {
    id: '1-3',
    name: '曲がって運ぶ',
    objective: 'カーブレールで向きを変えて、横にあるゴールへ',
    hint: 'まっすぐだけが道ではありません。',
    devices: [launcher, rail('rail_1', 0.4, -2), rail('rail_2', 0.2, 0), { id: 'goal_1', type: 'goal', position: [2.25, 0, 2.25], rotationYDeg: 0 }],
    inventory: { curve: 1 },
    required: ['ball_enter_goal'],
    solution: [{ id: 'curve_1', type: 'curve', position: [0.5, 0, 1.75], rotationYDeg: 0, params: { turn: 1 } }],
  },
  {
    id: '1-4',
    name: '歯車で動かす',
    objective: '羽根車の回転を可動橋に伝えて、橋をつなごう',
    hint: '回るものは、つなぐと伝わります。',
    devices: [
      { ...launcher, position: [0, 0.6, -3.65] },
      rail('rail_1', 1.0, -2),
      { id: 'paddle_1', type: 'paddle', position: [0, 0.8, -0.5], rotationYDeg: 0 },
      rail('rail_2', 0.7, 1),
      { id: 'bridge_1', type: 'bridge', position: [0, 0.5, 3], rotationYDeg: 0 },
      { id: 'platform_1', type: 'platform', position: [0, 0, 4.8], rotationYDeg: 0, params: { heightMeters: 0.4 } },
      { id: 'goal_1', type: 'goal', position: [0, 0.4, 5], rotationYDeg: 0 },
    ],
    inventory: { gearbox: 1, shaft: 1 },
    required: ['paddle_turned', 'bridge_connected', 'ball_enter_goal'],
    solution: [
      { id: 'gearbox_1', type: 'gearbox', position: [0.75, 0, 0.75], rotationYDeg: 270, params: { gearRatio: 2 } },
      { id: 'shaft_1', type: 'shaft', position: [0.75, 0, 1.75], rotationYDeg: 0, params: { lengthMeters: 0.5 } },
    ],
  },
  {
    id: '1-5',
    name: '設計図を保存',
    objective: '球をゴールへ届けたあと、上の「設計図」から設計図を保存しよう',
    hint: '再現できるなら、研究成果です。',
    // 1-1〜1-3 の復習：レールとカーブで横のゴールへ。ゴールに入れたあと保存するとクリア
    devices: [launcher, rail('rail_1', 0.4, -2), { id: 'goal_1', type: 'goal', position: [2.25, 0, 2.25], rotationYDeg: 0 }],
    inventory: { rail: 1, curve: 1 },
    required: ['ball_enter_goal', 'blueprint_saved'],
    solution: [rail('rail_2', 0.2, 0), { id: 'curve_1', type: 'curve', position: [0.5, 0, 1.75], rotationYDeg: 0, params: { turn: 1 } }],
  },
];

/**
 * 遊べるか（アンロック順, DECISIONS.md D-27：順番に解放 — 2026-10-11 ユーザー判断）。
 * 最初のステージは最初から遊べる。それ以降は、それより前のステージをすべてクリアすると遊べる。
 */
export function unlockState(id: string, cleared: readonly string[]): { unlocked: boolean; reason?: string } {
  const i = STAGES.findIndex((s) => s.id === id);
  if (i < 0) return { unlocked: false, reason: 'このステージはありません' };
  // 前のステージがすべてクリア済みなら遊べる（記録が欠けていたら、最初に欠けているステージを案内する）
  const missing = STAGES.slice(0, i).find((s) => !cleared.includes(s.id));
  return missing ? { unlocked: false, reason: `${missing.id}「${missing.name}」をクリアすると遊べます` } : { unlocked: true };
}

export function findStage(id: string): StageDef | undefined {
  return STAGES.find((s) => s.id === id);
}
