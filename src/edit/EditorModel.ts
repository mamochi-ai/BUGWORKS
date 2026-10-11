import { getDeviceDef } from '../sim/catalog';
import type { DeviceType, PlacedDevice, SliceLayout } from '../sim/layout';
import { findSpec, formatParam, normalizeParam, paramValue } from './params';
import {
  PLACEMENT,
  PROBLEM_TEXT,
  checkPlacement,
  evaluateMove,
  findConnections,
  findFreeSpot,
  restsOnSurface,
  seatOnSurface,
  type Connection,
  type PlacementEvaluation,
} from './placement';

export interface EditMessage {
  kind: 'info' | 'error';
  text: string;
}

type ChangeKind = 'layout' | 'selection' | 'message';

const HISTORY_LIMIT = 100;

/**
 * 研究所の装置配置を編集するモデル。描画・物理に依存しない。
 * 配置が変わるたびに 'layout' を通知し、受け手が物理ワールドと描画を作り直す。
 */
export class EditorModel {
  private _devices: PlacedDevice[];
  private _selectedId: string | null = null;
  /** ステージで最初から置いてある装置（動かせない） */
  private locked = new Set<string>();
  /** ステージで置ける装置と数（null＝自由研究：制限なし） */
  private _inventory: Partial<Record<DeviceType, number>> | null = null;
  private _message: EditMessage | null = null;
  private past: PlacedDevice[][] = [];
  private future: PlacedDevice[][] = [];
  private listeners = new Set<(kind: ChangeKind) => void>();

  constructor(
    initial: readonly PlacedDevice[],
    readonly seed: number,
  ) {
    this._devices = clone(initial);
  }

  get devices(): readonly PlacedDevice[] {
    return this._devices;
  }

  get layout(): SliceLayout {
    return { seed: this.seed, devices: clone(this._devices) };
  }

  get selectedId(): string | null {
    return this._selectedId;
  }

  get selected(): PlacedDevice | null {
    return this._devices.find((d) => d.id === this._selectedId) ?? null;
  }

  get message(): EditMessage | null {
    return this._message;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  /** ステージの装置で、動かせないか */
  isLocked(id: string): boolean {
    return this.locked.has(id);
  }

  /** ステージ中か（置ける装置に制限がある） */
  get inStage(): boolean {
    return this._inventory !== null;
  }

  /** ステージで置ける装置の種類（自由研究なら null） */
  get inventoryTypes(): DeviceType[] | null {
    return this._inventory ? (Object.keys(this._inventory) as DeviceType[]) : null;
  }

  /** あと何個置けるか（自由研究なら無制限） */
  remaining(type: DeviceType): number {
    if (!this._inventory) return Infinity;
    const placed = this._devices.filter((d) => d.type === type && !this.locked.has(d.id)).length;
    return (this._inventory[type] ?? 0) - placed;
  }

  /** ステージを始める：配置を差し替え、元からある装置を固定し、置ける装置を制限する（履歴は消す） */
  startStage(devices: readonly PlacedDevice[], inventory: Partial<Record<DeviceType, number>>, text: string): void {
    this.locked = new Set(devices.map((d) => d.id));
    this._inventory = { ...inventory };
    this.reset(devices, text);
  }

  /** 自由研究：制限なしで配置を差し替える（履歴は消す） */
  startFree(devices: readonly PlacedDevice[], text: string): void {
    this.locked = new Set();
    this._inventory = null;
    this.reset(devices, text);
  }

  private reset(devices: readonly PlacedDevice[], text: string): void {
    this._devices = clone(devices);
    this.past = [];
    this.future = [];
    this._selectedId = null;
    this._message = { kind: 'info', text };
    this.emit('layout');
    this.emit('selection');
    this.emit('message');
  }

  /** ステージの装置なら理由を出して true */
  private guardLocked(id: string): boolean {
    if (!this.locked.has(id)) return false;
    this.fail('この装置はステージの一部なので動かせません');
    return true;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  connections(): Connection[] {
    return findConnections(this._devices);
  }

  onChange(fn: (kind: ChangeKind) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  select(id: string | null): void {
    if (id !== null && !this._devices.some((d) => d.id === id)) id = null;
    if (id === this._selectedId) return;
    this._selectedId = id;
    this.emit('selection');
  }

  /** 装置を追加する。near 付近の空き場所に置き、選択状態にする */
  addDevice(type: DeviceType, nearX: number, nearZ: number): string | null {
    if (this._devices.length >= PLACEMENT.maxDevices) return this.fail(PROBLEM_TEXT.too_many);
    if (this.remaining(type) <= 0) return this.fail(`このステージで置ける${getDeviceDef(type).name}はもうありません`);
    const id = this.nextId(type);
    const spot = findFreeSpot({ id, type, position: [nearX, 0, nearZ], rotationYDeg: 0 }, nearX, nearZ, this._devices);
    if (!spot) return this.fail('空いている場所がありません');
    this.commit([...this._devices, spot], `${id} を追加しました`);
    this.select(id);
    return id;
  }

  /** ドラッグ中のプレビュー（モデルは変更しない） */
  previewMove(id: string, desiredX: number, desiredZ: number): PlacementEvaluation | null {
    const d = this.find(id);
    if (!d || this.guardLocked(id)) return null;
    return evaluateMove(d, desiredX, desiredZ, this.others(id));
  }

  /** ドラッグ終了。置けない場合は元の位置のまま理由を表示する */
  commitMove(id: string, evaluation: PlacementEvaluation): boolean {
    const before = this.find(id);
    if (!before || this.guardLocked(id)) return false;
    if (!evaluation.ok) {
      this.fail(`置けません：${PROBLEM_TEXT[evaluation.problem!]}`);
      return false;
    }
    if (samePlacement(before, evaluation.device)) {
      if (evaluation.connectHint) this.fail(evaluation.connectHint);
      return false;
    }
    const text = evaluation.snap
      ? `${id} を ${evaluation.snap.other.deviceId} に接続しました`
      : evaluation.connectHint ?? `${id} を移動しました`;
    this.commit(this.replace(evaluation.device), text, evaluation.connectHint && !evaluation.snap ? 'error' : 'info');
    return true;
  }

  rotate(id: string): boolean {
    const d = this.find(id);
    if (!d || this.guardLocked(id)) return false;
    return this.tryReplace({ ...d, rotationYDeg: (((d.rotationYDeg + 90) % 360) + 360) % 360 }, `${id} を回転しました`, '回転できません');
  }

  changeHeight(id: string, steps: number): boolean {
    const d = this.find(id);
    if (!d || this.guardLocked(id)) return false;
    if (restsOnSurface(d.type)) {
      this.fail(d.type === 'platform' ? '台の高さは「設定」で変えてください' : 'この装置は真下の台（なければ床）の上に置かれます');
      return false;
    }
    const y = round(d.position[1] + steps * PLACEMENT.heightStep);
    return this.tryReplace(
      { ...d, position: [d.position[0], y, d.position[2]] },
      `${id} の高さを ${y.toFixed(1)}m にしました`,
      '高さを変えられません',
    );
  }

  /** 装置の設定を変える（範囲・刻みに合わせてから保存。元に戻せる） */
  setParam(id: string, key: string, value: number): boolean {
    const d = this.find(id);
    if (!d || this.guardLocked(id)) return false;
    const spec = findSpec(d.type, key);
    if (!spec) {
      this.fail(`${id} には「${key}」の設定はありません`);
      return false;
    }
    const v = normalizeParam(spec, value);
    if (paramValue(d, key) === v) return false;
    return this.tryReplace(
      { ...d, params: { ...(d.params ?? {}), [key]: v } },
      `${id} の${spec.label}を ${formatParam(spec, v)} にしました`,
      '変更できません',
    );
  }

  remove(id: string): boolean {
    if (!this.find(id) || this.guardLocked(id)) return false;
    this.commit(
      this._devices.filter((d) => d.id !== id),
      `${id} を削除しました`,
    );
    if (this._selectedId === id) this.select(null);
    return true;
  }

  /** 配置をまるごと差し替える（見本の読み込みなど。元に戻せる） */
  loadLayout(devices: readonly PlacedDevice[], text: string): void {
    if (this.inStage) {
      this.fail('ステージ中は見本を読み込めません（ステージ選択の「自由研究」で使えます）');
      return;
    }
    this.commit(clone(devices), text);
    this.select(null);
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push(this._devices);
    this.restore(prev, '元に戻しました');
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this._devices);
    this.restore(next, 'やり直しました');
    return true;
  }

  private tryReplace(next: PlacedDevice, okText: string, failPrefix: string): boolean {
    // 台の高さを変えたときなど、上に乗っている装置を先に合わせ直してから重なりを調べる
    const list = this.replace(next);
    const seated = list.map((d) => seatOnSurface(d, list));
    const check = checkPlacement(
      seated.find((d) => d.id === next.id)!,
      seated.filter((d) => d.id !== next.id),
    );
    if (!check.ok) {
      this.fail(`${failPrefix}：${PROBLEM_TEXT[check.problem!]}`);
      return false;
    }
    this.commit(this.replace(next), okText);
    return true;
  }

  private restore(devices: PlacedDevice[], text: string): void {
    this._devices = devices;
    if (this._selectedId && !this.find(this._selectedId)) this._selectedId = null;
    this._message = { kind: 'info', text };
    this.emit('layout');
    this.emit('selection');
    this.emit('message');
  }

  private commit(next: PlacedDevice[], text: string, kind: EditMessage['kind'] = 'info'): void {
    // 台を動かしたり高さを変えたりしたら、上に乗っている装置の高さを合わせ直す
    next = next.map((d) => seatOnSurface(d, next));
    this.past.push(this._devices);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this._devices = next;
    this._message = { kind, text };
    this.emit('layout');
    this.emit('message');
  }

  private fail(text: string): null {
    // ドラッグ中など同じ理由が続くときは知らせ直さない
    if (this._message?.kind === 'error' && this._message.text === text) return null;
    this._message = { kind: 'error', text };
    this.emit('message');
    return null;
  }

  private find(id: string): PlacedDevice | undefined {
    return this._devices.find((d) => d.id === id);
  }

  private others(id: string): PlacedDevice[] {
    return this._devices.filter((d) => d.id !== id);
  }

  private replace(next: PlacedDevice): PlacedDevice[] {
    return this._devices.map((d) => (d.id === next.id ? next : d));
  }

  private nextId(prefix: string): string {
    let n = 0;
    for (const d of this._devices) {
      const m = new RegExp(`^${prefix}_(\\d+)$`).exec(d.id);
      if (m) n = Math.max(n, Number(m[1]));
    }
    return `${prefix}_${n + 1}`;
  }

  private emit(kind: ChangeKind): void {
    for (const fn of this.listeners) fn(kind);
  }
}

function clone(devices: readonly PlacedDevice[]): PlacedDevice[] {
  return devices.map((d) => ({ ...d, position: [...d.position] as PlacedDevice['position'], params: d.params ? { ...d.params } : undefined }));
}

function samePlacement(a: PlacedDevice, b: PlacedDevice): boolean {
  return a.rotationYDeg === b.rotationYDeg && a.position.every((v, i) => Math.abs(v - b.position[i]) < 1e-9);
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
