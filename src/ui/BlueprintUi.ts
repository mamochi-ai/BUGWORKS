import { blueprintToJson, fileNameFor, parseBlueprint, toBlueprint } from '../blueprint/blueprint';
import { listSaved, removeSaved, saveBlueprint } from '../blueprint/store';
import { mergeLayouts } from '../blueprint/merge';
import type { EditorModel } from '../edit/EditorModel';
import type { SimulationController } from '../sim/SimulationController';
import type { StageController } from '../stage/StageController';

/**
 * 設計図の保存・読み込み（D-34）。この端末（ブラウザ）への保存と、JSON ファイルの書き出し・読み込み。
 * サーバーには送らない。文字はすべて textContent で出す（読み込んだ名前を HTML として扱わない）。
 */
export class BlueprintUi {
  private el: Record<string, HTMLElement> = {};
  /** ファイルを選んだあと、置き換えるか（open）つなげるか（merge） */
  private fileMode: 'open' | 'merge' = 'open';

  constructor(
    root: HTMLElement,
    private readonly editor: EditorModel,
    private readonly ctl: SimulationController,
    private readonly stage: StageController,
  ) {
    // 上のバーに「設計図」ボタン
    const top = root.querySelector('.hud-top');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'bp-open';
    open.innerHTML = '<i aria-hidden="true">▤</i><span>設計図</span>';
    open.setAttribute('aria-label', '設計図の保存と読み込み');
    open.addEventListener('click', () => this.show());
    top?.appendChild(open);

    const modal = document.createElement('div');
    modal.className = 'stage-modal bp-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="stage-dialog" role="dialog" aria-modal="true" aria-labelledby="bp-title">
        <h2 id="bp-title">設計図</h2>
        <section class="bp-sec" aria-label="保存">
          <h3>保存する</h3>
          <label class="bp-name">名前<input type="text" data-k="name" maxlength="40" autocomplete="off" /></label>
          <div class="stage-actions">
            <button type="button" data-b="save-local" class="primary"><i>💾</i><span>この端末に保存</span></button>
            <button type="button" data-b="save-file"><i>⇩</i><span>ファイルに書き出す</span></button>
          </div>
        </section>
        <section class="bp-sec" aria-label="開く">
          <h3>開く・つなげる</h3>
          <p class="bp-note">「開く」はいまの配置と入れ替えます。「つなげる」はいまの配置に足します（重ならない所に置き、ID を付け直します）。</p>
          <p class="bp-note" data-k="openNote"></p>
          <ul class="bp-list" data-k="list"></ul>
          <div class="stage-actions">
            <button type="button" data-b="load-file" data-k="loadFile"><i>⇧</i><span>ファイルから読み込む</span></button>
            <button type="button" data-b="merge-file" data-k="mergeFile"><i>⊕</i><span>ファイルからつなげる</span></button>
          </div>
          <input type="file" accept=".json,application/json" data-k="file" hidden />
        </section>
        <p class="bp-msg" data-k="msg" role="status" aria-live="polite"></p>
        <p class="bp-note">保存した設計図はこの端末のブラウザの中にだけ残ります（ブラウザのデータを消すと消えます）。他の人に渡すときはファイルに書き出してください。</p>
        <div class="stage-actions">
          <button type="button" data-b="close"><i>✕</i><span>閉じる</span></button>
        </div>
      </div>`;
    root.appendChild(modal);
    this.el.modal = modal;
    modal.querySelectorAll<HTMLElement>('[data-k]').forEach((n) => (this.el[n.dataset.k!] = n));
    modal.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-b]');
      if (b && !b.disabled) this.run(b.dataset.b!, b.dataset.id);
    });
    (this.el.file as HTMLInputElement).addEventListener('change', () => this.readFile());
  }

  show(): void {
    const st = this.stage.current;
    (this.el.name as HTMLInputElement).value = st ? `ステージ${st.id} ${st.name}` : '自由研究の設計図';
    this.say('', 'info');
    this.renderList();
    this.el.modal.hidden = false;
  }

  private run(action: string, id?: string): void {
    switch (action) {
      case 'close':
        this.el.modal.hidden = true;
        break;
      case 'save-local': {
        const { title, json } = this.make();
        const r = saveBlueprint(title, json);
        if (!r.ok) return this.say(r.reason, 'error');
        this.say(`「${title}」をこの端末に保存しました`, 'info');
        this.stage.markSaved();
        this.renderList();
        break;
      }
      case 'save-file': {
        const { title, json } = this.make();
        try {
          const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
          const a = document.createElement('a');
          a.href = url;
          a.download = fileNameFor(title);
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
          this.say(`「${a.download}」を書き出しました（iPad では「ダウンロード」か「ファイル」に保存されます）`, 'info');
          this.stage.markSaved();
        } catch {
          this.say('ファイルに書き出せませんでした', 'error');
        }
        break;
      }
      case 'open': {
        const item = listSaved().find((x) => x.id === id);
        if (item) this.load(item.json);
        break;
      }
      case 'merge': {
        const item = listSaved().find((x) => x.id === id);
        if (item) this.merge(item.json);
        break;
      }
      case 'merge-file':
        this.fileMode = 'merge';
        (this.el.file as HTMLInputElement).value = '';
        (this.el.file as HTMLInputElement).click();
        break;
      case 'delete':
        // 消すと戻せないので確かめる
        if (id && window.confirm('この設計図を消しますか？（元に戻せません）')) {
          removeSaved(id);
          this.renderList();
          this.say('消しました', 'info');
        }
        break;
      case 'load-file':
        this.fileMode = 'open';
        (this.el.file as HTMLInputElement).value = '';
        (this.el.file as HTMLInputElement).click();
        break;
    }
  }

  private make(): { title: string; json: string } {
    const title = (this.el.name as HTMLInputElement).value.trim() || '名前のない設計図';
    const bp = toBlueprint(this.editor.devices, this.editor.seed, { title, stageId: this.stage.current?.id });
    return { title: bp.title, json: blueprintToJson(bp) };
  }

  private readFile(): void {
    const f = (this.el.file as HTMLInputElement).files?.[0];
    if (!f) return;
    if (f.size > 400_000) return this.say('ファイルが大きすぎます', 'error');
    f.text()
      .then((t) => (this.fileMode === 'merge' ? this.merge(t) : this.load(t)))
      .catch(() => this.say('ファイルを読めませんでした', 'error'));
  }

  /** 設計図を読み込んで配置を差し替える（元に戻せる）。ステージ中は読み込めない */
  private load(json: string): void {
    if (this.editor.inStage) return this.say('ステージ中は開けません（ステージ選択の「自由研究」で開けます）', 'error');
    const r = parseBlueprint(json);
    if (!r.ok) return this.say(`読み込めません：${r.errors.slice(0, 3).join('／')}`, 'error');
    this.ctl.ensureEditable();
    this.editor.loadLayout(r.devices, `設計図「${r.title}」を読み込みました`);
    this.say(r.warnings.length ? `読み込みました（注意：${r.warnings.slice(0, 2).join('／')}）` : `「${r.title}」を読み込みました`, 'info');
    this.el.modal.hidden = true;
  }

  /** 設計図をいまの配置につなげる（元に戻せる）。ステージ中はできない */
  private merge(json: string): void {
    if (this.editor.inStage) return this.say('ステージ中はつなげられません（ステージ選択の「自由研究」でできます）', 'error');
    const r = parseBlueprint(json);
    if (!r.ok) return this.say(`読み込めません：${r.errors.slice(0, 3).join('／')}`, 'error');
    const m = mergeLayouts(this.editor.devices, r.devices, this.editor.seed);
    if (!m.ok) return this.say(`つなげられません：${m.errors.slice(0, 2).join('／')}`, 'error');
    this.ctl.ensureEditable();
    const shift = m.offset[0] === 0 && m.offset[1] === 0 ? 'そのままの位置' : `横に ${m.offset[0]}m・前後に ${m.offset[1]}m ずらした位置`;
    const text = `設計図「${r.title}」の装置 ${m.added} 個を${shift}に足しました（ID は ${m.namespace}_ 付き）。新しくつながった所：${m.joined} か所`;
    this.editor.loadLayout(m.devices, text);
    this.say(text + (m.warnings.length ? `（注意：${m.warnings[0]}）` : ''), 'info');
    this.el.modal.hidden = true;
  }

  private renderList(): void {
    const inStage = this.editor.inStage;
    this.el.openNote.textContent = inStage ? 'ステージ中は開けません（ステージ選択の「自由研究」で開けます）' : '';
    (this.el.loadFile as HTMLButtonElement).disabled = inStage;
    (this.el.mergeFile as HTMLButtonElement).disabled = inStage;
    const list = this.el.list;
    list.replaceChildren();
    const saved = listSaved();
    if (saved.length === 0) {
      const li = document.createElement('li');
      li.className = 'bp-empty';
      li.textContent = 'この端末に保存した設計図はまだありません';
      list.appendChild(li);
      return;
    }
    for (const s of saved) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'bp-item-name';
      name.textContent = s.title;
      const date = document.createElement('small');
      date.textContent = new Date(s.savedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      name.appendChild(date);
      const openB = document.createElement('button');
      openB.type = 'button';
      openB.dataset.b = 'open';
      openB.dataset.id = s.id;
      openB.disabled = inStage;
      openB.textContent = '開く';
      openB.setAttribute('aria-label', `「${s.title}」を開く`);
      const mergeB = document.createElement('button');
      mergeB.type = 'button';
      mergeB.dataset.b = 'merge';
      mergeB.dataset.id = s.id;
      mergeB.disabled = inStage;
      mergeB.textContent = 'つなげる';
      mergeB.setAttribute('aria-label', `「${s.title}」をいまの配置につなげる`);
      const del = document.createElement('button');
      del.type = 'button';
      del.dataset.b = 'delete';
      del.dataset.id = s.id;
      del.textContent = '消す';
      del.setAttribute('aria-label', `「${s.title}」を消す`);
      li.append(name, openB, mergeB, del);
      list.appendChild(li);
    }
  }

  private say(text: string, kind: 'info' | 'error'): void {
    this.el.msg.textContent = text ? `${kind === 'error' ? '⚠ ' : '✓ '}${text}` : '';
    this.el.msg.dataset.kind = kind;
  }
}
