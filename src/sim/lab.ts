import layoutJson from '../../spec/master/reference/shiyou_architecture_spec/architecture.example-layout.json';
import modulesJson from '../../spec/master/reference/shiyou_architecture_spec/architecture.modules.v0.1.json';
import type { Vec3 } from './catalog';

export interface LabBox {
  id: string;
  moduleId: string;
  /** 中心座標 */
  center: Vec3;
  size: Vec3;
  rotationYDeg: number;
  kind: 'floor' | 'wall' | 'curb';
}

const moduleSize = new Map(modulesJson.modules.map((m) => [m.id, m.sizeM as Vec3]));

/**
 * 研究所の簡易床。architecture.example-layout.json の地上階（y≈0）の床モジュール 3×3 と
 * 北・西の壁だけを箱で再現する。2階床・階段は縦切り範囲外。画像シートは使わない。
 */
export function buildLabBoxes(): LabBox[] {
  const boxes: LabBox[] = [];
  for (const el of layoutJson.elements) {
    const size = moduleSize.get(el.moduleId);
    if (!size) continue;
    const isGroundFloor = el.moduleId.startsWith('floor_') && Math.abs(el.position[1] - -0.125) < 1e-6;
    const isWall = el.moduleId.startsWith('wall_');
    if (!isGroundFloor && !isWall) continue;
    boxes.push({
      id: el.id,
      moduleId: el.moduleId,
      center: el.position as Vec3,
      size,
      rotationYDeg: el.rotationYDeg,
      kind: isWall ? 'wall' : 'floor',
    });
  }
  // 試作専用：床の南・東の縁に低い縁石を置き、鉄球が床外へ落ち続けないようにする（仕様外, DECISIONS.md D-08）
  const curbH = 0.3;
  const curbT = 0.2;
  boxes.push(
    { id: 'curb_s', moduleId: 'proto_curb', center: [0, curbH / 2, 6 - curbT / 2], size: [12, curbH, curbT], rotationYDeg: 0, kind: 'curb' },
    { id: 'curb_e', moduleId: 'proto_curb', center: [6 - curbT / 2, curbH / 2, 0], size: [12, curbH, curbT], rotationYDeg: 90, kind: 'curb' },
  );
  return boxes;
}
