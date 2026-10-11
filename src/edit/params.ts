import type { DeviceType, PlacedDevice } from '../sim/layout';
import { launcherParams } from '../sim/launcher';
import { springParams } from '../sim/spring';

/**
 * 画面で変えられる装置の設定（範囲と刻みは試作値, DECISIONS.md D-22）。
 * 入力はこの範囲・刻みに丸めてから保存する（設計図JSONの読み込み時の検査にも使う予定）。
 */
export interface ParamSpec {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}

export const PARAM_SPECS: Record<DeviceType, readonly ParamSpec[]> = {
  rail: [],
  launcher: [
    { key: 'launchSpeed', label: '速さ', unit: 'm/s', min: 2, max: 8, step: 0.5 },
    { key: 'angleDegrees', label: '角度', unit: '°', min: 0, max: 60, step: 15 },
    { key: 'cooldownSeconds', label: '間隔', unit: '秒', min: 0.5, max: 3, step: 0.5 },
  ],
  spring: [
    { key: 'launchSpeed', label: '打ち上げの速さ', unit: 'm/s', min: 2, max: 8, step: 0.5 },
    { key: 'tiltDegrees', label: '天板の傾き', unit: '°', min: 0, max: 30, step: 15 },
  ],
};

export function findSpec(type: DeviceType, key: string): ParamSpec | undefined {
  return PARAM_SPECS[type].find((s) => s.key === key);
}

/** 範囲内に収め、刻みに合わせる */
export function normalizeParam(spec: ParamSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.min;
  const clamped = Math.min(spec.max, Math.max(spec.min, value));
  const snapped = spec.min + Math.round((clamped - spec.min) / spec.step) * spec.step;
  return Math.round(snapped * 1000) / 1000;
}

/** 今の値（未設定なら JSON または既定値） */
export function paramValue(device: PlacedDevice, key: string): number {
  const all: Record<string, number> =
    device.type === 'launcher' ? { ...launcherParams(device) } : device.type === 'spring' ? { ...springParams(device) } : {};
  return all[key] ?? NaN;
}

export function formatParam(spec: ParamSpec, value: number): string {
  const digits = spec.step < 1 ? 1 : 0;
  return `${value.toFixed(digits)}${spec.unit}`;
}
