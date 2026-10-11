import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { getDeviceDef } from '../sim/catalog';
import type { PlacedDevice } from '../sim/layout';
import { LAUNCHER_SHAPE } from '../sim/launcher';
import { railParts } from '../sim/Simulation';
import type { RailMaterials } from './RailModel';
import { addLegs } from './SpringModel';

/**
 * 鉄球発射機の見た目（試作）。デザイン画 launcher_base / launcher_arm / coil_spring を参考に組む。
 * - 台座：四隅のオレンジ金具とボルト、中央のリング
 * - 溝（シュート）：水平。前端が ball_out で、つないだレールと同じ高さ
 * - 溝の後ろ：横向きのコイルばねと押し板。撃つ瞬間に押し板が伸び、その後ばねを縮めて戻る
 * - 装填口：溝の後ろの上にある漏斗。次の球はここから溝へ落ちる
 * 当たり判定は Simulation 側（台座の箱と溝）で、この形状は描画専用。
 */
export class LauncherModelFactory {
  private readonly geo = {
    corner: new RoundedBoxGeometry(0.24, 0.3, 0.24, 3, 0.03),
    bolt: new THREE.CylinderGeometry(0.035, 0.035, 0.07, 12),
    ring: new THREE.TorusGeometry(0.2, 0.035, 10, 32).rotateX(Math.PI / 2),
    disc: new THREE.CylinderGeometry(0.26, 0.26, 0.03, 32),
    bracket: new RoundedBoxGeometry(0.07, 0.16, 0.16, 2, 0.015),
    bearing: new THREE.CylinderGeometry(0.035, 0.035, 0.02, 16).rotateZ(Math.PI / 2),
    spring: makeSpringGeometry(),
    plunger: new RoundedBoxGeometry(0.26, 0.1, 0.04, 2, 0.01),
    hopper: new THREE.CylinderGeometry(0.16, 0.12, 0.12, 24, 1, true),
    hopperRim: new THREE.TorusGeometry(0.16, 0.015, 8, 24).rotateX(Math.PI / 2),
    strut: new THREE.BoxGeometry(0.06, 1, 0.06),
  };

  constructor(private readonly mats: RailMaterials) {}

  create(device: PlacedDevice): THREE.Group {
    const S = LAUNCHER_SHAPE;
    const g = new THREE.Group();
    g.position.set(...device.position);
    g.rotation.y = (device.rotationYDeg * Math.PI) / 180;

    // 台座
    const [bw, bh, bd] = S.base.size;
    const bz = S.base.center[2];
    const plateTop = bh * 0.45;
    const plate = new THREE.Mesh(new RoundedBoxGeometry(bw * 0.92, plateTop, bd * 0.92, 2, 0.03), this.mats.dark);
    plate.geometry.userData.ownedByDevice = true;
    plate.position.set(0, plateTop / 2, bz);
    g.add(plate);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const c = new THREE.Mesh(this.geo.corner, this.mats.paint);
        c.position.set(sx * (bw / 2 - 0.13), 0.15, bz + sz * (bd / 2 - 0.13));
        const bolt = new THREE.Mesh(this.geo.bolt, this.mats.bolt);
        bolt.position.set(c.position.x, 0.33, c.position.z);
        g.add(c, bolt);
      }
    }
    const disc = new THREE.Mesh(this.geo.disc, this.mats.steel);
    disc.position.set(0, plateTop + 0.015, bz);
    const ring = new THREE.Mesh(this.geo.ring, this.mats.dark);
    ring.position.set(0, plateTop + 0.04, bz);
    g.add(disc, ring);

    // 溝：レールと同じ断面（底板＋側壁）。走行面 = ball_out の高さ
    const len = S.frontZ - S.backZ;
    const chute = new THREE.Group();
    chute.position.set(0, S.surfaceY, (S.frontZ + S.backZ) / 2);
    railParts(len).forEach((part, i) => {
      const geo = new THREE.BoxGeometry(part.half[0] * 2, part.half[1] * 2, part.half[2] * 2);
      geo.userData.ownedByDevice = true;
      const m = new THREE.Mesh(geo, i === 0 ? this.mats.steel : this.mats.dark);
      m.position.set(...part.offset);
      chute.add(m);
    });
    // 側面のオレンジ金具（launcher_arm の意匠）
    for (const sx of [-1, 1]) {
      for (const t of [-0.42, 0.42]) {
        const br = new THREE.Mesh(this.geo.bracket, this.mats.paint);
        br.position.set(sx * 0.21, 0.02, t * len);
        const be = new THREE.Mesh(this.geo.bearing, this.mats.bearing);
        be.position.set(sx * 0.25, 0.02, t * len);
        chute.add(br, be);
      }
    }
    // 後ろ壁
    const back = new THREE.Mesh(new RoundedBoxGeometry(0.38, 0.2, 0.05, 2, 0.01), this.mats.paint);
    back.geometry.userData.ownedByDevice = true;
    back.position.set(0, 0.06, -len / 2 - 0.025);
    chute.add(back);
    g.add(chute);

    // 溝を支える柱
    for (const z of [S.backZ + 0.15, S.frontZ - 0.2]) {
      const h = S.surfaceY - 0.04 - plateTop;
      const strut = new THREE.Mesh(this.geo.strut, this.mats.dark);
      strut.scale.y = h;
      strut.position.set(0, plateTop + h / 2, z);
      g.add(strut);
    }

    // 横向きのばねと押し板（setPlunger で動かす）
    const spring = new THREE.Mesh(this.geo.spring, this.mats.steel);
    spring.name = 'launcher_spring';
    spring.position.set(0, S.surfaceY + 0.06, S.backZ);
    const plunger = new THREE.Mesh(this.geo.plunger, this.mats.paint);
    plunger.name = 'launcher_plunger';
    plunger.position.set(0, S.surfaceY + 0.06, S.plungerRetractedZ - 0.02);
    g.add(spring, plunger);

    // 装填口（漏斗）：装填位置の真上
    const hopper = new THREE.Mesh(this.geo.hopper, this.mats.dark);
    hopper.position.set(0, S.surfaceY + S.hopperDrop + 0.02, S.loadZ);
    const rim = new THREE.Mesh(this.geo.hopperRim, this.mats.paint);
    rim.position.set(0, S.surfaceY + S.hopperDrop + 0.08, S.loadZ);
    const neck = new THREE.Mesh(this.geo.strut, this.mats.dark);
    neck.scale.set(0.6, S.hopperDrop - 0.05, 0.6);
    neck.position.set(-0.19, S.surfaceY + (S.hopperDrop - 0.05) / 2 + 0.05, S.loadZ);
    g.add(hopper, rim, neck);

    addLegs(g, device.position[1], bw / 2 - 0.13, bd / 2 - 0.13 + 0.0, this.mats);

    // タッチ用の当たり判定（描画しない）
    const [sx, sy, sz] = getDeviceDef('launcher').size;
    const pickGeo = new THREE.BoxGeometry(sx + 0.05, sy, sz + 0.05);
    pickGeo.userData.ownedByDevice = true;
    const pick = new THREE.Mesh(pickGeo, this.mats.pick);
    pick.position.y = sy / 2;
    pick.name = 'pick_proxy';
    g.add(pick);

    g.traverse((o) => {
      if (o instanceof THREE.Mesh && o !== pick) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.setPlunger(g, 1);
    return g;
  }

  /** compression: 0＝押し板が伸びている（撃った瞬間）、1＝ばねを縮めて待機 */
  setPlunger(group: THREE.Group, compression: number): void {
    const S = LAUNCHER_SHAPE;
    const c = Math.min(1, Math.max(0, compression));
    const face = S.plungerExtendedZ + (S.plungerRetractedZ - S.plungerExtendedZ) * c;
    const plunger = group.getObjectByName('launcher_plunger');
    const spring = group.getObjectByName('launcher_spring');
    if (plunger) plunger.position.z = face - 0.02;
    if (spring) spring.scale.z = Math.max(0.01, face - 0.04 - S.backZ);
  }
}

/** Z 方向に長さ 1 の横向きコイル（scale.z で伸縮させる） */
function makeSpringGeometry(): THREE.BufferGeometry {
  const turns = 7;
  const radius = 0.06;
  const curve = new THREE.CatmullRomCurve3(
    Array.from({ length: turns * 16 + 1 }, (_, i) => {
      const t = i / (turns * 16);
      const a = t * turns * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, t);
    }),
  );
  return new THREE.TubeGeometry(curve, turns * 24, 0.011, 6, false);
}
