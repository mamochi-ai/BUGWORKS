import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { PlacedDevice } from '../sim/layout';
import { buildRailTrack, portWorldPosition } from '../sim/railGeometry';
import { signalInPort } from '../sim/switch';
import type { RailMaterials, RailModelFactory } from './RailModel';
import { PALETTE } from './palette';

/**
 * スイッチと配線の見た目（試作, DECISIONS.md D-30）。画像は使わずプリミティブで作る。
 * - 1m のレールの上に門。門から下がるレバーが ON で前、OFF で後ろに傾く
 * - 横の端子箱の上面に「ON」「OFF」の札（文字で示し、色だけに頼らない）。ON の間は端子箱の灯りがシアンに光る
 * - 配線：スイッチの端子から相手（発射機・磁石）の信号ポートまで、床に垂れるケーブル。ON の間はシアンに光る
 */
export class SwitchModelFactory {
  private readonly labelMats = { on: labelMat('ON'), off: labelMat('OFF') };
  private readonly lampMats = {
    on: new THREE.MeshStandardMaterial({ color: PALETTE.anomaly, emissive: PALETTE.anomaly, emissiveIntensity: 1.1 }),
    off: new THREE.MeshStandardMaterial({ color: 0x23282e, roughness: 0.6, metalness: 0.3 }),
  };
  private readonly cableMats = {
    on: new THREE.MeshStandardMaterial({ color: PALETTE.anomaly, emissive: PALETTE.anomaly, emissiveIntensity: 0.7, roughness: 0.5 }),
    off: new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.8, metalness: 0.1 }),
  };

  constructor(
    private readonly mats: RailMaterials,
    private readonly rails: RailModelFactory,
  ) {}

  create(device: PlacedDevice): THREE.Group {
    const g = new THREE.Group();
    g.position.set(...device.position);
    g.rotation.y = (device.rotationYDeg * Math.PI) / 180;
    g.add(this.rails.createRail(buildRailTrack({ ...device, position: [0, 0, 0], rotationYDeg: 0 })));
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      geo.userData.ownedByDevice = true;
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    // 門（レールをまたぐ2本の柱と横木）
    const top = 0.85;
    for (const x of [-0.26, 0.26]) add(new THREE.BoxGeometry(0.05, top, 0.05), this.mats.dark, x, top / 2, 0);
    add(new RoundedBoxGeometry(0.62, 0.07, 0.08, 2, 0.015), this.mats.paint, 0, top, 0);
    // レバー（横木から下がる板。ON/OFF で傾きが変わる）
    const lever = new THREE.Group();
    lever.name = 'switch_lever';
    lever.position.set(0, top - 0.04, 0);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.03), this.mats.steel);
    plate.geometry.userData.ownedByDevice = true;
    plate.position.y = -0.11;
    plate.castShadow = true;
    lever.add(plate);
    g.add(lever);
    // 端子箱（信号の出口）。床まで脚を下ろす
    const sx = 0.45;
    add(new THREE.BoxGeometry(0.04, 0.3 + device.position[1], 0.04), this.mats.dark, sx, (0.3 + device.position[1]) / 2 - device.position[1], 0);
    add(new RoundedBoxGeometry(0.2, 0.16, 0.2, 2, 0.02), this.mats.dark, sx, 0.36, 0);
    const lamp = add(new THREE.BoxGeometry(0.21, 0.04, 0.21), this.lampMats.off, sx, 0.3, 0);
    lamp.name = 'switch_lamp';
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.12), this.labelMats.off);
    label.geometry.userData.ownedByDevice = true;
    label.name = 'switch_label';
    label.rotation.x = -Math.PI / 2;
    label.position.set(sx, 0.445, 0);
    g.add(label);
    // タップしやすいよう外形の見えない箱
    const pick = new THREE.Mesh(new THREE.BoxGeometry(1.0, top + 0.1, 1.0), this.mats.pick);
    pick.geometry.userData.ownedByDevice = true;
    pick.position.y = (top + 0.1) / 2;
    pick.name = 'pick_proxy';
    g.add(pick);
    this.setOn(g, false);
    return g;
  }

  setOn(group: THREE.Object3D, on: boolean): void {
    const lever = group.getObjectByName('switch_lever');
    if (lever) lever.rotation.x = on ? -0.45 : 0.45;
    const lamp = group.getObjectByName('switch_lamp') as THREE.Mesh | undefined;
    if (lamp) lamp.material = on ? this.lampMats.on : this.lampMats.off;
    const label = group.getObjectByName('switch_label') as THREE.Mesh | undefined;
    if (label) label.material = on ? this.labelMats.on : this.labelMats.off;
  }

  /** 配線のケーブル（スイッチの端子 → 相手の信号ポート）。床に垂れる曲線 */
  createCable(from: PlacedDevice, to: PlacedDevice): THREE.Mesh | null {
    const port = signalInPort(to.type);
    if (!port) return null;
    const a = new THREE.Vector3(...portWorldPosition(from, 'signal_out'));
    const b = new THREE.Vector3(...portWorldPosition(to, port));
    const curve = new THREE.CubicBezierCurve3(
      a,
      new THREE.Vector3(a.x, 0.03, a.z),
      new THREE.Vector3(b.x, 0.03, b.z),
      b,
    );
    const geo = new THREE.TubeGeometry(curve, 32, 0.022, 6, false);
    const m = new THREE.Mesh(geo, this.cableMats.off);
    m.name = 'signal_cable';
    m.userData.switchId = from.id;
    m.raycast = () => {}; // ケーブルはタップの対象にしない
    return m;
  }

  setCableOn(cable: THREE.Mesh, on: boolean): void {
    cable.material = on ? this.cableMats.on : this.cableMats.off;
  }
}

function labelMat(text: string): THREE.MeshBasicMaterial {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 84;
  const g = c.getContext('2d')!;
  g.fillStyle = text === 'ON' ? '#0e3a46' : '#16191d';
  g.fillRect(0, 0, 128, 84);
  g.fillStyle = text === 'ON' ? '#3fd4ff' : '#9aa3ae';
  g.font = "bold 46px system-ui, 'Hiragino Sans', sans-serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 44);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: t });
}
