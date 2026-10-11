import * as THREE from 'three';
import type { BallState, Simulation } from '../sim/Simulation';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PHYSICS_HZ } from '../sim/constants';
import { plungerCompression } from '../sim/launcher';
import { BALL_RADIUS } from '../sim/railGeometry';
import { PALETTE } from './palette';
import { DeviceLayer } from './DeviceLayer';

/**
 * 物理状態を読むだけの描画層。物理ワールドへは書き込まない。
 * 形状はすべてプリミティブで構築（画像シート/PNGは3Dモデルではないため使用しない）。
 */
export class LabView {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  /** 装置（編集に追従して作り直す） */
  readonly devices = new DeviceLayer();
  /** 鉄球のメッシュ（発射された分だけ使い回す） */
  private ballPool: THREE.Mesh[] = [];
  private ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 32, 16);
  private ballMat!: THREE.MeshStandardMaterial;
  private tmpQa = new THREE.Quaternion();
  private tmpQb = new THREE.Quaternion();

  constructor(
    container: HTMLElement,
    private readonly sim: Simulation,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(PALETTE.background);
    this.scene.fog = new THREE.Fog(PALETTE.background, 18, 40);
    // 金属の映り込み用の簡易環境マップ（外部画像なしで生成）
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();
    this.addLights();
    this.addLab();
    this.scene.add(this.devices.root);
    this.ballMat = this.makeBallMaterial();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  resize(width: number, height: number, camera: THREE.PerspectiveCamera): void {
    this.renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  }

  /** alpha: 前tick→現tickの補間係数（描画は可変FPS、物理は固定120Hz） */
  render(camera: THREE.Camera, alpha: number): void {
    this.devices.setLauncherCharge(launcherCharge(this.sim));
    this.devices.setSpringCompression(new Map(this.sim.springCompressions().map((s) => [s.deviceId, s.offset])));
    // 球が入ったゴールは 0.6 秒かけて光が引く
    const flashTicks = 0.6 * PHYSICS_HZ;
    this.devices.setGoalFlash(
      new Map(
        this.sim.snapshot().goals.map((g) => [g.deviceId, g.lastHitTick === null ? 0 : Math.max(0, 1 - (this.sim.tick - g.lastHitTick) / flashTicks)]),
      ),
    );
    const frames = this.sim.readBallFrames();
    while (this.ballPool.length < frames.length) {
      const m = new THREE.Mesh(this.ballGeo, this.ballMat);
      m.castShadow = true;
      m.name = 'steel_ball';
      this.scene.add(m);
      this.ballPool.push(m);
    }
    this.ballPool.forEach((m, i) => {
      const f = frames[i];
      m.visible = !!f;
      if (f) this.applyBall(m, f.prev, f.curr, alpha);
    });
    this.renderer.render(this.scene, camera);
  }

  private applyBall(mesh: THREE.Mesh, prev: BallState, curr: BallState, alpha: number): void {
    const a = prev.position;
    const b = curr.position;
    mesh.position.set(a[0] + (b[0] - a[0]) * alpha, a[1] + (b[1] - a[1]) * alpha, a[2] + (b[2] - a[2]) * alpha);
    this.tmpQa.set(...prev.rotation);
    this.tmpQb.set(...curr.rotation);
    mesh.quaternion.slerpQuaternions(this.tmpQa, this.tmpQb, alpha);
  }

  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight(0x8fa6c0, 0x1a1c20, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(6, 10, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera;
    sc.left = -8;
    sc.right = 8;
    sc.top = 8;
    sc.bottom = -8;
    sc.near = 1;
    sc.far = 30;
    this.scene.add(key);
    const accent = new THREE.PointLight(0x3fd4ff, 6, 10, 2);
    accent.position.set(-4, 2.5, -4);
    this.scene.add(accent);
  }

  private addLab(): void {
    const mats = {
      floor: new THREE.MeshStandardMaterial({ color: PALETTE.floor, roughness: 0.85, metalness: 0.3 }),
      wall: new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.9, metalness: 0.2 }),
      curb: new THREE.MeshStandardMaterial({ color: PALETTE.curb, roughness: 0.7, metalness: 0.4 }),
    };
    for (const box of this.sim.labBoxes) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...box.size), mats[box.kind]);
      mesh.position.set(...box.center);
      mesh.rotation.y = (box.rotationYDeg * Math.PI) / 180;
      mesh.receiveShadow = true;
      mesh.castShadow = box.kind !== 'floor';
      mesh.name = box.id;
      this.scene.add(mesh);
      if (box.moduleId === 'wall_window') this.addWindowStrip(mesh, box.size);
    }
    // 0.25m 配置グリッド（devices.v0.1.json gridSize）と 4m モジュール境界
    const minor = new THREE.GridHelper(12, 48, PALETTE.gridMinor, PALETTE.gridMinor);
    minor.position.y = 0.002;
    const module = new THREE.GridHelper(12, 3, PALETTE.gridModule, PALETTE.gridModule);
    module.position.y = 0.004;
    (module.material as THREE.Material).opacity = 0.6;
    (module.material as THREE.Material).transparent = true;
    this.scene.add(minor, module);
  }

  private addWindowStrip(wall: THREE.Mesh, size: [number, number, number]): void {
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(size[0] * 0.7, size[1] * 0.3, size[2] + 0.02),
      new THREE.MeshStandardMaterial({ color: 0x0c2a33, emissive: 0x1a6f86, emissiveIntensity: 0.6 }),
    );
    strip.position.y = size[1] * 0.15;
    wall.add(strip);
  }

  private makeBallMaterial(): THREE.MeshStandardMaterial {
    // 転がりが見えるよう帯模様のテクスチャを付ける（画像素材は使わずCanvasで生成）
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#c9ced6';
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#ff7a1a';
    g.fillRect(0, 28, 128, 8);
    g.fillRect(60, 0, 8, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.25, metalness: 0.9 });
  }
}

/** 発射機ごとの押し板の縮み具合（0=撃った瞬間, 1=縮めて待機） */
function launcherCharge(sim: Simulation): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of sim.snapshotLaunchers()) {
    m.set(l.deviceId, plungerCompression(l.lastFireTick === null ? null : sim.tick - l.lastFireTick));
  }
  return m;
}
