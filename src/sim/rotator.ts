import { getDeviceDef, type Vec3 } from './catalog';
import type { PlacedDevice } from './layout';
import { add, rotateY } from './railGeometry';

/**
 * 回転装置（devices.v0.1.json の rotator。挙動は試作, DECISIONS.md D-32）。
 * 台（turntable）の上に短いレール。台は自分で回り（degreesPerSecond）、スイッチを配線すると ON の間だけ回る。
 * OFF になったら途中では止まらず、まっすぐの向き（入口と前の出口を結ぶ向き）まで回ってから止まる。
 * 球の流れ：
 *   1. 入口（ローカル −Z）に来た球を入口で待たせる（台のレールが入口の向きにそろうまで）
 *   2. そろったら台の中央へ運び、台と一緒に回す
 *   3. 球の進む向き（入ってきた向きを台と一緒に回したもの）が、入口以外の辺（前・左・右）を向いたら送り出す
 * 止まっている台がまっすぐの向きなら、球はそのまま前へ。回っていれば横（左回りなら +X 側、右回りなら −X 側）へ出る。
 * 仕様の shaft_in（軸の入口）は今回は使わない。球の入口・出口のポートは仕様に無いので試作で追加した（G-26）。
 */
export const ROTATOR = {
  /** 走行面の高さ（装置の原点から） */
  surfaceY: 0.35,
  /** 入口・出口のポートの位置（中心から辺までの距離） */
  half: 0.6,
  /** 入口で待たせる位置（中心からの距離）。待っている球どうしの間隔 */
  gateD: 0.45,
  queueGap: 0.21,
  /** 入口に来たとみなす範囲（入口の外側へ／横へ） */
  catch: { along: 0.35, side: 0.12 },
  /** 台のレールがそろったとみなす角度の幅（rad） */
  alignTol: (0.6 * Math.PI) / 180,
  /** 入口から中央へ運ぶ時間（s） */
  slideSeconds: 0.25,
  /** 送り出す速さ（m/s） */
  releaseSpeed: 1.6,
} as const;

export interface RotatorParams {
  degreesPerSecond: number;
  /** +1 左回り（上から見て反時計回り）/ −1 右回り */
  direction: 1 | -1;
}

export function rotatorParams(device: PlacedDevice): RotatorParams {
  const p = device.params ?? {};
  return {
    degreesPerSecond: p.degreesPerSecond ?? Number(getDeviceDef('rotator').params.degreesPerSecond),
    direction: (p.direction ?? 1) < 0 ? -1 : 1,
  };
}

/** 装置ローカル → ワールド */
export function rotatorToWorld(device: PlacedDevice, local: Vec3): Vec3 {
  return add(device.position, rotateY(local, (device.rotationYDeg * Math.PI) / 180));
}

/** ワールド → 装置ローカル */
export function rotatorToLocal(device: PlacedDevice, p: Vec3): Vec3 {
  const d: Vec3 = [p[0] - device.position[0], p[1] - device.position[1], p[2] - device.position[2]];
  return rotateY(d, (-device.rotationYDeg * Math.PI) / 180);
}

/** 入口に来た球か（ローカル座標の球の中心） */
export function atRotatorEntry(local: Vec3): boolean {
  const c = ROTATOR.catch;
  const surface = ROTATOR.surfaceY;
  return (
    Math.abs(local[0]) <= c.side &&
    local[2] <= -ROTATOR.gateD + 0.05 &&
    local[2] >= -ROTATOR.half - c.along &&
    local[1] >= surface - 0.05 &&
    local[1] <= surface + 0.35
  );
}

/** 台の角度 a（rad、上から見て反時計回りが +）でレールが入口の向き（Z 軸）にそろっているか */
export function alignedWithEntry(a: number): boolean {
  const m = ((a % Math.PI) + Math.PI) % Math.PI;
  return m <= ROTATOR.alignTol || Math.PI - m <= ROTATOR.alignTol;
}

/**
 * 球の進む向き（ローカル、水平の単位ベクトル）。入ってきた向き（+Z）を、乗ってからの台の回転だけ回す。
 * 上から見て反時計回りを + とする（rotateY と同じ向き）。
 */
export function travelDir(turned: number): Vec3 {
  return rotateY([0, 0, 1], turned);
}

/** 送り出す出口。入口（−Z）以外の辺を向いたら、その辺の名前（front/left/right）。向いていなければ null */
export function exitFor(dir: Vec3): 'front' | 'left' | 'right' | null {
  const tol = Math.cos(ROTATOR.alignTol);
  if (dir[2] >= tol) return 'front';
  if (dir[0] >= tol) return 'left';
  if (dir[0] <= -tol) return 'right';
  return null;
}
