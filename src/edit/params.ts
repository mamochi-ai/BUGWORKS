import type { DeviceType, PlacedDevice } from '../sim/layout';
import { launcherParams } from '../sim/launcher';
import { springParams } from '../sim/spring';
import { platformHeight } from '../sim/goal';
import { curveTurn } from '../sim/curveGeometry';
import { gearRatio, shaftLength } from '../sim/drive';
import { magnetParams } from '../sim/magnet';

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
  /** 数値ではなく選択肢で表す設定（左/右など）。−／＋ で前後の選択肢に移る */
  choices?: readonly { value: number; label: string }[];
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
  goal: [],
  curve: [
    {
      key: 'turn',
      label: '曲がる向き',
      unit: '',
      min: -1,
      max: 1,
      step: 2,
      choices: [
        { value: -1, label: '右' },
        { value: 1, label: '左' },
      ],
    },
  ],
  platform: [{ key: 'heightMeters', label: '高さ', unit: 'm', min: 0.2, max: 2, step: 0.2 }],
  paddle: [],
  bridge: [],
  gearbox: [
    {
      key: 'gearRatio',
      label: 'ギア比（出力÷入力）',
      unit: '',
      min: 0.5,
      max: 3,
      step: 0.5,
      choices: [
        { value: 0.5, label: '1/2倍' },
        { value: 1, label: '等速' },
        { value: 2, label: '2倍' },
        { value: 3, label: '3倍' },
      ],
    },
  ],
  shaft: [{ key: 'lengthMeters', label: '長さ', unit: 'm', min: 0.5, max: 3, step: 0.5 }],
  switch: [],
  magnet: [
    {
      key: 'mode',
      label: '向き',
      unit: '',
      min: -1,
      max: 1,
      step: 2,
      choices: [
        { value: 1, label: '引きよせる' },
        { value: -1, label: 'しりぞける' },
      ],
    },
    { key: 'maxForceNewton', label: '強さ（いちばん近いとき）', unit: 'N', min: 5, max: 40, step: 5 },
    { key: 'radius', label: '届く距離', unit: 'm', min: 0.5, max: 3, step: 0.25 },
  ],
};

export function findSpec(type: DeviceType, key: string): ParamSpec | undefined {
  return PARAM_SPECS[type].find((s) => s.key === key);
}

/** 範囲内に収め、刻みに合わせる（選択肢なら一番近い選択肢） */
export function normalizeParam(spec: ParamSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.choices ? spec.choices[0].value : spec.min;
  if (spec.choices) {
    return spec.choices.reduce((best, c) => (Math.abs(c.value - value) < Math.abs(best - value) ? c.value : best), spec.choices[0].value);
  }
  const clamped = Math.min(spec.max, Math.max(spec.min, value));
  const snapped = spec.min + Math.round((clamped - spec.min) / spec.step) * spec.step;
  return Math.round(snapped * 1000) / 1000;
}

/** 今の値（未設定なら JSON または既定値） */
export function paramValue(device: PlacedDevice, key: string): number {
  const all: Record<string, number> =
    device.type === 'launcher'
      ? { ...launcherParams(device) }
      : device.type === 'spring'
        ? { ...springParams(device) }
        : device.type === 'platform'
          ? { heightMeters: platformHeight(device) }
          : device.type === 'curve'
            ? { turn: curveTurn(device) }
            : device.type === 'gearbox'
              ? { gearRatio: gearRatio(device) }
              : device.type === 'shaft'
                ? { lengthMeters: shaftLength(device) }
                : device.type === 'magnet'
                  ? { ...magnetParams(device) }
                  : {};
  return all[key] ?? NaN;
}

/** −（dir=-1）／＋（dir=+1）を押したときの次の値 */
export function stepParam(spec: ParamSpec, value: number, dir: 1 | -1): number {
  if (spec.choices) {
    const i = spec.choices.findIndex((c) => c.value === value);
    const j = Math.min(spec.choices.length - 1, Math.max(0, i + dir));
    return spec.choices[j].value;
  }
  return normalizeParam(spec, value + dir * spec.step);
}

export function formatParam(spec: ParamSpec, value: number): string {
  const choice = spec.choices?.find((c) => c.value === value);
  if (choice) return choice.label;
  // 刻みの小数の桁数で表示する（0.25 刻みなら 2 桁）
  const digits = (String(spec.step).split('.')[1] ?? '').length;
  return `${value.toFixed(digits)}${spec.unit}`;
}
