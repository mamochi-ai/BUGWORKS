import type { EditorModel } from '../edit/EditorModel';
import { getDeviceDef } from '../sim/catalog';
import { SPRING_TILTS, springParams } from '../sim/spring';
import type { SimulationController } from '../sim/SimulationController';

export interface EditPanelDeps {
  editor: EditorModel;
  ctl: SimulationController;
  /** 新しい装置を置く目安の位置（視点の注視点など） */
  addPosition: () => { x: number; z: number };
}

/**
 * 装置パレットと選択中の装置の操作。ボタンはテキスト＋記号で、色だけに頼らない。
 * 編集操作はすべて初期状態で行う（実行中/一時停止中なら先にリセットする）。
 */
export class EditPanel {
  private el: Record<string, HTMLElement> = {};

  constructor(
    root: HTMLElement,
    private readonly deps: EditPanelDeps,
  ) {
    const panel = document.createElement('aside');
    panel.className = 'edit';
    panel.setAttribute('aria-label', '装置の配置');
    panel.innerHTML = `
      <h2>装置</h2>
      <button type="button" data-e="add-rail" class="add"><i>＋</i><span>${getDeviceDef('rail').name}</span></button>
      <button type="button" data-e="add-launcher" class="add"><i>＋</i><span>${getDeviceDef('launcher').name}</span></button>
      <button type="button" data-e="add-spring" class="add"><i>＋</i><span>${getDeviceDef('spring').name}</span></button>
      <div class="sel" data-k="sel"></div>
      <div class="row">
        <button type="button" data-e="rotate" aria-label="回転"><i>⟳</i><span>回転</span></button>
        <button type="button" data-e="delete" aria-label="削除"><i>✕</i><span>削除</span></button>
      </div>
      <div class="row">
        <button type="button" data-e="up" aria-label="高さを上げる"><i>▲</i><span>上げる</span></button>
        <button type="button" data-e="down" aria-label="高さを下げる"><i>▼</i><span>下げる</span></button>
      </div>
      <button type="button" data-e="tilt" class="param" aria-label="天板の傾き" hidden></button>
      <div class="row">
        <button type="button" data-e="undo" aria-label="元に戻す"><i>↶</i><span>戻す</span></button>
        <button type="button" data-e="redo" aria-label="やり直す"><i>↷</i><span>やり直し</span></button>
      </div>
      <p class="msg" data-k="msg" role="status" aria-live="polite"></p>
    `;
    root.appendChild(panel);
    panel.querySelectorAll<HTMLElement>('[data-k]').forEach((n) => (this.el[n.dataset.k!] = n));
    panel.querySelectorAll<HTMLButtonElement>('[data-e]').forEach((b) => {
      this.el[b.dataset.e!] = b;
      b.addEventListener('click', () => this.run(b.dataset.e!));
    });

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') this.run(e.shiftKey ? 'redo' : 'undo');
      else if (mod && k === 'y') this.run('redo');
      else if (mod) return;
      else if (k === 'r') this.run('rotate');
      else if (k === 'delete' || k === 'backspace') this.run('delete');
      else if (k === 'escape') deps.editor.select(null);
      else return;
      e.preventDefault();
    });

    deps.editor.onChange(() => this.sync());
    deps.ctl.onChange(() => this.sync());
    this.sync();
  }

  private run(action: string): void {
    const { editor, ctl } = this.deps;
    const id = editor.selectedId;
    const needsSel = ['rotate', 'delete', 'up', 'down', 'tilt'].includes(action);
    if (needsSel && !id) return;
    ctl.ensureEditable();
    switch (action) {
      case 'add-rail':
      case 'add-launcher':
      case 'add-spring': {
        const p = this.deps.addPosition();
        editor.addDevice(action === 'add-rail' ? 'rail' : action === 'add-launcher' ? 'launcher' : 'spring', p.x, p.z);
        break;
      }
      case 'tilt': {
        const sel = editor.selected;
        if (sel?.type !== 'spring') break;
        const cur = springParams(sel).tiltDegrees;
        const i = SPRING_TILTS.indexOf(cur as (typeof SPRING_TILTS)[number]);
        editor.setParam(id!, 'tiltDegrees', SPRING_TILTS[(i + 1) % SPRING_TILTS.length], '天板の傾き');
        break;
      }
      case 'rotate':
        editor.rotate(id!);
        break;
      case 'delete':
        editor.remove(id!);
        break;
      case 'up':
        editor.changeHeight(id!, 1);
        break;
      case 'down':
        editor.changeHeight(id!, -1);
        break;
      case 'undo':
        editor.undo();
        break;
      case 'redo':
        editor.redo();
        break;
    }
  }

  private sync(): void {
    const { editor } = this.deps;
    const sel = editor.selected;
    this.el.sel.textContent = sel
      ? `選択中：${getDeviceDef(sel.type).name} ${sel.id}（高さ ${sel.position[1].toFixed(1)}m・${sel.rotationYDeg}°）`
      : '部品をタップすると選択できます';
    for (const k of ['rotate', 'delete', 'up', 'down']) (this.el[k] as HTMLButtonElement).disabled = !sel;
    const tilt = this.el.tilt as HTMLButtonElement;
    tilt.hidden = sel?.type !== 'spring';
    if (sel?.type === 'spring') tilt.innerHTML = `<i>◢</i><span>天板の傾き ${springParams(sel).tiltDegrees}°（タップで変更）</span>`;
    (this.el.undo as HTMLButtonElement).disabled = !editor.canUndo;
    (this.el.redo as HTMLButtonElement).disabled = !editor.canRedo;
    const m = editor.message;
    this.el.msg.textContent = m ? `${m.kind === 'error' ? '⚠ ' : '✓ '}${m.text}` : '';
    this.el.msg.dataset.kind = m?.kind ?? '';
  }
}
