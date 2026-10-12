import { getDeviceDef, type PortDef, type Vec3 } from './catalog';
import type { PlacedDevice } from './layout';
import { add, rotateY } from './railGeometry';

/**
 * カーブレール（試作, DECISIONS.md D-24 / D-31）。
 * 入口は前方（ローカル +Z）へ進む向きで入り、turn=+1 なら +X 側、-1 なら -X 側へ曲がる。
 * 形は設定で選ぶ：
 * - 半径（radius）：ゆるい 1.25m（既定）／急 0.75m
 * - 弧（arc）：0 = 90°、1 = 45°の曲がり始め（まっすぐ→斜め）、2 = 45°の曲がり終わり（斜め→まっすぐ）
 *   45°は他の装置が 90°単位でしか回せないため、始めと終わりをつないで使う（90°カーブ、または隣の列への車線変更）
 * 高さは入口 0.35m から、90°で 0.2m・45°で 0.1m 下る（直線レールと同じ割合に近い）。
 */
export const CURVE = {
  /** ゆるいカーブの中心線の半径（既定） */
  radius: 1.25,
  /** ゆるい 90°カーブの外形の半分 */
  half: 0.75,
  inY: 0.35,
  outY: 0.15,
  /** 当たり判定・描画で弧を分割する数（90°あたり） */
  segments: 24,
} as const;

export const CURVE_RADII = { gentle: 1.25, sharp: 0.75 } as const;

const GRID = 0.25;
const roundGrid = (v: number) => Math.round(v / GRID) * GRID;
const DEG45 = Math.PI / 4;

export interface CurveShape {
  turn: 1 | -1;
  radius: number;
  arc: 0 | 1 | 2;
  /** 弧の始まりと終わりの角度（rad。0 = 入口が +Z を向く所） */
  theta0: number;
  theta1: number;
  /** 弧の中心（ローカル x, z。turn=+1 のときの値に turn を掛けた後） */
  cx: number;
  cz: number;
  inY: number;
  outY: number;
  /** 中心線の長さ */
  length: number;
  /** 分割数 */
  segments: number;
}

export function curveTurn(device: PlacedDevice): 1 | -1 {
  const t = device.params?.turn ?? Number(getDeviceDef('curve').params.turn);
  return t < 0 ? -1 : 1;
}

/** 装置の設定からカーブの形を求める */
export function curveShape(device: PlacedDevice): CurveShape {
  const turn = curveTurn(device);
  const radius = device.params?.radius === CURVE_RADII.sharp ? CURVE_RADII.sharp : CURVE_RADII.gentle;
  const a = device.params?.arc;
  const arc: 0 | 1 | 2 = a === 1 ? 1 : a === 2 ? 2 : 0;
  return makeShape(turn, radius, arc);
}

export function makeShape(turn: 1 | -1, radius: number, arc: 0 | 1 | 2): CurveShape {
  let cx: number;
  let cz: number;
  let theta0 = 0;
  let theta1 = Math.PI / 2;
  if (arc === 0) {
    // 外形の正方形の中央が原点。ポートが 0.25m グリッドに乗る
    const half = (radius + GRID) / 2;
    cx = half;
    cz = -half;
  } else if (arc === 1) {
    // 入口を (0, z0) に置く（グリッド上）
    theta1 = DEG45;
    const z0 = -roundGrid((radius * Math.sin(DEG45)) / 2);
    cx = radius;
    cz = z0;
  } else {
    // 出口を (x1, 0) に置く（グリッド上）
    theta0 = DEG45;
    const x1 = roundGrid((radius * Math.cos(DEG45)) / 2);
    cx = x1;
    cz = -radius;
  }
  const sweep = theta1 - theta0;
  const drop = arc === 0 ? CURVE.inY - CURVE.outY : (CURVE.inY - CURVE.outY) / 2;
  return {
    turn,
    radius,
    arc,
    theta0,
    theta1,
    cx: turn * cx,
    cz,
    inY: arc === 2 ? CURVE.inY - drop : CURVE.inY,
    outY: arc === 1 ? CURVE.inY - drop : arc === 2 ? CURVE.inY - 2 * drop : CURVE.outY,
    length: sweep * radius,
    segments: Math.max(8, Math.round((CURVE.segments * sweep) / (Math.PI / 2))),
  };
}

/** ゆるい 90°カーブの弧の長さ */
export const CURVE_LENGTH = (Math.PI / 2) * CURVE.radius;

export interface CurveFrame {
  /** 走行面の中心線上の点（装置ローカル） */
  pos: Vec3;
  /** 進む向き（坂を含む単位ベクトル） */
  tangent: Vec3;
  /** 横方向（水平、進行方向の右） */
  side: Vec3;
  /** 走行面の上向き法線 */
  normal: Vec3;
}

/** t=0（入口）〜1（出口）の位置と向き。装置ローカル座標 */
export function shapeFrame(s: CurveShape, t: number): CurveFrame {
  const th = s.theta0 + (s.theta1 - s.theta0) * t;
  const y = s.inY + (s.outY - s.inY) * t;
  const pos: Vec3 = [s.cx - s.turn * s.radius * Math.cos(th), y, s.cz + s.radius * Math.sin(th)];
  const slope = (s.outY - s.inY) / s.length;
  const h: Vec3 = [s.turn * Math.sin(th), 0, Math.cos(th)]; // 水平の進行方向
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

/** ゆるい 90°カーブの位置と向き（互換用） */
export function curveFrame(turn: 1 | -1, t: number): CurveFrame {
  return shapeFrame(makeShape(turn, CURVE.radius, 0), t);
}

/** 形に応じたポート（装置ローカル）。向きは弧の両端の水平の進行方向 */
export function shapePorts(s: CurveShape): PortDef[] {
  const a = shapeFrame(s, 0);
  const b = shapeFrame(s, 1);
  const flat = (v: Vec3): Vec3 => {
    const l = Math.hypot(v[0], v[2]);
    return [clean(v[0] / l), 0, clean(v[2] / l)];
  };
  const tin = flat(a.tangent);
  return [
    { id: 'ball_in', type: 'ball', position: [clean(a.pos[0]), s.inY, clean(a.pos[2])], direction: [-tin[0], 0, -tin[2]] },
    { id: 'ball_out', type: 'ball', position: [clean(b.pos[0]), s.outY, clean(b.pos[2])], direction: flat(b.tangent) },
  ];
}

/** ゆるい 90°カーブのポート（互換用） */
export function curvePorts(turn: 1 | -1): PortDef[] {
  return shapePorts(makeShape(turn, CURVE.radius, 0));
}

/** 外形（装置ローカルの x, z の範囲）。90°は正方形、45°は弧を囲む箱に溝の幅を足したもの */
export function shapeBounds(s: CurveShape): { minX: number; maxX: number; minZ: number; maxZ: number } {
  if (s.arc === 0) {
    const half = (s.radius + GRID) / 2;
    return { minX: -half, maxX: half, minZ: -half, maxZ: half };
  }
  const w = 0.15;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i <= s.segments; i++) {
    const p = shapeFrame(s, i / s.segments).pos;
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minZ = Math.min(minZ, p[2]);
    maxZ = Math.max(maxZ, p[2]);
  }
  return { minX: minX - w, maxX: maxX + w, minZ: minZ - w, maxZ: maxZ + w };
}

/** ローカル座標 → ワールド座標 */
export function curveToWorld(device: PlacedDevice, local: Vec3): Vec3 {
  return add(device.position, rotateY(local, (device.rotationYDeg * Math.PI) / 180));
}

/**
 * 当たり判定用の三角形メッシュ（装置ローカル）：走行面と左右の側壁の内面を弧に沿って張る。
 * 直線レールと同じ断面（内幅・壁の高さ）。inletDrop だけ入口側を下げ、継ぎ目を下り段差にする（D-20）。
 */
export function shapeMesh(s: CurveShape, innerHalf: number, wallHeight: number, inletDrop: number): { vertices: Float32Array; indices: Uint32Array } {
  return pathMesh((t) => shapeFrame(s, t), s.segments, innerHalf, wallHeight, inletDrop);
}

/** 曲がった走行路（カーブ・ループ）の当たり判定の三角形メッシュ。frame(t) は t=0（入口）〜1（出口）の断面 */
export function pathMesh(
  frame: (t: number) => CurveFrame,
  n: number,
  innerHalf: number,
  wallHeight: number,
  inletDrop: number,
): { vertices: Float32Array; indices: Uint32Array } {
  const verts: number[] = [];
  const idx: number[] = [];
  // 1断面あたり4点：0=左の床, 1=右の床, 2=左の壁の上, 3=右の壁の上（左右は進行方向に対して）
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const f = frame(t);
    // 入口側だけ下げる（最初の 1 区間で 0 に戻す。ループのように走行面が上を向かない所には効かせない）
    const drop = inletDrop * Math.max(0, 1 - t * n);
    const at = (side: number, h: number) => {
      for (let k = 0; k < 3; k++) verts.push(f.pos[k] + f.side[k] * side + f.normal[k] * h - (k === 1 ? drop : 0));
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

/** ゆるい 90°カーブの当たり判定（互換用） */
export function curveMesh(turn: 1 | -1, innerHalf: number, wallHeight: number, inletDrop: number): { vertices: Float32Array; indices: Uint32Array } {
  return shapeMesh(makeShape(turn, CURVE.radius, 0), innerHalf, wallHeight, inletDrop);
}

/** 浮動小数の誤差（1e-12 程度）を丸める。ポートの一致判定を安定させる */
function clean(v: number): number {
  const r = Math.round(v * 1e9) / 1e9;
  return Object.is(r, -0) ? 0 : r;
}
