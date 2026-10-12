import type { Vec3 } from './catalog';
import type { PlacedDevice } from './layout';
import { magnetParams, magnetPole } from './magnet';
import { rotateY } from './railGeometry';

/**
 * 隠しバグ（意図して仕込んだ例外法則, マスター仕様 §4 / DECISIONS.md D-37）。
 * マスター仕様 §10 の手順3「まず3種だけ」に従い、今ある装置で起こせる3種を実装する。
 * 発動の条件・効果は開発用資料（リポジトリ外, spec/private）の各IDに従う。条件の文章はゲームの画面・保存ファイルに出さない。
 * どれも物理の状態だけで決まり、同じ配置なら毎回同じ tick で発動する（決定論）。
 */
export type BugId = 'BUG-12' | 'BUG-16' | 'BUG-18';
export const IMPLEMENTED_BUGS: readonly BugId[] = ['BUG-12', 'BUG-16', 'BUG-18'];

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
} as const;

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
