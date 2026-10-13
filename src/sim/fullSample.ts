import { portWorldDirection } from '../edit/placement';
import type { DeviceType, PlacedDevice, SliceLayout } from './layout';
import { portWorldPosition } from './railGeometry';

/**
 * 見本「全部のせ」（D-52）：いろいろな装置を、置ける上限（100個）近くまで部屋いっぱいに並べた配置。
 * 重さ（描画・物理）を確かめるためにも使う。
 * - 7本のレーン：発射機 → 1m の部品9個（レール・羽根車・スイッチ、まん中のレーンはループも）→ ゴール。合わせて99個
 * - 左右の壁ぎわに磁石の列（11台ずつ）（壁の方を向き、球には届かない）。各レーンのスイッチを磁石に配線してある
 * 位置は部品のポートをつないで計算する（手で座標を書かない）。
 */
type Piece = { type: DeviceType; params?: Record<string, number> };

const r9 = (v: number) => Math.round(v * 1e9) / 1e9;

/** prev の出口（port）に d の入口をつないだ位置と向き */
export function attachAt(prev: PlacedDevice, port: string, d: Omit<PlacedDevice, 'position' | 'rotationYDeg'>): PlacedDevice {
  const out = portWorldPosition(prev, port);
  const odir = portWorldDirection(prev, port);
  for (const rot of [0, 90, 180, 270]) {
    const probe = { ...d, rotationYDeg: rot, position: [0, 0, 0] } as PlacedDevice;
    const idir = portWorldDirection(probe, 'ball_in');
    if (Math.abs(idir[0] + odir[0]) < 1e-6 && Math.abs(idir[2] + odir[2]) < 1e-6) {
      const local = portWorldPosition(probe, 'ball_in');
      return { ...probe, position: [r9(out[0] - local[0]), r9(out[1] - local[1]), r9(out[2] - local[2])] };
    }
  }
  throw new Error(`${d.id} をつなげる向きがありません`);
}

const R1: Piece = { type: 'rail', params: { lengthMeters: 1, slopeMeters: 0.1 } };
const PAD: Piece = { type: 'paddle' };
const SW: Piece = { type: 'switch' };
const LOOP: Piece = { type: 'loop' };

/** レーンごとの部品（どれも長さ 1m、下りは 0.05〜0.1m） */
const LANES: Piece[][] = [
  [R1, PAD, R1, SW, R1, PAD, R1, R1, R1],
  [R1, SW, R1, R1, PAD, R1, SW, R1, R1],
  [R1, R1, PAD, R1, R1, SW, R1, PAD, R1],
  [R1, SW, R1, PAD, LOOP, R1, R1, R1, R1],
  [R1, R1, R1, SW, PAD, R1, R1, R1, R1],
  [R1, PAD, R1, R1, SW, R1, PAD, R1, R1],
  [R1, R1, SW, R1, R1, PAD, R1, SW, R1],
];
const LANE_X = [-4.2, -2.8, -1.4, 0, 1.4, 2.8, 4.2];

function build(): PlacedDevice[] {
  const out: PlacedDevice[] = [];
  const magnetsL: PlacedDevice[] = [];
  const magnetsR: PlacedDevice[] = [];
  // 壁ぎわの磁石（11台ずつ。壁の方を向く・届く距離は最小）
  for (let i = 0; i < 11; i++) {
    const z = -5 + i;
    magnetsL.push({ id: `magnet_l${i + 1}`, type: 'magnet', position: [-5.3, 0, z], rotationYDeg: 270, params: { mode: 1, maxForceNewton: 5, radius: 0.5 } });
    magnetsR.push({ id: `magnet_r${i + 1}`, type: 'magnet', position: [5.3, 0, z], rotationYDeg: 90, params: { mode: 1, maxForceNewton: 5, radius: 0.5 } });
  }
  let wire = 0;
  LANES.forEach((pieces, li) => {
    const L = String.fromCharCode(97 + li); // a, b, c, …
    const drop = pieces.reduce((n, p) => n + (p.type === 'loop' ? 0.05 : 0.1), 0);
    // 最後の部品の出口が床から 0.15m になる高さから始める
    const launcher: PlacedDevice = { id: `launcher_${L}`, type: 'launcher', position: [LANE_X[li], r9(0.15 + drop - 0.75), -4.9], rotationYDeg: 0, params: { cooldownSeconds: 2 + (li % 3) * 0.5 } };
    out.push(launcher);
    let prev = launcher;
    pieces.forEach((p, pi) => {
      const d = attachAt(prev, 'ball_out', { id: `${p.type}_${L}${pi + 1}`, type: p.type, ...(p.params ? { params: { ...p.params } } : {}) });
      if (d.type === 'switch') {
        // 壁ぎわの磁石に配線（左半分のレーンは左の列、右半分は右の列）
        const target = (LANE_X[li] < 0 ? magnetsL : magnetsR)[wire++ % 11];
        d.signalTargets = [target.id];
      }
      out.push(d);
      prev = d;
    });
    const end = portWorldPosition(prev, 'ball_out');
    out.push({ id: `goal_${L}`, type: 'goal', position: [r9(end[0]), 0, r9(end[2] + 0.45)], rotationYDeg: 0 });
  });
  return [...out, ...magnetsL, ...magnetsR];
}

export const FULL_SAMPLE_LAYOUT: SliceLayout = { seed: 404, devices: build() };
