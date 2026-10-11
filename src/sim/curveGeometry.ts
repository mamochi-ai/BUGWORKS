import { getDeviceDef, type PortDef, type Vec3 } from './catalog';
import type { PlacedDevice } from './layout';
import { add, rotateY } from './railGeometry';

/**
 * カーブレール（試作, DECISIONS.md D-24）。
 * 90°に曲がる四分円。中心線の半径 1.25m、外形 1.5×1.5m（ポートが 0.25m グリッドに乗る大きさ）。
 * 入口は前方（ローカル +Z）へ進む向きで入り、turn=+1 なら +X 側（進行方向の左）、-1 なら -X 側（右）へ曲がって出る。
 * 高さは直線レールと同じく、入口 0.35m → 出口 0.15m を弧に沿って一定の割合で下る。
 */
export const CURVE = {
  radius: 1.25,
  half: 0.75,
  inY: 0.35,
  outY: 0.15,
  /** 当たり判定・描画で弧を分割する数 */
  segments: 24,
} as const;

export function curveTurn(device: PlacedDevice): 1 | -1 {
  const t = device.params?.turn ?? Number(getDeviceDef('curve').params.turn);
  return t < 0 ? -1 : 1;
}

/** 弧の長さ */
export const CURVE_LENGTH = (Math.PI / 2) * CURVE.radius;

export interface CurveFrame {
  /** 走行面の中心線上の点（装置ローカル） */
  pos: Vec3;
  /** 進む向き（水平成分のみ正規化した、坂を含む単位ベクトル） */
  tangent: Vec3;
  /** 横方向（水平、進行方向の右） */
  side: Vec3;
  /** 走行面の上向き法線 */
  normal: Vec3;
}

/** t=0（入口）〜1（出口）の位置と向き。装置ローカル座標 */
export function curveFrame(turn: 1 | -1, t: number): CurveFrame {
  const R = CURVE.radius;
  const th = (t * Math.PI) / 2;
  // 中心 C から見た角度 th の点。左に曲がる場合 C=(+0.75, -0.75)、点 = C + R(-cos th, sin th)
  const cx = turn * CURVE.half;
  const cz = -CURVE.half;
  const y = CURVE.inY + (CURVE.outY - CURVE.inY) * t;
  const pos: Vec3 = [cx - turn * R * Math.cos(th), y, cz + R * Math.sin(th)];
  const slope = (CURVE.outY - CURVE.inY) / CURVE_LENGTH;
  const h: Vec3 = [turn * Math.sin(th), 0, Math.cos(th)]; // 水平の進行方向
  const tl = Math.hypot(1, slope);
  const tangent: Vec3 = [h[0] / tl, slope / tl, h[2] / tl];
  // 進行方向の右 = h × up（Y-up 右手系）
  const side: Vec3 = [-h[2], 0, h[0]];
  // normal = side × tangent（上向き）
  const normal: Vec3 = [
    side[1] * tangent[2] - side[2] * tangent[1],
    side[2] * tangent[0] - side[0] * tangent[2],
    side[0] * tangent[1] - side[1] * tangent[0],
  ];
  return { pos, tangent, side, normal: normal[1] < 0 ? [-normal[0], -normal[1], -normal[2]] : normal };
}

/** 曲がる向きに応じたポート（装置ローカル） */
export function curvePorts(turn: 1 | -1): PortDef[] {
  return [
    { id: 'ball_in', type: 'ball', position: [-turn * 0.5, CURVE.inY, -CURVE.half], direction: [0, 0, -1] },
    { id: 'ball_out', type: 'ball', position: [turn * CURVE.half, CURVE.outY, 0.5], direction: [turn, 0, 0] },
  ];
}

/** ローカル座標 → ワールド座標 */
export function curveToWorld(device: PlacedDevice, local: Vec3): Vec3 {
  return add(device.position, rotateY(local, (device.rotationYDeg * Math.PI) / 180));
}

/**
 * 当たり判定用の三角形メッシュ（装置ローカル）：走行面と左右の側壁の内面を弧に沿って張る。
 * 直線レールと同じ断面（内幅・壁の高さ）。inletDrop だけ入口側を下げ、継ぎ目を下り段差にする（D-20）。
 */
export function curveMesh(turn: 1 | -1, innerHalf: number, wallHeight: number, inletDrop: number): { vertices: Float32Array; indices: Uint32Array } {
  const n = CURVE.segments;
  const verts: number[] = [];
  const idx: number[] = [];
  // 1断面あたり4点：0=左の床, 1=右の床, 2=左の壁の上, 3=右の壁の上（左右は進行方向に対して）
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const f = curveFrame(turn, t);
    const drop = inletDrop * (1 - t);
    const at = (s: number, h: number) => {
      for (let k = 0; k < 3; k++) verts.push(f.pos[k] + f.side[k] * s + f.normal[k] * h - (k === 1 ? drop : 0));
    };
    at(-innerHalf, 0);
    at(innerHalf, 0);
    at(-innerHalf, wallHeight);
    at(innerHalf, wallHeight);
  }
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, a, c, d);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const q = (i + 1) * 4;
    quad(p + 0, p + 1, q + 1, q + 0); // 床
    quad(p + 0, q + 0, q + 2, p + 2); // 左の壁
    quad(p + 1, p + 3, q + 3, q + 1); // 右の壁
  }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}
