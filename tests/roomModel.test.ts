import { readFileSync, statSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ROOM, prepareRoom, roomPartOf, updateWallVisibility } from '../src/render/RoomModel';

const GLB = 'public/models/industrial_room_12x12.glb';

/** GLB の JSON 部分だけを読む（画像は読まない） */
function glbJson(path: string): { nodes: { name?: string }[]; extensionsUsed?: string[]; images?: { mimeType?: string }[] } {
  const b = readFileSync(path);
  expect(b.toString('ascii', 0, 4)).toBe('glTF');
  const len = b.readUInt32LE(12);
  return JSON.parse(b.toString('utf8', 20, 20 + len));
}

/** Z が上のモデルを真似た小さなシーン */
function fakeRoom(): THREE.Group {
  const g = new THREE.Group();
  const add = (name: string, x: number, y: number, z: number, mat?: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.1), mat ?? new THREE.MeshStandardMaterial());
    m.name = name;
    m.position.set(x, y, z);
    g.add(m);
  };
  const steel = new THREE.MeshStandardMaterial();
  add('Floor_0_0_0', 0, 0, 0, steel);
  add('Floor_0_0_1', 2, 0, 0, steel);
  add('FrontWall_0', 0, -6, 1.4);
  add('FrontDoor_0', 0, -6, 1.4);
  add('BackWall_0', 0, 6, 1.4);
  add('LeftWall_0', -6, 0, 1.4);
  add('RightWall_0', 6, 0, 1.4);
  add('Column_1', 5.8, 5.8, 1.3);
  add('BeamEW_0', 0, 0, 2.6);
  add('Duct_1', 0, 0, 2.5);
  add('LampLens_3', 0, 0, 2.6);
  return g;
}

describe('部屋のモデル（見た目だけ, D-36）', () => {
  it('同梱したモデル：12m×12m の部屋の部位がそろい、画像は WebP で 2MB 未満', () => {
    expect(statSync(GLB).size).toBeLessThan(2_000_000);
    const j = glbJson(GLB);
    const parts = new Set(j.nodes.map((n) => roomPartOf(n.name ?? '')));
    for (const p of ['floor', 'wallFront', 'wallBack', 'wallLeft', 'wallRight', 'column', 'ceiling']) expect(parts.has(p as never)).toBe(true);
    expect(j.extensionsUsed).toContain('EXT_texture_webp');
    expect(j.images?.every((i) => i.mimeType === 'image/webp')).toBe(true);
  });

  it('部品の名前から部位を決める（扉は手前の壁と一緒、梁・ダクト・照明は天井）', () => {
    expect(roomPartOf('Floor_3_2_10')).toBe('floor');
    expect(roomPartOf('FrontDoor_12')).toBe('wallFront');
    expect(roomPartOf('BeamNS_1')).toBe('ceiling');
    expect(roomPartOf('DuctClamp_4')).toBe('ceiling');
    expect(roomPartOf('LampHousing_2')).toBe('ceiling');
    expect(roomPartOf('Base_0')).toBe('column');
  });

  it('Z 上から Y 上へ回し、天井近くの部品は使わず、部位×材質ごとにまとめる', () => {
    const room = prepareRoom(fakeRoom());
    expect(room.stats.source).toBe(11);
    expect(room.parts.has('ceiling' as never)).toBe(false);
    // 床は1つにまとまる（同じ材質）
    expect(room.parts.get('floor')!.children).toHaveLength(1);
    const box = new THREE.Box3().setFromObject(room.root);
    // 高さ（Y）は 0〜3m の範囲（回さなければ Z に伸びる）。手前の壁（モデルの −Y）はゲームの +Z 側
    expect(box.max.y).toBeLessThan(3);
    const front = new THREE.Box3().setFromObject(room.parts.get('wallFront')!);
    expect(front.getCenter(new THREE.Vector3()).z).toBeGreaterThan(5);
    const floor = new THREE.Box3().setFromObject(room.parts.get('floor')!);
    expect(floor.max.y).toBeCloseTo(0.05 - ROOM.sink, 6);
  });

  it('カメラが壁の外にいる間は、その壁を隠す', () => {
    const room = prepareRoom(fakeRoom());
    updateWallVisibility(room.parts, new THREE.Vector3(7, 9, 3));
    expect(room.parts.get('wallRight')!.visible).toBe(false);
    expect(room.parts.get('wallFront')!.visible).toBe(true);
    expect(room.parts.get('wallBack')!.visible).toBe(true);
    // 右の壁の隅の柱（モデルの +X+Y＝ゲームの +x−z）も一緒に隠れる
    expect(room.parts.get('column+x-z')!.visible).toBe(false);
    updateWallVisibility(room.parts, new THREE.Vector3(0, 9, 8));
    expect(room.parts.get('wallRight')!.visible).toBe(true);
    expect(room.parts.get('wallFront')!.visible).toBe(false);
    updateWallVisibility(room.parts, new THREE.Vector3(0, 3, 0));
    for (const p of ['wallFront', 'wallBack', 'wallLeft', 'wallRight'] as const) expect(room.parts.get(p)!.visible).toBe(true);
  });
});
