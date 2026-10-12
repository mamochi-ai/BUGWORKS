import { toBlueprint } from '../blueprint/blueprint';
import { ENGINE_VERSION, PHYSICS_HZ, PHYSICS_PROFILE } from '../sim/constants';
import type { PlacedDevice } from '../sim/layout';
import type { VerifyResult } from './verify';

/**
 * 検証証明書（certificate.example.json の形）。この端末で作るだけの記録で、改ざんへの強さや公開ランキングは保証しない。
 * 設計図のハッシュは、作成日時・題名を除いた設計図（装置と seed）から作る（同じ機械なら同じ値）。
 */
export interface Certificate {
  certificateVersion: '0.1';
  game: 'BUGWORKS';
  machineName: string;
  status: VerifyResult['status'];
  verificationMethod: 'bounded_periodic_replay';
  blueprintSha256: string;
  engineVersion: string;
  physicsProfile: string;
  seed: number;
  periodSteps: number | null;
  periodSeconds: number | null;
  confirmedCycles: number;
  outputEventsPerCycle: number[];
  triggeredBugIds: string[];
  issuedAt: string;
  disclaimer: string;
}

export const DISCLAIMER = 'ゲーム内ルールに基づく有限回の周期再検証結果。現実の永久機関や数学的な無限継続の証明ではありません。';

/** ハッシュを取る設計図の文字列（作成日時・題名は除く） */
export function canonicalBlueprint(devices: readonly PlacedDevice[], seed: number): string {
  const bp = toBlueprint(devices, seed, { title: 'machine', now: new Date(0) });
  return JSON.stringify({ ...bp, title: undefined, createdAt: undefined });
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function makeCertificate(result: VerifyResult, devices: readonly PlacedDevice[], seed: number, machineName: string, now = new Date()): Promise<Certificate> {
  return {
    certificateVersion: '0.1',
    game: 'BUGWORKS',
    machineName,
    status: result.status,
    verificationMethod: 'bounded_periodic_replay',
    blueprintSha256: await sha256Hex(canonicalBlueprint(devices, seed)),
    engineVersion: ENGINE_VERSION,
    physicsProfile: PHYSICS_PROFILE,
    seed,
    periodSteps: result.periodSteps,
    periodSeconds: result.periodSteps === null ? null : result.periodSteps / PHYSICS_HZ,
    confirmedCycles: result.outputEventsPerCycle.length,
    outputEventsPerCycle: result.outputEventsPerCycle,
    triggeredBugIds: result.bugs,
    issuedAt: now.toISOString(),
    disclaimer: DISCLAIMER,
  };
}
