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
export type StageEvent = 'ball_enter_goal' | 'spring_triggered' | 'paddle_turned' | 'bridge_connected' | 'switch_on' | 'all_goals' | 'blueprint_saved';

/** 1回の再生ではなく、ステージの間ずっと覚えておく出来事（設計図の保存はリセットしてから行うため） */
export const STICKY_EVENTS: readonly StageEvent[] = ['blueprint_saved'];

export const EVENT_TEXT: Record<StageEvent, string> = {
  ball_enter_goal: '球がゴールに入る',
  spring_triggered: 'バネで球を打ち上げる',
  paddle_turned: '球で羽根車を回す',
  bridge_connected: '可動橋をつなぐ',
  switch_on: 'スイッチを ON にする',
  all_goals: 'すべてのゴールに球を入れる',
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
/**
 * 羽根車 → 歯車装置（固定・2倍）→ ［軸 1.5m］→ 遠くの可動橋 → ゴール（ステージ3用）。
 * 1-4 より可動橋が遠く、間に 1m のレールがある（全体を 0.5m 手前にずらし、可動橋の先は 1-4 と同じ台の上のゴール）。
 */
const gearChain = (): PlacedDevice[] => [
  { ...launcher, position: [0, 0.6, -4.15] },
  rail('rail_1', 1.0, -2.5),
  { id: 'paddle_1', type: 'paddle', position: [0, 0.8, -1], rotationYDeg: 0 },
  rail('rail_2', 0.7, 0.5),
  { id: 'rail_3', type: 'rail', position: [0, 0.6, 2], rotationYDeg: 0, params: { lengthMeters: 1, slopeMeters: 0.1 } },
  { id: 'bridge_1', type: 'bridge', position: [0, 0.4, 3.5], rotationYDeg: 0 },
  { id: 'gearbox_1', type: 'gearbox', position: [0.75, 0, 0.25], rotationYDeg: 270, params: { gearRatio: 2 } },
  { id: 'platform_1', type: 'platform', position: [0, 0, 4.8], rotationYDeg: 0, params: { heightMeters: 0.4 } },
  { id: 'goal_1', type: 'goal', position: [0, 0.4, 5], rotationYDeg: 0 },
];
/** 床の発射機とレール（rail_1 の出口：z=−1, 高さ0.55m）。その先 z=−0.4 に回転台を置ける */
const turnBase = (): PlacedDevice[] => [launcher, rail('rail_1', 0.4, -2)];
/** 床へ転がり出る発射機（3秒ごと）とレール3本（rail_3 の出口：z=3, 床の高さ）。ステージ4用 */
const floorChain = (): PlacedDevice[] => [{ ...launcher, params: { cooldownSeconds: 3 } }, rail('rail_1', 0.4, -2), rail('rail_2', 0.2, 0), rail('rail_3', 0, 2)];
const magnet = (id: string, x: number, z: number, rotationYDeg: number, params: Record<string, number>): PlacedDevice => ({ id, type: 'magnet', position: [x, 0, z], rotationYDeg, params });
/** 高い所から始まる発射機とレール3本（1-2 と同じ。rail_3 の出口：z=3, 高さ0.75m） */
const highChain = (): PlacedDevice[] => [{ ...launcher, position: [0, 0.6, -3.65] }, rail('rail_1', 1.0, -2), rail('rail_2', 0.8, 0), rail('rail_3', 0.6, 2)];

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
  // ---- ステージ2「はねる」（バネとタイミング。ステージ資料 v1.0 は題だけなので、内容は試作で作った, D-35）
  {
    id: '2-1',
    name: '高い段へ',
    objective: 'バネで、1-2 より高い段のゴールまで跳ばそう',
    hint: '傾きと強さ、両方さわってみましょう。',
    devices: [...highChain(), { id: 'platform_1', type: 'platform', position: [0, 0, 4.9], rotationYDeg: 0, params: { heightMeters: 1.4 } }, { id: 'goal_1', type: 'goal', position: [0, 1.4, 5], rotationYDeg: 0 }],
    inventory: { spring: 1 },
    required: ['spring_triggered', 'ball_enter_goal'],
    solution: [{ id: 'spring_1', type: 'spring', position: [0, 0, 3.5], rotationYDeg: 0, params: { tiltDegrees: 15, launchSpeed: 6 } }],
  },
  {
    id: '2-2',
    name: '遠くへ跳ぶ',
    objective: 'レールの先から離れた台のゴールへ、バネで跳び移ろう',
    hint: '遠くへ飛ばすなら、ななめに強く。',
    devices: [
      { ...launcher, position: [0, 0.6, -4.65] },
      rail('rail_1', 1.0, -3),
      rail('rail_2', 0.8, -1),
      { id: 'platform_1', type: 'platform', position: [0, 0, 4], rotationYDeg: 0, params: { heightMeters: 1 } },
      { id: 'goal_1', type: 'goal', position: [0, 1, 4.25], rotationYDeg: 0 },
    ],
    inventory: { spring: 1 },
    required: ['spring_triggered', 'ball_enter_goal'],
    solution: [{ id: 'spring_1', type: 'spring', position: [0, 0, 1], rotationYDeg: 0, params: { tiltDegrees: 30, launchSpeed: 6 } }],
  },
  {
    id: '2-3',
    name: 'スイッチを置こう',
    objective: 'すき間にスイッチを置いて、球でスイッチを入れながらゴールへ',
    hint: '通るたびに、カチッと切り替わります。',
    devices: [launcher, rail('rail_1', 0.4, -2), rail('rail_2', 0.1, 1), { id: 'goal_1', type: 'goal', position: [0, 0, 3], rotationYDeg: 0 }],
    inventory: { switch: 1 },
    required: ['switch_on', 'ball_enter_goal'],
    solution: [{ id: 'switch_1', type: 'switch', position: [0, 0.2, -0.5], rotationYDeg: 0 }],
  },
  {
    id: '2-4',
    name: '磁石を止める',
    objective: '磁石が球をそらしてしまう。スイッチを置いて磁石に配線し、ゴールへ通そう',
    hint: 'ON と OFF、交互にやってきます。',
    devices: [
      { ...launcher, params: { cooldownSeconds: 2 } },
      rail('rail_1', 0.4, -2),
      rail('rail_2', 0.1, 1),
      { id: 'goal_1', type: 'goal', position: [0, 0, 4.75], rotationYDeg: 0 },
      { id: 'magnet_1', type: 'magnet', position: [1.25, 0, 3.25], rotationYDeg: 270, params: { mode: 1, maxForceNewton: 40, radius: 2.5 } },
    ],
    inventory: { switch: 1 },
    required: ['switch_on', 'ball_enter_goal'],
    solution: [{ id: 'switch_1', type: 'switch', position: [0, 0.2, -0.5], rotationYDeg: 0, signalTargets: ['magnet_1'] }],
  },
  {
    id: '2-5',
    name: '高低差を越える',
    objective: '途切れたレールをつなぎ、バネで高い段のゴールへ',
    hint: 'ここまでの研究の、総まとめです。',
    devices: [
      ...highChain().filter((d) => d.id !== 'rail_2'),
      { id: 'platform_1', type: 'platform', position: [0, 0, 4.9], rotationYDeg: 0, params: { heightMeters: 1.4 } },
      { id: 'goal_1', type: 'goal', position: [0, 1.4, 5], rotationYDeg: 0 },
    ],
    inventory: { rail: 1, spring: 1 },
    required: ['spring_triggered', 'ball_enter_goal'],
    solution: [rail('rail_2', 0.8, 0), { id: 'spring_1', type: 'spring', position: [0, 0, 3.5], rotationYDeg: 0, params: { tiltDegrees: 15, launchSpeed: 6 } }],
  },
  // ---- ステージ3「まわる」（歯車・回転軸・伝達、回転台。ステージ資料 v1.0 は題だけなので、内容は試作で作った, D-39）
  {
    id: '3-1',
    name: '軸をのばす',
    objective: '歯車装置から可動橋まで、軸で回転を伝えよう',
    hint: '長さ、合っていますか？',
    devices: gearChain(),
    inventory: { shaft: 1 },
    required: ['bridge_connected', 'ball_enter_goal'],
    solution: [{ id: 'shaft_1', type: 'shaft', position: [0.75, 0, 1.75], rotationYDeg: 0, params: { lengthMeters: 1.5 } }],
  },
  {
    id: '3-2',
    name: '回転台で曲げる',
    objective: '回転台を置いて、左にあるゴールへ球を運ぼう',
    hint: '止まって、回って、出ていきます。',
    devices: [...turnBase(), { id: 'rail_2', type: 'rail', position: [1.6, 0.2, -0.4], rotationYDeg: 90 }, { id: 'goal_1', type: 'goal', position: [3.25, 0, -0.4], rotationYDeg: 0 }],
    inventory: { rotator: 1 },
    required: ['ball_enter_goal'],
    solution: [{ id: 'rotator_1', type: 'rotator', position: [0, 0.2, -0.4], rotationYDeg: 0 }],
  },
  {
    id: '3-3',
    name: '右へ回す',
    objective: '今度のゴールは右。回転台の回る向きを変えよう',
    hint: '左回りだけが回転ではありません。',
    devices: [...turnBase(), { id: 'rail_2', type: 'rail', position: [-1.6, 0.2, -0.4], rotationYDeg: 270 }, { id: 'goal_1', type: 'goal', position: [-3.25, 0, -0.4], rotationYDeg: 0 }],
    inventory: { rotator: 1 },
    required: ['ball_enter_goal'],
    solution: [{ id: 'rotator_1', type: 'rotator', position: [0, 0.2, -0.4], rotationYDeg: 0, params: { direction: -1 } }],
  },
  {
    id: '3-4',
    name: '両方のゴールへ',
    objective: '回転台は回り続けている。スイッチで止めて、前と左の両方のゴールに入れよう',
    hint: '回すか、止めるか。それが問題です。',
    devices: [
      { ...launcher, params: { cooldownSeconds: 3 } },
      { id: 'rail_1', type: 'rail', position: [0, 0.4, -1.5], rotationYDeg: 0, params: { lengthMeters: 1, slopeMeters: 0.1 } },
      { id: 'rotator_1', type: 'rotator', position: [0, 0.2, -0.4], rotationYDeg: 0, params: { degreesPerSecond: 90 } },
      { id: 'rail_2', type: 'rail', position: [0, 0.2, 1.2], rotationYDeg: 0 },
      { id: 'goal_1', type: 'goal', position: [0, 0, 3], rotationYDeg: 0 },
      { id: 'rail_3', type: 'rail', position: [1.6, 0.2, -0.4], rotationYDeg: 90 },
      { id: 'goal_2', type: 'goal', position: [3.25, 0, -0.4], rotationYDeg: 0 },
    ],
    inventory: { switch: 1 },
    required: ['all_goals'],
    solution: [{ id: 'switch_1', type: 'switch', position: [0, 0.4, -2.5], rotationYDeg: 0, signalTargets: ['rotator_1'] }],
  },
  {
    id: '3-5',
    name: '動力を別の軸へ',
    objective: '羽根車の回転を、歯車装置と軸で遠くの可動橋まで伝えよう',
    hint: 'まわる研究の、総まとめです。',
    devices: gearChain().filter((d) => d.type !== 'gearbox'),
    inventory: { gearbox: 1, shaft: 1 },
    required: ['paddle_turned', 'bridge_connected', 'ball_enter_goal'],
    solution: [
      { id: 'gearbox_1', type: 'gearbox', position: [0.75, 0, 0.25], rotationYDeg: 270, params: { gearRatio: 2 } },
      { id: 'shaft_1', type: 'shaft', position: [0.75, 0, 1.75], rotationYDeg: 0, params: { lengthMeters: 1.5 } },
    ],
  },
  // ---- ステージ4「ひきあう」（磁石と極性。ステージ資料 v1.0 は題だけなので、内容は試作で作った, D-43）
  {
    id: '4-1',
    name: '引きよせる',
    objective: '磁石を置いて、転がる球を横のゴールへ引きよせよう',
    hint: '届く距離、足りていますか？',
    devices: [...floorChain(), { id: 'goal_1', type: 'goal', position: [1, 0, 4.5], rotationYDeg: 0 }],
    inventory: { magnet: 1 },
    required: ['ball_enter_goal'],
    solution: [magnet('magnet_1', 2, 4, 270, { radius: 2.5 })],
  },
  {
    id: '4-2',
    name: 'しりぞける',
    objective: '今度のゴールは反対側。磁石で球を押して届けよう',
    hint: '引くだけが磁石ではありません。',
    devices: [...floorChain(), { id: 'goal_1', type: 'goal', position: [-1, 0, 4.5], rotationYDeg: 0 }],
    inventory: { magnet: 1 },
    required: ['ball_enter_goal'],
    solution: [magnet('magnet_1', 1.25, 3.5, 270, { mode: -1, maxForceNewton: 40, radius: 2.5 })],
  },
  {
    id: '4-3',
    name: '遠くのゴール',
    objective: '遠く離れたゴールへ。磁石の向きと置き場所を考えよう',
    hint: '磁石は、前を向いている方にしか効きません。',
    devices: [...floorChain(), { id: 'goal_1', type: 'goal', position: [-2.5, 0, 4], rotationYDeg: 0 }],
    inventory: { magnet: 1 },
    required: ['ball_enter_goal'],
    solution: [magnet('magnet_1', -2.5, 5, 180, { maxForceNewton: 40, radius: 3 })],
  },
  {
    id: '4-4',
    name: 'つり合い',
    objective: '左の磁石が球を引っぱってしまう。もう1台の磁石で打ち消して、まっすぐゴールへ',
    hint: 'つり合い、という言葉があります。',
    devices: [...floorChain(), magnet('magnet_1', -1.25, 3.5, 90, { mode: 1, maxForceNewton: 30, radius: 2.5 }), { id: 'goal_1', type: 'goal', position: [0, 0, 5], rotationYDeg: 0 }],
    inventory: { magnet: 1 },
    required: ['ball_enter_goal'],
    solution: [magnet('magnet_2', 1.25, 3.5, 270, { mode: 1, maxForceNewton: 30, radius: 2.5 })],
  },
  {
    id: '4-5',
    name: '入れ分ける',
    objective: '磁石とスイッチを置いて、2つのゴールに球を入れ分けよう',
    hint: 'ひきあう研究の、総まとめです。',
    devices: [
      { ...launcher, params: { cooldownSeconds: 2 } },
      rail('rail_1', 0.4, -2),
      rail('rail_2', 0.1, 1),
      { id: 'goal_1', type: 'goal', position: [0, 0, 4.75], rotationYDeg: 0 },
      { id: 'goal_2', type: 'goal', position: [0.5, 0, 3.5], rotationYDeg: 0 },
    ],
    inventory: { magnet: 1, switch: 1 },
    required: ['all_goals'],
    solution: [
      { id: 'switch_1', type: 'switch', position: [0, 0.2, -0.5], rotationYDeg: 0, signalTargets: ['magnet_1'] },
      magnet('magnet_1', 1.5, 3.5, 270, { mode: 1, maxForceNewton: 40, radius: 2.5 }),
    ],
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
