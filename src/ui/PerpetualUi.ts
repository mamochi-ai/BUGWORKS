import { CODEX } from '../bugs/codexData';
import { loadCodex } from '../bugs/codex';
import { blueprintToJson, fileNameFor, toBlueprint } from '../blueprint/blueprint';
import type { EditorModel } from '../edit/EditorModel';
import { DISCLAIMER, makeCertificate } from '../perpetual/certificate';
import { SimMachine } from '../perpetual/simMachine';
import { PerpetualVerifier, VERIFY_CONFIG, type VerifyResult } from '../perpetual/verify';
import type { PlacedDevice } from '../sim/layout';
import { PHYSICS_HZ } from '../sim/constants';
import type { Rapier } from '../sim/rapier';
import { S404_SVG, celebrate } from './effects';

/**
 * 永久機関の検証（D-41）。画面で動いているものとは別に、いまの配置を最初から動かして調べる。
 * 1回に使う時間（FRAME_BUDGET_MS）を決めて少しずつ進め、そのたびにブラウザに戻すので、検証中も画面は固まらない（止める・閉じるで中止）。
 */
const FRAME_BUDGET_MS = 10;
const VERIFY_WARMUP_S = Math.round(VERIFY_CONFIG.warmupSteps / PHYSICS_HZ);

const STATUS_TEXT: Record<string, string> = {
  RUNNING: '調べています',
  CANDIDATE: 'くり返しの候補を確かめています',
  VERIFIED: '永久機関 認定！',
  INCONCLUSIVE: '判定できませんでした',
  FAILED: '永久機関ではありませんでした',
  INCOMPATIBLE: 'この設計図は検証できません',
};

export class PerpetualUi {
  private el: Record<string, HTMLElement> = {};
  private job: { verifier: PerpetualVerifier; machine: SimMachine; raf: number; devices: PlacedDevice[]; seed: number } | null = null;
  private last: { result: VerifyResult; devices: PlacedDevice[]; seed: number; name: string } | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly R: Rapier,
    private readonly editor: EditorModel,
    private readonly onBugs: (ids: string[]) => void,
  ) {
    const top = root.querySelector('.hud-top');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'bp-open';
    open.innerHTML = '<i aria-hidden="true">∞</i><span>永久機関</span>';
    open.setAttribute('aria-label', '永久機関の検証');
    open.addEventListener('click', () => this.show());
    top?.appendChild(open);

    const modal = document.createElement('div');
    modal.className = 'stage-modal pm-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="stage-dialog" role="dialog" aria-modal="true" aria-labelledby="pm-title" data-k="dialog">
        <h2 id="pm-title">永久機関の検証</h2>
        <p class="bp-note">いまの配置を最初から動かして、<b>外の力</b>（発射機・バネ・回転台のモーター・スイッチで切り替わる磁石）を使わずに、同じ動きと出力（羽根車を回す・スイッチを切り替える）をくり返すかを調べます。最初の${VERIFY_WARMUP_S}秒は始動の時間で、外の力を使ってもかまいません。力の源にできるのは隠しバグだけです。</p>
        <label class="bp-name">機関の名前<input type="text" data-k="name" maxlength="40" autocomplete="off" /></label>
        <div class="pm-progress" data-k="progressBox" hidden>
          <progress data-k="bar" max="1" value="0"></progress>
          <p class="pm-status" data-k="status" role="status" aria-live="polite"></p>
          <dl class="pm-facts">
            <dt>周期の候補</dt><dd data-k="period">—</dd>
            <dt>出力</dt><dd data-k="outputs">0</dd>
            <dt>使ったバグ</dt><dd data-k="bugs">—</dd>
          </dl>
        </div>
        <div class="pm-result" data-k="result" hidden>
          <p class="pm-verdict" data-k="verdict"></p>
          <p class="bug-s404" data-k="s404">${S404_SVG}<b>S-404</b><span data-k="s404text"></span></p>
          <p class="pm-reason" data-k="reason"></p>
        </div>
        <div class="stage-actions">
          <button type="button" data-b="start" data-k="start" class="primary"><i>▶</i><span>検証する</span></button>
          <button type="button" data-b="cancel" data-k="cancel" hidden><i>■</i><span>中止</span></button>
          <button type="button" data-b="cert" data-k="cert" hidden><i>⇩</i><span>証明書を保存</span></button>
          <button type="button" data-b="blueprint" data-k="bpBtn" hidden><i>▤</i><span>設計図を書き出す</span></button>
        </div>
        <p class="bp-msg" data-k="msg" role="status"></p>
        <p class="bp-note">認定は、ゲームの中のルールで決まった回数だけくり返しを確かめた結果です。${DISCLAIMER.replace('ゲーム内ルールに基づく有限回の周期再検証結果。', '')}証明書はこの端末で作るだけの記録で、受け取った人は設計図を自分で検証し直せます。</p>
        <div class="stage-actions"><button type="button" data-b="close"><i>✕</i><span>閉じる</span></button></div>
      </div>`;
    root.appendChild(modal);
    this.el.modal = modal;
    modal.querySelectorAll<HTMLElement>('[data-k]').forEach((n) => (this.el[n.dataset.k!] = n));
    modal.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-b]');
      if (!b || b.disabled) return;
      if (b.dataset.b === 'start') this.start();
      if (b.dataset.b === 'cancel') this.cancel('中止しました');
      if (b.dataset.b === 'close') {
        this.cancel('');
        modal.hidden = true;
      }
      if (b.dataset.b === 'cert') void this.saveCertificate();
      if (b.dataset.b === 'blueprint') this.saveBlueprint();
    });
  }

  private show(): void {
    const name = this.el.name as HTMLInputElement;
    if (!name.value) name.value = '無題の機関';
    this.el.modal.hidden = false;
  }

  private start(): void {
    this.cancel('');
    const devices = this.editor.layout.devices.map((d) => ({ ...d }));
    const seed = this.editor.layout.seed;
    const machine = new SimMachine(this.R, { seed, devices });
    const verifier = new PerpetualVerifier(machine);
    this.job = { verifier, machine, raf: 0, devices, seed };
    this.el.progressBox.hidden = false;
    this.el.result.hidden = true;
    this.el.start.hidden = true;
    this.el.cancel.hidden = false;
    this.el.cert.hidden = true;
    this.el.bpBtn.hidden = true;
    this.el.dialog.classList.remove('clear');
    this.say('');
    const tick = () => {
      const job = this.job;
      if (!job) return;
      const t0 = performance.now();
      let r: VerifyResult | null = null;
      while (!r && performance.now() - t0 < FRAME_BUDGET_MS) r = job.verifier.run(30);
      this.render();
      if (r) this.done(r);
      else job.raf = window.setTimeout(tick, 0);
    };
    this.job.raf = window.setTimeout(tick, 0);
  }

  private cancel(text: string): void {
    if (!this.job) return;
    clearTimeout(this.job.raf);
    this.job.machine.dispose();
    this.job = null;
    this.el.start.hidden = false;
    this.el.cancel.hidden = true;
    if (text) {
      (this.el.status as HTMLElement).textContent = text;
      this.say(text);
    }
  }

  private bugNames(ids: string[]): string {
    if (ids.length === 0) return 'なし';
    const found = loadCodex().discovered;
    return ids.map((id) => (found[id] ? `${id} ${CODEX.find((c) => c.id === id)?.name ?? ''}` : `${id}（未発見）`)).join('、');
  }

  private render(): void {
    if (!this.job) return;
    const p = this.job.verifier.progress();
    (this.el.bar as HTMLProgressElement).value = p.tick / p.maxSteps;
    this.el.status.textContent = `${STATUS_TEXT[p.status] ?? p.status}…（ゲーム内 ${(p.tick / PHYSICS_HZ).toFixed(0)} 秒 / 最大 ${(p.maxSteps / PHYSICS_HZ).toFixed(0)} 秒）`;
    this.el.period.textContent = p.candidatePeriod === null ? '—' : `${(p.candidatePeriod / PHYSICS_HZ).toFixed(2)} 秒（確認 ${Math.max(0, p.confirmedCycles - 1)} 回）`;
    this.el.outputs.textContent = String(p.outputEvents);
    this.el.bugs.textContent = this.bugNames(p.bugs);
  }

  private done(r: VerifyResult): void {
    const job = this.job!;
    clearTimeout(job.raf);
    job.machine.dispose();
    this.job = null;
    // 検証の中で起きたバグも、図鑑に記録する（初めてなら発見の演出）
    if (r.bugs.length) this.onBugs(r.bugs);
    this.el.bugs.textContent = this.bugNames(r.bugs);
    const name = (this.el.name as HTMLInputElement).value.trim() || '無題の機関';
    this.last = { result: r, devices: job.devices, seed: job.seed, name };
    this.el.start.hidden = false;
    (this.el.start.querySelector('span') as HTMLElement).textContent = 'もう一度検証する';
    this.el.cancel.hidden = true;
    this.el.result.hidden = false;
    this.el.verdict.textContent = STATUS_TEXT[r.status];
    this.el.verdict.dataset.status = r.status;
    this.el.reason.textContent =
      r.status === 'VERIFIED'
        ? `「${name}」　周期 ${((r.periodSteps ?? 0) / PHYSICS_HZ).toFixed(2)} 秒・毎周期の出力 ${r.outputEventsPerCycle.join(' / ')}・使ったバグ ${this.bugNames(r.bugs)}`
        : r.reason;
    this.el.s404text.textContent = r.status === 'VERIFIED' ? '「仕様です。」' : r.status === 'FAILED' ? '「惜しいですね。」' : '「観測が足りません。」';
    this.el.cert.hidden = r.status !== 'VERIFIED';
    this.el.bpBtn.hidden = r.status !== 'VERIFIED';
    this.el.status.textContent = `${STATUS_TEXT[r.status]}（ゲーム内 ${(r.tick / PHYSICS_HZ).toFixed(0)} 秒まで調べました）`;
    if (r.status === 'VERIFIED') {
      this.el.dialog.classList.add('clear');
      celebrate(this.root);
    }
  }

  private download(json: string, file: string): void {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = file;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  private async saveCertificate(): Promise<void> {
    if (!this.last) return;
    try {
      const cert = await makeCertificate(this.last.result, this.last.devices, this.last.seed, this.last.name);
      const file = fileNameFor(`${this.last.name}_証明書`);
      this.download(JSON.stringify(cert, null, 2), file);
      this.say(`「${file}」を書き出しました`);
    } catch {
      this.say('証明書を書き出せませんでした');
    }
  }

  private saveBlueprint(): void {
    if (!this.last) return;
    try {
      const bp = toBlueprint(this.last.devices, this.last.seed, { title: this.last.name });
      const file = fileNameFor(this.last.name);
      this.download(blueprintToJson(bp), file);
      this.say(`「${file}」を書き出しました`);
    } catch {
      this.say('設計図を書き出せませんでした');
    }
  }

  private say(text: string): void {
    this.el.msg.textContent = text;
  }
}
