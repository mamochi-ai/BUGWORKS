import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Vec3 } from '../sim/catalog';
import type { RailTrack } from '../sim/railGeometry';
import { quatFromYawPitch } from '../sim/Simulation';
import { PALETTE } from './palette';
import { railVisualProfile } from './railVisualProfile';
import type { PlacedDevice } from '../sim/layout';
import { curveShape, shapeBounds, shapeFrame, type CurveFrame } from '../sim/curveGeometry';
import { LOOP, loopBounds, loopFrame, loopRadius } from '../sim/loopGeometry';

/**
 * レールの見た目（試作）。デザイン画 rail_straight_long / rail_connector / rail_support_low を参考に、
 * 鋼管4本＋両端のオレンジ金具＋支柱をプリミティブから組む。画像は読み込まない。
 * 当たり判定は Simulation 側の箱形状のままで、この形状は描画専用。
 */
export interface RailMaterials {
  steel: THREE.MeshStandardMaterial;
  paint: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  bolt: THREE.MeshStandardMaterial;
  bearing: THREE.MeshStandardMaterial;
  /** タッチ用の当たり判定（描画しない） */
  pick: THREE.MeshBasicMaterial;
}

/** 装置で共有する材質（レールと発射機で同じ塗装・鋼材を使う） */
export function createDeviceMaterials(): RailMaterials {
  const wear = makeWearTexture();
  return {
    steel: new THREE.MeshStandardMaterial({ color: PALETTE.railSteel, metalness: 0.95, roughness: 0.32 }),
    paint: new THREE.MeshStandardMaterial({
      color: PALETTE.railWall,
      metalness: 0.25,
      roughness: 0.55,
      roughnessMap: wear,
      map: wear,
    }),
    dark: new THREE.MeshStandardMaterial({ color: PALETTE.railLeg, metalness: 0.7, roughness: 0.5 }),
    bolt: new THREE.MeshStandardMaterial({ color: 0x9aa1aa, metalness: 0.9, roughness: 0.35 }),
    bearing: new THREE.MeshStandardMaterial({ color: 0x2a2e33, metalness: 0.8, roughness: 0.4 }),
    pick: new THREE.MeshBasicMaterial({ visible: false }),
  };
}

export class RailModelFactory {
  private readonly profile = railVisualProfile();
  private readonly geo: {
    cheek: THREE.BufferGeometry;
    crossbar: THREE.BufferGeometry;
    bolt: THREE.BufferGeometry;
    bearing: THREE.BufferGeometry;
    bearingRing: THREE.BufferGeometry;
    legPost: THREE.BufferGeometry;
    legFoot: THREE.BufferGeometry;
    legClamp: THREE.BufferGeometry;
  };

  constructor(private readonly mats: RailMaterials) {
    const c = this.profile.collar;
    this.geo = {
      cheek: new RoundedBoxGeometry(c.cheekWidth, c.height, c.length, 3, 0.012),
      crossbar: new RoundedBoxGeometry(c.cheekX * 2, 0.035, c.length * 0.7, 2, 0.008),
      bolt: new THREE.CylinderGeometry(0.011, 0.011, 0.008, 6).rotateZ(Math.PI / 2),
      bearing: new THREE.CylinderGeometry(0.03, 0.03, 0.012, 20).rotateZ(Math.PI / 2),
      bearingRing: new THREE.TorusGeometry(0.03, 0.006, 8, 20).rotateY(Math.PI / 2),
      legPost: new THREE.BoxGeometry(0.05, 1, 0.05),
      legFoot: new RoundedBoxGeometry(0.16, 0.025, 0.16, 2, 0.006),
      legClamp: new RoundedBoxGeometry(0.1, 0.05, 0.08, 2, 0.008),
    };
  }

  /** 1本分のレール（走行面中央を原点、ローカル Z 方向に長さ length） */
  createRail(track: RailTrack): THREE.Group {
    const p = this.profile;
    const group = new THREE.Group();
    group.name = track.deviceId;
    group.position.set(...midpoint(track.start, track.end));
    const q = quatFromYawPitch(track.yawRad, track.pitch);
    group.quaternion.set(q.x, q.y, q.z, q.w);

    const tube = new THREE.CylinderGeometry(1, 1, track.length, 16).rotateX(Math.PI / 2);
    tube.userData.ownedByDevice = true; // レール削除時に破棄する（他は共有ジオメトリ）
    for (const side of [-1, 1]) {
      group.add(this.mesh(tube, this.mats.steel, [side * p.carrier.x, p.carrier.y, 0], p.carrier.radius));
      group.add(this.mesh(tube, this.mats.steel, [side * p.guard.x, p.guard.y, 0], p.guard.radius));
    }
    for (const end of [-1, 1]) {
      group.add(this.createCollar(end * (track.length / 2 - p.collar.length / 2)));
    }
    // タッチ用の当たり判定（描画しない）。鋼管の隙間を指が素通りしないよう、外形より少し大きい箱
    const pick = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, track.length), this.mats.pick);
    pick.geometry.userData.ownedByDevice = true;
    pick.position.y = 0.07;
    pick.name = 'pick_proxy';
    group.add(pick);
    return group;
  }

  /** カーブレール（装置ローカルで作り、装置の位置・回転のグループに入れる） */
  createCurve(device: PlacedDevice): THREE.Group {
    const shape = curveShape(device);
    const b = shapeBounds(shape);
    return this.createPath(device, (t) => shapeFrame(shape, t), shape.segments, [0, 0.5, 1], { ...b, minY: 0, maxY: 0.5 });
  }

  /** ループ（縦に1周する走行路）。金具は入口・出口と、4分の1周ごと */
  createLoop(device: PlacedDevice): THREE.Group {
    const radius = loopRadius(device);
    const b = loopBounds(radius);
    return this.createPath(device, (t) => loopFrame(radius, t), LOOP.segments, [0, 0.25, 0.5, 0.75, 1], { ...b, minY: 0, maxY: b.height });
  }

  /** 曲がった走行路の見た目：断面 frame(t) に沿って鋼管を通し、金具を付ける */
  private createPath(
    device: PlacedDevice,
    frame: (t: number) => CurveFrame,
    segments: number,
    collarAt: number[],
    bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
  ): THREE.Group {
    const p = this.profile;
    const group = new THREE.Group();
    group.name = device.id;
    group.position.set(...device.position);
    group.rotation.y = (device.rotationYDeg * Math.PI) / 180;

    // 鋼管：各断面で、横 s・高さ h だけずらした点をつないだ曲線
    const offsetCurve = (s: number, h: number) =>
      new THREE.CatmullRomCurve3(
        Array.from({ length: segments + 1 }, (_, i) => {
          const f = frame(i / segments);
          return new THREE.Vector3(...f.pos.map((v, k) => v + f.side[k] * s + f.normal[k] * h));
        }),
      );
    for (const side of [-1, 1]) {
      for (const [x, y, r] of [
        [p.carrier.x, p.carrier.y, p.carrier.radius],
        [p.guard.x, p.guard.y, p.guard.radius],
      ]) {
        const geo = new THREE.TubeGeometry(offsetCurve(side * x, y), segments * 2, r, 12, false);
        geo.userData.ownedByDevice = true;
        const m = new THREE.Mesh(geo, this.mats.steel);
        m.castShadow = true;
        m.receiveShadow = true;
        group.add(m);
      }
    }
    // 金具（走行路の向きと、上下の向き〔ループの上では逆さ〕に合わせる）
    for (const t of collarAt) {
      const f = frame(t);
      const along = t === 0 ? p.collar.length / 2 : t === 1 ? -p.collar.length / 2 : 0;
      const collar = this.createCollar(0);
      const at = f.pos.map((v, k) => v + f.tangent[k] * along + f.normal[k] * p.collar.centerY);
      collar.position.set(at[0], at[1], at[2]);
      collar.up.set(...f.normal);
      collar.lookAt(collar.position.clone().add(new THREE.Vector3(...f.tangent)));
      group.add(collar);
    }
    // タッチ用の当たり判定（外形の箱）
    const pickGeo = new THREE.BoxGeometry(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ);
    pickGeo.userData.ownedByDevice = true;
    const pick = new THREE.Mesh(pickGeo, this.mats.pick);
    pick.position.set((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, (bounds.minZ + bounds.maxZ) / 2);
    pick.name = 'pick_proxy';
    group.add(pick);
    return group;
  }

  /**
   * ポート位置の支柱。隣り合うレールの継ぎ目で重複しないよう、呼び出し側で位置を重複排除する。
   * @param port 走行面上のポート座標（ワールド）
   */
  createSupport(port: Vec3): THREE.Group | null {
    const c = this.profile.collar;
    const top = port[1] + c.centerY - c.height / 2;
    if (top <= 0.05) return null;
    const g = new THREE.Group();
    g.name = 'rail_support';
    g.position.set(port[0], 0, port[2]);
    const post = new THREE.Mesh(this.geo.legPost, this.mats.dark);
    post.scale.y = top;
    post.position.y = top / 2;
    const foot = new THREE.Mesh(this.geo.legFoot, this.mats.paint);
    foot.position.y = 0.0125;
    const clamp = new THREE.Mesh(this.geo.legClamp, this.mats.paint);
    clamp.position.y = top - 0.025;
    for (const m of [post, foot, clamp]) {
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    return g;
  }

  private createCollar(z: number): THREE.Group {
    const c = this.profile.collar;
    const g = new THREE.Group();
    g.position.set(0, c.centerY, z);
    for (const side of [-1, 1]) {
      const cheek = new THREE.Mesh(this.geo.cheek, this.mats.paint);
      cheek.position.x = side * c.cheekX;
      g.add(cheek);

      // 外側の面：中央にベアリング、四隅にボルト（デザイン画の丸い軸受けと六角ボルト）
      const faceX = side * (c.cheekX + c.cheekWidth / 2 + 0.004);
      const bearing = new THREE.Mesh(this.geo.bearing, this.mats.bearing);
      bearing.position.set(faceX, -c.height * 0.12, 0);
      const ring = new THREE.Mesh(this.geo.bearingRing, this.mats.bolt);
      ring.position.copy(bearing.position);
      g.add(bearing, ring);
      for (const [dy, dz] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        const bolt = new THREE.Mesh(this.geo.bolt, this.mats.bolt);
        bolt.position.set(faceX, dy * (c.height / 2 - 0.028), dz * (c.length / 2 - 0.026));
        g.add(bolt);
      }
    }
    // 底の連結梁（鉄球の通り道より下）
    const bar = new THREE.Mesh(this.geo.crossbar, this.mats.dark);
    bar.position.y = -c.height / 2 + 0.0175;
    g.add(bar);
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return g;
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, pos: Vec3, radius: number): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.scale.set(radius, radius, 1);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

/** 塗装の使い込み感（細かなムラと擦れ）。Canvasで生成し、画像ファイルは使わない */
function makeWearTexture(): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  // 決まった種の擬似乱数（毎回同じ見た目にする）
  let s = 404;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 260; i++) {
    const v = 228 + Math.floor(rand() * 27);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(rand() * size, rand() * size, 1 + rand() * 3, 1 + rand() * 2);
  }
  for (let i = 0; i < 18; i++) {
    g.strokeStyle = `rgba(190,190,190,${0.2 + rand() * 0.3})`;
    g.lineWidth = 0.5 + rand();
    g.beginPath();
    const x = rand() * size;
    const y = rand() * size;
    g.moveTo(x, y);
    g.lineTo(x + (rand() - 0.5) * 30, y + (rand() - 0.5) * 8);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
