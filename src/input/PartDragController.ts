import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface PartDragHandlers {
  /** 部品に触れた（選択）。編集できない状態ならここで初期状態に戻す */
  onPick(deviceId: string): void;
  /** 何もない所をタップした（ドラッグしていない） */
  onTapEmpty(): void;
  /** ドラッグ中：床と平行な面上の希望位置（XZ） */
  onDrag(deviceId: string, x: number, z: number): void;
  onDrop(deviceId: string, x: number, z: number): void;
  onCancel(deviceId: string): void;
  /** ドラッグ開始時の装置位置（掴んだ点とのずれを保つため） */
  positionOf(deviceId: string): THREE.Vector3 | null;
}

/** タップとドラッグを分けるしきい値（px）。仮値 */
const DRAG_THRESHOLD_PX = 8;

/**
 * 部品操作とカメラ操作の振り分け（DECISIONS.md D-09 / SPEC_GAPS G-07 の試作）。
 * - 1本指/左ボタンで部品に触れたら：その指はカメラに渡さず、部品の選択・ドラッグにする
 * - 何もない所なら：何もしない（OrbitControls が視点回転/パン/ズームを処理）
 *
 * OrbitControls より先にイベントを見るため、canvas の親要素でキャプチャ段階のリスナーを使い、
 * 部品に当たったときだけ controls.enabled を一時的に false にする。
 */
export class PartDragController {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly plane = new THREE.Plane();
  private readonly hit = new THREE.Vector3();
  private drag: {
    pointerId: number;
    deviceId: string;
    startX: number;
    startY: number;
    offset: THREE.Vector3;
    moved: boolean;
  } | null = null;
  private tap: { pointerId: number; x: number; y: number } | null = null;
  private activePointers = new Set<number>();

  constructor(
    container: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.Camera,
    private readonly controls: OrbitControls,
    private readonly pickables: () => THREE.Object3D[],
    private readonly handlers: PartDragHandlers,
  ) {
    container.addEventListener('pointerdown', this.onDown, { capture: true });
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onCancelEvent);
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  private onDown = (e: PointerEvent): void => {
    if (e.target !== this.canvas) return;
    this.activePointers.add(e.pointerId);
    // 2本目の指が来たら、タップ判定はやめる（ピンチ/パンはカメラへ）
    if (this.activePointers.size > 1) {
      this.tap = null;
      return;
    }
    const isPrimaryButton = e.pointerType !== 'mouse' || e.button === 0;
    if (!isPrimaryButton) return;

    const deviceId = this.pick(e);
    if (!deviceId) {
      this.tap = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    // 部品に触れた：この操作はカメラに渡さない
    this.controls.enabled = false;
    this.handlers.onPick(deviceId);
    const pos = this.handlers.positionOf(deviceId);
    if (!pos || !this.intersect(e, pos.y)) {
      this.controls.enabled = true;
      return;
    }
    this.drag = {
      pointerId: e.pointerId,
      deviceId,
      startX: e.clientX,
      startY: e.clientY,
      offset: new THREE.Vector3(pos.x - this.hit.x, 0, pos.z - this.hit.z),
      moved: false,
    };
    this.plane.set(new THREE.Vector3(0, 1, 0), -pos.y);
    e.preventDefault();
  };

  private onMove = (e: PointerEvent): void => {
    if (this.tap && e.pointerId === this.tap.pointerId && Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y) > DRAG_THRESHOLD_PX) {
      this.tap = null; // 視点操作として扱う
    }
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD_PX) return;
    d.moved = true;
    if (!this.intersectPlane(e)) return;
    this.handlers.onDrag(d.deviceId, this.hit.x + d.offset.x, this.hit.z + d.offset.z);
  };

  private onUp = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    if (this.tap && e.pointerId === this.tap.pointerId) {
      this.tap = null;
      this.handlers.onTapEmpty();
    }
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.drag = null;
    this.controls.enabled = true;
    if (d.moved && this.intersectPlane(e)) this.handlers.onDrop(d.deviceId, this.hit.x + d.offset.x, this.hit.z + d.offset.z);
    else if (d.moved) this.handlers.onCancel(d.deviceId);
  };

  private onCancelEvent = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    if (this.tap?.pointerId === e.pointerId) this.tap = null;
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.drag = null;
    this.controls.enabled = true;
    this.handlers.onCancel(d.deviceId);
  };

  private setRay(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
  }

  private pick(e: PointerEvent): string | null {
    this.setRay(e);
    const hits = this.raycaster.intersectObjects(this.pickables(), true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.deviceId === undefined) o = o.parent;
      if (o) return o.userData.deviceId as string;
    }
    return null;
  }

  private intersect(e: PointerEvent, y: number): boolean {
    this.plane.set(new THREE.Vector3(0, 1, 0), -y);
    return this.intersectPlane(e);
  }

  private intersectPlane(e: PointerEvent): boolean {
    this.setRay(e);
    return this.raycaster.ray.intersectPlane(this.plane, this.hit) !== null;
  }
}
