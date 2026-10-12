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
  /** 撃つ球の数（0 = いくつでも）。試作で追加（devices.v0.1.json に無い, DECISIONS.md D-41） */
  shots: number;
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
  /** 装填した球の中心（押し板を縮めた状態で、その前に接して止まる。溝が水平のとき） */
  loadZ: -0.3 + BALL_RADIUS,
  /** 次の球を落とす高さ（走行面から球の中心まで） */
  hopperDrop: 0.32,
} as const;

/** 撃ってから次の球を落とすまで（押し板が戻りきるのを待つ）。試作値 */
export const RELOAD_SECONDS = 0.25;

export interface LauncherPlan {
  deviceId: string;
  /** 実際の溝の角度（rad）。レールにつながっていれば 0 */
  angle: number;
  /** 溝の後端（軸）のワールド座標と、溝に沿った向き・溝の面の法線 */
  pivot: Vec3;
  dir: Vec3;
  normal: Vec3;
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
  const shots = Math.max(0, Math.round(device.params?.shots ?? 0));
  return { launchSpeed: pick('launchSpeed'), angleDegrees: pick('angleDegrees'), cooldownSeconds: pick('cooldownSeconds'), shots };
}

/** ローカル座標 → ワールド座標 */
export function launcherToWorld(device: PlacedDevice, local: Vec3): Vec3 {
  return add(device.position, rotateY(local, (device.rotationYDeg * Math.PI) / 180));
}

/** 溝の後端（軸）から測った距離：押し板（縮めたとき）の前面＝球の止め */
export const CHUTE_STOP_D = LAUNCHER_SHAPE.plungerRetractedZ - LAUNCHER_SHAPE.backZ;
/**
 * 装填位置と止めの間のすき間。止めのすぐ脇を落ちる球が接触の予測で前へ押し出されないよう 2cm あける。
 * 溝が傾いていれば、球は止めまで転がってから落ち着く（どちらの位置でも発射できる）。
 */
const LOAD_GAP = 0.02;
/** 溝の長さ */
export const CHUTE_LENGTH = LAUNCHER_SHAPE.frontZ - LAUNCHER_SHAPE.backZ;

/** 溝の座標（後端からの距離 d・溝の面からの高さ h）→ 装置ローカル座標 */
export function chuteLocal(angle: number, d: number, h: number): Vec3 {
  const S = LAUNCHER_SHAPE;
  return [0, S.surfaceY + Math.sin(angle) * d + Math.cos(angle) * h, S.backZ + Math.cos(angle) * d - Math.sin(angle) * h];
}

/** 装填口（次の球を落とし始める位置）：装填位置の真上 */
export function hopperLocal(angle: number): Vec3 {
  const p = chuteLocal(angle, CHUTE_STOP_D + BALL_RADIUS + LOAD_GAP, BALL_RADIUS);
  return [p[0], p[1] + LAUNCHER_SHAPE.hopperDrop - BALL_RADIUS, p[2]];
}

/**
 * 発射のしかた（DECISIONS.md D-18）：
 * 球は溝の後ろ（押し板の前）に装填され、押し板で溝に沿って launchSpeed で押し出される。
 * 溝は後端を軸に angleDegrees だけ上へ傾く。ただし ball_out がレールにつながっているときは
 * 球がレールを飛び越えないよう、溝は水平（0°）に固定する。
 */
export function planLauncher(device: PlacedDevice, devices: readonly PlacedDevice[]): LauncherPlan {
  const params = launcherParams(device);
  const s = LAUNCHER_SHAPE;
  const conn = findConnections(devices).find((c) => c.from.deviceId === device.id && c.from.portId === 'ball_out');
  const angle = conn ? 0 : (params.angleDegrees * Math.PI) / 180;
  const yaw = (device.rotationYDeg * Math.PI) / 180;
  const dir = rotateY([0, Math.sin(angle), Math.cos(angle)], yaw);
  const loadD = CHUTE_STOP_D + BALL_RADIUS + LOAD_GAP;
  return {
    deviceId: device.id,
    angle,
    pivot: launcherToWorld(device, [0, s.surfaceY, s.backZ]),
    dir,
    normal: rotateY([0, Math.cos(angle), -Math.sin(angle)], yaw),
    loadPoint: launcherToWorld(device, chuteLocal(angle, loadD, BALL_RADIUS)),
    // 装填口は溝が傾いても装填位置の真上（真下に落として、傾いた溝なら止めまで転がる）
    hopperPoint: launcherToWorld(device, hopperLocal(angle)),
    velocity: scale(dir, params.launchSpeed),
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
