/**
 * バグ図鑑の記録（発見したバグと日時）。この端末（ブラウザ）にだけ保存し、設計図には入れない（マスター仕様 §4）。
 */
const KEY = 'bugworks.codex.v1';

export interface CodexRecord {
  /** バグID → 発見した日時（ISO 形式） */
  discovered: Record<string, string>;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadCodex(s: StorageLike | null = storage()): CodexRecord {
  try {
    const raw = s?.getItem(KEY);
    if (!raw) return { discovered: {} };
    const d = JSON.parse(raw) as { discovered?: unknown };
    const out: Record<string, string> = {};
    if (d && typeof d.discovered === 'object' && d.discovered !== null) {
      for (const [k, v] of Object.entries(d.discovered as Record<string, unknown>)) {
        if (/^BUG-\d{2}$/.test(k) && typeof v === 'string') out[k] = v;
      }
    }
    return { discovered: out };
  } catch {
    return { discovered: {} };
  }
}

/** 発見を記録する。初めての発見なら true */
export function recordDiscovery(id: string, now = new Date(), s: StorageLike | null = storage()): boolean {
  const c = loadCodex(s);
  if (c.discovered[id]) return false;
  c.discovered[id] = now.toISOString();
  try {
    s?.setItem(KEY, JSON.stringify(c));
  } catch {
    /* 保存できなくても、この回の発見は画面に出す */
  }
  return true;
}
