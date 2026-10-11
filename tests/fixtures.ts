import type { SliceLayout } from '../src/sim/layout';

/**
 * テスト用の配置：床置きの発射機1台と、0.2m ずつ下る3本のレール（バネなし）。
 * 画面の最初の配置（VERTICAL_SLICE_LAYOUT）は見せ方で変わるので、テストはこちらを基準にする。
 */
export const FLOOR_CHAIN: SliceLayout = {
  seed: 404,
  devices: [
    { id: 'launcher_1', type: 'launcher', position: [0, 0, -3.65], rotationYDeg: 0 },
    { id: 'rail_1', type: 'rail', position: [0, 0.4, -2], rotationYDeg: 0 },
    { id: 'rail_2', type: 'rail', position: [0, 0.2, 0], rotationYDeg: 0 },
    { id: 'rail_3', type: 'rail', position: [0, 0.0, 2], rotationYDeg: 0 },
  ],
};
