import { findConnections } from '../edit/placement';
import { getDeviceDef, type Vec3 } from './catalog';
import { PHYSICS_DT } from './constants';
import { BALL_START_OFFSET, type PlacedDevice } from './layout';
import { BALL_RADIUS, add, ballRestPosition, buildRailTrack, portWorldPosition, rotateY, scale } from './railGeometry';

/** 同時に存在できる鉄球の上限（試作値, DECISIONS.md D-19） */
export const MAX_BALLS = 16;

export interface LauncherParams {
  launchSpeed: number;
  angleDegrees: number;
  cooldownSeconds: number;
}

export interface LauncherPlan {
  deviceId: string;
  /** 球を出す位置（球の中心） */
  spawn: Vec3;
  /** 発射時の速度ベクトル */
  velocity: Vec3;
  /** 発射間隔（tick） */
  periodTicks: number;
  /** ball_out につながっているレール（なければ null） */
  feedsRailId: string | null;
  params: LauncherParams;
}

/** 発射機の当たり判定：台座だけ（ローカル座標、原点＝接地面中心）。アームは描画のみ */
export const LAUNCHER_BASE = { size: [1, 0.5, 1.2] as Vec3, center: [0, 0.25, -0.1] as Vec3 };

export function launcherParams(device: PlacedDevice): LauncherParams {
  const def = getDeviceDef('launcher').params;
  const pick = (k: keyof LauncherParams) => device.params?.[k] ?? Number(def[k]);
  return { launchSpeed: pick('launchSpeed'), angleDegrees: pick('angleDegrees'), cooldownSeconds: pick('cooldownSeconds') };
}

/**
 * 発射のしかた（DECISIONS.md D-18）：
 * - ball_out がレールにつながっていれば、レールの入口の少し先に球を出し、レールの向きに launchSpeed で送り出す
 *   （angleDegrees で上に撃つとレールを飛び越えてしまうため、接続時は角度を使わない）
 * - つながっていなければ、ball_out の向きから angleDegrees だけ上に向けて撃ち出す
 */
export function planLauncher(device: PlacedDevice, devices: readonly PlacedDevice[]): LauncherPlan {
  const params = launcherParams(device);
  const periodTicks = Math.max(1, Math.round(params.cooldownSeconds / PHYSICS_DT));
  const conn = findConnections(devices).find((c) => c.from.deviceId === device.id && c.from.portId === 'ball_out');
  const rail = conn ? devices.find((d) => d.id === conn.to.deviceId && d.type === 'rail') : undefined;

  if (rail) {
    const track = buildRailTrack(rail);
    return {
      deviceId: device.id,
      spawn: ballRestPosition(track, BALL_START_OFFSET),
      velocity: scale(track.dir, params.launchSpeed),
      periodTicks,
      feedsRailId: rail.id,
      params,
    };
  }

  const yaw = (device.rotationYDeg * Math.PI) / 180;
  const a = (params.angleDegrees * Math.PI) / 180;
  const forward = rotateY([0, 0, 1], yaw);
  const dir: Vec3 = [forward[0] * Math.cos(a), Math.sin(a), forward[2] * Math.cos(a)];
  const port = portWorldPosition(device, 'ball_out');
  // 台座の当たり判定と重ならないよう、出口から少し前に出す
  return {
    deviceId: device.id,
    spawn: add(port, scale(forward, BALL_RADIUS + 0.06)),
    velocity: scale(dir, params.launchSpeed),
    periodTicks,
    feedsRailId: null,
    params,
  };
}
