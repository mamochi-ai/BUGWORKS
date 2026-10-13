import type { StageController } from '../stage/StageController';
import { CHAPTER_TITLES, EVENT_TEXT, STAGES, chapterOf, chapters } from '../stage/stages';
import { S404_SVG, celebrate } from './effects';
import type { SimulationController } from '../sim/SimulationController';

/**
 * ステージ選択・ステージの目標とチェックリスト・S-404 のひとこと・クリアの知らせ（DECISIONS.md D-26）。
 * 状態は記号（✓／☐）と文字で示し、色だけに頼らない。時間で勝手に次へ進めない。
 */
export class StageUi {
  private el: Record<string, HTMLElement> = {};
  /** 表示している章（null なら開いたときに決める） */
  private tab: number | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly stage: StageController,
    private readonly ctl: SimulationController,
  ) {
    const panel = document.createElement('section');
    panel.className = 'stage-panel';
    panel.setAttribute('aria-label', 'ステージの目標');
    panel.innerHTML = `
      <div class="stage-head">
        <strong data-k="title"></strong>
        <button type="button" data-s="open" aria-label="ステージ選択を開く"><i>☰</i><span>ステージ</span></button>
      </div>
      <p class="objective" data-k="objective"></p>
      <ul class="checklist" data-k="checklist" aria-label="クリア条件"></ul>
      <p class="s404" data-k="hint">${S404_SVG}<b>S-404</b><span data-k="hintText"></span></p>
    `;
    root.appendChild(panel);

    const select = document.createElement('div');
    select.className = 'stage-modal';
    select.dataset.k = 'select';
    select.hidden = true;
    select.innerHTML = `
      <div class="stage-dialog" role="dialog" aria-modal="true" aria-labelledby="stage-select-title">
        <h2 id="stage-select-title">ステージ選択</h2>
        <div class="stage-tabs" role="tablist" aria-label="章" data-k="tabs"></div>
        <ul class="stage-list" role="tabpanel" data-k="list"></ul>
        <p class="stage-next" data-k="nextChapter"></p>
        <div class="stage-actions">
          <button type="button" data-s="free"><i>✎</i><span>自由研究</span></button>
          <button type="button" data-s="close-select" data-k="closeSelect"><i>✕</i><span>閉じる</span></button>
        </div>
      </div>
    `;
    root.appendChild(select);

    const clear = document.createElement('div');
    clear.className = 'stage-modal';
    clear.dataset.k = 'clear';
    clear.hidden = true;
    clear.innerHTML = `
      <div class="stage-dialog clear" role="dialog" aria-modal="true" aria-labelledby="stage-clear-title">
        <h2 id="stage-clear-title">✓ ステージクリア！</h2>
        <p data-k="clearText"></p>
        <div class="stage-actions">
          <button type="button" data-s="next" class="primary"><i>▶</i><span>次のステージへ</span></button>
          <button type="button" data-s="retry"><i>↺</i><span>もう一度</span></button>
          <button type="button" data-s="open"><i>☰</i><span>ステージ選択</span></button>
          <button type="button" data-s="close-clear"><i>✕</i><span>閉じて眺める</span></button>
        </div>
      </div>
    `;
    root.appendChild(clear);

    for (const box of [panel, select, clear]) {
      box.querySelectorAll<HTMLElement>('[data-k]').forEach((n) => (this.el[n.dataset.k!] = n));
      if (box.dataset.k) this.el[box.dataset.k] = box;
    }
    this.el.panel = panel;
    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-s]');
      if (b && !b.disabled) this.run(b.dataset.s!, b.dataset.id);
    });

    stage.onChange((c) => {
      if (c === 'clear') this.showClear();
      else this.sync();
      // ステージが変わったら S-404 がひとこと言い直す（動きを減らす設定では動かない）
      if (c === 'stage') {
        this.el.hint.classList.remove('pop');
        void this.el.hint.offsetWidth;
        this.el.hint.classList.add('pop');
      }
    });
    this.renderList();
    this.sync();
  }

  /** ステージ選択を開く（タイトル画面の「ゲーム開始」から。閉じずに選ぶ／自由研究を押す） */
  showSelect(fromTitle = false): void {
    this.el.clear.hidden = true;
    this.tab = null;
    this.renderList();
    this.el.closeSelect.hidden = fromTitle;
    this.el.select.hidden = false;
  }

  private run(action: string, id?: string): void {
    switch (action) {
      case 'open':
        this.el.clear.hidden = true;
        this.openSelect();
        break;
      case 'tab':
        if (id) {
          this.tab = Number(id);
          this.renderList();
        }
        break;
      case 'close-select':
        this.el.select.hidden = true;
        break;
      case 'stage':
        if (id && this.stage.start(id)) this.closeAll();
        break;
      case 'free':
        this.stage.free();
        this.closeAll();
        break;
      case 'next': {
        const n = this.stage.next();
        if (n && this.stage.start(n.id)) this.closeAll();
        break;
      }
      case 'retry':
        this.ctl.reset();
        this.closeAll();
        break;
      case 'close-clear':
        this.el.clear.hidden = true;
        break;
    }
  }

  private openSelect(): void {
    this.tab = null;
    this.renderList();
    this.el.closeSelect.hidden = false;
    this.el.select.hidden = false;
  }

  private closeAll(): void {
    this.el.select.hidden = true;
    this.el.clear.hidden = true;
  }

  /** 遊べる章：その章の最初のステージが開いている章（前の章をすべてクリアすると出てくる） */
  private openChapters(): number[] {
    return chapters().filter((c) => {
      const first = STAGES.find((s) => chapterOf(s.id) === c);
      return !!first && this.stage.unlock(first.id).unlocked;
    });
  }

  /** 開いたときの章：遊んでいるステージの章 → まだクリアしていないステージがある最初の章 → 最後の章 */
  private defaultTab(open: number[]): number {
    const cur = this.stage.current;
    if (cur && open.includes(chapterOf(cur.id))) return chapterOf(cur.id);
    const todo = open.find((c) => STAGES.some((s) => chapterOf(s.id) === c && !this.stage.isCleared(s.id)));
    return todo ?? open[open.length - 1] ?? 1;
  }

  private renderList(): void {
    const open = this.openChapters();
    if (this.tab === null || !open.includes(this.tab)) this.tab = this.defaultTab(open);
    const tab = this.tab;
    this.el.tabs.innerHTML = open
      .map((c) => {
        const done = STAGES.filter((s) => chapterOf(s.id) === c).every((s) => this.stage.isCleared(s.id));
        return `<button type="button" role="tab" data-s="tab" data-id="${c}" aria-selected="${c === tab}" data-done="${done}" aria-label="ステージ${c}「${CHAPTER_TITLES[c] ?? ''}」${done ? '（すべてクリア）' : ''}">ステージ${c}<small>${CHAPTER_TITLES[c] ?? ''}</small></button>`;
      })
      .join('');
    const next = chapters().find((c) => !open.includes(c));
    this.el.nextChapter.textContent = next ? `ステージ${next}「${CHAPTER_TITLES[next] ?? ''}」は、ステージ${next - 1} をすべてクリアすると出てきます。` : '';
    this.el.list.innerHTML = STAGES.filter((s) => chapterOf(s.id) === tab).map((s) => {
      const cleared = this.stage.isCleared(s.id);
      const lock = this.stage.unlock(s.id);
      // 準備中を先に判定（機能が無いので、前をクリアしても遊べない）
      const kind = s.comingSoon ? 'soon' : !lock.unlocked ? 'locked' : cleared ? 'cleared' : 'open';
      const state = { soon: '準備中', locked: '🔒 ロック中', cleared: '✓ クリア済み', open: '未クリア' }[kind];
      const note = s.comingSoon ?? lock.reason ?? s.objective;
      return `
        <li>
          <button type="button" data-s="stage" data-id="${s.id}" ${kind === 'soon' || kind === 'locked' ? 'disabled' : ''} aria-label="ステージ ${s.id} ${s.name}（${state}。${note}）">
            <span class="sid">${s.id}</span>
            <span class="sname">${s.name}<small>${note}</small></span>
            <span class="sstate" data-state="${kind}">${state}</span>
          </button>
        </li>`;
    }).join('');
  }

  private showClear(): void {
    const st = this.stage.current;
    if (!st) return;
    const next = this.stage.next();
    this.el.clearText.textContent = `ステージ ${st.id}「${st.name}」をクリアしました。`;
    (this.el.clear.querySelector('[data-s="next"]') as HTMLButtonElement).hidden = !next;
    this.el.clear.hidden = false;
    celebrate(this.root);
    this.sync();
  }

  private sync(): void {
    const st = this.stage.current;
    this.el.title.textContent = st ? `ステージ ${st.id}　${st.name}${this.stage.isCleared(st.id) ? '（✓ クリア済み）' : ''}` : '自由研究';
    this.el.objective.textContent = st ? st.objective : '好きな装置を置いて試せます。クリア条件はありません。';
    const ev = this.stage.events();
    this.el.checklist.hidden = !st;
    this.el.checklist.innerHTML = st
      ? st.required.map((e) => `<li data-done="${ev[e]}"><i aria-hidden="true">${ev[e] ? '✓' : '☐'}</i><span>${EVENT_TEXT[e]}</span><span class="sr">${ev[e] ? '（できた）' : '（まだ）'}</span></li>`).join('')
      : '';
    this.el.hint.hidden = !st;
    this.el.hintText.textContent = st ? st.hint : '';
  }
}
