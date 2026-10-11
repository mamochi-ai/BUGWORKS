/**
 * ステージの進み具合（クリアしたステージ）を、この端末のブラウザに保存する（サーバーは使わない）。
 * プライベートブラウズやサイトデータの削除で消えることがある（README に記載）。保存できなくてもゲームは動く。
 */
const KEY = 'bugworks.progress.v1';

export interface Progress {
  cleared: string[];
}

export function loadProgress(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Progress {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return { cleared: [] };
    const data = JSON.parse(raw) as unknown;
    // 保存データは文字列の配列だけを受け付ける（それ以外は捨てる）
    const cleared = Array.isArray((data as Progress).cleared) ? (data as Progress).cleared.filter((x): x is string => typeof x === 'string').slice(0, 100) : [];
    return { cleared };
  } catch {
    return { cleared: [] };
  }
}

export function saveProgress(p: Progress, storage: Pick<Storage, 'setItem'> | null = safeStorage()): boolean {
  try {
    storage?.setItem(KEY, JSON.stringify({ cleared: [...new Set(p.cleared)] }));
    return !!storage;
  } catch {
    return false;
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
