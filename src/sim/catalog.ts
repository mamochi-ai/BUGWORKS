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

/** 装置定義は reference/shiyou_specs/devices.v0.1.json を唯一の出典とする（マスター仕様 §3）。 */
export const DEVICE_CATALOG: ReadonlyMap<string, DeviceDef> = parseDeviceCatalog(devicesJson);

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
