import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { getDeviceDef } from '../sim/catalog';
import { BRIDGE, PADDLE, SHAFT_Y, shaftLength } from '../sim/drive';
import type { PlacedDevice } from '../sim/layout';
import { buildRailTrack } from '../sim/railGeometry';
import type { RailMaterials, RailModelFactory } from './RailModel';

/**
 * 回転を伝える装置の見た目（試作）。デザイン画 shiyou_gear_parts / launcher_arm の配色に合わせ、プリミティブで組む。
 * 回る部品には名前を付け、setAngles で角度を与える（物理の状態を読むだけ）。
 * - 羽根車：1m のレールの上に4枚羽根。横に縦の軸を下ろし、床から 0.65m の軸ポートへ
 * - 歯車装置：箱の中に大小の歯車（入力・出力）。ギア比に応じて回る
 * - 軸：床から 0.65m の高さの鋼の棒と受け台
 * - 可動橋：出口側の蝶番で跳ね上がるレール、横に駆動用の歯車と縦の軸
 */
export class DriveModelFactory {
  private readonly gearGeo = new Map<string, THREE.BufferGeometry>();

  constructor(
    private readonly mats: RailMaterials,
    private readonly rails: RailModelFactory,
  ) {}

  createPaddle(device: PlacedDevice): THREE.Group {
    const g = this.deviceGroup(device);
    // 走行路（装置ローカルで作る）
    g.add(this.rails.createRail(buildRailTrack({ ...device, position: [0, 0, 0], rotationYDeg: 0 })));
    // 羽根車：レールの真上、横向きの軸に4枚羽根。羽根の先が球の上端（走行面+0.2m）に届く高さ
    const hubY = 0.3 + 0.2 + 0.28;
    const wheel = new THREE.Group();
    wheel.name = 'paddle_wheel';
    wheel.position.set(0, hubY, 0);
    const axle = this.cyl(0.03, 0.9, this.mats.steel);
    axle.rotation.z = Math.PI / 2;
    axle.position.x = 0.3;
    wheel.add(axle);
    for (let i = 0; i < 4; i++) {
      const blade = this.box([0.26, 0.24, 0.03], this.mats.paint);
      blade.position.set(0, Math.cos((i * Math.PI) / 2) * 0.16, Math.sin((i * Math.PI) / 2) * 0.16);
      blade.rotation.x = (i * Math.PI) / 2;
      wheel.add(blade);
    }
    g.add(wheel);
    // 羽根車を支える門と、横の歯車箱
    for (const x of [-0.3, 0.75]) {
      const post = this.box([0.06, hubY + 0.05, 0.06], this.mats.dark);
      post.position.set(x, (hubY + 0.05) / 2 - device.position[1], 0);
      post.scale.y = (hubY + 0.05 + device.position[1]) / (hubY + 0.05);
      post.position.y = (hubY + 0.05 + device.position[1]) / 2 - device.position[1];
      g.add(post);
    }
    const sideBox = this.box([0.16, 0.16, 0.16], this.mats.paint, true);
    sideBox.position.set(0.75, hubY, 0);
    g.add(sideBox);
    // 縦の軸（床から 0.65m の軸ポートまで下ろす）と、ポートの向きの短い軸
    this.addDropShaft(g, device, PADDLE.shaftX, hubY, 0, 0.5);
    g.add(this.pick([1.1, 0.9, 1.05], 0.45));
    return finish(g);
  }

  createGearbox(device: PlacedDevice): THREE.Group {
    const g = this.deviceGroup(device);
    const [sx, sy, sz] = getDeviceDef('gearbox').size;
    // 枠（前面は開けて歯車を見せる）
    const back = this.box([sx, sy, 0.06], this.mats.dark, true);
    back.position.set(0, sy / 2, -sz / 2 + 0.03);
    const base = this.box([sx, 0.08, sz], this.mats.dark, true);
    base.position.y = 0.04;
    const top = this.box([sx, 0.06, sz], this.mats.dark, true);
    top.position.y = sy - 0.03;
    g.add(back, base, top);
    for (const x of [-1, 1]) {
      const side = this.box([0.08, sy, sz], this.mats.paint, true);
      side.position.set(x * (sx / 2 - 0.04), sy / 2, 0);
      g.add(side);
    }
    // 入力・出力の軸の高さに歯車（左＝入力の大歯車、右＝出力の小歯車）
    const gin = this.gear(0.36, 24, 'gear_in');
    gin.position.set(-0.32, SHAFT_Y, 0);
    const gout = this.gear(0.18, 12, 'gear_out');
    gout.position.set(-0.32 + 0.36 + 0.18, SHAFT_Y, 0);
    g.add(gin, gout);
    // 入出力の軸の端
    for (const [x, name] of [
      [-0.75, 'stub_in'],
      [0.75, 'stub_out'],
    ] as const) {
      const stub = this.cyl(0.035, 0.2, this.mats.steel);
      stub.rotation.z = Math.PI / 2;
      stub.position.set(x - Math.sign(x) * 0.05, SHAFT_Y, 0);
      stub.name = name;
      g.add(stub);
    }
    g.add(this.pick([sx, sy, sz], sy / 2));
    return finish(g);
  }

  createShaft(device: PlacedDevice): THREE.Group {
    const g = this.deviceGroup(device);
    const len = shaftLength(device);
    const rod = new THREE.Group();
    rod.name = 'shaft_rod';
    rod.position.y = SHAFT_Y;
    const bar = this.cyl(0.035, len, this.mats.steel, true);
    bar.rotation.x = Math.PI / 2;
    rod.add(bar);
    // 回っているのが見えるようにオレンジの印
    const mark = this.box([0.075, 0.02, len * 0.6], this.mats.paint, true);
    rod.add(mark);
    g.add(rod);
    // 受け台
    for (const z of [-len / 2 + 0.12, len / 2 - 0.12]) {
      const stand = this.box([0.14, SHAFT_Y, 0.08], this.mats.dark);
      stand.position.set(0, SHAFT_Y / 2, z);
      g.add(stand);
    }
    g.add(this.pick([0.25, 0.8, len], 0.4));
    return finish(g);
  }

  createBridge(device: PlacedDevice): THREE.Group {
    const g = this.deviceGroup(device);
    const local = buildRailTrack({ ...device, position: [0, 0, 0], rotationYDeg: 0 });
    // 蝶番（出口）を原点にした床板
    const hinge = new THREE.Group();
    hinge.name = 'bridge_hinge';
    hinge.position.set(...local.end);
    const deck = this.rails.createRail(local);
    deck.position.sub(new THREE.Vector3(...local.end));
    hinge.add(deck);
    g.add(hinge);
    // 蝶番の塔
    for (const x of [-0.32, 0.32]) {
      const tower = this.box([0.08, local.end[1] + device.position[1] + 0.25, 0.12], this.mats.paint);
      tower.position.set(x, (local.end[1] - device.position[1] + 0.25) / 2, local.end[2]);
      g.add(tower);
    }
    // 駆動用の歯車と縦の軸（入口側の横）
    const hubY = 0.6;
    const drive = this.gear(0.16, 12, 'bridge_gear');
    drive.rotation.y = Math.PI / 2;
    drive.position.set(BRIDGE.shaftX, hubY, -0.8);
    g.add(drive);
    this.addDropShaft(g, device, BRIDGE.shaftX, hubY, -0.8, -1);
    g.add(this.pick([0.6, 0.6, 2], 0.3));
    return finish(g);
  }

  /** 回る部品の角度を反映する */
  setAngles(group: THREE.Group, a: { wheel?: number; gearIn?: number; gearOut?: number; shaft?: number; bridge?: number; bridgeGear?: number }): void {
    const set = (name: string, fn: (o: THREE.Object3D) => void) => {
      const o = group.getObjectByName(name);
      if (o) fn(o);
    };
    // 球が前（+Z）へ押すと、下の羽根が前へ動く向き
    if (a.wheel !== undefined) set('paddle_wheel', (o) => (o.rotation.x = -a.wheel!));
    if (a.gearIn !== undefined) set('gear_in', (o) => (o.rotation.z = a.gearIn!));
    // 噛み合う歯車は逆向きに回る
    if (a.gearOut !== undefined) set('gear_out', (o) => (o.rotation.z = -a.gearOut!));
    if (a.shaft !== undefined) set('shaft_rod', (o) => (o.rotation.z = a.shaft!));
    // 出口側の蝶番を軸に、入口側（-Z）が上がる向き
    if (a.bridge !== undefined) set('bridge_hinge', (o) => (o.rotation.x = a.bridge!));
    if (a.bridgeGear !== undefined) set('bridge_gear', (o) => (o.rotation.x = a.bridgeGear!));
  }

  /** 縦の軸：(x, hubY, zHub) から床上 0.65m まで下ろし、ポートの位置 (x, 0.65, zPort) へ短く伸ばす */
  private addDropShaft(g: THREE.Group, device: PlacedDevice, x: number, hubY: number, zHub: number, zPort: number): void {
    const portY = SHAFT_Y - device.position[1];
    const top = Math.max(hubY, portY);
    const bottom = Math.min(hubY, portY);
    const v = this.cyl(0.03, top - bottom + 0.04, this.mats.steel, true);
    v.position.set(x, (top + bottom) / 2, zHub);
    g.add(v);
    const len = Math.abs(zPort - zHub);
    if (len > 0.01) {
      const h = this.cyl(0.03, len, this.mats.steel, true);
      h.rotation.x = Math.PI / 2;
      h.position.set(x, portY, (zHub + zPort) / 2);
      g.add(h);
    }
    const joint = this.box([0.1, 0.1, 0.1], this.mats.paint, true);
    joint.position.set(x, portY, zHub);
    g.add(joint);
  }

  /** 歯の付いた円盤（z 軸まわりに回す）。歯数ごとに共有 */
  private gear(radius: number, teeth: number, name: string): THREE.Group {
    const key = `${radius}:${teeth}`;
    let geo = this.gearGeo.get(key);
    if (!geo) {
      const shape = new THREE.Shape();
      const steps = teeth * 4;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const r = i % 4 < 2 ? radius : radius * 0.86;
        if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      const hole = new THREE.Path();
      hole.absarc(0, 0, radius * 0.2, 0, Math.PI * 2, true);
      shape.holes.push(hole);
      geo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false }).translate(0, 0, -0.025);
      this.gearGeo.set(key, geo);
    }
    const g = new THREE.Group();
    g.name = name;
    const m = new THREE.Mesh(geo, this.mats.paint);
    const hub = this.cyl(radius * 0.25, 0.08, this.mats.steel, true);
    hub.rotation.x = Math.PI / 2;
    g.add(m, hub);
    return g;
  }

  private deviceGroup(device: PlacedDevice): THREE.Group {
    const g = new THREE.Group();
    g.position.set(...device.position);
    g.rotation.y = (device.rotationYDeg * Math.PI) / 180;
    return g;
  }

  private box(size: [number, number, number], mat: THREE.Material, rounded = false): THREE.Mesh {
    const geo = rounded ? new RoundedBoxGeometry(size[0], size[1], size[2], 2, Math.min(0.015, Math.min(...size) / 3)) : new THREE.BoxGeometry(...size);
    geo.userData.ownedByDevice = true;
    return new THREE.Mesh(geo, mat);
  }

  private cyl(r: number, h: number, mat: THREE.Material, owned = true): THREE.Mesh {
    const geo = new THREE.CylinderGeometry(r, r, h, 14);
    if (owned) geo.userData.ownedByDevice = true;
    return new THREE.Mesh(geo, mat);
  }

  private pick(size: [number, number, number], y: number): THREE.Mesh {
    const geo = new THREE.BoxGeometry(...size);
    geo.userData.ownedByDevice = true;
    const m = new THREE.Mesh(geo, this.mats.pick);
    m.position.y = y;
    m.name = 'pick_proxy';
    return m;
  }
}

function finish(g: THREE.Group): THREE.Group {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name !== 'pick_proxy') {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}
