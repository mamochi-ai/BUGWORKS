import RAPIER from '@dimforge/rapier3d-deterministic-compat';

export type Rapier = typeof RAPIER;

let ready: Promise<Rapier> | null = null;

/**
 * Rapier（決定論ビルド, WASMをbase64同梱）を初期化する。
 * 同梱版なので追加のファイル配信やネットワークは不要（オフライン動作）。
 */
export function loadRapier(): Promise<Rapier> {
  ready ??= RAPIER.init().then(() => RAPIER);
  return ready;
}
