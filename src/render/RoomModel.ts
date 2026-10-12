import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * 研究所の部屋のモデル（industrial_room_12x12_static.glb, DECISIONS.md D-36）。見た目だけで、当たり判定は持たない。
 * - モデルは Z 軸が上で作られているので、Y 軸が上になるよう −90°回す（モデルの −Y 側＝扉のある壁が、ゲームの +Z 側に来る）
 * - 床の模様の出っ張り（最大 0.041m）で球が沈んで見えないよう、少し下げる
 * - 天井近くの梁・ダクト・照明は、上から見下ろすと盤面を隠すので使わない
 * - 7,500 個ほどに分かれた部品を「部位（床・壁4面・柱）× 材質」ごとに1つにまとめ、描く回数を減らす
 * - カメラ側の壁は、カメラが壁の外にいる間だけ隠す（盤面が見えるように）
 */
export const ROOM = {
  url: 'models/industrial_room_12x12.glb',
  /** 見た目を下げる量（m）。床の板の上面がほぼ物理の床（0）にそろう */
  sink: 0.03,
  /** 壁を隠し始める、壁の内側の面からの距離（カメラの位置） */
  wallHideMargin: 0.2,
  wallInner: 5.8,
} as const;

/**
 * モデルの場所。ふつうはページと同じ所の models/ にある glb。
 * glb を置けない配信先（確認用のページなど）では、ページ側で data: URL を window.BUGWORKS_ROOM_URL に入れておく。
 */
export function roomUrl(): string {
  const override = (globalThis as { BUGWORKS_ROOM_URL?: unknown }).BUGWORKS_ROOM_URL;
  if (typeof override === 'string' && override.startsWith('data:model/gltf-binary;base64,')) return override;
  return new URL(ROOM.url, document.baseURI).href;
}

export type RoomPart = 'floor' | 'wallFront' | 'wallBack' | 'wallLeft' | 'wallRight' | 'column' | 'ceiling' | 'other';
/** 四隅の柱は、隣の壁と一緒に隠すため隅ごとに分ける（x の向き・z の向き） */
type ColumnKey = 'column+x+z' | 'column+x-z' | 'column-x+z' | 'column-x-z';
type PartKey = Exclude<RoomPart, 'column'> | ColumnKey;

/** 部品の名前から部位を決める（名前の先頭の語で判断） */
export function roomPartOf(name: string): RoomPart {
  const head = name.split('_')[0];
  if (head === 'Floor') return 'floor';
  if (head === 'FrontWall' || head === 'FrontDoor') return 'wallFront';
  if (head === 'BackWall') return 'wallBack';
  if (head === 'LeftWall') return 'wallLeft';
  if (head === 'RightWall') return 'wallRight';
  if (head === 'Column' || head === 'Base') return 'column';
  if (/^(Beam|Duct|Lamp)/.test(head)) return 'ceiling';
  return 'other';
}

export interface PreparedRoom {
  root: THREE.Group;
  /** 部位ごとのまとめたメッシュ（壁と隅の柱はカメラに合わせて隠す） */
  parts: Map<PartKey, THREE.Object3D>;
  /** まとめる前の部品数 → まとめた後のメッシュ数 */
  stats: { source: number; merged: number };
}

/** 読み込んだモデルのシーンを、ゲームで使う形にまとめる（テストでは作ったシーンでも呼べる） */
export function prepareRoom(scene: THREE.Object3D): PreparedRoom {
  // Z 上 → Y 上。外側の箱で回してから、部品のワールド座標で頂点を焼き込む
  const holder = new THREE.Group();
  holder.rotation.x = -Math.PI / 2;
  holder.position.y = -ROOM.sink;
  holder.add(scene);
  holder.updateMatrixWorld(true);

  const buckets = new Map<string, { part: PartKey; material: THREE.Material; geos: THREE.BufferGeometry[] }>();
  let source = 0;
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    source++;
    const kind = roomPartOf(o.name || o.parent?.name || '');
    if (kind === 'ceiling') return;
    const material = Array.isArray(o.material) ? o.material[0] : (o.material as THREE.Material);
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    let part: PartKey;
    if (kind === 'column') {
      geo.computeBoundingBox();
      const c = geo.boundingBox!.getCenter(new THREE.Vector3());
      part = `column${c.x >= 0 ? '+x' : '-x'}${c.z >= 0 ? '+z' : '-z'}` as ColumnKey;
    } else {
      part = kind;
    }
    // まとめるには属性の組み合わせがそろっている必要がある
    const attrs = Object.keys(geo.attributes).sort().join(',');
    const key = `${part}|${material.uuid}|${attrs}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { part, material, geos: [] }));
    b.geos.push(geo);
  });

  const root = new THREE.Group();
  root.name = 'room_model';
  const parts = new Map<PartKey, THREE.Object3D>();
  let merged = 0;
  for (const b of buckets.values()) {
    const geo = mergeGeometries(b.geos);
    for (const g of b.geos) g.dispose();
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, b.material);
    mesh.receiveShadow = true;
    mesh.castShadow = b.part.startsWith('column');
    mesh.name = `room_${b.part}`;
    let group = parts.get(b.part);
    if (!group) {
      group = new THREE.Group();
      group.name = `room_${b.part}`;
      parts.set(b.part, group);
      root.add(group);
    }
    group.add(mesh);
    merged++;
  }
  return { root, parts, stats: { source, merged } };
}

/** カメラが壁の外側にいる間、その壁を隠す（家の模型の手前の壁を外すように） */
export function updateWallVisibility(parts: ReadonlyMap<PartKey, THREE.Object3D>, camera: THREE.Vector3): void {
  const edge = ROOM.wallInner - ROOM.wallHideMargin;
  const hide = { '+z': camera.z > edge, '-z': camera.z < -edge, '+x': camera.x > edge, '-x': camera.x < -edge };
  const set = (p: PartKey, hidden: boolean) => {
    const o = parts.get(p);
    if (o) o.visible = !hidden;
  };
  set('wallFront', hide['+z']);
  set('wallBack', hide['-z']);
  set('wallRight', hide['+x']);
  set('wallLeft', hide['-x']);
  // 隅の柱は、隣り合う壁のどちらかを隠したら一緒に隠す
  for (const x of ['+x', '-x'] as const) for (const z of ['+z', '-z'] as const) set(`column${x}${z}`, hide[x] || hide[z]);
}

export type { PartKey };
