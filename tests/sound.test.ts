import { describe, expect, it } from 'vitest';
import { BGM, loadSettings } from '../src/ui/Sound';

describe('音の設定と BGM（D-40 / D-44）', () => {
  it('設定は効果音・BGM とも既定 ON。壊れたデータでも ON に戻る。片方だけ OFF にできる', () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null };
    expect(loadSettings(s)).toEqual({ sound: true, bgm: true });
    m.set('bugworks.settings.v1', JSON.stringify({ sound: true, bgm: false }));
    expect(loadSettings(s)).toEqual({ sound: true, bgm: false });
    m.set('bugworks.settings.v1', JSON.stringify({ sound: false }));
    expect(loadSettings(s)).toEqual({ sound: false, bgm: true });
    m.set('bugworks.settings.v1', '{bad');
    expect(loadSettings(s)).toEqual({ sound: true, bgm: true });
  });

  it('BGM の譜面：4小節の和音と、16歩のアルペジオ（和音の音か休み）', () => {
    expect(BGM.chords).toHaveLength(4);
    for (const c of BGM.chords) expect(c).toHaveLength(3);
    expect(BGM.arp).toHaveLength(16);
    for (const a of BGM.arp) expect(a).toBeGreaterThanOrEqual(-1);
    expect(BGM.bpm).toBeGreaterThan(60);
  });
});
