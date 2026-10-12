import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { getDeviceDef } from '../sim/catalog';
import type { PlacedDevice } from '../sim/layout';
import { MAGNET, magnetParams } from '../sim/magnet';
import type { RailMaterials } from './RailModel';
import { PALETTE } from './palette';

/**
 * 磁石装置の見た目（試作, DECISIONS.md D-29）。画像は使わずプリミティブで作る。
 * - ガンメタルの台座と柱、前面（+Z）に向けたオレンジの U 字磁石と鋼の磁極
 * - 上面の札に向きを文字で出す（「引きよせ ←●」／「しりぞけ ●→」。色だけに頼らない）
 * - 床に届く距離の目安の輪（シアンの破線）。引きよせは内向き、しりぞけは外向きの矢印
 */
export class MagnetModelFactory {
  private readonly labels = new Map<number, THREE.MeshBasicMaterial>();
  private readonly fieldMat = new THREE.LineDashedMaterial({ color: PALETTE.anomaly, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.7 });
  private readonly arrowMat = new THREE.MeshBasicMaterial({ color: PALETTE.anomaly, transparent: true, opacity: 0.75, side: THREE.DoubleSide });

  constructor(private readonly mats: RailMaterials) {}

  create(device: PlacedDevice): THREE.Group {
    const g = new THREE.Group();
    g.position.set(...device.position);
    g.rotation.y = (device.rotationYDeg * Math.PI) / 180;
    const [sx, sy, sz] = getDeviceDef('magnet').size;
    const { mode, radius } = magnetParams(device);
    const own = (m: THREE.Mesh) => {
      m.geometry.userData.ownedByDevice = true;
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };

    // タップしやすいよう外形より少し大きい見えない箱
    const pick = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.05, sy, sz + 0.05), this.mats.pick);
    pick.geometry.userData.ownedByDevice = true;
    pick.position.y = sy / 2;
    pick.name = 'pick_proxy';
    g.add(pick);

    // 台座と柱（当たり判定は外形の箱）
    own(new THREE.Mesh(new RoundedBoxGeometry(sx, 0.16, sz, 2, 0.03), this.mats.dark)).position.y = 0.08;
    // 柱は後ろ寄りにして、前の U 字磁石の曲がった部分が見えるようにする
    const pillarDepth = sz * 0.45;
    const pillarZ = -sz / 2 + pillarDepth / 2 + 0.02;
    const pillar = own(new THREE.Mesh(new RoundedBoxGeometry(sx * 0.7, sy - 0.16, pillarDepth, 2, 0.04), this.mats.bearing));
    pillar.position.set(0, 0.16 + (sy - 0.16) / 2, pillarZ);

    // U 字磁石（前を向く）：半円の胴と2本の腕、先に鋼の磁極
    const py = MAGNET.pole[1];
    const bend = own(new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.075, 12, 24, Math.PI), this.mats.paint));
    bend.rotation.set(Math.PI / 2, 0, Math.PI);
    bend.position.set(0, py, 0.16);
    for (const x of [-0.2, 0.2]) {
      const arm = own(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.22, 12), this.mats.paint));
      arm.rotation.x = Math.PI / 2;
      arm.position.set(x, py, 0.27);
      const tip = own(new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.06, 12), this.mats.steel));
      tip.rotation.x = Math.PI / 2;
      tip.position.set(x, py, 0.41);
    }

    // 上面の札（向きを文字で）
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), this.labelMat(mode));
    label.geometry.userData.ownedByDevice = true;
    label.rotation.x = -Math.PI / 2;
    label.position.set(0, sy + 0.005, pillarZ);
    g.add(label);

    // 届く距離の目安（磁極を中心に、床の高さに破線の輪）と向きの矢印
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0.02, MAGNET.pole[2] + Math.sin(a) * radius));
    }
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.fieldMat);
    ring.geometry.userData.ownedByDevice = true;
    ring.computeLineDistances();
    ring.name = 'magnet_field';
    // 目安の輪と矢印はタップの対象にしない（床をタップしたつもりで磁石を選ばないように）
    ring.raycast = () => {};
    g.add(ring);
    for (const ang of [-0.6, 0, 0.6]) {
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 3), this.arrowMat);
      arrow.geometry.userData.ownedByDevice = true;
      const r = radius * 0.7;
      const dir = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
      arrow.position.set(dir.x * r, 0.03, MAGNET.pole[2] + dir.z * r);
      // 引きよせ：磁極へ向かう／しりぞけ：外へ向かう
      const point = mode > 0 ? dir.clone().negate() : dir;
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), point);
      arrow.raycast = () => {};
      g.add(arrow);
    }
    return g;
  }

  private labelMat(mode: number): THREE.MeshBasicMaterial {
    let m = this.labels.get(mode);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ map: makeLabel(mode > 0 ? '引きよせ ←●' : 'しりぞけ ●→'), transparent: true });
      this.labels.set(mode, m);
    }
    return m;
  }
}

function makeLabel(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#16191d';
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#ff7a1a';
  g.lineWidth = 6;
  g.strokeRect(5, 5, 246, 118);
  g.fillStyle = '#e6e9ee';
  g.font = "bold 40px system-ui, 'Hiragino Sans', 'Noto Sans JP', sans-serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
