import { getDeviceDef, getPort, type PortDef, type Vec3 } from './catalog';
import { curvePorts, curveTurn } from './curveGeometry';
import { SHAFT_Y, isFloorShaftPort, shaftPortZ } from './drive';
import type { PlacedDevice } from './layout';

/** 試作用の鉄球半径（m）。仕様に記載なし → DECISIONS.md D-06 */
export const BALL_RADIUS = 0.1;

/** レール断面（試作値）。外形幅は devices.v0.1.json の size[0]=0.5 に収める */
export const RAIL_PROFILE = {
  innerWidth: 0.3,
  plateThickness: 0.04,
  wallThickness: 0.04,
  wallHeight: 0.12,
} as const;

export interface RailTrack {
  deviceId: string;
  /** 走行面の入口・出口（ワールド座標）。ポート座標＝走行面中心線上の点（DECISIONS.md D-05） */
  start: Vec3;
  end: Vec3;
  length: number;
  /** 走行方向の単位ベクトル */
  dir: Vec3;
  /** 走行面の法線（上向き） */
  normal: Vec3;
  /** 横方向（右手系: dir × normal） */
  side: Vec3;
  /** 傾斜角（rad, 下り正） */
  pitch: number;
  yawRad: number;
}

export function rotateY([x, y, z]: Vec3, rad: number): Vec3 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [x * c + z * s, y, -x * s + z * c];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale(a: Vec3, k: number): Vec3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

/** 装置のポート（装置ローカル）。カーブは曲がる向きで左右が変わる */
export function localPort(device: PlacedDevice, portId: string): PortDef {
  if (device.type === 'curve') {
    const p = curvePorts(curveTurn(device)).find((x) => x.id === portId);
    if (!p) throw new Error(`装置 ${device.id} にポート ${portId} がありません`);
    return p;
  }
  const port = getPort(getDeviceDef(device.type), portId);
  // 長さが変わる軸
  if (device.type === 'shaft') return { ...port, position: [0, port.position[1], shaftPortZ(device, portId)] };
  // 羽根車・可動橋の軸は、装置の高さによらず床から一定の高さ
  if (isFloorShaftPort(device, portId)) return { ...port, position: [port.position[0], SHAFT_Y - device.position[1], port.position[2]] };
  return port;
}

/** 装置ローカル座標のポートをワールド座標へ */
export function portWorldPosition(device: PlacedDevice, portId: string): Vec3 {
  const port = localPort(device, portId);
  let local = port.position;
  if (device.type === 'rail' && portId === 'ball_in') {
    local = [local[0], railInY(device), local[2]];
  }
  return add(device.position, rotateY(local, (device.rotationYDeg * Math.PI) / 180));
}

/**
 * slopeMeters パラメータは入口と出口の高低差として解釈する（DECISIONS.md D-07）。
 * 既定値 0.2 は JSON のポート高さ差（0.35-0.15）と一致する。
 */
function railInY(device: PlacedDevice): number {
  const def = getDeviceDef('rail');
  const out = getPort(def, 'ball_out').position[1];
  const slope = device.params?.slopeMeters ?? Number(def.params.slopeMeters);
  return out + slope;
}

/** ball_in → ball_out をまっすぐ結ぶ走行路（レール・羽根車・可動橋〔下りた状態〕） */
export function buildRailTrack(device: PlacedDevice): RailTrack {
  if (device.type !== 'rail' && device.type !== 'paddle' && device.type !== 'bridge') throw new Error(`直線の走行路ではありません: ${device.id}`);
  const start = portWorldPosition(device, 'ball_in');
  const end = portWorldPosition(device, 'ball_out');
  const d: Vec3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const length = Math.hypot(d[0], d[1], d[2]);
  const dir = scale(d, 1 / length);
  const horiz = Math.hypot(d[0], d[2]);
  const pitch = Math.atan2(-d[1], horiz);
  const yawRad = (device.rotationYDeg * Math.PI) / 180;
  // side = 水平な横方向, normal = side × dir（上向き）
  const side: Vec3 = rotateY([1, 0, 0], yawRad);
  const normal: Vec3 = [
    side[1] * dir[2] - side[2] * dir[1],
    side[2] * dir[0] - side[0] * dir[2],
    side[0] * dir[1] - side[1] * dir[0],
  ];
  // +Z前方・+X横 のとき side×dir は -Y を指すので符号を合わせる
  const n: Vec3 = normal[1] < 0 ? scale(normal, -1) : normal;
  return { deviceId: device.id, start, end, length, dir, normal: n, side, pitch, yawRad };
}

/** 走行面に接して置いた鉄球の中心座標 */
export function ballRestPosition(track: RailTrack, distanceAlongTrack: number): Vec3 {
  return add(add(track.start, scale(track.dir, distanceAlongTrack)), scale(track.normal, BALL_RADIUS));
}
