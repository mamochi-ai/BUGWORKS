import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { getDeviceDef } from '../sim/catalog';
import type { PlacedDevice } from '../sim/layout';
import { SPRING_SHAPE, planSpring } from '../sim/spring';
import type { RailMaterials } from './RailModel';

const COIL_POSITIONS: [number, number][] = [
  [-0.22, -0.22],
  [0.22, -0.22],
  [-0.22, 0.22],
  [0.22, 0.22],
];

/**
 * バネ装置の見た目（試作）。デザイン画 spring_part_08 を参考に、
 * 台座（四隅のオレンジ金具）、四隅のコイルと中央の太いコイル、天板（後ろの辺を軸に傾く）を組む。
 * 天板とコイルは setCompression で縮み量に合わせて動かす。当たり判定は Simulation 側。
 */
export class SpringModelFactory {
  private readonly geo = {
    base: new RoundedBoxGeometry(SPRING_SHAPE.base.size[0], SPRING_SHAPE.base.size[1], SPRING_SHAPE.base.size[2], 2, 0.03),
    // 台座の角から少しはみ出させて、面が重なってちらつかないようにする
    corner: new RoundedBoxGeometry(0.22, 0.24, 0.22, 2, 0.03),
    bolt: new THREE.CylinderGeometry(0.03, 0.03, 0.06, 12),
    plate: new RoundedBoxGeometry(SPRING_SHAPE.plateHalf[0] * 2, SPRING_SHAPE.plateHalf[1] * 2, SPRING_SHAPE.plateHalf[2] * 2, 2, 0.012),
    plateCap: new RoundedBoxGeometry(0.12, 0.03, 0.12, 2, 0.01),
    smallCoil: makeCoilGeometry(0.045, 7, 0.01),
    bigCoil: makeCoilGeometry(0.12, 6, 0.016),
  };

  constructor(private readonly mats: RailMaterials) {}

  create(device: PlacedDevice): THREE.Group {
    const g = new THREE.Group();
    g.position.set(...device.position);
    g.rotation.y = (device.rotationYDeg * Math.PI) / 180;
    g.userData.springDevice = device;

    const [bw, bh, bd] = SPRING_SHAPE.base.size;
    const base = new THREE.Mesh(this.geo.base, this.mats.dark);
    base.position.y = bh / 2;
    g.add(base);
    for (const [x, z] of COIL_POSITIONS) {
      const c = new THREE.Mesh(this.geo.corner, this.mats.paint);
      c.position.set(Math.sign(x) * (bw / 2 - 0.1), 0.12, Math.sign(z) * (bd / 2 - 0.1));
      const bolt = new THREE.Mesh(this.geo.bolt, this.mats.bolt);
      bolt.position.set(c.position.x, 0.27, c.position.z);
      g.add(c, bolt);
    }

    for (const [i, [x, z]] of COIL_POSITIONS.entries()) {
      const coil = new THREE.Mesh(this.geo.smallCoil, this.mats.steel);
      coil.name = `spring_coil_${i}`;
      coil.position.set(x, bh, z);
      g.add(coil);
    }
    const big = new THREE.Mesh(this.geo.bigCoil, this.mats.steel);
    big.name = 'spring_coil_big';
    big.position.set(0, bh, 0);
    g.add(big);

    // 天板：グループの原点＝上面中心。rotation.x で前へ傾ける
    const plate = new THREE.Group();
    plate.name = 'spring_plate';
    const top = new THREE.Mesh(this.geo.plate, this.mats.steel);
    top.position.y = -SPRING_SHAPE.plateHalf[1];
    plate.add(top);
    for (const [x, z] of COIL_POSITIONS) {
      const cap = new THREE.Mesh(this.geo.plateCap, this.mats.paint);
      cap.position.set(x * 1.15, 0.005, z * 1.15);
      plate.add(cap);
    }
    g.add(plate);

    addLegs(g, device.position[1], bw / 2 - 0.1, bd / 2 - 0.1, this.mats);

    const [sx, sy, sz] = getDeviceDef('spring').size;
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
    this.setCompression(g, 0);
    return g;
  }

  /** 縮み量（m）に合わせて天板とコイルを動かす */
  setCompression(group: THREE.Group, offset: number): void {
    const device = group.userData.springDevice as PlacedDevice | undefined;
    if (!device) return;
    // 装置ローカル座標で計算するため、位置・回転を 0 にした計画を使う
    const plan = planSpring({ ...device, position: [0, 0, 0], rotationYDeg: 0 });
    const top = plan.top.map((v, i) => v - plan.normal[i] * offset) as [number, number, number];
    const plate = group.getObjectByName('spring_plate');
    if (plate) {
      plate.position.set(...top);
      plate.rotation.x = plan.tilt;
    }
    const baseTop = SPRING_SHAPE.base.size[1];
    const thick = SPRING_SHAPE.plateHalf[1] * 2;
    // 天板の下面の高さ（ローカル z の位置で）
    const underside = (z: number) => {
      const a = (z - top[2]) / Math.cos(plan.tilt);
      return top[1] - Math.sin(plan.tilt) * a - thick / Math.cos(plan.tilt);
    };
    COIL_POSITIONS.forEach(([, z], i) => {
      const coil = group.getObjectByName(`spring_coil_${i}`);
      if (coil) coil.scale.y = Math.max(0.02, underside(z) - baseTop);
    });
    const big = group.getObjectByName('spring_coil_big');
    if (big) big.scale.y = Math.max(0.02, underside(0) - baseTop);
  }
}

/** 床から持ち上げた装置の脚（見た目だけ） */
export function addLegs(group: THREE.Group, height: number, hx: number, hz: number, mats: RailMaterials): void {
  if (height <= 0.01) return;
  const post = new THREE.BoxGeometry(0.06, height, 0.06);
  post.userData.ownedByDevice = true;
  const foot = new THREE.BoxGeometry(0.16, 0.025, 0.16);
  foot.userData.ownedByDevice = true;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const p = new THREE.Mesh(post, mats.dark);
      p.position.set(sx * hx, -height / 2, sz * hz);
      const f = new THREE.Mesh(foot, mats.paint);
      f.position.set(sx * hx, -height + 0.0125, sz * hz);
      group.add(p, f);
    }
  }
}

/** 高さ 1 の縦のコイル（scale.y で伸縮） */
function makeCoilGeometry(radius: number, turns: number, wire: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(
    Array.from({ length: turns * 16 + 1 }, (_, i) => {
      const t = i / (turns * 16);
      const a = t * turns * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * radius, t, Math.sin(a) * radius);
    }),
  );
  return new THREE.TubeGeometry(curve, turns * 20, wire, 6, false);
}
