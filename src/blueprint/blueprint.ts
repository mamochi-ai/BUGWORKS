import { PLACEMENT, findConnections } from '../edit/placement';
import { PARAM_SPECS, normalizeParam } from '../edit/params';
import { ENGINE_VERSION, PHYSICS_PROFILE } from '../sim/constants';
import type { DeviceType, PlacedDevice } from '../sim/layout';
import { acceptsSignal } from '../sim/switch';

/**
 * 設計図JSON（マスター仕様 §7 の暫定契約, DECISIONS.md D-34）。
 * ルートキーはマスター仕様に合わせる（schemaVersion, engineVersion, physicsProfile, seed, devices, connections, ports, initialState）。
 * ステージ資料の stageId は任意キーとして持つ（SPEC_GAPS G-08）。ports は役割が未定義なので空配列（G-12）。
 * 入力はデータのみとして扱い、形・数・範囲・重複・未知の装置・危ないキーを検査してから使う。
 */
export const BLUEPRINT_SCHEMA_VERSION = '0.1.0';
/** 読み込める JSON の大きさの上限（文字数） */
export const MAX_BLUEPRINT_CHARS = 200_000;
const MAX_TITLE = 40;
const ID_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
const KNOWN_TYPES: readonly DeviceType[] = [
  'rail', 'launcher', 'spring', 'goal', 'platform', 'curve', 'paddle', 'gearbox', 'shaft', 'bridge', 'magnet', 'switch', 'rotator', 'loop',
];
const ROOT_KEYS = ['schemaVersion', 'engineVersion', 'physicsProfile', 'seed', 'devices', 'connections', 'ports', 'initialState', 'title', 'description', 'authorAlias', 'createdAt', 'stageId'];
const DEVICE_KEYS = ['id', 'type', 'position', 'rotationYDeg', 'params', 'signalTargets'];

export interface BlueprintDevice {
  id: string;
  type: DeviceType;
  position: [number, number, number];
  rotationYDeg: number;
  params?: Record<string, number>;
  signalTargets?: string[];
}

export interface Blueprint {
  schemaVersion: string;
  engineVersion: string;
  physicsProfile: string;
  seed: number;
  title: string;
  createdAt: string;
  stageId?: string;
  devices: BlueprintDevice[];
  connections: { from: { deviceId: string; portId: string }; to: { deviceId: string; portId: string } }[];
  ports: [];
  initialState: Record<string, never>;
}

/** 配置から設計図を作る（接続は配置から求めて記録する） */
export function toBlueprint(devices: readonly PlacedDevice[], seed: number, meta: { title: string; stageId?: string; now?: Date }): Blueprint {
  const bp: Blueprint = {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    physicsProfile: PHYSICS_PROFILE,
    seed,
    title: cleanTitle(meta.title) || '名前のない設計図',
    createdAt: (meta.now ?? new Date()).toISOString(),
    devices: devices.map((d) => {
      const out: BlueprintDevice = { id: d.id, type: d.type, position: [...d.position], rotationYDeg: d.rotationYDeg };
      if (d.params && Object.keys(d.params).length) out.params = { ...d.params };
      if (d.signalTargets?.length) out.signalTargets = [...d.signalTargets];
      return out;
    }),
    connections: findConnections(devices).map((c) => ({ from: { ...c.from }, to: { ...c.to } })),
    ports: [],
    initialState: {},
  };
  if (meta.stageId) bp.stageId = meta.stageId;
  return bp;
}

export function blueprintToJson(bp: Blueprint): string {
  return JSON.stringify(bp, null, 2);
}

export type ParseResult =
  | { ok: true; devices: PlacedDevice[]; seed: number; title: string; stageId?: string; warnings: string[] }
  | { ok: false; errors: string[] };

/** 設計図JSONの文字列を検査して配置に直す。問題があれば理由（日本語）を返す */
export function parseBlueprint(text: string): ParseResult {
  if (typeof text !== 'string') return fail('読み込めませんでした');
  if (text.length > MAX_BLUEPRINT_CHARS) return fail(`ファイルが大きすぎます（${MAX_BLUEPRINT_CHARS.toLocaleString()} 文字まで）`);
  let raw: unknown;
  try {
    // __proto__ などのキーはそもそも受け付けない
    raw = JSON.parse(text, (key, value) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('bad-key');
      return value;
    });
  } catch (e) {
    return fail((e as Error).message === 'bad-key' ? '使えないキー（__proto__ など）が含まれています' : 'JSON として読めません（ファイルが壊れているか、設計図ではありません）');
  }
  if (!isPlainObject(raw)) return fail('設計図の形ではありません');
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const k of Object.keys(raw)) if (!ROOT_KEYS.includes(k)) warnings.push(`知らない項目「${k.slice(0, 20)}」は無視しました`);

  const schema = raw.schemaVersion;
  if (typeof schema !== 'string' || !/^\d+\.\d+\.\d+$/.test(schema)) errors.push('schemaVersion がありません');
  else if (schema.split('.')[0] !== BLUEPRINT_SCHEMA_VERSION.split('.')[0]) errors.push(`この版（${schema}）の設計図は読めません`);
  if (raw.physicsProfile !== PHYSICS_PROFILE) warnings.push('物理のルールの版が違うので、同じ動きにならないことがあります（再生して確かめてください）');
  const seed = typeof raw.seed === 'number' && Number.isInteger(raw.seed) && raw.seed >= 0 && raw.seed < 2 ** 31 ? raw.seed : 404;
  const title = cleanTitle(typeof raw.title === 'string' ? raw.title : '') || '名前のない設計図';
  const stageId = typeof raw.stageId === 'string' && /^\d-\d$/.test(raw.stageId) ? raw.stageId : undefined;

  const list = raw.devices;
  if (!Array.isArray(list)) return fail(...errors, 'devices（装置の一覧）がありません');
  if (list.length > PLACEMENT.maxDevices) return fail(...errors, `装置が多すぎます（${PLACEMENT.maxDevices}個まで）`);
  const devices: PlacedDevice[] = [];
  const ids = new Set<string>();
  list.forEach((d, i) => {
    const where = `${i + 1}番目の装置`;
    if (!isPlainObject(d)) return errors.push(`${where}の形が正しくありません`);
    for (const k of Object.keys(d)) if (!DEVICE_KEYS.includes(k)) warnings.push(`${where}の知らない項目「${k.slice(0, 20)}」は無視しました`);
    const id = d.id;
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) return errors.push(`${where}の ID が正しくありません（英小文字・数字・_ で32文字まで）`);
    if (ids.has(id)) return errors.push(`ID「${id}」が重複しています`);
    ids.add(id);
    const type = d.type as DeviceType;
    if (!KNOWN_TYPES.includes(type)) return errors.push(`${id}：知らない装置です（${String(d.type).slice(0, 20)}）`);
    const pos = d.position;
    if (!Array.isArray(pos) || pos.length !== 3 || !pos.every((v) => typeof v === 'number' && Number.isFinite(v))) return errors.push(`${id}：位置が正しくありません`);
    const lim = PLACEMENT.bounds.max + 0.5;
    if (Math.abs(pos[0]) > lim || Math.abs(pos[2]) > lim || pos[1] < 0 || pos[1] > 6) return errors.push(`${id}：研究所の外に置かれています`);
    const rot = d.rotationYDeg;
    if (typeof rot !== 'number' || ![0, 90, 180, 270].includes(rot)) return errors.push(`${id}：向きは 0/90/180/270° のどれかです`);
    const out: PlacedDevice = { id, type, position: [pos[0], pos[1], pos[2]], rotationYDeg: rot };
    if (d.params !== undefined) {
      if (!isPlainObject(d.params)) return errors.push(`${id}：設定の形が正しくありません`);
      const params: Record<string, number> = {};
      for (const [k, v] of Object.entries(d.params)) {
        const spec = PARAM_SPECS[type].find((s) => s.key === k);
        if (!spec) {
          warnings.push(`${id}：知らない設定「${k.slice(0, 20)}」は無視しました`);
          continue;
        }
        if (typeof v !== 'number' || !Number.isFinite(v)) return errors.push(`${id}：設定「${spec.label}」が数ではありません`);
        if (normalizeParam(spec, v) !== v) return errors.push(`${id}：設定「${spec.label}」が範囲外か、刻みに合っていません`);
        params[k] = v;
      }
      if (Object.keys(params).length) out.params = params;
    }
    if (d.signalTargets !== undefined) {
      if (type !== 'switch') return errors.push(`${id}：配線はスイッチだけが持てます`);
      if (!Array.isArray(d.signalTargets) || d.signalTargets.length > PLACEMENT.maxDevices || !d.signalTargets.every((t) => typeof t === 'string')) {
        return errors.push(`${id}：配線の形が正しくありません`);
      }
      out.signalTargets = [...new Set(d.signalTargets as string[])];
    }
    devices.push(out);
  });
  // 配線の相手が存在し、信号を受けられるか
  for (const d of devices) {
    for (const t of d.signalTargets ?? []) {
      const target = devices.find((x) => x.id === t);
      if (!target) errors.push(`${d.id}：配線の相手「${t.slice(0, 32)}」がありません`);
      else if (!acceptsSignal(target.type)) errors.push(`${d.id}：${t} は信号を受けられません`);
    }
  }
  if (errors.length) return { ok: false, errors };
  // 記録された接続と、配置から求めた接続が違えば知らせる（配置を正とする）
  const key = (c: { from: { deviceId: string; portId: string }; to: { deviceId: string; portId: string } }) => `${c.from.deviceId}/${c.from.portId}>${c.to.deviceId}/${c.to.portId}`;
  const actual = new Set(findConnections(devices).map(key));
  const recorded = Array.isArray(raw.connections) ? raw.connections.filter(isPlainObject) : [];
  const recordedKeys = recorded
    .map((c) => (isPlainObject(c.from) && isPlainObject(c.to) ? `${String(c.from.deviceId)}/${String(c.from.portId)}>${String(c.to.deviceId)}/${String(c.to.portId)}` : ''))
    .filter(Boolean);
  if (recordedKeys.length !== actual.size || recordedKeys.some((k) => !actual.has(k))) warnings.push('接続の記録と装置の位置が合いません（位置を正として読み込みました）');
  return { ok: true, devices, seed, title, stageId, warnings };
}

function fail(...errors: string[]): ParseResult {
  return { ok: false, errors };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

/** 名前：制御文字を除き、前後の空白を取り、長さを制限する（画面にはテキストとして出す） */
export function cleanTitle(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_TITLE);
}

/** ファイル名に使える形に（日本語は残す） */
export function fileNameFor(title: string): string {
  const base = cleanTitle(title).replace(/[\\/:*?"<>|]/g, '_') || 'blueprint';
  return `bugworks-${base}.json`;
}
