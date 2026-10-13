import { portWorldDirection } from '../edit/placement';
import type { DeviceType, PlacedDevice, SliceLayout } from './layout';
import { portWorldPosition } from './railGeometry';

/**
 * 見本「全部のせ」（D-52）：発射機1台からゴール1つまで、全種類の装置（設定の違いも）を使った一本道のコースを、
 * 置ける上限（100個）近くまで部屋いっぱいに並べたもの。
 * - 部屋を7列で往復する。折り返しは主に回転台2台（左回り・右回り、速さ 90°/45°）、一か所は急なカーブ2本
 * - 1列目：発射の勢いでループ（大）。6列目：回転台のあとの下り坂でループ（小）
 * - 2列目：羽根車 → 歯車装置（2倍）→ 軸 → 可動橋。4列目の羽根車にも歯車装置（1/2倍・3倍）と軸
 * - スイッチは磁石（引きよせる・しりぞける）に配線。磁石は床や壁ぎわにあり、届く距離が最小なので球には効かない
 * - 7列目：45°カーブと斜めのレールで隣へ移り、部屋の奥を低いところで戻って（上の列の下をくぐる）、1列目の下へ
 * - 最後：バネで打ち上げて、台の上のゴールへ
 * 回転台は毎回同じ速さで送り出すので、ほとんどのレールは平らでよい。回転台の直後の上り坂で高さを少し取り戻す。
 * 位置は部品のポートをつないで計算し（手で座標を書かない）、最後に全体の高さをそろえる。
 */
const r9 = (v: number) => {
  const r = Math.round(v * 1e9) / 1e9;
  return Object.is(r, -0) ? 0 : r;
};

type Omit2 = Omit<PlacedDevice, 'position' | 'rotationYDeg'>;

/** prev の出口（port）に d の入口（inPort）をつないだ位置と向き */
export function attachAt(prev: PlacedDevice, port: string, d: Omit2, inPort = 'ball_in'): PlacedDevice {
  const out = portWorldPosition(prev, port);
  const odir = portWorldDirection(prev, port);
  for (const rot of [0, 90, 180, 270]) {
    const probe = { ...d, rotationYDeg: rot, position: [0, 0, 0] } as PlacedDevice;
    const idir = portWorldDirection(probe, inPort);
    if (Math.abs(idir[0] + odir[0]) < 1e-6 && Math.abs(idir[2] + odir[2]) < 1e-6) {
      const local = portWorldPosition(probe, inPort);
      // 軸は床から決まった高さを通すので、床に置く装置の高さは 0 のまま
      const y = d.type === 'gearbox' || d.type === 'shaft' ? 0 : r9(out[1] - local[1]);
      return { ...probe, position: [r9(out[0] - local[0]), y, r9(out[2] - local[2])] };
    }
  }
  throw new Error(`${d.id} をつなげる向きがありません`);
}

/** コースの1歩：部品を1つつなぐ（out は次の部品をつなぐ出口） */
type Step = { type: DeviceType; params?: Record<string, number>; out?: string; tag?: string };

const rail = (len: number, slope: number, lean = 0): Step => ({ type: 'rail', params: { lengthMeters: len, slopeMeters: slope, ...(lean ? { lean } : {}) } });
const curve = (turn: 1 | -1, radius: number, arc: 0 | 1 | 2): Step => ({ type: 'curve', params: { turn, radius, arc } });
/** 回転台で90°曲がる（dir +1 は左、−1 は右へ出す） */
const rot = (dir: 1 | -1): Step => ({ type: 'rotator', params: { degreesPerSecond: 90, direction: dir }, out: dir > 0 ? 'ball_left_out' : 'ball_right_out' });

/** 折り返し：回転台2台を直につなぐ（列の間は 1.2m） */
const uRot = (dir: 1 | -1, speed = 90): Step[] => [
  { ...rot(dir), params: { degreesPerSecond: speed, direction: dir } },
  { ...rot(dir), params: { degreesPerSecond: speed, direction: dir } },
];
const UP = rail(1, -0.1);
const F1 = rail(1, 0);

/**
 * コース（上から順に）。列は 7m（z = −4 〜 3）で、+z と −z を交互に進む。
 * ループは速さが要るので、ループ（大）は発射の勢いで、ループ（小）は回転台のあとの下り坂で回る。
 * 回転台は毎回同じ速さで送り出すので、そのほかは平らなレールでよい。回転台の直後の上り坂で高さを少し取り戻す。
 */
const COURSE: Step[] = [
  // 1列目（+z）：坂 → ループ（大）
  rail(2, 0.2),
  { type: 'loop', params: { radius: 0.5 } },
  F1,
  F1,
  F1,
  F1,
  F1,
  ...uRot(1),
  // 2列目（−z）：羽根車 → 3m 先の可動橋（床の歯車装置と軸がつなぐ）
  UP,
  { type: 'paddle', tag: 'paddle' },
  F1,
  rail(2, 0),
  { type: 'bridge', tag: 'bridge' },
  ...uRot(-1),
  // 3列目（+z）：スイッチ（磁石に配線）・3m のレール
  UP,
  { type: 'switch', tag: 'switch' },
  rail(3, 0),
  F1,
  F1,
  ...uRot(1, 45),
  // 4列目（−z）：羽根車
  UP,
  F1,
  { type: 'paddle', tag: 'paddle2' },
  F1,
  F1,
  F1,
  rail(1, 0.1),
  // 折り返し：急なカーブ2本（右・右）
  curve(-1, 0.75, 0),
  curve(-1, 0.75, 0),
  // 5列目（+z）：スイッチ3つ（それぞれ、この列の下の磁石に配線）
  F1,
  { type: 'switch', tag: 'sw_a' },
  F1,
  { type: 'switch', tag: 'sw_b' },
  F1,
  { type: 'switch', tag: 'sw_c' },
  F1,
  ...uRot(1),
  // 6列目（−z）：下り坂 → ループ（小）
  F1,
  rail(1, 0.2),
  rail(1, 0.2),
  rail(1, 0.2),
  rail(1, 0.2),
  rail(1, 0.2),
  { type: 'loop', params: { radius: 0.35 } },
  rail(1, 0.1),
  ...uRot(-1),
  // 7列目（+z）：45°カーブで斜めのレールを通って隣の列へ（車線変更）→ 最後
  UP,
  F1,
  curve(1, 1.25, 1),
  rail(1, 0, 1),
  curve(-1, 1.25, 2),
  F1,
  // 部屋の奥を、低いところで −x へ戻る（上の列の下をくぐる）
  rot(-1),
  UP,
  F1,
  F1,
  F1,
  F1,
  F1,
  F1,
  F1,
  rot(-1),
  // 1列目の下を −z へ → 最後
  UP,
  F1,
  F1,
  rail(1, 0.2),
];

/** 最後：レールの出口（高さ 0.75m）から 0.45m 先のバネで打ち上げ、台（1m）の上のゴールへ（見本「バネでゴール」と同じ形） */
function finale(last: PlacedDevice, n: () => string): PlacedDevice[] {
  const end = portWorldPosition(last, 'ball_out');
  const dir = portWorldDirection(last, 'ball_out');
  const at = (d: number): [number, number] => [r9(end[0] + dir[0] * d), r9(end[2] + dir[2] * d)];
  const yaw = r9((Math.atan2(dir[0], dir[2]) * 180) / Math.PI + 360) % 360;
  const [sx, sz] = at(0.45);
  // 台とゴールは、部屋の内側へ少し寄せる（球の通り道は台・ゴールの範囲に入ったまま）
  const inward = (v: number) => (Math.abs(v) > 4.8 ? -Math.sign(v) * 0.4 : 0);
  const [px0, pz] = at(1.7);
  const [gx0, gz] = at(1.95);
  const px = r9(px0 + inward(px0));
  const gx = r9(gx0 + inward(gx0) * 0.25);
  return [
    { id: n(), type: 'spring', position: [sx, 0, sz], rotationYDeg: yaw, params: { tiltDegrees: 15 } },
    { id: n(), type: 'platform', position: [px, 0, pz], rotationYDeg: 0, params: { heightMeters: 1 } },
    { id: 'goal_1', type: 'goal', position: [gx, 1, gz], rotationYDeg: 0 },
  ];
}

function build(): PlacedDevice[] {
  const count = new Map<string, number>();
  const id = (type: string) => {
    const k = (count.get(type) ?? 0) + 1;
    count.set(type, k);
    return `${type}_${k}`;
  };
  const launcher: PlacedDevice = { id: 'launcher_1', type: 'launcher', position: [-4.8, 0, -4.65], rotationYDeg: 0, params: { cooldownSeconds: 3, launchSpeed: 7 } };
  const path: PlacedDevice[] = [launcher];
  const tags = new Map<string, PlacedDevice>();
  let prev = launcher;
  let prevOut = 'ball_out';
  for (const s of COURSE) {
    const d = attachAt(prev, prevOut, { id: id(s.type), type: s.type, ...(s.params ? { params: { ...s.params } } : {}) });
    path.push(d);
    if (s.tag) tags.set(s.tag, d);
    prev = d;
    prevOut = s.out ?? 'ball_out';
  }
  // 全体の高さ：最後のレールの出口が 0.75m になるようにずらす（床置きの装置はそのまま）
  const lift = 0.75 - portWorldPosition(prev, prevOut)[1];
  for (const d of path) d.position = [d.position[0], r9(d.position[1] + lift), d.position[2]];

  // 歯車：羽根車の軸 → 歯車装置（2倍）→ 軸 → 可動橋
  const extra: PlacedDevice[] = [];
  const paddle = tags.get('paddle')!;
  const gear = attachAt(paddle, 'shaft_out', { id: id('gearbox'), type: 'gearbox', params: { gearRatio: 2 } }, 'shaft_in');
  const shaft = attachAt(gear, 'shaft_out', { id: id('shaft'), type: 'shaft', params: { lengthMeters: 1.5 } }, 'shaft_in');
  extra.push(gear, shaft);
  // 2つ目の羽根車にも歯車装置（1/2倍）と軸（回る様子を見せるだけ）
  const gear2 = attachAt(tags.get('paddle2')!, 'shaft_out', { id: id('gearbox'), type: 'gearbox', params: { gearRatio: 0.5 } }, 'shaft_in');
  const shaft2 = attachAt(gear2, 'shaft_out', { id: id('shaft'), type: 'shaft', params: { lengthMeters: 0.5 } }, 'shaft_in');
  const gear3 = attachAt(shaft2, 'shaft_out', { id: id('gearbox'), type: 'gearbox', params: { gearRatio: 3 } }, 'shaft_in');
  const shaft3 = attachAt(gear3, 'shaft_out', { id: id('shaft'), type: 'shaft', params: { lengthMeters: 1 } }, 'shaft_in');
  extra.push(gear2, shaft2, gear3, shaft3);
  // 高い列の下の床に、配線しない磁石（いつも ON。届く距離が最小なので球には効かない）
  for (const [x, z] of [[-3.1, 3], [-3.1, -1.5], [-0.7, 1], [-0.7, -4]]) {
    extra.push({ id: id('magnet'), type: 'magnet', position: [x, 0, z], rotationYDeg: 90, params: { mode: 1, maxForceNewton: 5, radius: 0.5 } });
  }
  // 5列目の下の床に磁石（球には届かない）。スイッチから配線
  // 奥の低い通り道（z≈2）にかからない所だけ
  const wires: [string, number[]][] = [['sw_a', [-3, -2]], ['sw_b', [-1, 0]], ['sw_c', [1]]];
  for (const [tag, zs] of wires) {
    const sw = tags.get(tag)!;
    const under: PlacedDevice[] = zs.map((z, i) => ({
      id: id('magnet'),
      type: 'magnet',
      position: [sw.position[0], 0, z],
      rotationYDeg: 90,
      params: { mode: i === 0 ? 1 : -1, maxForceNewton: 5, radius: 0.5 },
    }));
    sw.signalTargets = under.map((m) => m.id);
    extra.push(...under);
  }

  // 磁石（引きよせる・しりぞける）：スイッチの横に置き、スイッチから配線（ON の間だけ効く）
  const magnetBeside = (sw: PlacedDevice, mode: 1 | -1): PlacedDevice => ({
    id: id('magnet'),
    type: 'magnet',
    position: [r9(sw.position[0] - 0.75), 0, sw.position[2]],
    rotationYDeg: 90,
    params: { mode, maxForceNewton: 5, radius: 0.5 },
  });
  const sw = tags.get('switch')!;
  const m1 = magnetBeside(sw, 1);
  const m2: PlacedDevice = { id: id('magnet'), type: 'magnet', position: [-1.9, 0, 3], rotationYDeg: 90, params: { mode: -1, maxForceNewton: 5, radius: 0.5 } };
  sw.signalTargets = [m1.id, m2.id];
  extra.push(m1, m2);

  return [...path, ...extra, ...finale(prev, () => id('x'))].map((d) => (d.id.startsWith('x_') ? { ...d, id: id(d.type) } : d));
}

export const FULL_SAMPLE_LAYOUT: SliceLayout = { seed: 404, devices: build() };
