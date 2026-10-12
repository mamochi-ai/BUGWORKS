import devicesJson from '../../spec/master/reference/shiyou_specs/devices.v0.1.json';

export type Vec3 = [number, number, number];
export type PortType = 'ball' | 'shaft' | 'signal';

export interface PortDef {
  id: string;
  type: PortType;
  position: Vec3;
  direction: Vec3;
}

export interface DeviceDef {
  id: string;
  name: string;
  size: Vec3;
  ports: PortDef[];
  params: Record<string, number | string>;
  movingParts: string[];
  /** devices.v0.1.json に無く、試作で追加した装置（DECISIONS.md D-23） */
  prototypeOnly?: true;
}

const PORT_TYPES: readonly string[] = ['ball', 'shaft', 'signal'];

function vec3(v: unknown, where: string): Vec3 {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new Error(`${where}: 3要素の数値配列ではありません`);
  }
  return [v[0], v[1], v[2]];
}

/** JSONの形を実行時に検査してから型付けする（型アサーションで素通りさせない） */
export function parseDeviceCatalog(json: { devices: unknown[] }): Map<string, DeviceDef> {
  const map = new Map<string, DeviceDef>();
  for (const raw of json.devices) {
    const d = raw as Record<string, unknown>;
    if (typeof d.id !== 'string' || map.has(d.id)) throw new Error(`装置IDが不正/重複: ${String(d.id)}`);
    const ports = (d.ports as Record<string, unknown>[]).map((p) => {
      if (typeof p.id !== 'string' || !PORT_TYPES.includes(String(p.type))) {
        throw new Error(`${d.id}: ポート定義が不正`);
      }
      return {
        id: p.id,
        type: p.type as PortType,
        position: vec3(p.position, `${d.id}.${p.id}.position`),
        direction: vec3(p.direction, `${d.id}.${p.id}.direction`),
      };
    });
    map.set(d.id, {
      id: d.id,
      name: String(d.name),
      size: vec3(d.size, `${d.id}.size`),
      ports,
      params: d.params as Record<string, number | string>,
      movingParts: (d.movingParts as string[]) ?? [],
    });
  }
  return map;
}

/**
 * 試作で追加した装置。仕様の装置JSONには無い（SPEC_GAPS G-04：ステージ資料の goal_sensor / raised_platform に相当）。
 * 寸法は仮。仕様で定義されたら JSON に移す。
 */
const PROTOTYPE_DEVICES: DeviceDef[] = [
  { id: 'goal', name: 'ゴール', size: [0.8, 0.4, 0.8], ports: [], params: {}, movingParts: [], prototypeOnly: true },
  { id: 'platform', name: '台', size: [1.6, 1, 1.6], ports: [], params: { heightMeters: 1 }, movingParts: [], prototypeOnly: true },
  {
    // ポートは左に曲がる形。右に曲がる形は params.turn=-1 で左右を反転する（curveGeometry.ts）
    id: 'curve',
    name: 'カーブレール',
    size: [1.5, 0.4, 1.5],
    ports: [
      { id: 'ball_in', type: 'ball', position: [-0.5, 0.35, -0.75], direction: [0, 0, -1] },
      { id: 'ball_out', type: 'ball', position: [0.75, 0.15, 0.5], direction: [1, 0, 0] },
    ],
    params: { turn: 1 },
    movingParts: [],
    prototypeOnly: true,
  },
  {
    // 羽根車：長さ1mのレールに羽根。軸ポートの高さは装置の高さによらず床から0.65m（drive.ts）
    id: 'paddle',
    name: '羽根車',
    size: [1, 0.9, 1],
    ports: [
      { id: 'ball_in', type: 'ball', position: [0, 0.35, -0.5], direction: [0, 0, -1] },
      { id: 'ball_out', type: 'ball', position: [0, 0.25, 0.5], direction: [0, 0, 1] },
      { id: 'shaft_out', type: 'shaft', position: [0.75, 0.65, 0.5], direction: [0, 0, 1] },
    ],
    params: {},
    movingParts: ['wheel'],
    prototypeOnly: true,
  },
  {
    // スイッチ：長さ1mのレールにレバー。球が通るたびに ON/OFF が切り替わり、配線した装置へ信号を送る（switch.ts, D-30）
    id: 'switch',
    name: 'スイッチ',
    size: [1, 0.9, 1],
    ports: [
      { id: 'ball_in', type: 'ball', position: [0, 0.35, -0.5], direction: [0, 0, -1] },
      { id: 'ball_out', type: 'ball', position: [0, 0.25, 0.5], direction: [0, 0, 1] },
      { id: 'signal_out', type: 'signal', position: [0.45, 0.3, 0], direction: [1, 0, 0] },
    ],
    params: {},
    movingParts: ['lever'],
    prototypeOnly: true,
  },
  {
    // 軸：長さは設定で変える（ポートの z は長さの半分）
    id: 'shaft',
    name: '軸',
    size: [0.2, 0.8, 1],
    ports: [
      { id: 'shaft_in', type: 'shaft', position: [0, 0.65, -0.5], direction: [0, 0, -1] },
      { id: 'shaft_out', type: 'shaft', position: [0, 0.65, 0.5], direction: [0, 0, 1] },
    ],
    params: { lengthMeters: 1 },
    movingParts: [],
    prototypeOnly: true,
  },
  {
    // 可動橋：直線レールと同じ長さ・高さ。軸ポートは入口側の横、床から0.65m
    id: 'bridge',
    name: '可動橋',
    size: [0.5, 0.4, 2],
    ports: [
      { id: 'ball_in', type: 'ball', position: [0, 0.35, -1], direction: [0, 0, -1] },
      { id: 'ball_out', type: 'ball', position: [0, 0.15, 1], direction: [0, 0, 1] },
      { id: 'shaft_in', type: 'shaft', position: [0.75, 0.65, -1], direction: [0, 0, -1] },
    ],
    params: {},
    movingParts: ['deck'],
    prototypeOnly: true,
  },
];

/** 装置定義は reference/shiyou_specs/devices.v0.1.json を出典とする（マスター仕様 §3）。試作の追加分は別扱い */
export const DEVICE_CATALOG: ReadonlyMap<string, DeviceDef> = new Map([
  ...parseDeviceCatalog(devicesJson),
  ...PROTOTYPE_DEVICES.map((d) => [d.id, d] as const),
]);

export const CATALOG_UNITS = devicesJson.units;
export const CATALOG_UP_AXIS = devicesJson.upAxis;
export const CATALOG_GRID_SIZE = devicesJson.gridSize;

export function getDeviceDef(id: string): DeviceDef {
  const def = DEVICE_CATALOG.get(id);
  if (!def) throw new Error(`未知の装置ID: ${id}`);
  return def;
}

export function getPort(def: DeviceDef, portId: string): PortDef {
  const port = def.ports.find((p) => p.id === portId);
  if (!port) throw new Error(`装置 ${def.id} にポート ${portId} がありません`);
  return port;
}
