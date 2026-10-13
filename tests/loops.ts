import type { PlacedDevice } from '../src/sim/layout';
import { portWorldPosition } from '../src/sim/railGeometry';
import { portWorldDirection } from '../src/edit/placement';

const r9 = (v: number) => Math.round(v * 1e9) / 1e9;

/** prev の port（出口）に、d の入口をつないだ位置と向き */
export function attach(prev: PlacedDevice, port: string, d: Omit<PlacedDevice, 'position' | 'rotationYDeg'>): PlacedDevice {
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

/**
 * 回転台4台と平らなレール4本の輪（閉じたレール）。発射機は1球だけ撃ち、rotator_4 の上を越えて rail_4 に落とす。
 * 回転台が毎回同じ速さで送り出すので、球は同じ周回をくり返す（検証・隠しバグの試験用）。
 */
export function rotatorRing(): PlacedDevice[] {
  const out: PlacedDevice[] = [];
  let rot: PlacedDevice = { id: 'rotator_1', type: 'rotator', position: [-1.5, 0, 1.5], rotationYDeg: 0, params: { degreesPerSecond: 90 } };
  out.push(rot);
  for (let i = 0; i < 4; i++) {
    const rail = attach(rot, 'ball_left_out', { id: `rail_${i + 1}`, type: 'rail', params: { slopeMeters: 0 } });
    out.push(rail);
    if (i === 3) break;
    rot = attach(rail, 'ball_out', { id: `rotator_${i + 2}`, type: 'rotator', params: { degreesPerSecond: 90 } });
    out.push(rot);
  }
  const r4 = out.find((d) => d.id === 'rail_4')!;
  return [{ id: 'launcher_1', type: 'launcher', position: [r4.position[0], 0, r4.position[2] - 3], rotationYDeg: 0, params: { angleDegrees: 0, launchSpeed: 3, shots: 1 } }, ...out];
}

/**
 * 電池つきの回転台4台の輪（羽根車つき）。電池が切れるまでは回転台が球を回し、そのあとは隠しバグだけで回る（D-45 の確認用）。
 * 羽根車で 0.1m 下がる分は、最後の1mの上り坂で取り戻す。
 */
export function batteryRing(batterySeconds: number): PlacedDevice[] {
  const P = { degreesPerSecond: 90, batterySeconds };
  const y0 = 0.3;
  const out: PlacedDevice[] = [];
  const r1: PlacedDevice = { id: 'rotator_1', type: 'rotator', position: [-1.5, y0, 1.5], rotationYDeg: 0, params: P };
  const pad = attach(r1, 'ball_left_out', { id: 'paddle_1', type: 'paddle' });
  const ra = attach(pad, 'ball_out', { id: 'rail_1', type: 'rail', params: { slopeMeters: 0, lengthMeters: 1 } });
  out.push(r1, pad, ra);
  let prev = attach(ra, 'ball_out', { id: 'rotator_2', type: 'rotator', params: P });
  out.push(prev);
  for (const i of [2, 3]) {
    const rail = attach(prev, 'ball_left_out', { id: `rail_${i}`, type: 'rail', params: { slopeMeters: 0 } });
    prev = attach(rail, 'ball_out', { id: `rotator_${i + 1}`, type: 'rotator', params: P });
    out.push(rail, prev);
  }
  const up = attach(prev, 'ball_left_out', { id: 'rail_4', type: 'rail', params: { slopeMeters: -0.1, lengthMeters: 1 } });
  const last = attach(up, 'ball_out', { id: 'rail_5', type: 'rail', params: { slopeMeters: 0, lengthMeters: 1 } });
  out.push(up, last);
  return [{ id: 'launcher_1', type: 'launcher', position: [last.position[0], y0, last.position[2] - 3.5], rotationYDeg: 0, params: { angleDegrees: 0, launchSpeed: 3, shots: 1 } }, ...out];
}
