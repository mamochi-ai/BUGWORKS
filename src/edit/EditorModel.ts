import type { PlacedDevice, SliceLayout } from '../sim/layout';
import {
  PLACEMENT,
  PROBLEM_TEXT,
  checkPlacement,
  evaluateMove,
  findConnections,
  findFreeSpot,
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

  /** レールを追加する。near 付近の空き場所に置き、選択状態にする */
  addRail(nearX: number, nearZ: number): string | null {
    if (this._devices.length >= PLACEMENT.maxDevices) return this.fail(PROBLEM_TEXT.too_many);
    const id = this.nextId('rail');
    const spot = findFreeSpot({ id, type: 'rail', position: [nearX, 0, nearZ], rotationYDeg: 0 }, nearX, nearZ, this._devices);
    if (!spot) return this.fail('空いている場所がありません');
    this.commit([...this._devices, spot], `${id} を追加しました`);
    this.select(id);
    return id;
  }

  /** ドラッグ中のプレビュー（モデルは変更しない） */
  previewMove(id: string, desiredX: number, desiredZ: number): PlacementEvaluation | null {
    const d = this.find(id);
    if (!d) return null;
    return evaluateMove(d, desiredX, desiredZ, this.others(id));
  }

  /** ドラッグ終了。置けない場合は元の位置のまま理由を表示する */
  commitMove(id: string, evaluation: PlacementEvaluation): boolean {
    const before = this.find(id);
    if (!before) return false;
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
    if (!d) return false;
    return this.tryReplace({ ...d, rotationYDeg: (((d.rotationYDeg + 90) % 360) + 360) % 360 }, `${id} を回転しました`, '回転できません');
  }

  changeHeight(id: string, steps: number): boolean {
    const d = this.find(id);
    if (!d) return false;
    const y = round(d.position[1] + steps * PLACEMENT.heightStep);
    return this.tryReplace(
      { ...d, position: [d.position[0], y, d.position[2]] },
      `${id} の高さを ${y.toFixed(1)}m にしました`,
      '高さを変えられません',
    );
  }

  remove(id: string): boolean {
    if (!this.find(id)) return false;
    this.commit(
      this._devices.filter((d) => d.id !== id),
      `${id} を削除しました`,
    );
    if (this._selectedId === id) this.select(null);
    return true;
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
    const check = checkPlacement(next, this.others(next.id));
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
    this.past.push(this._devices);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this._devices = next;
    this._message = { kind, text };
    this.emit('layout');
    this.emit('message');
  }

  private fail(text: string): null {
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
