import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { PlacedDevice } from '../sim/layout';
import { buildRailTrack } from '../sim/railGeometry';
import { ROTATOR, rotatorParams } from '../sim/rotator';
import type { RailMaterials, RailModelFactory } from './RailModel';

/**
 * 回転装置の見た目（試作, DECISIONS.md D-32）。画像は使わずプリミティブで作る。
 * - ガンメタルの土台（床まで）と、オレンジの縁の円い台。台の上に短いレール（台と一緒に回る）
 * - 土台の前面の札に回る向きを文字で（「左回り ↺」「右回り ↻」）
 */
export class RotatorModelFactory {
  private readonly labels = new Map<number, THREE.MeshBasicMaterial>();

  constructor(
    private readonly mats: RailMaterials,
    private readonly rails: RailModelFactory,
  ) {}

  create(device: PlacedDevice): THREE.Group {
    const g = new THREE.Group();
    g.position.set(...device.position);
    g.rotation.y = (device.rotationYDeg * Math.PI) / 180;
    const own = (m: THREE.Mesh) => {
      m.geometry.userData.ownedByDevice = true;
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };
    const top = ROTATOR.surfaceY - 0.05;
    // 土台：床から台の下まで
    const h = top + device.position[1];
    const base = own(new THREE.Mesh(new RoundedBoxGeometry(1.0, h, 1.0, 2, 0.03), this.mats.dark));
    base.position.y = h / 2 - device.position[1];
    g.add(base);
    // 回る台（円盤＋縁＋レール）
    const table = new THREE.Group();
    table.name = 'rotator_table';
    table.position.y = 0;
    const disk = own(new THREE.Mesh(new THREE.CylinderGeometry(ROTATOR.half - 0.02, ROTATOR.half - 0.02, 0.05, 40), this.mats.bearing));
    disk.position.y = ROTATOR.surfaceY - 0.05;
    table.add(disk);
    const rim = own(new THREE.Mesh(new THREE.TorusGeometry(ROTATOR.half - 0.02, 0.018, 8, 48), this.mats.paint));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = ROTATOR.surfaceY - 0.03;
    table.add(rim);
    const length = (ROTATOR.half - 0.03) * 2;
    table.add(
      this.rails.createRail(
        buildRailTrack({ id: `${device.id}_table_rail`, type: 'rail', position: [0, ROTATOR.surfaceY - 0.15, 0], rotationYDeg: 0, params: { lengthMeters: length, slopeMeters: 0 } }),
      ),
    );
    g.add(table);
    // 前面の札（回る向き）。前の出口のレールと支柱に隠れないよう右寄りに
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.11), this.labelMat(rotatorParams(device).direction));
    label.geometry.userData.ownedByDevice = true;
    label.position.set(0.32, top - Math.min(0.09, h / 2), 0.505);
    g.add(label);
    // タップしやすいよう外形の見えない箱
    const pick = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 1.2), this.mats.pick);
    pick.geometry.userData.ownedByDevice = true;
    pick.position.y = 0.1;
    pick.name = 'pick_proxy';
    g.add(pick);
    return g;
  }

  setAngle(group: THREE.Object3D, angle: number): void {
    const t = group.getObjectByName('rotator_table');
    if (t) t.rotation.y = angle;
  }

  private labelMat(direction: number): THREE.MeshBasicMaterial {
    let m = this.labels.get(direction);
    if (!m) {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 92;
      const g = c.getContext('2d')!;
      g.fillStyle = '#16191d';
      g.fillRect(0, 0, 256, 92);
      g.strokeStyle = '#ff7a1a';
      g.lineWidth = 5;
      g.strokeRect(4, 4, 248, 84);
      g.fillStyle = '#e6e9ee';
      g.font = "bold 40px system-ui, 'Hiragino Sans', 'Noto Sans JP', sans-serif";
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(direction > 0 ? '左回り ↺' : '右回り ↻', 128, 48);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      m = new THREE.MeshBasicMaterial({ map: t });
      this.labels.set(direction, m);
    }
    return m;
  }
}
