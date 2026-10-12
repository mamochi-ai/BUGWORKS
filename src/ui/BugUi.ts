import { CODEX } from '../bugs/codexData';
import { loadCodex, recordDiscovery } from '../bugs/codex';
import type { BugTrigger } from '../sim/bugs';
import { S404_SVG } from './effects';

/**
 * 隠しバグの発見の演出と、バグ図鑑（D-37）。
 * - 初めて発動したら：S-404「仕様です。」と、バグの名前・効果を出す（図鑑に登録）。発動の条件は出さない
 * - 発見済みのバグが発動したら：画面の端に小さく知らせる
 * - 図鑑：40種の一覧。未発見は「？？？」（名前も出さない）
 */
export class BugUi {
  private el: Record<string, HTMLElement> = {};
  private toastTimer = 0;
  private onDiscover: ((id: string) => void) | null = null;

  constructor(root: HTMLElement) {
    const top = root.querySelector('.hud-top');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'bp-open';
    open.dataset.k = 'codexBtn';
    open.addEventListener('click', () => this.showCodex());
    top?.appendChild(open);
    this.el.codexBtn = open;

    const discover = document.createElement('div');
    discover.className = 'bug-discover';
    discover.hidden = true;
    discover.setAttribute('role', 'alertdialog');
    discover.setAttribute('aria-labelledby', 'bug-discover-title');
    discover.innerHTML = `
      <p class="bug-alert" aria-hidden="true">⚠ ANOMALY</p>
      <p class="bug-s404">${S404_SVG}<b>S-404</b>「仕様です。」</p>
      <h2 id="bug-discover-title" data-k="dTitle"></h2>
      <p class="bug-desc" data-k="dDesc"></p>
      <p class="bug-note">バグ図鑑に登録しました。同じことをもう一度起こすと、また起きます。</p>
      <div class="stage-actions"><button type="button" data-b="close-discover"><i>✕</i><span>閉じる</span></button></div>`;
    root.appendChild(discover);
    this.el.discover = discover;

    const toast = document.createElement('div');
    toast.className = 'bug-toast';
    toast.hidden = true;
    toast.setAttribute('role', 'status');
    root.appendChild(toast);
    this.el.toast = toast;

    const codex = document.createElement('div');
    codex.className = 'stage-modal';
    codex.hidden = true;
    codex.innerHTML = `
      <div class="stage-dialog" role="dialog" aria-modal="true" aria-labelledby="codex-title">
        <h2 id="codex-title">バグ図鑑</h2>
        <p class="bp-note" data-k="count"></p>
        <ul class="codex-list" data-k="list"></ul>
        <p class="bp-note">発見の記録はこの端末のブラウザの中にだけ残ります（設計図には入りません）。</p>
        <div class="stage-actions"><button type="button" data-b="close-codex"><i>✕</i><span>閉じる</span></button></div>
      </div>`;
    root.appendChild(codex);
    this.el.codex = codex;
    for (const box of [discover, codex]) box.querySelectorAll<HTMLElement>('[data-k]').forEach((n) => (this.el[n.dataset.k!] = n));
    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-b]');
      if (b?.dataset.b === 'close-discover') this.el.discover.hidden = true;
      if (b?.dataset.b === 'close-codex') this.el.codex.hidden = true;
    });
    this.syncButton();
  }

  /** 初めての発見のとき呼ばれる（音を鳴らすなど） */
  setOnDiscover(fn: (id: string) => void): void {
    this.onDiscover = fn;
  }

  /** シミュレーションで発動したバグを受け取る */
  handle(ev: BugTrigger): void {
    const entry = CODEX.find((c) => c.id === ev.id);
    if (!entry) return;
    if (recordDiscovery(ev.id)) {
      this.el.dTitle.textContent = `${entry.id}　${entry.name ?? ''}`;
      this.el.dDesc.textContent = entry.description ?? '';
      this.el.discover.hidden = false;
      this.syncButton();
      this.onDiscover?.(ev.id);
    } else {
      this.toast(`${entry.id} ${entry.name ?? ''} が発動しました`);
    }
  }

  private toast(text: string): void {
    this.el.toast.textContent = `⚠ ${text}`;
    this.el.toast.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.el.toast.hidden = true), 2500);
  }

  private syncButton(): void {
    const n = Object.keys(loadCodex().discovered).length;
    this.el.codexBtn.innerHTML = `<i aria-hidden="true">❖</i><span>図鑑 ${n}/${CODEX.length}</span>`;
    this.el.codexBtn.setAttribute('aria-label', `バグ図鑑（${CODEX.length}種のうち ${n}種を発見）`);
  }

  private showCodex(): void {
    const found = loadCodex().discovered;
    const n = Object.keys(found).length;
    this.el.count.textContent = `発見 ${n} / ${CODEX.length}`;
    const list = this.el.list;
    list.replaceChildren();
    for (const c of CODEX) {
      const li = document.createElement('li');
      const at = found[c.id];
      li.dataset.found = String(!!at);
      const id = document.createElement('span');
      id.className = 'codex-id';
      id.textContent = c.id;
      const body = document.createElement('span');
      body.className = 'codex-body';
      const name = document.createElement('b');
      name.textContent = at ? `${c.name ?? ''}（${c.category}）` : '？？？';
      const desc = document.createElement('small');
      desc.textContent = at ? `${c.description ?? ''}　— ${new Date(at).toLocaleDateString('ja-JP')} 発見` : '未発見';
      body.append(name, desc);
      li.append(id, body);
      list.appendChild(li);
    }
    this.el.codex.hidden = false;
  }
}
