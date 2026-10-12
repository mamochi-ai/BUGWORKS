import { PLACEMENT, checkPlacement, findConnections, seatOnSurface } from '../edit/placement';
import type { PlacedDevice } from '../sim/layout';
import { parseBlueprint, toBlueprint } from './blueprint';

/**
 * 設計図の連結（マスター仕様 §7 / DECISIONS.md D-38）：いまの配置に、別の設計図の装置を足す。
 * - 足す側の ID は名前空間付き（例：b2_rail_1）に振り直し、スイッチの配線も付け替える
 * - 重ならず研究所の中に収まる位置を、ずらす量の小さい順に探す（0.25m 刻み）
 * - つないだあとは、全体を設計図として書き出して読み直し、もう一度検査する（連結後の再検証）
 * - 新しくつながった接続（いまの配置 ↔ 足した装置）を数えて知らせる
 */
export type MergeResult =
  | { ok: true; devices: PlacedDevice[]; offset: [number, number]; namespace: string; added: number; joined: number; warnings: string[] }
  | { ok: false; errors: string[] };

const ID_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

/** まだ使われていない名前空間（b2, b3, …） */
export function nextNamespace(current: readonly PlacedDevice[]): string {
  for (let n = 2; n < 1000; n++) {
    const ns = `b${n}`;
    if (!current.some((d) => d.id.startsWith(`${ns}_`))) return ns;
  }
  return `b${Date.now() % 1000}`;
}

/** 足す側の ID を振り直す（重ならず、ID の決まりに合う形に） */
export function renameWithNamespace(incoming: readonly PlacedDevice[], ns: string, taken: ReadonlySet<string>): PlacedDevice[] {
  const used = new Set(taken);
  const map = new Map<string, string>();
  for (const d of incoming) {
    let id = `${ns}_${d.id}`.slice(0, 32);
    for (let k = 2; !ID_PATTERN.test(id) || used.has(id); k++) id = `${ns}_${d.type}_${k}`.slice(0, 32);
    used.add(id);
    map.set(d.id, id);
  }
  return incoming.map((d) => {
    const out: PlacedDevice = { ...d, id: map.get(d.id)!, position: [...d.position] as PlacedDevice['position'], params: d.params ? { ...d.params } : undefined };
    if (!d.params) delete out.params;
    if (d.signalTargets) out.signalTargets = d.signalTargets.map((t) => map.get(t)).filter((t): t is string => !!t);
    return out;
  });
}

/** ずらす候補（小さい順）。0.25m 刻みで、研究所の幅いっぱいまで */
function* offsets(): Generator<[number, number]> {
  const step = 0.25;
  const max = Math.round((PLACEMENT.bounds.max * 2) / step);
  yield [0, 0];
  for (let r = 1; r <= max; r++) {
    for (let i = -r; i <= r; i++) {
      for (const [a, b] of [
        [i, -r],
        [i, r],
        [-r, i],
        [r, i],
      ] as const) {
        if (Math.abs(a) === r || Math.abs(b) === r) yield [a * step, b * step];
      }
    }
  }
}

export function mergeLayouts(current: readonly PlacedDevice[], incoming: readonly PlacedDevice[], seed: number): MergeResult {
  if (incoming.length === 0) return { ok: false, errors: ['足す装置がありません'] };
  if (current.length + incoming.length > PLACEMENT.maxDevices) {
    return { ok: false, errors: [`装置が多すぎます（合わせて ${current.length + incoming.length} 個。${PLACEMENT.maxDevices} 個まで）`] };
  }
  const ns = nextNamespace(current);
  const renamed = renameWithNamespace(incoming, ns, new Set(current.map((d) => d.id)));
  const seen = new Set<string>();
  for (const [dx, dz] of offsets()) {
    const key = `${dx},${dz}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const moved = renamed.map((d) => ({ ...d, position: [round(d.position[0] + dx), d.position[1], round(d.position[2] + dz)] as PlacedDevice['position'] }));
    // 台の上に乗る装置は、新しい場所の台（なければ床）に乗せ直す
    const all = [...current, ...moved];
    const seated = moved.map((d) => seatOnSurface(d, all));
    const ok = seated.every((d) => checkPlacement(d, [...current, ...seated.filter((x) => x.id !== d.id)]).ok);
    if (!ok) continue;
    const devices = [...current.map((d) => ({ ...d })), ...seated];
    // 連結後の再検証：設計図として書き出して読み直す
    const re = parseBlueprint(JSON.stringify(toBlueprint(devices, seed, { title: 'merge' })));
    if (!re.ok) return { ok: false, errors: re.errors };
    const addedIds = new Set(seated.map((d) => d.id));
    const joined = findConnections(devices).filter((c) => addedIds.has(c.from.deviceId) !== addedIds.has(c.to.deviceId)).length;
    return { ok: true, devices: re.devices, offset: [dx, dz], namespace: ns, added: seated.length, joined, warnings: re.warnings };
  }
  return { ok: false, errors: ['重ならずに置ける場所が見つかりません（装置を減らすか、空いている場所を作ってください）'] };
}

function round(v: number): number {
  return Math.round(v * 1e9) / 1e9;
}
