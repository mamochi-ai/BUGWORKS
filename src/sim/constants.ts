import verificationConfig from '../../spec/master/reference/BUGWORKS_perpetual_spec/verification.config.v0.1.json';

/**
 * 物理演算の固定刻み。マスター仕様 §6 に従い 120Hz に統一する。
 * 値の出典は検証設定JSON（fixedDeltaSeconds）。装置JSONの physicsStep=1/60 は旧値として使わない。
 */
export const PHYSICS_DT: number = verificationConfig.simulation.fixedDeltaSeconds;
export const PHYSICS_HZ = Math.round(1 / PHYSICS_DT);

/** 1描画フレームで実行する物理ステップの上限（タブ復帰時などの「死のスパイラル」防止）。仮値。 */
export const MAX_STEPS_PER_FRAME = 16;

/** 1フレームとして受け付ける実時間の上限（秒）。これを超えた分は捨てる。仮値。 */
export const MAX_FRAME_SECONDS = 0.25;

/** 物理プロファイル識別子（設計図JSONの physicsProfile 用）。縦切り試作専用の暫定値。 */
export const PHYSICS_PROFILE = 'proto-vslice-120hz-0';
export const ENGINE_VERSION = '0.0.1-vslice';

export const GRAVITY = { x: 0, y: -9.81, z: 0 };
