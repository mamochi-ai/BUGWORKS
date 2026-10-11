import { findConnections } from '../edit/placement';
import { getDeviceDef, getPort, type Vec3 } from './catalog';
import { PHYSICS_DT } from './constants';
import type { PlacedDevice } from './layout';
import { BALL_RADIUS, add, rotateY, scale } from './railGeometry';

/** 同時に存在できる鉄球の上限（試作値, DECISIONS.md D-19） */
export const MAX_BALLS = 16;

export interface LauncherParams {
  launchSpeed: number;
  angleDegrees: number;
  cooldownSeconds: number;
}

/**
 * 発射機の形（ローカル座標：原点＝接地面中心、前方＝+Z）。
 * 水平な溝（シュート）の後ろに横向きのばねと押し板があり、溝の前端が ball_out（レールの入口）。
 */
const OUT = getPort(getDeviceDef('launcher'), 'ball_out').position;
export const LAUNCHER_SHAPE = {
  /** 台座の当たり判定 */
  base: { size: [1, 0.5, 1.2] as Vec3, center: [0, 0.25, -0.1] as Vec3 },
  /** 溝の走行面の高さ（= ball_out の高さ。つないだレールの走行面と段差なくつながる） */
  surfaceY: OUT[1],
  /** 溝の後端（後ろ壁）と前端（= ball_out） */
  backZ: -0.6,
  frontZ: OUT[2],
  /** 押し板の前面：縮めたとき／伸ばしたとき */
  plungerRetractedZ: -0.3,
  plungerExtendedZ: -0.12,
  /** 装填した球の中心（押し板を縮めた状態で、その前に接して止まる） */
  loadZ: -0.3 + BALL_RADIUS,
  /** 次の球を落とす高さ（走行面から球の中心まで） */
  hopperDrop: 0.32,
} as const;

/** 撃ってから次の球を落とすまで（押し板が戻りきるのを待つ）。試作値 */
export const RELOAD_SECONDS = 0.25;

export interface LauncherPlan {
  deviceId: string;
  /** 装填位置（溝の上に止まった球の中心） */
  loadPoint: Vec3;
  /** 次の球を落とし始める位置 */
  hopperPoint: Vec3;
  /** 発射時に球に与える速度（溝の向き × launchSpeed） */
  velocity: Vec3;
  periodTicks: number;
  reloadTicks: number;
  /** ball_out につながっているレール（なければ null） */
  feedsRailId: string | null;
  params: LauncherParams;
}

export function launcherParams(device: PlacedDevice): LauncherParams {
  const def = getDeviceDef('launcher').params;
  const pick = (k: keyof LauncherParams) => device.params?.[k] ?? Number(def[k]);
  return { launchSpeed: pick('launchSpeed'), angleDegrees: pick('angleDegrees'), cooldownSeconds: pick('cooldownSeconds') };
}

/** ローカル座標 → ワールド座標 */
export function launcherToWorld(device: PlacedDevice, local: Vec3): Vec3 {
  return add(device.position, rotateY(local, (device.rotationYDeg * Math.PI) / 180));
}

/**
 * 発射のしかた（DECISIONS.md D-18）：
 * 球は溝の後ろに装填され、ばねの押し板で溝の向き（水平・前方）に launchSpeed で押し出される。
 * 溝の前端が ball_out なので、つないだレールへそのまま転がり込む。レールがなければ前へ飛び出して落ちる。
 * angleDegrees は今の形（水平な溝）では使わない（SPEC_GAPS G-17）。
 */
export function planLauncher(device: PlacedDevice, devices: readonly PlacedDevice[]): LauncherPlan {
  const params = launcherParams(device);
  const s = LAUNCHER_SHAPE;
  const conn = findConnections(devices).find((c) => c.from.deviceId === device.id && c.from.portId === 'ball_out');
  const forward = rotateY([0, 0, 1], (device.rotationYDeg * Math.PI) / 180);
  return {
    deviceId: device.id,
    loadPoint: launcherToWorld(device, [0, s.surfaceY + BALL_RADIUS, s.loadZ]),
    hopperPoint: launcherToWorld(device, [0, s.surfaceY + s.hopperDrop, s.loadZ]),
    velocity: scale(forward, params.launchSpeed),
    periodTicks: Math.max(1, Math.round(params.cooldownSeconds / PHYSICS_DT)),
    reloadTicks: Math.round(RELOAD_SECONDS / PHYSICS_DT),
    feedsRailId: conn?.to.deviceId ?? null,
    params,
  };
}

/**
 * 押し板の縮み具合（描画用）。0＝伸びている（撃った瞬間）、1＝縮みきっている（装填・待機中）。
 * 撃った直後 0.06 秒は伸ばしたまま見せ、その後 RELOAD_SECONDS までに縮める。
 */
export function plungerCompression(ticksSinceFire: number | null): number {
  if (ticksSinceFire === null) return 1;
  const t = ticksSinceFire * PHYSICS_DT;
  const hold = 0.06;
  if (t <= hold) return 0;
  return Math.min(1, (t - hold) / (RELOAD_SECONDS - hold));
}
