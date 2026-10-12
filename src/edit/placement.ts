import { getDeviceDef, type Vec3 } from '../sim/catalog';
import type { PlacedDevice } from '../sim/layout';
import { platformTop, platformHeight } from '../sim/goal';
import { shaftLength } from '../sim/drive';
import { localPort, portWorldPosition, railLength, rotateY } from '../sim/railGeometry';
import { curveShape, shapeBounds } from '../sim/curveGeometry';

/**
 * 置いた面の上に乗る装置（DECISIONS.md D-23）。高さは手で変えず、真下の台の上面（無ければ床）に合わせる。
 * 台そのものは常に床に置く。
 */
export function restsOnSurface(type: PlacedDevice['type']): boolean {
  return type === 'goal' || type === 'spring' || type === 'platform' || type === 'gearbox' || type === 'shaft' || type === 'magnet';
}

/** (x, z) の真下にある台の上面の高さ（無ければ 0 = 床） */
export function surfaceHeightAt(x: number, z: number, devices: readonly PlacedDevice[], excludeId?: string): number {
  let top = 0;
  for (const d of devices) {
    if (d.type !== 'platform' || d.id === excludeId) continue;
    const f = footprint(d);
    if (x > f.minX + 1e-9 && x < f.maxX - 1e-9 && z > f.minZ + 1e-9 && z < f.maxZ - 1e-9) top = Math.max(top, platformTop(d));
  }
  return top;
}

/** 面に乗る装置の高さを、真下の面に合わせる（それ以外はそのまま） */
export function seatOnSurface(device: PlacedDevice, others: readonly PlacedDevice[]): PlacedDevice {
  if (!restsOnSurface(device.type)) return device;
  const y = device.type === 'platform' ? 0 : surfaceHeightAt(device.position[0], device.position[2], others, device.id);
  return y === device.position[1] ? device : { ...device, position: [device.position[0], y, device.position[2]] };
}

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
  type: 'ball' | 'shaft';
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
  const port = localPort(device, portId);
  return rotateY(port.direction, (device.rotationYDeg * Math.PI) / 180);
}

export function snapToGrid(v: number): number {
  return Math.round(v / PLACEMENT.grid) * PLACEMENT.grid;
}

/** XZ 平面上の外形（90度単位の回転なので軸平行の箱で正確に表せる）と高さ範囲 */
export function footprint(device: PlacedDevice): { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number } {
  const [sx, defY, defZ] = getDeviceDef(device.type).size;
  const sy = device.type === 'platform' ? platformHeight(device) : defY;
  const sz = device.type === 'shaft' ? shaftLength(device) : device.type === 'rail' ? railLength(device) : defZ;
  // 装置ローカルの外形（カーブは形に合わせる。45°は原点に対して片寄る）
  const local = device.type === 'curve' ? shapeBounds(curveShape(device)) : { minX: -sx / 2, maxX: sx / 2, minZ: -sz / 2, maxZ: sz / 2 };
  const yaw = (Math.round(device.rotationYDeg / 90) * Math.PI) / 2;
  const [x, y, z] = device.position;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const cx of [local.minX, local.maxX]) {
    for (const cz of [local.minZ, local.maxZ]) {
      const [wx, , wz] = rotateY([cx, 0, cz], yaw);
      minX = Math.min(minX, x + wx);
      maxX = Math.max(maxX, x + wx);
      minZ = Math.min(minZ, z + wz);
      maxZ = Math.max(maxZ, z + wz);
    }
  }
  const r = (v: number) => Math.round(v * 1e9) / 1e9;
  return { minX: r(minX), maxX: r(maxX), minZ: r(minZ), maxZ: r(maxZ), minY: y, maxY: y + sy };
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

/**
 * ball 型ポートの役割。devices.v0.1.json に入口/出口の区別が無いため、ID の接尾辞で判定する（DECISIONS.md D-18）。
 * spring の impact のような接尾辞の無い ball ポートは、レールとの接続対象にしない。
 */
export function ballPortRole(portId: string): 'in' | 'out' | null {
  if (portId.endsWith('_out')) return 'out';
  if (portId.endsWith('_in')) return 'in';
  return null;
}

/** 接続の対象になるポート（ball・shaft の入口/出口）。signal はまだ扱わない */
export function rolePorts(device: PlacedDevice): { portId: string; role: 'in' | 'out'; type: 'ball' | 'shaft' }[] {
  return getDeviceDef(device.type)
    .ports.filter((p) => p.type === 'ball' || p.type === 'shaft')
    .flatMap((p) => {
      const role = ballPortRole(p.id);
      return role ? [{ portId: p.id, role, type: p.type as 'ball' | 'shaft' }] : [];
    });
}

/** 装置の ball 型ポートのうち、入口/出口のどちらかに当たるもの */
export function ballPorts(device: PlacedDevice): { portId: string; role: 'in' | 'out' }[] {
  return rolePorts(device).filter((p) => p.type === 'ball');
}

function linked(a: PlacedDevice, aPort: string, b: PlacedDevice, bPort: string): boolean {
  return samePoint(portWorldPosition(a, aPort), portWorldPosition(b, bPort)) && opposite(portWorldDirection(a, aPort), portWorldDirection(b, bPort));
}

/** 出口→入口のつながり（ball・shaft とも）。座標が一致し、向きが向かい合っていれば接続とみなす */
export function findConnections(devices: readonly PlacedDevice[]): Connection[] {
  const out: Connection[] = [];
  for (const a of devices) {
    for (const ap of rolePorts(a)) {
      if (ap.role !== 'out') continue;
      for (const b of devices) {
        if (a.id === b.id) continue;
        for (const bp of rolePorts(b)) {
          if (bp.role === 'in' && bp.type === ap.type && linked(a, ap.portId, b, bp.portId)) {
            out.push({ type: ap.type, from: { deviceId: a.id, portId: ap.portId }, to: { deviceId: b.id, portId: bp.portId } });
          }
        }
      }
    }
  }
  return out;
}

/** 2台が ball / shaft ポートで接続されているか */
export function areConnected(a: PlacedDevice, b: PlacedDevice): boolean {
  for (const ap of rolePorts(a)) {
    for (const bp of rolePorts(b)) {
      if (ap.role === bp.role || ap.type !== bp.type) continue;
      if (linked(a, ap.portId, b, bp.portId)) return true;
    }
  }
  return false;
}

/**
 * 外形の重なり。ただし接続している2台は除外する。
 * 発射機の ball_out（z=0.65）は外形（奥行き1.4の半分＝0.7）の内側にあるため、つなぐと必ずわずかに重なる（SPEC_GAPS G-18）。
 */
export function conflicts(a: PlacedDevice, b: PlacedDevice): boolean {
  return overlaps(a, b) && !areConnected(a, b);
}

function problemOf(device: PlacedDevice, others: readonly PlacedDevice[]): PlacementProblem | undefined {
  const f = footprint(device);
  if (device.position[1] < -1e-9) return 'below_floor';
  if (device.position[1] > PLACEMENT.maxHeight + 1e-9) return 'too_high';
  const { min, max } = PLACEMENT.bounds;
  if (f.minX < min - 1e-9 || f.maxX > max + 1e-9 || f.minZ < min - 1e-9 || f.maxZ > max + 1e-9) return 'out_of_bounds';
  if (others.some((o) => conflicts(device, o))) return 'overlap';
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
  const free: PlacedDevice = seatOnSurface({ ...moving, position: [snapToGrid(desiredX), moving.position[1], snapToGrid(desiredZ)] }, others);

  type Candidate = { snap: SnapResult; dist: number; problem?: PlacementProblem };
  const candidates: Candidate[] = [];
  let hint: { text: string; dist: number } | undefined;

  const pairs = (o: PlacedDevice) =>
    rolePorts(moving).flatMap((m) =>
      rolePorts(o)
        .filter((t) => t.role !== m.role && t.type === m.type)
        .map((t) => [m.portId, t.portId, m.type] as const),
    );

  for (const o of others) {
    for (const [mine, theirs, type] of pairs(o)) {
      const target = portWorldPosition(o, theirs);
      // 回転は動かしている装置のまま、ポートが target に来る位置を求める
      const local = portWorldPosition({ ...moving, position: [0, 0, 0] }, mine);
      // 軸は床から一定の高さを通すので、軸どうしの吸着では高さを変えない（面に乗る装置は面に合わせる）
      const y = type === 'shaft' ? moving.position[1] : target[1] - local[1];
      // 斜めのポート（45°カーブ）でも位置の誤差がたまらないよう細かく丸める
      const r9 = (v: number) => Math.round(v * 1e9) / 1e9;
      const pos: Vec3 = [r9(target[0] - local[0]), r9(y), r9(target[2] - local[2])];
      const dist = Math.hypot(pos[0] - desiredX, pos[2] - desiredZ);
      if (dist > PLACEMENT.snapRadius) continue;
      const placed: PlacedDevice = seatOnSurface({ ...moving, position: pos }, others);
      if (type === 'shaft' && !samePoint(portWorldPosition(placed, mine), target)) {
        if (!hint || dist < hint.dist) hint = { text: `${o.id} とは軸の高さが合いません（歯車装置と軸は床に置いてください）`, dist };
        continue;
      }
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
        const d: PlacedDevice = seatOnSurface({ ...template, position: [cx + i * g, template.position[1], cz + j * g] }, others);
        if (!problemOf(d, others)) return d;
      }
    }
  }
  return null;
}
