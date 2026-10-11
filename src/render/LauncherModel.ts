import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { getDeviceDef, getPort } from '../sim/catalog';
import type { PlacedDevice } from '../sim/layout';
import { LAUNCHER_BASE } from '../sim/launcher';
import type { RailMaterials } from './RailModel';

/**
 * 鉄球発射機の見た目（試作）。デザイン画 launcher_base / launcher_arm / coil_spring を参考に、
 * 台座（四隅のオレンジ金具とボルト、中央のリング）、斜めのアーム、コイルばねをプリミティブで組む。
 * 当たり判定は Simulation 側の台座の箱だけで、この形状は描画専用。
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
  };

  constructor(private readonly mats: RailMaterials) {}

  create(device: PlacedDevice): THREE.Group {
    const g = new THREE.Group();
    g.position.set(...device.position);
    g.rotation.y = (device.rotationYDeg * Math.PI) / 180;

    // 台座（当たり判定と同じ寸法）
    const [bw, bh, bd] = LAUNCHER_BASE.size;
    const [, , bz] = LAUNCHER_BASE.center;
    const plate = new THREE.Mesh(new RoundedBoxGeometry(bw * 0.92, bh * 0.45, bd * 0.92, 2, 0.03), this.mats.dark);
    plate.geometry.userData.ownedByDevice = true;
    plate.position.set(0, bh * 0.225, bz);
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
    disc.position.set(0, bh * 0.45 + 0.015, bz);
    const ring = new THREE.Mesh(this.geo.ring, this.mats.dark);
    ring.position.set(0, bh * 0.45 + 0.04, bz);
    g.add(disc, ring);

    // アーム：後ろの支点から ball_out の手前まで斜めに伸びる溝
    const out = getPort(getDeviceDef('launcher'), 'ball_out').position;
    const pivot = new THREE.Vector3(0, 0.42, -0.45);
    const tip = new THREE.Vector3(out[0], out[1] - 0.06, out[2] - 0.05);
    const arm = new THREE.Group();
    const len = pivot.distanceTo(tip);
    arm.position.copy(pivot).add(tip).multiplyScalar(0.5);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tip.clone().sub(pivot).normalize());
    const barGeo = new THREE.BoxGeometry(0.05, 0.08, len);
    barGeo.userData.ownedByDevice = true;
    const floorGeo = new THREE.BoxGeometry(0.3, 0.025, len);
    floorGeo.userData.ownedByDevice = true;
    for (const sx of [-1, 1]) {
      const bar = new THREE.Mesh(barGeo, this.mats.dark);
      bar.position.x = sx * 0.15;
      arm.add(bar);
      for (const t of [-0.45, 0, 0.45]) {
        const br = new THREE.Mesh(this.geo.bracket, this.mats.paint);
        br.position.set(sx * 0.2, 0, t * len);
        const be = new THREE.Mesh(this.geo.bearing, this.mats.bearing);
        be.position.set(sx * 0.24, 0, t * len);
        arm.add(br, be);
      }
    }
    const floor = new THREE.Mesh(floorGeo, this.mats.steel);
    floor.position.y = -0.05;
    arm.add(floor);
    g.add(arm);

    // 前側の支柱
    const strutH = tip.y - 0.1 - bh * 0.45;
    const strutGeo = new THREE.BoxGeometry(0.06, strutH, 0.06);
    strutGeo.userData.ownedByDevice = true;
    const strut = new THREE.Mesh(strutGeo, this.mats.dark);
    strut.position.set(0, bh * 0.45 + strutH / 2, tip.z - 0.1);
    g.add(strut);

    // コイルばね（発射までの溜めを縮みで表す）
    const spring = new THREE.Mesh(this.geo.spring, this.mats.steel);
    spring.name = 'launcher_spring';
    spring.position.set(0, bh * 0.45, -0.45);
    g.add(spring);

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
    return g;
  }

  /** charge: 0（撃った直後）〜1（次の発射直前）。ばねを縮める */
  static setCharge(group: THREE.Group, charge: number): void {
    const spring = group.getObjectByName('launcher_spring');
    if (spring) spring.scale.y = 1 - 0.4 * Math.min(1, Math.max(0, charge));
  }
}

/** 高さ 1 のコイル（スケールで伸縮させる） */
function makeSpringGeometry(): THREE.BufferGeometry {
  const turns = 6;
  const radius = 0.09;
  const height = 0.2;
  const curve = new THREE.CatmullRomCurve3(
    Array.from({ length: turns * 16 + 1 }, (_, i) => {
      const t = i / (turns * 16);
      const a = t * turns * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * radius, t * height, Math.sin(a) * radius);
    }),
  );
  return new THREE.TubeGeometry(curve, turns * 24, 0.014, 6, false);
}
