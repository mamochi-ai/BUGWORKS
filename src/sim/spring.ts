import { getDeviceDef, getPort, type Vec3 } from './catalog';
import { PHYSICS_DT } from './constants';
import type { PlacedDevice } from './layout';
import { add, rotateY, scale } from './railGeometry';

/**
 * バネ装置（DECISIONS.md D-21）。
 * 球が天板に乗ると受け止めて（速度を0にして保持）、maxCompression まで縮み、縮みきったら
 * 天板の向き（法線）に launchSpeed で打ち上げる。その後しばらく戻る時間があり、その間は受け止めない。
 * 戻っている間に落ちてきた球は、天板の反発係数（restitution）でそのまま跳ね返る。
 */

export interface SpringParams {
  /** 天板の反発係数（受け止めていないときの跳ね返り）。JSON の値 */
  restitution: number;
  /** 縮む量（m）。JSON の値 */
  maxCompression: number;
  /** 打ち上げの速さ（m/s）。JSON に無い新しい値。仮値 */
  launchSpeed: number;
  /** 天板の傾き（度）。前方（ローカル +Z）へ傾ける。JSON に無い新しい値 */
  tiltDegrees: number;
}

/** 天板の傾きの選択肢 */
export const SPRING_TILTS = [0, 15, 30] as const;
const DEFAULTS = { launchSpeed: 5, tiltDegrees: 0 };

const IMPACT = getPort(getDeviceDef('spring'), 'impact').position;
export const SPRING_SHAPE = {
  /** 天板の上面中心（= impact ポート、傾き 0° のとき） */
  topCenter: IMPACT as Vec3,
  /** 天板の大きさ（半分） */
  plateHalf: [0.3, 0.03, 0.3] as Vec3,
  /** 台座の当たり判定 */
  base: { size: [0.8, 0.2, 0.8] as Vec3, center: [0, 0.1, 0] as Vec3 },
};

/** 縮む時間・戻る時間（試作値） */
export const SPRING_TIMING = { compressSeconds: 0.12, recoverSeconds: 0.3 };

/**
 * 受け止める範囲：天板の真上、上面から球の下端まで gap 以内。
 * 傾けた天板は前が下がるので、速い球は天板に触れずに上を通り過ぎてしまう。天板の上の空間で受け止め、縮む間に天板へ下ろす。
 * maxSeparatingSpeed：打ち上げた直後の球（法線方向 5m/s）を受け止め直さないための上限。
 */
const CAPTURE = { gap: 0.15, maxSeparatingSpeed: 2.5, edgeMargin: 0.02 };

export function springParams(device: PlacedDevice): SpringParams {
  const def = getDeviceDef('spring').params;
  const p = device.params ?? {};
  return {
    restitution: p.restitution ?? Number(def.restitution),
    maxCompression: p.maxCompression ?? Number(def.maxCompression),
    launchSpeed: p.launchSpeed ?? DEFAULTS.launchSpeed,
    tiltDegrees: p.tiltDegrees ?? DEFAULTS.tiltDegrees,
  };
}

export interface SpringPlan {
  deviceId: string;
  params: SpringParams;
  yaw: number;
  /** 天板の傾き（rad） */
  tilt: number;
  /** 天板の上面中心（ワールド、縮んでいないとき） */
  top: Vec3;
  /** 天板の法線（打ち上げる向き） */
  normal: Vec3;
  /** 天板の面内の単位ベクトル（横・前後） */
  side: Vec3;
  along: Vec3;
  compressTicks: number;
  recoverTicks: number;
}

export function planSpring(device: PlacedDevice): SpringPlan {
  const params = springParams(device);
  const yaw = (device.rotationYDeg * Math.PI) / 180;
  const tilt = (params.tiltDegrees * Math.PI) / 180;
  return {
    deviceId: device.id,
    params,
    yaw,
    tilt,
    // 天板は後ろの辺を軸に前へ傾ける（後ろから来る球の前に、持ち上がった辺が壁にならないように）
    top: add(
      device.position,
      rotateY(
        [
          SPRING_SHAPE.topCenter[0],
          SPRING_SHAPE.topCenter[1] - SPRING_SHAPE.plateHalf[2] * Math.sin(tilt),
          SPRING_SHAPE.topCenter[2] - SPRING_SHAPE.plateHalf[2] * (1 - Math.cos(tilt)),
        ],
        yaw,
      ),
    ),
    normal: rotateY([0, Math.cos(tilt), Math.sin(tilt)], yaw),
    side: rotateY([1, 0, 0], yaw),
    along: rotateY([0, -Math.sin(tilt), Math.cos(tilt)], yaw),
    compressTicks: Math.max(1, Math.round(SPRING_TIMING.compressSeconds / PHYSICS_DT)),
    recoverTicks: Math.max(1, Math.round(SPRING_TIMING.recoverSeconds / PHYSICS_DT)),
  };
}

/** 天板の上面中心の位置（縮み量 offset を反映） */
export function plateTop(plan: SpringPlan, offset: number): Vec3 {
  return add(plan.top, scale(plan.normal, -offset));
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** 球の中心を天板の座標（横 s・前後 a・法線方向の高さ h）で表す */
export function toPlate(plan: SpringPlan, offset: number, p: Vec3): { s: number; a: number; h: number } {
  const d = sub(p, plateTop(plan, offset));
  return { s: dot(d, plan.side), a: dot(d, plan.along), h: dot(d, plan.normal) };
}

/** 天板の上に乗っていて、受け止めてよい球か */
export function canCapture(plan: SpringPlan, ballPos: Vec3, ballVel: Vec3, radius: number): boolean {
  const { s, a, h } = toPlate(plan, 0, ballPos);
  const [hx, , hz] = SPRING_SHAPE.plateHalf;
  if (Math.abs(s) > hx - CAPTURE.edgeMargin || Math.abs(a) > hz - CAPTURE.edgeMargin) return false;
  const gap = h - radius;
  if (gap < -0.01 || gap > CAPTURE.gap) return false;
  return dot(ballVel, plan.normal) <= CAPTURE.maxSeparatingSpeed;
}

/** 縮み量：縮む間はなめらかに増え、戻る間は直線で減る */
export function compressionAt(phase: 'ready' | 'compress' | 'recover', t: number, plan: SpringPlan): number {
  const max = plan.params.maxCompression;
  if (phase === 'compress') {
    const x = Math.min(1, t / plan.compressTicks);
    return max * (1 - (1 - x) * (1 - x));
  }
  if (phase === 'recover') return max * Math.max(0, 1 - t / plan.recoverTicks);
  return 0;
}
