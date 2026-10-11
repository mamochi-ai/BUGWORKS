import * as THREE from 'three';
import { rolePorts, footprint, type Connection, type PortRef } from '../edit/placement';
import type { Vec3 } from '../sim/catalog';
import type { PlacedDevice } from '../sim/layout';
import { buildRailTrack, portWorldPosition } from '../sim/railGeometry';
import { quatFromYawPitch } from '../sim/Simulation';
import { planLauncher } from '../sim/launcher';
import type { Simulation } from '../sim/Simulation';
import { curveFrame, curveToWorld, curveTurn } from '../sim/curveGeometry';
import { LauncherModelFactory } from './LauncherModel';
import { SpringModelFactory } from './SpringModel';
import { GoalModelFactory } from './GoalModels';
import { DriveModelFactory } from './DriveModels';
import { RailModelFactory, createDeviceMaterials } from './RailModel';

const COLOR = { selected: 0x3fd4ff, invalid: 0xff4d3d, openPort: 0xff7a1a, snapPort: 0x3fd4ff } as const;

/**
 * 装置（レール・鉄球発射機）の描画レイヤー。配置データ（PlacedDevice）だけから作り直せるので、編集・元に戻す・物理リセットのどれにも追従する。
 * - 変わっていないレールのメッシュは使い回す
 * - 編集モード（初期状態）では、つながっていないポートにオレンジの輪を出す
 * - ドラッグ中は対象レールだけを仮の位置に動かし、吸着先のポートを水色の輪で示す
 */
export class DeviceLayer {
  readonly root = new THREE.Group();
  private readonly mats = createDeviceMaterials();
  private readonly railFactory = new RailModelFactory(this.mats);
  private readonly launcherFactory = new LauncherModelFactory(this.mats);
  private readonly springFactory = new SpringModelFactory(this.mats);
  private readonly goalFactory = new GoalModelFactory(this.mats);
  private readonly driveFactory = new DriveModelFactory(this.mats, this.railFactory);
  private readonly rails = new Map<string, { key: string; group: THREE.Group }>();
  private readonly supports = new THREE.Group();
  private readonly markers = new THREE.Group();
  private readonly outline: THREE.LineSegments;
  private readonly ringGeo = new THREE.TorusGeometry(0.2, 0.014, 8, 32);
  private readonly ringMats = {
    open: new THREE.MeshBasicMaterial({ color: COLOR.openPort }),
    snap: new THREE.MeshBasicMaterial({ color: COLOR.snapPort }),
  };
  private devices: readonly PlacedDevice[] = [];
  private connections: readonly Connection[] = [];
  private selectedId: string | null = null;
  private editMode = true;

  constructor() {
    this.root.name = 'devices';
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: COLOR.selected, depthTest: false, transparent: true }));
    this.outline.renderOrder = 10;
    this.outline.visible = false;
    this.root.add(this.supports, this.markers, this.outline);
  }

  /** レイキャスト対象（userData.deviceId を持つグループ） */
  get pickables(): THREE.Object3D[] {
    return [...this.rails.values()].map((r) => r.group);
  }

  sync(devices: readonly PlacedDevice[], connections: readonly Connection[], selectedId: string | null): void {
    this.devices = devices;
    this.connections = connections;
    this.selectedId = selectedId;
    const alive = new Set<string>();
    for (const d of devices) {
      alive.add(d.id);
      // 発射機は接続で溝の角度が変わるので、角度もキーに含める
      const launcherAngle = d.type === 'launcher' ? planLauncher(d, devices).angle : 0;
      const key = JSON.stringify([d.position, d.rotationYDeg, d.params ?? null, launcherAngle]);
      const existing = this.rails.get(d.id);
      if (existing?.key === key) continue;
      if (existing) this.disposeRail(existing.group);
      const group =
        d.type === 'rail'
          ? this.railFactory.createRail(buildRailTrack(d))
          : d.type === 'curve'
            ? this.railFactory.createCurve(d)
          : d.type === 'launcher'
            ? this.launcherFactory.create(d, launcherAngle)
            : d.type === 'spring'
              ? this.springFactory.create(d)
              : d.type === 'goal'
                ? this.goalFactory.createGoal(d)
                : d.type === 'platform'
                  ? this.goalFactory.createPlatform(d)
                  : d.type === 'paddle'
                    ? this.driveFactory.createPaddle(d)
                    : d.type === 'gearbox'
                      ? this.driveFactory.createGearbox(d)
                      : d.type === 'shaft'
                        ? this.driveFactory.createShaft(d)
                        : this.driveFactory.createBridge(d);
      group.userData.deviceId = d.id;
      this.root.add(group);
      this.rails.set(d.id, { key, group });
    }
    for (const [id, r] of this.rails) {
      if (!alive.has(id)) {
        this.disposeRail(r.group);
        this.rails.delete(id);
      }
    }
    this.rebuildSupports(devices);
    this.rebuildMarkers(devices, connections, null);
    this.updateOutline(this.devices.find((d) => d.id === selectedId) ?? null, true);
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
    this.updateOutline(this.devices.find((d) => d.id === id) ?? null, true);
  }

  setEditMode(on: boolean): void {
    this.editMode = on;
    this.markers.visible = on;
    this.outline.visible = on && this.selectedId !== null;
  }

  /** ドラッグ中の仮表示 */
  preview(device: PlacedDevice, valid: boolean, snapTo: PortRef | null): void {
    const r = this.rails.get(device.id);
    if (!r) return;
    if (device.type === 'rail') {
      const track = buildRailTrack(device);
      r.group.position.set((track.start[0] + track.end[0]) / 2, (track.start[1] + track.end[1]) / 2, (track.start[2] + track.end[2]) / 2);
      const q = quatFromYawPitch(track.yawRad, track.pitch);
      r.group.quaternion.set(q.x, q.y, q.z, q.w);
    } else {
      r.group.position.set(...device.position);
      r.group.rotation.set(0, (device.rotationYDeg * Math.PI) / 180, 0);
    }
    r.key = ''; // 次の sync で作り直す
    const others = this.devices.filter((d) => d.id !== device.id);
    this.rebuildSupports([...others, device]);
    this.rebuildMarkers(others, this.connections.filter((c) => c.from.deviceId !== device.id && c.to.deviceId !== device.id), snapTo);
    this.updateOutline(device, valid);
  }

  private updateOutline(device: PlacedDevice | null, valid: boolean): void {
    if (!device) {
      this.outline.visible = false;
      return;
    }
    const f = footprint(device);
    const pad = 0.04;
    this.outline.scale.set(f.maxX - f.minX + pad, f.maxY - f.minY + pad, f.maxZ - f.minZ + pad);
    this.outline.position.set((f.minX + f.maxX) / 2, (f.minY + f.maxY) / 2, (f.minZ + f.maxZ) / 2);
    (this.outline.material as THREE.LineBasicMaterial).color.setHex(valid ? COLOR.selected : COLOR.invalid);
    this.outline.visible = this.editMode;
  }

  private rebuildSupports(devices: readonly PlacedDevice[]): void {
    this.supports.clear();
    const key = (p: Vec3) => p.map((v) => v.toFixed(3)).join(',');
    // 発射機の出口は発射機自身が支えるので、そこに支柱は立てない
    const seen = new Set<string>(devices.filter((d) => d.type === 'launcher').map((d) => key(portWorldPosition(d, 'ball_out'))));
    for (const d of devices) {
      if (d.type !== 'rail' && d.type !== 'curve' && d.type !== 'paddle') continue;
      // カーブは弧の中央にも支柱を立てる
      const extra: Vec3[] = d.type === 'curve' ? [curveToWorld(d, curveFrame(curveTurn(d), 0.5).pos)] : [];
      for (const p of [...['ball_in', 'ball_out'].map((id) => portWorldPosition(d, id)), ...extra]) {
        if (seen.has(key(p))) continue;
        seen.add(key(p));
        const s = this.railFactory.createSupport(p);
        if (s) this.supports.add(s);
      }
    }
  }

  private rebuildMarkers(devices: readonly PlacedDevice[], connections: readonly Connection[], snapTo: PortRef | null): void {
    this.markers.clear();
    const linked = new Set(connections.flatMap((c) => [`${c.from.deviceId}/${c.from.portId}`, `${c.to.deviceId}/${c.to.portId}`]));
    for (const d of devices) {
      for (const { portId, type } of rolePorts(d)) {
        const isSnap = snapTo?.deviceId === d.id && snapTo.portId === portId;
        if (linked.has(`${d.id}/${portId}`) && !isSnap) continue;
        const ring = this.ring(portWorldPosition(d, portId), (d.rotationYDeg * Math.PI) / 180, isSnap);
        // 軸のポートは小さい輪を軸の高さに（球の通り道ではない）
        if (type === 'shaft') {
          ring.position.y -= 0.1;
          ring.scale.multiplyScalar(0.45);
        }
        this.markers.add(ring);
      }
    }
  }

  /** 発射機の押し板とばね（compression: deviceId → 0..1） */
  setLauncherCharge(compression: ReadonlyMap<string, number>): void {
    for (const [id, c] of compression) {
      const r = this.rails.get(id);
      if (r) this.launcherFactory.setPlunger(r.group, c);
    }
  }

  /** バネの天板とコイル（offset: deviceId → 縮み量 m） */
  setSpringCompression(offsets: ReadonlyMap<string, number>): void {
    for (const [id, o] of offsets) {
      const r = this.rails.get(id);
      if (r) this.springFactory.setCompression(r.group, o);
    }
  }

  /** 羽根車・歯車・軸・可動橋の角度 */
  setDriveAngles(angles: ReturnType<Simulation['driveAngles']>): void {
    for (const [id, r] of this.rails) {
      const d = this.devices.find((x) => x.id === id);
      if (!d) continue;
      const input = angles.shafts.input.get(id) ?? 0;
      const output = angles.shafts.output.get(id) ?? 0;
      if (d.type === 'paddle') this.driveFactory.setAngles(r.group, { wheel: angles.paddles.get(id) ?? 0 });
      else if (d.type === 'gearbox') this.driveFactory.setAngles(r.group, { gearIn: input, gearOut: output });
      else if (d.type === 'shaft') this.driveFactory.setAngles(r.group, { shaft: output });
      else if (d.type === 'bridge') this.driveFactory.setAngles(r.group, { bridge: angles.bridges.get(id) ?? 0, bridgeGear: input });
    }
  }

  /** ゴールの光り（strength: deviceId → 0..1） */
  setGoalFlash(strength: ReadonlyMap<string, number>): void {
    for (const [id, v] of strength) {
      const r = this.rails.get(id);
      if (r) this.goalFactory.setGoalFlash(r.group, v);
    }
  }

  private ring(p: Vec3, yaw: number, snap: boolean): THREE.Mesh {
    const m = new THREE.Mesh(this.ringGeo, snap ? this.ringMats.snap : this.ringMats.open);
    m.position.set(p[0], p[1] + 0.1, p[2]);
    m.rotation.y = yaw;
    if (snap) m.scale.setScalar(1.35);
    return m;
  }

  private disposeRail(group: THREE.Group): void {
    this.root.remove(group);
    group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry.userData.ownedByDevice) o.geometry.dispose();
    });
  }
}
