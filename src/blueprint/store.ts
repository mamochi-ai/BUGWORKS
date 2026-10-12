/**
 * この端末（ブラウザ）に設計図を保存する（D-34）。サーバー・クラウドには送らない。
 * ブラウザのデータを消すと消える（README に記載）。保存できない環境でもゲームは動く。
 */
const KEY = 'bugworks.blueprints.v1';
export const MAX_SAVED = 20;

export interface SavedBlueprint {
  id: string;
  title: string;
  savedAt: string;
  json: string;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function listSaved(s: StorageLike | null = storage()): SavedBlueprint[] {
  try {
    const raw = s?.getItem(KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (x): x is SavedBlueprint =>
          typeof x === 'object' && x !== null && typeof x.id === 'string' && typeof x.title === 'string' && typeof x.savedAt === 'string' && typeof x.json === 'string',
      )
      .slice(0, MAX_SAVED);
  } catch {
    return [];
  }
}

/** 保存する。同じ名前があれば上書き。数が上限なら一番古いものを消す。保存できなければ理由を返す */
export function saveBlueprint(title: string, json: string, s: StorageLike | null = storage(), now = new Date()): { ok: true; id: string } | { ok: false; reason: string } {
  if (!s) return { ok: false, reason: 'この端末のブラウザでは保存できません（プライベートブラウズなど）。ファイルに書き出してください' };
  const list = listSaved(s).filter((x) => x.title !== title);
  const id = `bp_${now.getTime().toString(36)}`;
  const next = [{ id, title, savedAt: now.toISOString(), json }, ...list].slice(0, MAX_SAVED);
  try {
    s.setItem(KEY, JSON.stringify(next));
    return { ok: true, id };
  } catch {
    return { ok: false, reason: 'ブラウザの保存領域がいっぱいです。古い設計図を消すか、ファイルに書き出してください' };
  }
}

export function removeSaved(id: string, s: StorageLike | null = storage()): void {
  try {
    s?.setItem(KEY, JSON.stringify(listSaved(s).filter((x) => x.id !== id)));
  } catch {
    /* 消せなくても続ける */
  }
}
