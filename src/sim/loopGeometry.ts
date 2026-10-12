import type { PortDef, Vec3 } from './catalog';
import type { CurveFrame } from './curveGeometry';
import type { PlacedDevice } from './layout';

/**
 * ループ（宙返り, 試作, DECISIONS.md D-33）。
 * 入口（ローカル原点の真上、+Z へ進む向き）から縦の円を 1 周して、横（+X）に LOOP.shift ずれた所から +Z へ出る。
 * 入口と出口がぶつからないよう、1 周の間に少しずつ横へずれる（らせん）。
 * 走行面は円の外側（球は遠心力で走行面に押し付けられる）。速さが足りないと、てっぺんで落ちる。
 */
export const LOOP = {
  /** 入口の走行面の高さ（直線レールの入口と同じ） */
  inY: 0.35,
  /** 1 周で下る高さ */
  drop: 0.05,
  /** 1 周で横にずれる量（m） */
  shift: 0.5,
  /** 当たり判定・描画の分割数 */
  segments: 72,
} as const;

export const LOOP_RADII = [0.35, 0.5] as const;

export function loopRadius(device: PlacedDevice): number {
  return device.params?.radius === 0.5 ? 0.5 : 0.35;
}

/** t=0（入口）〜1（出口）の位置と向き（装置ローカル）。法線は円の中心を向く */
export function loopFrame(radius: number, t: number): CurveFrame {
  const phi = 2 * Math.PI * t;
  const pos: Vec3 = [LOOP.shift * t, LOOP.inY - LOOP.drop * t + radius * (1 - Math.cos(phi)), radius * Math.sin(phi)];
  // 接線（dp/dφ を正規化）
  const dx = LOOP.shift / (2 * Math.PI);
  const dy = radius * Math.sin(phi) - LOOP.drop / (2 * Math.PI);
  const dz = radius * Math.cos(phi);
  const tl = Math.hypot(dx, dy, dz);
  const tangent: Vec3 = [dx / tl, dy / tl, dz / tl];
  // 中心へ向かう向き（縦の円の内側）を、接線に直交させて法線にする
  const c: Vec3 = [0, Math.cos(phi), -Math.sin(phi)];
  const k = c[0] * tangent[0] + c[1] * tangent[1] + c[2] * tangent[2];
  const nRaw: Vec3 = [c[0] - k * tangent[0], c[1] - k * tangent[1], c[2] - k * tangent[2]];
  const nl = Math.hypot(...nRaw);
  const normal: Vec3 = [nRaw[0] / nl, nRaw[1] / nl, nRaw[2] / nl];
  // 横（進行方向の右）= 接線 × 法線（カーブと同じ向きの取り方）
  const side: Vec3 = [
    tangent[1] * normal[2] - tangent[2] * normal[1],
    tangent[2] * normal[0] - tangent[0] * normal[2],
    tangent[0] * normal[1] - tangent[1] * normal[0],
  ];
  return { pos, tangent, side, normal };
}

/** ポート（装置ローカル） */
export function loopPorts(): PortDef[] {
  return [
    { id: 'ball_in', type: 'ball', position: [0, LOOP.inY, 0], direction: [0, 0, -1] },
    { id: 'ball_out', type: 'ball', position: [LOOP.shift, LOOP.inY - LOOP.drop, 0], direction: [0, 0, 1] },
  ];
}

/** 外形（装置ローカルの x, z の範囲と高さ） */
export function loopBounds(radius: number): { minX: number; maxX: number; minZ: number; maxZ: number; height: number } {
  const w = 0.2;
  return { minX: -w, maxX: LOOP.shift + w, minZ: -radius - w, maxZ: radius + w, height: LOOP.inY + 2 * radius + 0.3 };
}
