import type { DeviceType, PlacedDevice } from './layout';
import { inPaddleZone } from './drive';

/**
 * スイッチ（試作, DECISIONS.md D-30）。
 * - 長さ1mのレール（羽根車と同じ形）。球が範囲に入るたびに ON↔OFF が切り替わる。最初は OFF
 * - 配線（PlacedDevice.signalTargets）した発射機・磁石へ信号を送る。信号は「ON の間だけ」効く
 *   - 発射機：配線されていると ON の間だけいつもの間隔で撃つ（配線が無ければ今までどおり）
 *   - 磁石：配線されていると ON の間だけ力が掛かる
 * - 1台に複数のスイッチを配線したら、どれか1つでも ON なら ON
 */

/** スイッチの信号を受けられる装置 */
export function acceptsSignal(type: DeviceType): boolean {
  return type === 'launcher' || type === 'magnet';
}

/** 信号を受け取るポート（配線の線の端） */
export function signalInPort(type: DeviceType): string | null {
  return type === 'launcher' ? 'trigger' : type === 'magnet' ? 'enable' : null;
}

/** スイッチの範囲（羽根車と同じ：レールの中央付近の、走行面の上） */
export function inSwitchZone(device: PlacedDevice, p: [number, number, number]): boolean {
  return inPaddleZone(device, p);
}

/** 配線：信号を受ける装置ID → 送ってくるスイッチIDの一覧（存在しない・受けられない相手は除く） */
export function signalSources(devices: readonly PlacedDevice[]): Map<string, string[]> {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const map = new Map<string, string[]>();
  for (const s of devices) {
    if (s.type !== 'switch') continue;
    for (const t of s.signalTargets ?? []) {
      const target = byId.get(t);
      if (!target || !acceptsSignal(target.type)) continue;
      const list = map.get(t) ?? [];
      if (!list.includes(s.id)) list.push(s.id);
      map.set(t, list);
    }
  }
  return map;
}
