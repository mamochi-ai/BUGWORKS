import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { getDeviceDef } from '../sim/catalog';
import { GOAL_ZONE, platformHeight } from '../sim/goal';
import type { PlacedDevice } from '../sim/layout';
import type { RailMaterials } from './RailModel';
import { PALETTE } from './palette';

/**
 * ゴールと台の見た目（試作）。研究所の配色（ガンメタル・工業オレンジ・異常のシアン）で、画像は使わない。
 * - ゴール：台座、範囲を示すシアンの枠、両脇の柱と「GOAL」の札。球が入ると光る（flash）
 * - 台：ガンメタルの箱。上面の縁にオレンジと黒の注意帯
 */
export class GoalModelFactory {
  private readonly goalMats = {
    zone: new THREE.MeshStandardMaterial({ color: PALETTE.anomaly, emissive: PALETTE.anomaly, emissiveIntensity: 0.6, transparent: true, opacity: 0.85 }),
    floor: new THREE.MeshStandardMaterial({ color: 0x0f3b47, emissive: 0x0b3a46, emissiveIntensity: 0.5, roughness: 0.6 }),
    sign: new THREE.MeshBasicMaterial({ map: makeSignTexture(), transparent: true }),
  };
  private readonly hazard = makeHazardTexture();

  constructor(private readonly mats: RailMaterials) {}

  createGoal(device: PlacedDevice): THREE.Group {
    const g = new THREE.Group();
    g.position.set(...device.position);
    g.rotation.y = (device.rotationYDeg * Math.PI) / 180;
    const [sx, , sz] = getDeviceDef('goal').size;
    const half = GOAL_ZONE.half;

    const base = new THREE.Mesh(new RoundedBoxGeometry(sx, 0.04, sz, 2, 0.01), this.mats.dark);
    base.geometry.userData.ownedByDevice = true;
    base.position.y = 0.02;
    const pad = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.01, half * 2), this.goalMats.floor);
    pad.geometry.userData.ownedByDevice = true;
    pad.position.y = 0.045;
    g.add(base, pad);

    // 範囲の枠（下と上の四角）。光らせるのはこのゴールだけなので材質はゴールごと
    const zoneMat = this.goalMats.zone.clone();
    const ring = new THREE.Group();
    ring.name = 'goal_zone';
    for (const y of [0.06, GOAL_ZONE.height]) {
      for (const [w, d, x, z] of [
        [half * 2, 0.025, 0, half],
        [half * 2, 0.025, 0, -half],
        [0.025, half * 2, half, 0],
        [0.025, half * 2, -half, 0],
      ]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.025, d), zoneMat);
        bar.geometry.userData.ownedByDevice = true;
        bar.position.set(x, y, z);
        ring.add(bar);
      }
    }
    g.add(ring);

    // 両脇の柱と札（文字は Canvas で描く）
    for (const sx2 of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.75, 0.05), this.mats.paint);
      post.geometry.userData.ownedByDevice = true;
      post.position.set(sx2 * (half + 0.03), 0.375, -half);
      g.add(post);
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.2), this.goalMats.sign);
    sign.geometry.userData.ownedByDevice = true;
    sign.position.set(0, 0.68, -half);
    const signBack = sign.clone();
    signBack.rotation.y = Math.PI;
    signBack.position.z -= 0.001;
    g.add(sign, signBack);

    g.add(this.pick(getDeviceDef('goal').size, 0));
    shadows(g);
    return g;
  }

  createPlatform(device: PlacedDevice): THREE.Group {
    const g = new THREE.Group();
    g.position.set(...device.position);
    g.rotation.y = (device.rotationYDeg * Math.PI) / 180;
    const [sx, , sz] = getDeviceDef('platform').size;
    const h = platformHeight(device);
    const body = new THREE.Mesh(new RoundedBoxGeometry(sx, h, sz, 2, 0.02), this.mats.dark);
    body.geometry.userData.ownedByDevice = true;
    body.position.y = h / 2;
    const topMat = new THREE.MeshStandardMaterial({ color: 0x3a4049, roughness: 0.8, metalness: 0.3 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(sx - 0.16, 0.012, sz - 0.16), topMat);
    top.geometry.userData.ownedByDevice = true;
    top.position.y = h + 0.006;
    g.add(body, top);
    // 上面の縁の注意帯
    const tex = this.hazard.clone();
    tex.needsUpdate = true;
    tex.repeat.set(sx * 4, 1);
    const stripeMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    for (const [w, d, x, z] of [
      [sx, 0.08, 0, sz / 2 - 0.04],
      [sx, 0.08, 0, -sz / 2 + 0.04],
      [0.08, sz - 0.16, sx / 2 - 0.04, 0],
      [0.08, sz - 0.16, -sx / 2 + 0.04, 0],
    ]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.014, d), stripeMat);
      m.geometry.userData.ownedByDevice = true;
      m.position.set(x, h + 0.007, z);
      g.add(m);
    }
    g.add(this.pick([sx, h, sz], 0));
    shadows(g);
    return g;
  }

  /** 球が入った直後に枠を明るくする（strength 0..1） */
  setGoalFlash(group: THREE.Group, strength: number): void {
    const zone = group.getObjectByName('goal_zone');
    zone?.traverse((o) => {
      if (o instanceof THREE.Mesh) (o.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6 + 2.4 * strength;
    });
  }

  private pick(size: number[], y: number): THREE.Mesh {
    const geo = new THREE.BoxGeometry(size[0] + 0.05, size[1], size[2] + 0.05);
    geo.userData.ownedByDevice = true;
    const pick = new THREE.Mesh(geo, this.mats.pick);
    pick.position.y = y + size[1] / 2;
    pick.name = 'pick_proxy';
    return pick;
  }
}

function shadows(g: THREE.Group): void {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name !== 'pick_proxy') {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
}

function makeSignTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ff7a1a';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#14171b';
  g.font = 'bold 40px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('GOAL', 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeHazardTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 16;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1b1e22';
  g.fillRect(0, 0, 64, 16);
  g.fillStyle = '#ff7a1a';
  for (let x = -16; x < 64; x += 16) {
    g.beginPath();
    g.moveTo(x, 16);
    g.lineTo(x + 8, 0);
    g.lineTo(x + 16, 0);
    g.lineTo(x + 8, 16);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
