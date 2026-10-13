import type { Vec3 } from './catalog';
import type { DeviceType, PlacedDevice } from './layout';
import { findConnections, portWorldDirection } from '../edit/placement';
import { portWorldPosition } from './railGeometry';
import { magnetParams, magnetPole } from './magnet';
import { rotateY } from './railGeometry';

/**
 * 隠しバグ（意図して仕込んだ例外法則, マスター仕様 §4 / DECISIONS.md D-37）。
 * マスター仕様 §10 の手順3「まず3種だけ」に従い、今ある装置で起こせる3種を実装した（D-37）。
 * そのあと BUG-03・BUG-15・BUG-30 を足した（D-42。2026-10-12 ユーザー判断）。
 * 発動の条件・効果は開発用資料（リポジトリ外, spec/private）の各IDに従う。条件の文章はゲームの画面・保存ファイルに出さない。
 * どれも物理の状態だけで決まり、同じ配置なら毎回同じ tick で発動する（決定論）。
 */
export type BugId = 'BUG-03' | 'BUG-12' | 'BUG-15' | 'BUG-16' | 'BUG-18' | 'BUG-30';
export const IMPLEMENTED_BUGS: readonly BugId[] = ['BUG-03', 'BUG-12', 'BUG-15', 'BUG-16', 'BUG-18', 'BUG-30'];

export interface BugTrigger {
  id: BugId;
  tick: number;
  /** 発動した場所（演出用） */
  at: Vec3;
}

/** 試作の数値（安全上限を含む） */
export const BUG_TUNING = {
  // BUG-12
  stillSpeed: 0.03,
  stillSeconds: 10,
  floorBallY: 0.13,
  slickSeconds: 2,
  slickAccel: 2,
  slickMaxSpeed: 3,
  // BUG-16
  pairAlign: 0.95,
  pairMaxGap: 3,
  centerRadius: 0.35,
  centerSeconds: 1,
  centerStill: 0.05,
  flipRegion: 1.0,
  flipMaxForce: 20,
  // BUG-18
  passesToTrigger: 20,
  passesPerStep: 5,
  frictionStep: 0.75,
  minFrictionFactor: 0.05,
  // BUG-03
  loopLaps: 3,
  loopPosGrid: 0.05,
  loopSpeedGrid: 0.1,
  loopCatch: 0.25,
  /** 覚えておける1周の長さの上限（秒） */
  loopMaxSeconds: 60,
  // BUG-15
  repeatRuns: 7,
  repeatAtTick: 600,
  // BUG-30
  watchCount: 5,
  watchLaunchFactor: 1.5,
  watchSpringFactor: 1.3,
  watchReleaseFactor: 2,
  watchMagnetTicks: 120,
} as const;

/** 閉じたレール（球の通り道が輪になっている所）の見張り地点：輪の中で最初（配置順）の装置の出口 */
export interface LoopCheckpoint {
  deviceId: string;
  at: Vec3;
  dir: Vec3;
}

/** 球の通り道（ball ポートのつながり）の輪を探し、輪ごとに見張り地点を1つ決める（配置順で決まる） */
export function closedLoops(devices: readonly PlacedDevice[]): LoopCheckpoint[] {
  const edges = findConnections(devices).filter((c) => c.type === 'ball');
  const next = new Map<string, { to: string; port: string }[]>();
  for (const c of edges) {
    const list = next.get(c.from.deviceId) ?? [];
    list.push({ to: c.to.deviceId, port: c.from.portId });
    next.set(c.from.deviceId, list);
  }
  const reach = (from: string, target: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === target) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of next.get(id) ?? []) stack.push(e.to);
    }
    return false;
  };
  const order = new Map(devices.map((d, i) => [d.id, i]));
  const out: LoopCheckpoint[] = [];
  const covered = new Set<string>();
  for (const d of devices) {
    if (covered.has(d.id)) continue;
    const e = (next.get(d.id) ?? []).find((x) => reach(x.to, d.id));
    if (!e) continue;
    // 同じ輪の装置は見張り地点を作らない（最初の装置だけ）
    for (const o of devices) if (reach(d.id, o.id) && reach(o.id, d.id)) covered.add(o.id);
    out.push({ deviceId: d.id, at: portWorldPosition(d, e.port), dir: portWorldDirection(d, e.port) });
  }
  return out.sort((a, b) => order.get(a.deviceId)! - order.get(b.deviceId)!);
}

/** 見張り地点を通った球の状態を量子化する（横のずれ・高さ・速さ） */
export function loopKey(cp: LoopCheckpoint, p: Vec3, v: Vec3): string {
  const t = BUG_TUNING;
  const rel: Vec3 = [p[0] - cp.at[0], p[1] - cp.at[1], p[2] - cp.at[2]];
  const side = rel[0] * -cp.dir[2] + rel[2] * cp.dir[0];
  return [Math.round(side / t.loopPosGrid), Math.round(rel[1] / t.loopPosGrid), Math.round(Math.hypot(v[0], v[1], v[2]) / t.loopSpeedGrid)].join(',');
}

/** 決まった種から 0 以上 1 未満の数を作る（mulberry32）。BUG-15 の分岐先の選び直しに使う */
export function seeded(seed: number): number {
  let a = (seed | 0) + 0x6d2b79f5;
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}

/** BUG-30 の効果がある装置（固定の表。ほかの装置は見ていても何も起きない） */
export function watchable(type: DeviceType): boolean {
  return type === 'launcher' || type === 'spring' || type === 'switch' || type === 'rotator' || type === 'magnet' || type === 'paddle';
}

/** 再生ごとに外から渡す、隠しバグの準備（BUG-15・BUG-30。どちらも物理の外の出来事で準備される） */
export interface BugArm {
  /** BUG-15：この再生で最初の分岐先を、この種で選び直す */
  branchSeed?: number;
  /** BUG-30：この装置の次の挙動を1回変える */
  watchedId?: string;
}

/** 2台の磁石が向かい合う組（BUG-16 の対象） */
export interface MagnetPair {
  a: string;
  b: string;
  mid: Vec3;
}

/** 向かい合う「しりぞける」磁石の組を探す（配置順で決まる） */
export function facingRepelPairs(magnets: readonly PlacedDevice[]): MagnetPair[] {
  const pairs: MagnetPair[] = [];
  const dir = (m: PlacedDevice): Vec3 => rotateY([0, 0, 1], (m.rotationYDeg * Math.PI) / 180);
  for (let i = 0; i < magnets.length; i++) {
    for (let j = i + 1; j < magnets.length; j++) {
      const A = magnets[i];
      const B = magnets[j];
      if (magnetParams(A).mode !== -1 || magnetParams(B).mode !== -1) continue;
      const pa = magnetPole(A);
      const pb = magnetPole(B);
      const d: Vec3 = [pb[0] - pa[0], 0, pb[2] - pa[2]];
      const len = Math.hypot(d[0], d[2]);
      if (len < 0.2 || len > BUG_TUNING.pairMaxGap) continue;
      const u: Vec3 = [d[0] / len, 0, d[2] / len];
      const da = dir(A);
      const db = dir(B);
      if (u[0] * da[0] + u[2] * da[2] < BUG_TUNING.pairAlign) continue;
      if (u[0] * db[0] + u[2] * db[2] > -BUG_TUNING.pairAlign) continue;
      pairs.push({ a: A.id, b: B.id, mid: [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2] });
    }
  }
  return pairs;
}

/** 球が床の上にいるか（BUG-12） */
export function onFloor(p: Vec3): boolean {
  return p[1] < BUG_TUNING.floorBallY;
}

/** 滑り出す向き：部屋の中央へ（中央なら +Z） */
export function slickDirection(p: Vec3): Vec3 {
  const l = Math.hypot(p[0], p[2]);
  return l < 0.05 ? [0, 0, 1] : [-p[0] / l, 0, -p[2] / l];
}

/** 何回目の通過で、摩擦を何倍にするか（BUG-18） */
export function wornFrictionFactor(passes: number): number {
  const t = BUG_TUNING;
  if (passes < t.passesToTrigger) return 1;
  const steps = 1 + Math.floor((passes - t.passesToTrigger) / t.passesPerStep);
  const f = Math.pow(t.frictionStep, steps);
  return f < t.minFrictionFactor ? 0 : f;
}
