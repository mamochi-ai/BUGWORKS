import { getDeviceDef, type Vec3 } from './catalog';
import type { PlacedDevice } from './layout';
import { add, rotateY } from './railGeometry';

/**
 * 回転を伝える装置（DECISIONS.md D-25）。
 * 羽根車（球が通ると回る）→ 歯車装置（ギア比を掛ける）→ 軸（そのまま伝える）→ 可動橋（回った分だけ下りる）。
 *
 * 軸はどの装置でも床から SHAFT_Y の高さに通す。レールは下り坂で装置ごとに高さが違うため、
 * 羽根車と可動橋の軸ポートは「装置の高さによらず床から 0.65m」に置き、縦の軸で下ろす（見た目）。
 * 歯車装置と軸は床に置く（台の上には置けない＝軸の高さが合わない）。
 */
export const SHAFT_Y = 0.65;

/** 羽根車：長さ1mのレール（入口0.35m→出口0.25m）の上に羽根。球が通るたびに 90° 回る */
export const PADDLE = {
  length: 1,
  inY: 0.35,
  outY: 0.25,
  /** 球を数える範囲（ローカル：横 ±half、前後 ±z、走行面から上へ height） */
  zone: { half: 0.15, z: 0.2, height: 0.3 },
  /** 球1個で回る角度 */
  stepRad: Math.PI / 2,
  /** 羽根が回る速さの上限（rad/s） */
  maxSpeed: 2 * Math.PI,
  /** 軸を出す位置（ローカル x, z） */
  shaftX: 0.75,
} as const;

/** 可動橋：長さ2mのレール。最初は出口側を軸に入口側が跳ね上がっている。入力が closeInputRad 回ると下りきる */
export const BRIDGE = {
  openRad: (75 * Math.PI) / 180,
  closeInputRad: Math.PI,
  /** 橋が動く速さの上限（rad/s） */
  maxSpeed: 1.5,
  shaftX: 0.75,
} as const;

export function gearRatio(device: PlacedDevice): number {
  return device.params?.gearRatio ?? Number(getDeviceDef('gearbox').params.gearRatio);
}

export function shaftLength(device: PlacedDevice): number {
  return device.params?.lengthMeters ?? Number(getDeviceDef('shaft').params.lengthMeters);
}

/** 床から一定の高さに置く軸ポートか（羽根車・可動橋の軸） */
export function isFloorShaftPort(device: PlacedDevice, portId: string): boolean {
  return (device.type === 'paddle' && portId === 'shaft_out') || (device.type === 'bridge' && portId === 'shaft_in');
}

/** 長さが変わる軸のポート（装置ローカル） */
export function shaftPortZ(device: PlacedDevice, portId: string): number {
  const half = shaftLength(device) / 2;
  return portId === 'shaft_in' ? -half : half;
}

export function driveToWorld(device: PlacedDevice, local: Vec3): Vec3 {
  return add(device.position, rotateY(local, (device.rotationYDeg * Math.PI) / 180));
}

/** 羽根車の数える範囲に球の中心が入っているか */
export function inPaddleZone(device: PlacedDevice, p: Vec3): boolean {
  const yaw = (device.rotationYDeg * Math.PI) / 180;
  const l = rotateY([p[0] - device.position[0], p[1] - device.position[1], p[2] - device.position[2]], -yaw);
  const z = PADDLE.zone;
  const surface = PADDLE.inY + ((PADDLE.outY - PADDLE.inY) * (l[2] + PADDLE.length / 2)) / PADDLE.length;
  return Math.abs(l[0]) <= z.half && Math.abs(l[2]) <= z.z && l[1] >= surface && l[1] <= surface + z.height;
}

/** 可動橋の跳ね上がり角：入力の回転（rad）に応じて下りる（0 = つながった） */
export function bridgeTargetAngle(inputRad: number): number {
  const closed = Math.min(1, Math.max(0, Math.abs(inputRad) / BRIDGE.closeInputRad));
  return BRIDGE.openRad * (1 - closed);
}

/** 目標へ一定の速さで近づける */
export function approach(current: number, target: number, maxStep: number): number {
  if (Math.abs(target - current) <= maxStep) return target;
  return current + Math.sign(target - current) * maxStep;
}

export interface ShaftLink {
  /** 回転を受け取る装置 */
  to: string;
  /** 回転を渡す装置 */
  from: string;
}

/**
 * 各装置の「出力軸」の角度を求める。links は shaft_out → shaft_in の接続。
 * 羽根車＝自分の角度、歯車装置＝入力×ギア比、軸＝入力、その他＝入力なし。
 */
export function solveDrive(
  devices: readonly PlacedDevice[],
  links: readonly ShaftLink[],
  sourceAngle: (deviceId: string) => number,
): { input: Map<string, number>; output: Map<string, number> } {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const upstream = new Map(links.map((l) => [l.to, l.from]));
  const input = new Map<string, number>();
  const output = new Map<string, number>();
  const outOf = (id: string, seen: Set<string>): number => {
    if (output.has(id)) return output.get(id)!;
    const d = byId.get(id);
    if (!d || seen.has(id)) return 0; // つながりが輪になっていたら回さない
    seen.add(id);
    const up = upstream.get(id);
    const inAngle = up ? outOf(up, seen) : 0;
    input.set(id, inAngle);
    const out = d.type === 'paddle' ? sourceAngle(id) : d.type === 'gearbox' ? inAngle * gearRatio(d) : d.type === 'shaft' ? inAngle : 0;
    output.set(id, out);
    return out;
  };
  for (const d of devices) outOf(d.id, new Set());
  return { input, output };
}
