import type { Vec3 } from './catalog';
import { getDeviceDef } from './catalog';
import type { PlacedDevice } from './layout';
import { add, rotateY } from './railGeometry';

/**
 * ゴールと台（試作, DECISIONS.md D-23）。
 * ゴール：台座の上の空間（横 ±0.35m・高さ 0〜0.4m）に球の中心が入ったら、その球を回収して数える。
 * 台：上に球や装置を載せられる箱。高さは設定で変えられる。
 */
export const GOAL_ZONE = { half: 0.35, height: 0.4 };

export function platformHeight(device: PlacedDevice): number {
  return device.params?.heightMeters ?? Number(getDeviceDef('platform').params.heightMeters);
}

/** 台の上面の高さ（ワールド） */
export function platformTop(device: PlacedDevice): number {
  return device.position[1] + platformHeight(device);
}

/** ゴールの範囲に球の中心が入っているか */
export function inGoal(goal: PlacedDevice, p: Vec3): boolean {
  const yaw = (goal.rotationYDeg * Math.PI) / 180;
  const d: Vec3 = [p[0] - goal.position[0], p[1] - goal.position[1], p[2] - goal.position[2]];
  const local = rotateY(d, -yaw);
  return Math.abs(local[0]) <= GOAL_ZONE.half && Math.abs(local[2]) <= GOAL_ZONE.half && local[1] >= 0 && local[1] <= GOAL_ZONE.height;
}

/** ゴールの中心（演出用） */
export function goalCenter(goal: PlacedDevice): Vec3 {
  return add(goal.position, rotateY([0, 0.1, 0], 0));
}
