import { getDeviceDef, getPort, type Vec3 } from '../sim/catalog';
import type { PlacedDevice } from '../sim/layout';
import { portWorldPosition, rotateY } from '../sim/railGeometry';

/**
 * 配置・接続のルール（描画にも物理にも依存しない純粋関数）。
 * 値はすべて試作値（DECISIONS.md D-15）。
 */
export const PLACEMENT = {
  /** 水平グリッド（devices.v0.1.json gridSize） */
  grid: 0.25,
  /** ポート同士を吸着させる水平距離 */
  snapRadius: 0.5,
  /** ポートが一致しているとみなす距離 */
  portTolerance: 1e-3,
  /** 高さの上げ下げ単位（レールの既定 slopeMeters と同じにして段差なく連結しやすくする） */
  heightStep: 0.2,
  maxHeight: 3,
  /** 装置を置ける範囲（床 ±6m から壁・縁石の厚みを除いた内側） */
  bounds: { min: -5.75, max: 5.75 },
  maxDevices: 40,
} as const;

export interface PortRef {
  deviceId: string;
  portId: string;
}

export interface Connection {
  /** 出口側（ball_out） */
  from: PortRef;
  /** 入口側（ball_in） */
  to: PortRef;
}

export type PlacementProblem = 'overlap' | 'below_floor' | 'too_high' | 'out_of_bounds' | 'too_many';

export const PROBLEM_TEXT: Record<PlacementProblem, string> = {
  overlap: '他の装置と重なっています',
  below_floor: '床より低くなります（相手の高さを上げてください）',
  too_high: '高すぎます',
  out_of_bounds: '研究所の床の外です',
  too_many: `装置の数が上限（${PLACEMENT.maxDevices}個）に達しています`,
};

export interface SnapResult {
  /** ポートを一致させた装置の配置 */
  device: PlacedDevice;
  mine: PortRef;
  other: PortRef;
}

export interface PlacementEvaluation {
  device: PlacedDevice;
  ok: boolean;
  problem?: PlacementProblem;
  snap?: SnapResult;
  /** 近くにポートはあるが接続できない理由（向き違いなど）。配置自体は可能な場合もある */
  connectHint?: string;
}

export function portWorldDirection(device: PlacedDevice, portId: string): Vec3 {
  const port = getPort(getDeviceDef(device.type), portId);
  return rotateY(port.direction, (device.rotationYDeg * Math.PI) / 180);
}

export function snapToGrid(v: number): number {
  return Math.round(v / PLACEMENT.grid) * PLACEMENT.grid;
}

/** XZ 平面上の外形（90度単位の回転なので軸平行の箱で正確に表せる）と高さ範囲 */
export function footprint(device: PlacedDevice): { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number } {
  const [sx, sy, sz] = getDeviceDef(device.type).size;
  const quarter = (((Math.round(device.rotationYDeg / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  const [hx, hz] = quarter % 2 === 0 ? [sx / 2, sz / 2] : [sz / 2, sx / 2];
  const [x, y, z] = device.position;
  return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, minY: y, maxY: y + sy };
}

export function overlaps(a: PlacedDevice, b: PlacedDevice): boolean {
  const eps = 1e-6;
  const fa = footprint(a);
  const fb = footprint(b);
  return (
    fa.minX < fb.maxX - eps &&
    fb.minX < fa.maxX - eps &&
    fa.minZ < fb.maxZ - eps &&
    fb.minZ < fa.maxZ - eps &&
    fa.minY < fb.maxY - eps &&
    fb.minY < fa.maxY - eps
  );
}

function samePoint(a: Vec3, b: Vec3, tol: number = PLACEMENT.portTolerance): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= tol;
}

function opposite(a: Vec3, b: Vec3): boolean {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < -0.99;
}

/** ball ポートの組（出口→入口）。座標が一致し、向きが向かい合っていれば接続とみなす */
export function findConnections(devices: readonly PlacedDevice[]): Connection[] {
  const out: Connection[] = [];
  for (const a of devices) {
    for (const b of devices) {
      if (a.id === b.id) continue;
      if (
        samePoint(portWorldPosition(a, 'ball_out'), portWorldPosition(b, 'ball_in')) &&
        opposite(portWorldDirection(a, 'ball_out'), portWorldDirection(b, 'ball_in'))
      ) {
        out.push({ from: { deviceId: a.id, portId: 'ball_out' }, to: { deviceId: b.id, portId: 'ball_in' } });
      }
    }
  }
  return out;
}

/**
 * 鉄球を置くレール（発射機ができるまでの暫定ルール, DECISIONS.md D-16）：
 * 入口がどこにもつながっていないレールのうち、入口がいちばん高いもの。同じ高さなら配置順が先のもの。
 */
export function chooseBallStart(devices: readonly PlacedDevice[]): string | null {
  const fed = new Set(findConnections(devices).map((c) => c.to.deviceId));
  let best: { id: string; y: number } | null = null;
  for (const d of devices) {
    if (fed.has(d.id)) continue;
    const y = portWorldPosition(d, 'ball_in')[1];
    if (!best || y > best.y + 1e-9) best = { id: d.id, y };
  }
  return best?.id ?? null;
}

function problemOf(device: PlacedDevice, others: readonly PlacedDevice[]): PlacementProblem | undefined {
  const f = footprint(device);
  if (device.position[1] < -1e-9) return 'below_floor';
  if (device.position[1] > PLACEMENT.maxHeight + 1e-9) return 'too_high';
  const { min, max } = PLACEMENT.bounds;
  if (f.minX < min - 1e-9 || f.maxX > max + 1e-9 || f.minZ < min - 1e-9 || f.maxZ > max + 1e-9) return 'out_of_bounds';
  if (others.some((o) => overlaps(device, o))) return 'overlap';
  return undefined;
}

/** 指定位置に置けるか（ポート吸着なし） */
export function checkPlacement(device: PlacedDevice, others: readonly PlacedDevice[]): PlacementEvaluation {
  const problem = problemOf(device, others);
  return { device, ok: !problem, problem };
}

/**
 * ドラッグ中の評価。希望位置（XZ）をグリッドに合わせ、近くに接続できるポートがあれば吸着する。
 * 高さ（y）は吸着時のみ変わり、それ以外は元の高さを保つ。
 */
export function evaluateMove(moving: PlacedDevice, desiredX: number, desiredZ: number, others: readonly PlacedDevice[]): PlacementEvaluation {
  const free: PlacedDevice = { ...moving, position: [snapToGrid(desiredX), moving.position[1], snapToGrid(desiredZ)] };

  type Candidate = { snap: SnapResult; dist: number; problem?: PlacementProblem };
  const candidates: Candidate[] = [];
  let hint: { text: string; dist: number } | undefined;

  for (const o of others) {
    for (const [mine, theirs] of [
      ['ball_in', 'ball_out'],
      ['ball_out', 'ball_in'],
    ] as const) {
      const target = portWorldPosition(o, theirs);
      // 回転は動かしている装置のまま、ポートが target に来る位置を求める
      const local = portWorldPosition({ ...moving, position: [0, 0, 0] }, mine);
      const pos: Vec3 = [target[0] - local[0], target[1] - local[1], target[2] - local[2]];
      const dist = Math.hypot(pos[0] - desiredX, pos[2] - desiredZ);
      if (dist > PLACEMENT.snapRadius) continue;
      const placed: PlacedDevice = { ...moving, position: pos };
      if (!opposite(portWorldDirection(placed, mine), portWorldDirection(o, theirs))) {
        if (!hint || dist < hint.dist) hint = { text: `${o.id} とは向きが合いません（回転してください）`, dist };
        continue;
      }
      candidates.push({
        snap: { device: placed, mine: { deviceId: moving.id, portId: mine }, other: { deviceId: o.id, portId: theirs } },
        dist,
        problem: problemOf(placed, others),
      });
    }
  }

  candidates.sort((a, b) => a.dist - b.dist);
  const valid = candidates.find((c) => !c.problem);
  if (valid) return { device: valid.snap.device, ok: true, snap: valid.snap };

  const freeEval = checkPlacement(free, others);
  const nearest = candidates[0];
  if (nearest) {
    freeEval.connectHint = `${nearest.snap.other.deviceId} に接続できません：${PROBLEM_TEXT[nearest.problem!]}`;
  } else if (hint) {
    freeEval.connectHint = hint.text;
  }
  return freeEval;
}

/**
 * 新しい装置を置く空き場所を探す（希望位置から外側へ渦巻き状に探索）。見つからなければ null。
 */
export function findFreeSpot(template: PlacedDevice, nearX: number, nearZ: number, others: readonly PlacedDevice[]): PlacedDevice | null {
  const g = PLACEMENT.grid;
  const cx = snapToGrid(nearX);
  const cz = snapToGrid(nearZ);
  const maxRing = Math.ceil((PLACEMENT.bounds.max - PLACEMENT.bounds.min) / g);
  for (let ring = 0; ring <= maxRing; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const d: PlacedDevice = { ...template, position: [cx + i * g, template.position[1], cz + j * g] };
        if (!problemOf(d, others)) return d;
      }
    }
  }
  return null;
}
