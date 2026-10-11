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
}

export type DeviceType = 'rail' | 'launcher';

export interface SliceLayout {
  seed: number;
  devices: PlacedDevice[];
}

/** 発射機につながったレールに球を出す位置：レール入口から走行方向へこの距離（m） */
export const BALL_START_OFFSET = 0.15;

/**
 * 鉄球発射機1台と、3本のレールを ball_out → ball_in で連結した下り坂。
 * レール既定値: ball_in y=0.35 / ball_out y=0.15 / 長さ2m（devices.v0.1.json）。
 * 各レールを 0.2m ずつ下げて前のレールの出口と次の入口を一致させる。
 * 北の壁との間に1本分の空きを残し、先頭の手前にもレールを足せるようにしている。
 */
export const VERTICAL_SLICE_LAYOUT: SliceLayout = {
  seed: 404,
  devices: [
    // 発射機の ball_out（y=0.75）がちょうど rail_1 の入口（0.4+0.35）に一致する
    { id: 'launcher_1', type: 'launcher', position: [0, 0, -3.65], rotationYDeg: 0 },
    { id: 'rail_1', type: 'rail', position: [0, 0.4, -2], rotationYDeg: 0 },
    { id: 'rail_2', type: 'rail', position: [0, 0.2, 0], rotationYDeg: 0 },
    { id: 'rail_3', type: 'rail', position: [0, 0.0, 2], rotationYDeg: 0 },
  ],
};
