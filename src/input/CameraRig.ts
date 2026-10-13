import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const HOME = { position: new THREE.Vector3(5.5, 4.2, 6.5), target: new THREE.Vector3(0, 0.4, 0) };
/** 注視点が研究所から大きく外れないよう制限する範囲（m） */
const TARGET_BOUNDS = new THREE.Box3(new THREE.Vector3(-8, -0.5, -8), new THREE.Vector3(8, 6, 8));

/**
 * 自由カメラ（回転・平行移動・ズーム）。
 * タッチ: 1本指=回転, 2本指=パン＋ピンチズーム（iPad優先）。
 * マウス: 右ドラッグ=回転, 中ドラッグ/Shift+左ドラッグ=パン, ホイール=ズーム。
 *   左ドラッグ回転は配置機能が入るまでの暫定（DECISIONS.md D-09）。
 * キーボード: Q/E=上下移動, 矢印=パン。
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private keys = new Set<string>();

  constructor(dom: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
    this.controls = new OrbitControls(this.camera, dom);
    const c = this.controls;
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.screenSpacePanning = true;
    c.minDistance = 1.2;
    c.maxDistance = 30;
    c.maxPolarAngle = Math.PI * 0.495; // 床下には潜らない
    c.rotateSpeed = 0.8;
    c.zoomToCursor = true;
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    c.listenToKeyEvents(window);
    this.home();

    dom.style.touchAction = 'none';
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    // iOS Safari のページ全体ピンチズーム/ジェスチャーを抑止
    for (const type of ['gesturestart', 'gesturechange', 'gestureend'] as const) {
      document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
    }
    window.addEventListener('keydown', (e) => {
      if (isTypingTarget(e.target)) return;
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** 最初の視点の方位角（rad。注視点から見たカメラの向き） */
  static readonly HOME_AZIMUTH = Math.atan2(HOME.position.x - HOME.target.x, HOME.position.z - HOME.target.z);

  /** いまの方位角（rad） */
  azimuth(): number {
    return this.controls.getAzimuthalAngle();
  }

  home(): void {
    this.camera.position.copy(HOME.position);
    this.controls.target.copy(HOME.target);
    this.controls.update();
  }

  update(realSeconds: number): void {
    const dy = (this.keys.has('e') ? 1 : 0) - (this.keys.has('q') ? 1 : 0);
    if (dy !== 0) {
      const d = dy * 2.5 * realSeconds;
      this.camera.position.y += d;
      this.controls.target.y += d;
    }
    const before = this.controls.target.clone();
    this.controls.target.clamp(TARGET_BOUNDS.min, TARGET_BOUNDS.max);
    this.camera.position.add(this.controls.target.clone().sub(before));
    this.controls.update(realSeconds);
  }
}

function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
}
