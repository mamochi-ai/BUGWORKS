import { getDeviceDef, type Vec3 } from './catalog';
import type { PlacedDevice } from './layout';
import { add, rotateY } from './railGeometry';

/**
 * 磁石装置（devices.v0.1.json の magnet。挙動は試作, DECISIONS.md D-29）。
 * - 前面（ローカル +Z）の磁極から radius 以内にある鉄球を、引きよせる（mode=+1）／しりぞける（mode=-1）
 * - 力は磁極に近いほど強い：maxForce × (1 − 距離/半径)²。半径の外では 0
 * - 物理エンジンの質量の単位は任意（鉄球の密度は相対値）なので、力は「基準の鉄球（REF_MASS_KG）に掛かる力」として
 *   加速度に直し、球の質量に関係なく同じ加速度を与える（20N → 10 m/s²）
 * - enable（signal）ポートはスイッチ類が無いので未使用（常に動作）
 */
export const MAGNET = {
  /** 磁極の位置（装置ローカル。前面の中央、高さ 0.6m） */
  pole: [0, 0.6, 0.48] as Vec3,
  /** 力を加速度に直すときの基準の鉄球の質量 */
  REF_MASS_KG: 2,
} as const;

export interface MagnetParams {
  /** +1 引きよせる / −1 しりぞける */
  mode: 1 | -1;
  maxForceNewton: number;
  radius: number;
}

export function magnetParams(device: PlacedDevice): MagnetParams {
  const def = getDeviceDef('magnet').params;
  const p = device.params ?? {};
  const mode = p.mode ?? (def.mode === 'repel' ? -1 : 1);
  return {
    mode: mode < 0 ? -1 : 1,
    maxForceNewton: p.maxForceNewton ?? Number(def.maxForceNewton),
    radius: p.radius ?? Number(def.radius),
  };
}

/** 磁極のワールド座標 */
export function magnetPole(device: PlacedDevice): Vec3 {
  return add(device.position, rotateY(MAGNET.pole, (device.rotationYDeg * Math.PI) / 180));
}

/** 位置 p の鉄球に掛かる加速度（m/s²）。範囲外なら null */
export function magnetAccel(device: PlacedDevice, p: Vec3): Vec3 | null {
  const { mode, maxForceNewton, radius } = magnetParams(device);
  const pole = magnetPole(device);
  const d: Vec3 = [pole[0] - p[0], pole[1] - p[1], pole[2] - p[2]];
  const dist = Math.hypot(d[0], d[1], d[2]);
  if (dist >= radius || dist < 1e-6) return null;
  const a = (mode * (maxForceNewton / MAGNET.REF_MASS_KG) * (1 - dist / radius) ** 2) / dist;
  return [d[0] * a, d[1] * a, d[2] * a];
}
