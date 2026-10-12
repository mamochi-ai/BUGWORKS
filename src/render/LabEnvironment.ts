import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LabBox } from '../sim/lab';
import { PLACEMENT } from '../edit/placement';

/**
 * 研究所の床・壁・背景の見た目（DECISIONS.md D-28）。描画専用で、当たり判定は持たない（物理は lab.ts の箱のまま）。
 * 研究所パーツの画像（shiyou_architecture_parts）は斜めから描いた参考イラストで、仕様JSONでも referenceImageOnly のため
 * 画像は読み込まず、色・形を手本にプリミティブと、コードで描いた模様（canvas）で作る。
 */

const C = {
  floorBase: '#2f343b',
  floorSeam: '#1b1e23',
  floorEdge: '#454b54',
  bolt: '#5a616b',
  wallBase: '#2a2f36',
  wallSeam: '#1a1d22',
  orange: 0xff7a1a,
  orangeDark: 0xb85512,
  metal: 0x4a5059,
  metalLight: 0x6b727c,
  apron: 0x191c20,
} as const;

/** コードで描いた模様をテクスチャにする */
function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** 決まった並びの細かいむら（毎回同じ見た目にする） */
function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, seed: number): void {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const v = rnd() < 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${0.02 + rnd() * 0.035})`;
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 3);
  }
}

/** 床パネル 2m 角（floor_solid の絵：灰色の鋼板、継ぎ目、四隅のボルト） */
function floorTexture(): THREE.CanvasTexture {
  const S = 512;
  return canvasTexture(S, S, (g) => {
    g.fillStyle = C.floorBase;
    g.fillRect(0, 0, S, S);
    speckle(g, S, S, 2600, 7);
    // 縁の面取り（明るい線）と継ぎ目（暗い線）
    g.strokeStyle = C.floorEdge;
    g.lineWidth = 6;
    g.strokeRect(9, 9, S - 18, S - 18);
    g.strokeStyle = C.floorSeam;
    g.lineWidth = 8;
    g.strokeRect(0, 0, S, S);
    // 中央の細い継ぎ目（1m ごと）
    g.strokeStyle = 'rgba(20,22,26,0.55)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(S / 2, 14);
    g.lineTo(S / 2, S - 14);
    g.stroke();
    // 四隅のボルト
    for (const [x, y] of [[28, 28], [S - 28, 28], [28, S - 28], [S - 28, S - 28]]) {
      g.fillStyle = C.floorSeam;
      g.beginPath();
      g.arc(x, y + 1.5, 8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = C.bolt;
      g.beginPath();
      g.arc(x, y, 7, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** 注意帯（floor_hazard の絵：オレンジと黒の斜めじま） */
function hazardTexture(): THREE.CanvasTexture {
  const W = 128;
  const H = 32;
  return canvasTexture(W, H, (g) => {
    g.fillStyle = '#16181b';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#e8711c';
    for (let x = -H; x < W + H; x += 32) {
      g.beginPath();
      g.moveTo(x, H);
      g.lineTo(x + 16, H);
      g.lineTo(x + 16 + H, 0);
      g.lineTo(x + H, 0);
      g.closePath();
      g.fill();
    }
  });
}

/** 壁パネル 4m×3.5m（wall_solid の絵：縦の継ぎ目、腰の高さの横の継ぎ目、リベット） */
function wallTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 448; // 4m : 3.5m
  return canvasTexture(W, H, (g) => {
    g.fillStyle = C.wallBase;
    g.fillRect(0, 0, W, H);
    speckle(g, W, H, 1800, 11);
    const y = (m: number) => H - (m / 3.5) * H;
    g.strokeStyle = C.wallSeam;
    g.lineWidth = 4;
    for (const m of [1.1, 2.7]) {
      g.beginPath();
      g.moveTo(0, y(m));
      g.lineTo(W, y(m));
      g.stroke();
    }
    for (const x of [0, W / 2, W]) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
    }
    g.fillStyle = '#3c424b';
    for (const m of [1.1, 2.7])
      for (let x = 24; x < W; x += 64) {
        g.beginPath();
        g.arc(x, y(m) - 10, 3, 0, Math.PI * 2);
        g.fill();
      }
  });
}

export interface LabEnvironment {
  root: THREE.Group;
  /** 床の箱・壁の箱に使う材質（当たり判定の箱の見た目） */
  materials: { floor: THREE.Material; wall: THREE.Material; curb: THREE.Material };
}

/**
 * 床の模様・置ける範囲の注意帯・壁の飾り（腰板・照明の帯・柱・梁・配管・制御盤）・手すり・
 * 床の外の小物（木箱・制御盤・植木・照明柱）を作る。
 */
export function buildLabEnvironment(boxes: readonly LabBox[]): LabEnvironment {
  const root = new THREE.Group();
  root.name = 'lab_environment';
  const std = (color: number, roughness = 0.75, metalness = 0.35, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  const m = {
    metal: std(C.metal, 0.6, 0.55),
    metalLight: std(C.metalLight, 0.45, 0.7),
    orange: std(C.orange, 0.55, 0.3),
    orangeDark: std(C.orangeDark, 0.6, 0.3),
    lamp: std(0xfff1d6, 0.4, 0, { emissive: 0xffd9a0, emissiveIntensity: 1.2 }),
    screen: std(0x0b2530, 0.3, 0.1, { emissive: 0x2a9fd0, emissiveIntensity: 0.9 }),
    dark: std(0x202328, 0.8, 0.3),
    apron: std(C.apron, 0.95, 0.1),
    leaf: std(0x3f7a3a, 0.8, 0),
  };
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0, shadow = false) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };
  const box = (sx: number, sy: number, sz: number) => new THREE.BoxGeometry(sx, sy, sz);

  // ---- 床：2m 角の鋼板の模様。4m の床モジュールの箱に直接貼る（重ね描きを増やさない）
  const floorMap = floorTexture();
  floorMap.repeat.set(2, 2);

  // ---- 装置を置ける範囲のふち：注意帯（ステージでも自由研究でも同じ範囲）
  const hz = hazardTexture();
  const edge = PLACEMENT.bounds.max;
  const band = 0.16;
  for (const [cx, cz, len, ry] of [
    [0, -edge - band / 2, edge * 2 + band * 2, 0],
    [0, edge + band / 2, edge * 2 + band * 2, 0],
    [-edge - band / 2, 0, edge * 2, Math.PI / 2],
    [edge + band / 2, 0, edge * 2, Math.PI / 2],
  ] as const) {
    const t = hz.clone();
    t.needsUpdate = true;
    t.repeat.set(len / (band * 4), 1);
    const strip = add(new THREE.PlaneGeometry(len, band), std(0xffffff, 0.7, 0.2, { map: t }), cx, 0.003, cz);
    strip.rotation.set(-Math.PI / 2, 0, ry);
  }

  // ---- 床の外の暗い土間（床の端が宙に浮いて見えないように。見た目だけ。床の下には描かない）
  for (const [x, z, sx, sz] of [[0, -13, 40, 14], [0, 13, 40, 14], [-13, 0, 14, 12], [13, 0, 14, 12]] as const) {
    const a = add(new THREE.PlaneGeometry(sx, sz), m.apron, x, -0.26, z);
    a.rotation.x = -Math.PI / 2;
  }

  // ---- 壁：腰板（オレンジの縁）・照明の帯・柱・梁
  const walls = boxes.filter((b) => b.kind === 'wall');
  for (const w of walls) {
    const ry = (w.rotationYDeg * Math.PI) / 180;
    // 部屋の内側（原点側）へ向く法線
    const inward = new THREE.Vector3(Math.abs(Math.sin(ry)) > 0.5 ? -Math.sign(w.center[0]) : 0, 0, Math.abs(Math.cos(ry)) > 0.5 ? -Math.sign(w.center[2]) : 0);
    const face = w.size[2] / 2 + 0.02;
    const at = (along: number, y: number, out: number) => {
      const dir = new THREE.Vector3(Math.cos(ry), 0, -Math.sin(ry));
      return new THREE.Vector3(w.center[0], y, w.center[2]).addScaledVector(dir, along).addScaledVector(inward, face + out);
    };
    let p = at(0, 0.2, 0.02);
    add(box(w.size[0], 0.4, 0.04), m.dark, p.x, p.y, p.z, ry);
    p = at(0, 0.42, 0.04);
    add(box(w.size[0], 0.05, 0.03), m.orange, p.x, p.y, p.z, ry);
    if (w.moduleId !== 'wall_window') {
      p = at(0, 2.95, 0.03);
      add(box(w.size[0] * 0.8, 0.07, 0.04), m.lamp, p.x, p.y, p.z, ry);
    }
  }
  // 柱（4m ごと）と壁の上の梁：北の壁（z=-6）と西の壁（x=-6）
  const colGeo = box(0.4, 3.5, 0.4);
  const colBase = box(0.52, 0.22, 0.52);
  const sconce = box(0.16, 0.36, 0.08);
  const column = (x: number, z: number) => {
    add(colGeo, m.metal, x, 1.75, z, 0, true);
    add(colBase, m.orangeDark, x, 0.11, z);
    // 柱の照明（architecture_part の柱の絵：縦長の灯り）
    const sx = x === -6 ? x + 0.24 : x;
    const sz = x === -6 ? z : z + 0.24;
    add(sconce, m.lamp, sx, 2.3, sz, x === -6 ? Math.PI / 2 : 0);
  };
  for (const x of [-6, -2, 2, 6]) column(x, -6);
  for (const z of [-2, 2, 6]) column(-6, z);
  add(box(12.4, 0.4, 0.4), m.metal, 0, 3.7, -6);
  add(box(0.4, 0.4, 12.4), m.metal, -6, 3.7, 0);

  // ---- 北の壁の配管（2本、支持金具つき）と、床へ下りる縦管・オレンジのバルブ
  const pipeMat = m.metalLight;
  for (const [y, r] of [[3.05, 0.07], [3.25, 0.05]] as const) {
    const pipe = add(new THREE.CylinderGeometry(r, r, 11.4, 14), pipeMat, 0, y, -5.72);
    pipe.rotation.z = Math.PI / 2;
  }
  for (let x = -5; x <= 5; x += 2) add(box(0.08, 0.36, 0.2), m.dark, x, 3.12, -5.78);
  add(new THREE.CylinderGeometry(0.07, 0.07, 3.0, 14), pipeMat, 4.6, 1.55, -5.72);
  add(new THREE.TorusGeometry(0.1, 0.03, 8, 16), m.orange, 4.6, 1.1, -5.6);
  add(box(0.24, 0.08, 0.24), m.orangeDark, 4.6, 0.04, -5.72);

  // ---- 西の壁の制御盤（青く光る画面）
  const panelZ = 0;
  add(box(0.14, 1.3, 2.0), m.dark, -5.82, 1.45, panelZ);
  add(box(0.03, 0.55, 0.8), m.screen, -5.74, 1.65, panelZ - 0.48);
  add(box(0.03, 0.55, 0.8), m.screen, -5.74, 1.65, panelZ + 0.48);
  add(box(0.05, 0.08, 1.8), m.orange, -5.74, 0.86, panelZ);

  // ---- 南と東の縁石の上の手すり（オレンジの上桟）。細い部材だけで視界をさえぎらない
  const post = box(0.05, 0.8, 0.05);
  const posts = new THREE.InstancedMesh(post, m.metal, 26);
  const tmp = new THREE.Object3D();
  let n = 0;
  for (let i = -6; i <= 6; i += 1) {
    tmp.position.set(i, 0.7, 5.95);
    tmp.updateMatrix();
    posts.setMatrixAt(n++, tmp.matrix);
    if (i < 6) {
      tmp.position.set(5.95, 0.7, i);
      tmp.updateMatrix();
      posts.setMatrixAt(n++, tmp.matrix);
    }
  }
  posts.count = n;
  root.add(posts);
  add(box(12, 0.06, 0.06), m.orange, 0, 1.1, 5.95);
  add(box(0.06, 0.06, 12), m.orange, 5.95, 1.1, 0);
  add(box(12, 0.03, 0.03), m.metal, 0, 0.72, 5.95);
  add(box(0.03, 0.03, 12), m.metal, 5.95, 0.72, 0);

  // ---- 床の外の小物（木箱・制御盤・植木・照明柱）。装置を置く範囲には何も置かない
  const crate = (x: number, z: number, s: [number, number, number], ry: number) => {
    const y = s[1] / 2 - 0.25;
    add(box(...s), m.metal, x, y, z, ry, true);
    add(box(s[0] + 0.02, 0.08, s[2] + 0.02), m.orangeDark, x, y + s[1] * 0.25, z, ry);
    add(box(s[0] + 0.02, 0.08, s[2] + 0.02), m.orangeDark, x, y - s[1] * 0.25, z, ry);
  };
  crate(7.6, -3.4, [1.2, 0.9, 1.0], 0.15);
  crate(7.4, -2.1, [0.8, 0.6, 0.8], -0.2);
  crate(7.9, -2.6, [0.7, 0.5, 0.7], 0.5);
  crate(-3.2, 7.6, [1.4, 0.8, 0.9], -0.1);
  crate(-1.8, 7.8, [0.8, 0.8, 0.8], 0.3);
  // 制御盤のキャビネット
  add(box(0.7, 1.8, 0.6), m.dark, 7.4, 0.65, 1.6, -Math.PI / 2, true);
  add(box(0.03, 0.5, 0.45), m.screen, 7.04, 1.05, 1.6);
  add(box(0.03, 0.06, 0.5), m.orange, 7.04, 0.6, 1.6);
  // 植木
  for (const [x, z] of [[7.3, 7.0], [6.9, 7.6]] as const) {
    add(new THREE.CylinderGeometry(0.22, 0.18, 0.45, 12), m.orangeDark, x, -0.03, z);
    const leaves = add(new THREE.IcosahedronGeometry(0.38, 0), m.leaf, x, 0.45, z, 0, true);
    leaves.scale.set(1, 1.25, 1);
  }
  // 照明柱（灯りの部分が光る）
  for (const [x, z] of [[7.2, -5.6], [-5.6, 7.2]] as const) {
    add(new THREE.CylinderGeometry(0.06, 0.08, 2.2, 10), m.metal, x, 0.85, z);
    add(new THREE.CylinderGeometry(0.11, 0.11, 0.5, 12), m.lamp, x, 2.15, z);
    add(box(0.32, 0.1, 0.32), m.orangeDark, x, -0.2, z);
  }

  // 当たり判定の箱の見た目：床は鋼板の模様、壁は継ぎ目つき
  const wallMap = wallTexture();
  return {
    root: mergeByMaterial(root),
    materials: {
      floor: std(0xffffff, 0.82, 0.35, { map: floorMap }),
      wall: std(0xffffff, 0.85, 0.25, { map: wallMap }),
      curb: std(0x3a3f47, 0.7, 0.4),
    },
  };
}

/**
 * 動かない飾りを材質ごとに1つのメッシュへまとめる（描画の呼び出し回数を減らす。iPad の負荷対策）。
 * 影を落とすものは分けておく。手すりの柱（InstancedMesh）はそのまま残す。
 */
function mergeByMaterial(src: THREE.Group): THREE.Group {
  const out = new THREE.Group();
  out.name = src.name;
  src.updateMatrixWorld(true);
  const groups = new Map<string, { mat: THREE.Material; shadow: boolean; geos: THREE.BufferGeometry[] }>();
  for (const child of [...src.children]) {
    if (!(child instanceof THREE.Mesh) || child instanceof THREE.InstancedMesh) {
      out.add(child);
      continue;
    }
    const mat = child.material as THREE.Material;
    const key = `${mat.uuid}:${child.castShadow}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { mat, shadow: child.castShadow, geos: [] }));
    // 属性をそろえてからまとめる（index の有無・uv の有無が混ざるとまとめられない）
    const geo = (child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone()).applyMatrix4(child.matrixWorld);
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
    g.geos.push(geo);
  }
  for (const g of groups.values()) {
    const merged = new THREE.Mesh(mergeGeometries(g.geos), g.mat);
    merged.castShadow = g.shadow;
    merged.receiveShadow = true;
    out.add(merged);
    for (const geo of g.geos) geo.dispose();
  }
  return out;
}
