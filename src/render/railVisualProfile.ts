import { BALL_RADIUS, RAIL_PROFILE } from '../sim/railGeometry';

/**
 * レールの見た目の断面寸法。描画専用だが、鉄球が見た目のパイプに「ちょうど乗って」見えるよう
 * 物理形状（RAIL_PROFILE, BALL_RADIUS）から逆算する。Three.js に依存しないのでテスト可能。
 *
 * 座標はレールのローカル系：X=横、Y=走行面の法線（物理の走行面が y=0）、Z=走行方向。
 */
export interface RailVisualProfile {
  /** 鉄球を下から支える2本の鋼管（中心の x, y と半径） */
  carrier: { x: number; y: number; radius: number };
  /** 鉄球の横ずれを止める2本の鋼管。内側の面が物理の側壁の内面と一致する */
  guard: { x: number; y: number; radius: number };
  /** 両端のオレンジの金具（左右の側板） */
  collar: { length: number; cheekWidth: number; height: number; centerY: number; cheekX: number };
}

export function railVisualProfile(): RailVisualProfile {
  const halfInner = RAIL_PROFILE.innerWidth / 2;

  // 支持管：鉄球の中心（y = BALL_RADIUS）から距離 BALL_RADIUS + r の位置に置くと、球が2本に接して見える
  const carrierRadius = 0.02;
  const carrierX = 0.08;
  const reach = BALL_RADIUS + carrierRadius;
  const carrierY = BALL_RADIUS - Math.sqrt(reach * reach - carrierX * carrierX);

  // ガード管：内側の面 = 物理の側壁の内面（x = ±innerWidth/2）
  const guardRadius = 0.02;
  const guardX = halfInner + guardRadius;
  const guardY = BALL_RADIUS - 0.01;

  // 金具：ガード管の外側に側板を置き、鉄球の通り道（|x| < innerWidth/2）をふさがない
  const cheekWidth = 0.06;
  const cheekX = guardX + guardRadius + cheekWidth / 2 - 0.005;
  const bottom = carrierY - carrierRadius - 0.05;
  const top = guardY + guardRadius + 0.04;

  return {
    carrier: { x: carrierX, y: carrierY, radius: carrierRadius },
    guard: { x: guardX, y: guardY, radius: guardRadius },
    collar: { length: 0.16, cheekWidth, height: top - bottom, centerY: (top + bottom) / 2, cheekX },
  };
}
