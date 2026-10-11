import type { Vec3 } from './catalog';

/**
 * 縦切り試作用のシーン定義。マスター仕様 §7 の設計図JSON暫定契約の「devices」部分だけを模した
 * 内部データであり、設計図の保存/読込/検証はまだ実装していない（TODO.md 参照）。
 */
export interface PlacedDevice {
  /** シーン内で一意のID */
  id: string;
  /** devices.v0.1.json の装置ID */
  type: 'rail';
  /** 装置ローカル原点のワールド座標（m）。原点＝ポート座標の基準点（DECISIONS.md D-05） */
  position: Vec3;
  /** Y軸回転（度）。90度単位スナップを想定 */
  rotationYDeg: number;
  params?: { slopeMeters?: number };
}

export interface SliceLayout {
  seed: number;
  devices: PlacedDevice[];
  /** 鉄球の初期配置：どのレールの ball_in に置くか */
  ballStart: { deviceId: string; portId: 'ball_in'; offsetAlongTrack: number };
}

/**
 * 3本のレールを ball_out → ball_in で連結した下り坂。
 * レール既定値: ball_in y=0.35 / ball_out y=0.15 / 長さ2m（devices.v0.1.json）。
 * 各レールを 0.2m ずつ下げて前のレールの出口と次の入口を一致させる。
 */
export const VERTICAL_SLICE_LAYOUT: SliceLayout = {
  seed: 404,
  devices: [
    { id: 'rail_1', type: 'rail', position: [0, 0.4, -3], rotationYDeg: 0 },
    { id: 'rail_2', type: 'rail', position: [0, 0.2, -1], rotationYDeg: 0 },
    { id: 'rail_3', type: 'rail', position: [0, 0.0, 1], rotationYDeg: 0 },
  ],
  ballStart: { deviceId: 'rail_1', portId: 'ball_in', offsetAlongTrack: 0.15 },
};
