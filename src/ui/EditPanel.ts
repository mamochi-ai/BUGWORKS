import type { EditorModel } from '../edit/EditorModel';
import { getDeviceDef } from '../sim/catalog';
import { GEAR_SAMPLE_LAYOUT, MAGNET_SAMPLE_LAYOUT, SWITCH_SAMPLE_LAYOUT, VERTICAL_SLICE_LAYOUT, type DeviceType } from '../sim/layout';
import { restsOnSurface } from '../edit/placement';

/** パレットに並べる装置 */
const PALETTE_TYPES: DeviceType[] = ['rail', 'curve', 'launcher', 'spring', 'platform', 'goal', 'paddle', 'gearbox', 'shaft', 'bridge', 'magnet', 'switch'];
/** パレットのボタンに出す短い名前（正式名はボタンの title に出す） */
const PALETTE_LABELS: Record<DeviceType, string> = {
  rail: 'レール',
  curve: 'カーブ',
  launcher: '発射機',
  spring: 'バネ',
  platform: '台',
  goal: 'ゴール',
  paddle: '羽根車',
  gearbox: '歯車',
  shaft: '軸',
  bridge: '可動橋',
  magnet: '磁石',
  switch: 'スイッチ',
};
import { PARAM_SPECS, formatParam, paramValue, stepParam } from '../edit/params';
import { planLauncher } from '../sim/launcher';
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
      <div class="palette">
        ${PALETTE_TYPES.map((t) => `<button type="button" data-e="add-${t}" class="add" title="${getDeviceDef(t).name}を追加"><i>＋</i><span>${PALETTE_LABELS[t]}</span><small data-k="left-${t}"></small></button>`).join('')}
      </div>
      <div class="sel" data-k="sel"></div>
      <div class="row">
        <button type="button" data-e="rotate" aria-label="回転"><i>⟳</i><span>回転</span></button>
        <button type="button" data-e="delete" aria-label="削除"><i>✕</i><span>削除</span></button>
      </div>
      <div class="row">
        <button type="button" data-e="up" aria-label="高さを上げる"><i>▲</i><span>上げる</span></button>
        <button type="button" data-e="down" aria-label="高さを下げる"><i>▼</i><span>下げる</span></button>
      </div>
      <section class="params" data-k="params" aria-label="選択中の装置の設定" hidden></section>
      <section class="params wires" data-k="wires" aria-label="スイッチの配線" hidden>
        <h3>配線</h3>
        <p class="wire-list" data-k="wireList"></p>
        <button type="button" data-e="wire" aria-label="配線"><i>⚡</i><span data-k="wireLabel">配線する</span></button>
      </section>
      <div class="row">
        <button type="button" data-e="undo" aria-label="元に戻す"><i>↶</i><span>戻す</span></button>
        <button type="button" data-e="redo" aria-label="やり直す"><i>↷</i><span>やり直し</span></button>
      </div>
      <p class="msg" data-k="msg" role="status" aria-live="polite"></p>
      <div class="samples" data-k="samples">
        <h2>サンプル</h2>
        <div class="row">
          <button type="button" data-e="sample-spring">バネでゴール</button>
          <button type="button" data-e="sample-gear">歯車で可動橋</button>
          <button type="button" data-e="sample-magnet">磁石でゴール</button>
          <button type="button" data-e="sample-switch">スイッチで発射</button>
        </div>
      </div>
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

    // 設定の −/＋（行は選択のたびに作り直すので、親で受ける）
    this.el.params.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-param]');
      const sel = deps.editor.selected;
      if (!b || b.disabled || !sel) return;
      const spec = PARAM_SPECS[sel.type].find((s) => s.key === b.dataset.param);
      if (!spec) return;
      deps.ctl.ensureEditable();
      deps.editor.setParam(sel.id, spec.key, stepParam(spec, paramValue(sel, spec.key), Number(b.dataset.dir) as 1 | -1));
    });

    deps.editor.onChange(() => this.sync());
    deps.ctl.onChange(() => this.sync());
    this.sync();
  }

  private run(action: string): void {
    const { editor, ctl } = this.deps;
    const id = editor.selectedId;
    const needsSel = ['rotate', 'delete', 'up', 'down', 'wire'].includes(action);
    if (needsSel && !id) return;
    ctl.ensureEditable();
    switch (action) {
      case 'add-rail':
      case 'add-curve':
      case 'add-launcher':
      case 'add-spring':
      case 'add-goal':
      case 'add-platform':
      case 'add-paddle':
      case 'add-gearbox':
      case 'add-shaft':
      case 'add-bridge':
      case 'add-magnet':
      case 'add-switch': {
        const p = this.deps.addPosition();
        editor.addDevice(action.slice(4) as DeviceType, p.x, p.z);
        break;
      }

      case 'rotate':
        editor.rotate(id!);
        break;
      case 'wire':
        if (editor.wiringFrom) editor.cancelWiring();
        else editor.startWiring(id!);
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
      case 'sample-spring':
        editor.loadLayout(VERTICAL_SLICE_LAYOUT.devices, 'サンプル「バネでゴール」を読み込みました');
        break;
      case 'sample-gear':
        editor.loadLayout(GEAR_SAMPLE_LAYOUT.devices, 'サンプル「歯車で可動橋」を読み込みました。1個目の球は橋が下りる前に着くので落ちます');
        break;
      case 'sample-magnet':
        editor.loadLayout(MAGNET_SAMPLE_LAYOUT.devices, 'サンプル「磁石でゴール」を読み込みました。床を転がる球を磁石が引きよせます');
        break;
      case 'sample-switch':
        editor.loadLayout(SWITCH_SAMPLE_LAYOUT.devices, 'サンプル「スイッチで発射」を読み込みました。左の球がスイッチを通るたびに、右の発射機が ON/OFF します');
        break;
      case 'undo':
        editor.undo();
        break;
      case 'redo':
        editor.redo();
        break;
    }
  }

  /** スイッチの配線先（文字で一覧）と、配線ボタン */
  private renderWires(): void {
    const { editor } = this.deps;
    const sel = editor.selected;
    const box = this.el.wires;
    box.hidden = sel?.type !== 'switch';
    if (!sel || sel.type !== 'switch') return;
    const targets = (sel.signalTargets ?? []).map((id) => editor.devices.find((d) => d.id === id)).filter((d) => d !== undefined);
    this.el.wireList.textContent = targets.length
      ? targets.map((d) => `→ ${getDeviceDef(d.type).name} ${d.id}`).join('\n')
      : 'まだどこにもつないでいません';
    const wiring = editor.wiringFrom === sel.id;
    this.el.wireLabel.textContent = wiring ? '配線をやめる' : '配線する';
    (this.el.wire as HTMLButtonElement).disabled = editor.isLocked(sel.id);
    (this.el.wire as HTMLButtonElement).setAttribute('aria-pressed', String(wiring));
  }

  /** 選択中の装置の設定（−／値／＋）。値はテキストで表示し、色に頼らない */
  private renderParams(): void {
    const box = this.el.params;
    const sel = this.deps.editor.selected;
    const specs = sel ? PARAM_SPECS[sel.type] : [];
    box.hidden = specs.length === 0;
    if (!sel || specs.length === 0) {
      box.innerHTML = '';
      return;
    }
    if (this.deps.editor.isLocked(sel.id)) {
      box.innerHTML = '<h3>設定</h3>' + specs.map((spec) => `<div class="param-row"><span class="param-label">${spec.label}</span><output>${formatParam(spec, paramValue(sel, spec.key))}</output><small>🔒 固定</small></div>`).join('');
      return;
    }
    const connected = sel.type === 'launcher' && planLauncher(sel, this.deps.editor.devices).feedsRailId !== null;
    box.innerHTML =
      '<h3>設定</h3>' +
      specs
        .map((spec) => {
          const v = paramValue(sel, spec.key);
          const locked = connected && spec.key === 'angleDegrees';
          const label = `${spec.label}`;
          return `
          <div class="param-row">
            <span class="param-label">${label}</span>
            <button type="button" data-param="${spec.key}" data-dir="-1" aria-label="${label}を${spec.choices ? '前の選択肢に' : '下げる'}" ${locked || stepParam(spec, v, -1) === v ? 'disabled' : ''}>−</button>
            <output aria-live="polite">${locked ? '0°' : formatParam(spec, v)}</output>
            <button type="button" data-param="${spec.key}" data-dir="1" aria-label="${label}を${spec.choices ? '次の選択肢に' : '上げる'}" ${locked || stepParam(spec, v, 1) === v ? 'disabled' : ''}>＋</button>
            ${locked ? `<small>レールにつないでいる間は 0°（外すと ${formatParam(spec, v)}）</small>` : ''}
          </div>`;
        })
        .join('');
  }

  private sync(): void {
    const { editor } = this.deps;
    const sel = editor.selected;
    const locked = sel ? editor.isLocked(sel.id) : false;
    this.el.sel.textContent = sel
      ? `選択中：${getDeviceDef(sel.type).name} ${sel.id}（高さ ${sel.position[1].toFixed(1)}m・${sel.rotationYDeg}°）${locked ? '　🔒固定：ステージの装置なので動かせません' : ''}`
      : '部品をタップすると選択できます';
    for (const k of ['rotate', 'delete', 'up', 'down']) (this.el[k] as HTMLButtonElement).disabled = !sel || locked;
    // ステージ中は置ける装置だけを、残りの数と一緒に出す
    const allowed = editor.inventoryTypes;
    for (const t of PALETTE_TYPES) {
      const b = this.el[`add-${t}`] as HTMLButtonElement;
      const left = editor.remaining(t);
      b.hidden = allowed !== null && !allowed.includes(t);
      b.disabled = left <= 0;
      this.el[`left-${t}`].textContent = allowed ? `残り${Math.max(0, left)}` : '';
      b.setAttribute('aria-label', `${getDeviceDef(t).name}を追加${allowed ? `（残り${Math.max(0, left)}個）` : ''}`);
    }
    this.el.samples.hidden = editor.inStage;
    // 台の上（または床）に乗る装置は高さを手で変えない
    if (sel && restsOnSurface(sel.type)) for (const k of ['up', 'down']) (this.el[k] as HTMLButtonElement).disabled = true;
    this.renderParams();
    this.renderWires();
    (this.el.undo as HTMLButtonElement).disabled = !editor.canUndo;
    (this.el.redo as HTMLButtonElement).disabled = !editor.canRedo;
    const m = editor.message;
    this.el.msg.textContent = m ? `${m.kind === 'error' ? '⚠ ' : '✓ '}${m.text}` : '';
    this.el.msg.dataset.kind = m?.kind ?? '';
  }
}
