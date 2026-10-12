/**
 * バグ図鑑の一覧（公開図鑑 bugworks_bug_codex_public.json から作成, DECISIONS.md D-37）。
 * まだ実装していないバグの名前・説明はアプリに入れない（未発見の内容をできるだけ配信物に含めない, SPEC_GAPS G-13）。
 * 実装したバグだけ、発見後に見せる名前と効果の説明を持つ。発動の条件はどこにも書かない。
 */
export interface CodexEntry {
  id: string;
  category: string;
  name?: string;
  description?: string;
}

export const CODEX: readonly CodexEntry[] = [
  { id: 'BUG-01', category: '接触' },
  { id: 'BUG-02', category: '運動' },
  { id: 'BUG-03', category: '循環', name: '無限ループ君', description: '4周目から周回損失を相殺する' },
  { id: 'BUG-04', category: '複製' },
  { id: 'BUG-05', category: '透過' },
  { id: 'BUG-06', category: '時間' },
  { id: 'BUG-07', category: '重力' },
  { id: 'BUG-08', category: '表示' },
  { id: 'BUG-09', category: '信号' },
  { id: 'BUG-10', category: '空間' },
  { id: 'BUG-11', category: '防御' },
  { id: 'BUG-12', category: '材質', name: '黒い液体', description: '床摩擦を負値相当に変える' },
  { id: 'BUG-13', category: '構造' },
  { id: 'BUG-14', category: '信号' },
  { id: 'BUG-15', category: '確率', name: 'ランダム君', description: '次回だけ分岐先を固定シードで変更' },
  { id: 'BUG-16', category: '磁力', name: '磁力狂い君', description: '一定領域で同極が引き合う' },
  { id: 'BUG-17', category: '複製' },
  { id: 'BUG-18', category: '材質', name: '劣化君', description: '摩擦が段階的に下がる' },
  { id: 'BUG-19', category: '重力' },
  { id: 'BUG-20', category: '空間' },
  { id: 'BUG-21', category: '時間' },
  { id: 'BUG-22', category: '空間' },
  { id: 'BUG-23', category: '位置' },
  { id: 'BUG-24', category: '表示' },
  { id: 'BUG-25', category: '接触' },
  { id: 'BUG-26', category: '材質' },
  { id: 'BUG-27', category: '表示' },
  { id: 'BUG-28', category: '信号' },
  { id: 'BUG-29', category: '信号' },
  { id: 'BUG-30', category: '観測', name: '監視君', description: '観測対象の次の挙動を1回変更' },
  { id: 'BUG-31', category: '接続' },
  { id: 'BUG-32', category: '復元' },
  { id: 'BUG-33', category: '観測' },
  { id: 'BUG-34', category: '空間' },
  { id: 'BUG-35', category: '空間' },
  { id: 'BUG-36', category: '空間' },
  { id: 'BUG-37', category: '時間' },
  { id: 'BUG-38', category: '観測' },
  { id: 'BUG-39', category: '変換' },
  { id: 'BUG-40', category: '感染' },
];
