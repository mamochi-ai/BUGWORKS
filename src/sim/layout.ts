import type { Vec3 } from './catalog';

/**
 * 縦切り試作用のシーン定義。マスター仕様 §7 の設計図JSON暫定契約の「devices」部分だけを模した
 * 内部データであり、設計図の保存/読込/検証はまだ実装していない（TODO.md 参照）。
 */
export interface PlacedDevice {
  /** シーン内で一意のID */
  id: string;
  /** devices.v0.1.json の装置ID（実装済みのもののみ） */
  type: DeviceType;
  /** 装置ローカル原点のワールド座標（m）。原点＝ポート座標の基準点（DECISIONS.md D-05） */
  position: Vec3;
  /** Y軸回転（度）。90度単位スナップを想定 */
  rotationYDeg: number;
  /** devices.v0.1.json の params を上書きする値（省略時は JSON の既定値） */
  params?: Record<string, number>;
  /** スイッチの配線先（信号を送る装置のID。発射機・磁石だけ。D-30） */
  signalTargets?: string[];
}

export type DeviceType = 'rail' | 'launcher' | 'spring' | 'goal' | 'platform' | 'curve' | 'paddle' | 'gearbox' | 'shaft' | 'bridge' | 'magnet' | 'switch';

export interface SliceLayout {
  seed: number;
  devices: PlacedDevice[];
}

/** 発射機につながったレールに球を出す位置：レール入口から走行方向へこの距離（m） */
export const BALL_START_OFFSET = 0.15;

/**
 * 鉄球発射機1台と3本のレールを ball_out → ball_in で連結した下り坂の先に、バネ装置を置いた配置。
 * レール既定値: ball_in y=0.35 / ball_out y=0.15 / 長さ2m（devices.v0.1.json）。各レールを 0.2m ずつ下げて連結する。
 * バネの天板（0.65m）より高い所から球が落ちるよう、発射機とレールを 0.6m 持ち上げている（発射機は脚で支える）。
 * 最後のレールの出口（z=3）を出た球は約0.5m先に落ちるので、バネの中心を z=3.5 に置く。
 * 北の壁との間に1本分の空きを残している。
 */
export const VERTICAL_SLICE_LAYOUT: SliceLayout = {
  seed: 404,
  devices: [
    // 発射機の ball_out（0.6+0.75）がちょうど rail_1 の入口（1.0+0.35）に一致する
    { id: 'launcher_1', type: 'launcher', position: [0, 0.6, -3.65], rotationYDeg: 0 },
    { id: 'rail_1', type: 'rail', position: [0, 1.0, -2], rotationYDeg: 0 },
    { id: 'rail_2', type: 'rail', position: [0, 0.8, 0], rotationYDeg: 0 },
    { id: 'rail_3', type: 'rail', position: [0, 0.6, 2], rotationYDeg: 0 },
    // 天板を 15° 前へ傾け、打ち上げた球を前へ送り出す（0° だと真上に上がって同じバネに落ち続ける）
    { id: 'spring_1', type: 'spring', position: [0, 0, 3.5], rotationYDeg: 0, params: { tiltDegrees: 15 } },
    // バネで打ち上げた球が上の段（高さ1m の台）に落ち、転がってゴールに入る
    { id: 'platform_1', type: 'platform', position: [0, 0, 4.75], rotationYDeg: 0, params: { heightMeters: 1 } },
    { id: 'goal_1', type: 'goal', position: [0, 1, 5], rotationYDeg: 0 },
  ],
};

/**
 * 見本「歯車で可動橋」（DECISIONS.md D-25）：
 * 発射機 → レール → 羽根車 → レール → 可動橋 → 台の上のゴール。
 * 羽根車の軸 → 歯車装置（2倍）→ 軸 → 可動橋。1個目の球が羽根車を 90° 回すと、2倍で 180° 伝わって橋が下りる。
 * 1個目の球は橋が下りる前に着くので、すき間から落ちる。2個目からは橋を渡ってゴールへ。
 */
export const GEAR_SAMPLE_LAYOUT: SliceLayout = {
  seed: 404,
  devices: [
    { id: 'launcher_1', type: 'launcher', position: [0, 0.6, -3.65], rotationYDeg: 0 },
    { id: 'rail_1', type: 'rail', position: [0, 1.0, -2], rotationYDeg: 0 },
    { id: 'paddle_1', type: 'paddle', position: [0, 0.8, -0.5], rotationYDeg: 0 },
    { id: 'rail_2', type: 'rail', position: [0, 0.7, 1], rotationYDeg: 0 },
    { id: 'bridge_1', type: 'bridge', position: [0, 0.5, 3], rotationYDeg: 0 },
    // 歯車装置は 270° 回して入力を -Z、出力を +Z に向ける
    { id: 'gearbox_1', type: 'gearbox', position: [0.75, 0, 0.75], rotationYDeg: 270, params: { gearRatio: 2 } },
    { id: 'shaft_1', type: 'shaft', position: [0.75, 0, 1.75], rotationYDeg: 0, params: { lengthMeters: 0.5 } },
    { id: 'platform_1', type: 'platform', position: [0, 0, 4.8], rotationYDeg: 0, params: { heightMeters: 0.4 } },
    { id: 'goal_1', type: 'goal', position: [0, 0.4, 5], rotationYDeg: 0 },
  ],
};

/**
 * 見本「磁石でゴール」（DECISIONS.md D-29）：床置きの発射機とレール3本。レールの先は床を転がり、
 * 右手前の磁石（引きよせる・強さ40N・届く距離2.5m）が球を引きよせ、磁石の前のゴールに入る。磁石が無いとゴールしない。
 */
export const MAGNET_SAMPLE_LAYOUT: SliceLayout = {
  seed: 404,
  devices: [
    { id: 'launcher_1', type: 'launcher', position: [0, 0, -3.65], rotationYDeg: 0 },
    { id: 'rail_1', type: 'rail', position: [0, 0.4, -2], rotationYDeg: 0 },
    { id: 'rail_2', type: 'rail', position: [0, 0.2, 0], rotationYDeg: 0 },
    { id: 'rail_3', type: 'rail', position: [0, 0, 2], rotationYDeg: 0 },
    { id: 'magnet_1', type: 'magnet', position: [1.75, 0, 4.5], rotationYDeg: 270, params: { mode: 1, maxForceNewton: 40, radius: 2.5 } },
    { id: 'goal_1', type: 'goal', position: [1, 0, 4.5], rotationYDeg: 0 },
  ],
};

/**
 * 見本「スイッチで発射」（DECISIONS.md D-30）：左の発射機（3秒ごと）の球がスイッチを通るたびに ON/OFF が切り替わる。
 * スイッチは右の発射機に配線してあり、右の発射機は ON の間だけ 1 秒ごとに撃つ（3発撃って止まり、次の球でまた撃つ）。
 */
export const SWITCH_SAMPLE_LAYOUT: SliceLayout = {
  seed: 404,
  devices: [
    { id: 'launcher_1', type: 'launcher', position: [0, 0, -3.65], rotationYDeg: 0, params: { cooldownSeconds: 3 } },
    { id: 'rail_1', type: 'rail', position: [0, 0.4, -2], rotationYDeg: 0 },
    { id: 'rail_2', type: 'rail', position: [0, 0.2, 0], rotationYDeg: 0 },
    { id: 'switch_1', type: 'switch', position: [0, 0, 1.5], rotationYDeg: 0, signalTargets: ['launcher_2'] },
    { id: 'goal_1', type: 'goal', position: [0, 0, 2.75], rotationYDeg: 0 },
    { id: 'launcher_2', type: 'launcher', position: [2.5, 0, -3.65], rotationYDeg: 0 },
    { id: 'rail_3', type: 'rail', position: [2.5, 0.4, -2], rotationYDeg: 0 },
    { id: 'rail_4', type: 'rail', position: [2.5, 0.2, 0], rotationYDeg: 0 },
    { id: 'rail_5', type: 'rail', position: [2.5, 0, 2], rotationYDeg: 0 },
    { id: 'goal_2', type: 'goal', position: [2.5, 0, 3.75], rotationYDeg: 0 },
  ],
};

/**
 * 見本「いろいろなレール」（DECISIONS.md D-31）：3m で 0.4m 下る直線 → 急なカーブ → 1m のほぼ水平な直線 →
 * 45°の曲がり始め＋曲がり終わり（隣の列への車線変更）→ 直線 → ゴール。
 * 車線変更のあとは位置が 0.25m グリッドから少しずれる（斜めの長さが割り切れないため）。
 */
export const RAIL_SAMPLE_LAYOUT: SliceLayout = {
  seed: 404,
  devices: [
    { id: 'launcher_1', type: 'launcher', position: [-3, 1, -3.65], rotationYDeg: 0 },
    { id: 'rail_1', type: 'rail', position: [-3, 1.2, -1.5], rotationYDeg: 0, params: { lengthMeters: 3, slopeMeters: 0.4 } },
    { id: 'curve_1', type: 'curve', position: [-2.75, 1, 0.5], rotationYDeg: 0, params: { radius: 0.75, turn: 1 } },
    { id: 'rail_2', type: 'rail', position: [-1.75, 0.9, 0.75], rotationYDeg: 90, params: { lengthMeters: 1, slopeMeters: 0.1 } },
    { id: 'curve_2', type: 'curve', position: [-0.75, 0.7, 0.75], rotationYDeg: 90, params: { arc: 1, turn: 1 } },
    { id: 'curve_3', type: 'curve', position: [0.017766952, 0.7, 0.017766952], rotationYDeg: 180, params: { arc: 2, turn: -1 } },
    { id: 'rail_3', type: 'rail', position: [1.517766952, 0.5, 0.017766952], rotationYDeg: 90, params: { lengthMeters: 2, slopeMeters: 0.2 } },
    { id: 'goal_1', type: 'goal', position: [3.25, 0, 0], rotationYDeg: 0 },
  ],
};
