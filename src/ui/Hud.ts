import { PHYSICS_HZ } from '../sim/constants';
import { MAX_BALLS } from '../sim/launcher';
import type { RunState, SimulationController } from '../sim/SimulationController';

/** 状態は色だけでなく記号とテキストでも示す（マスター仕様 §8 アクセシビリティ） */
const STATE_LABEL: Record<RunState, { icon: string; text: string }> = {
  ready: { icon: '■', text: '初期状態' },
  running: { icon: '▶', text: '実行中' },
  paused: { icon: '❚❚', text: '一時停止' },
};

export interface HudStats {
  fps: number;
  ticksPerSecond: number;
  physicsMsPerFrame: number;
  droppedSeconds: number;
}

/** UI文字は画像ではなくHTMLテキストで描画する（UI画像シートは参考デザインのみ） */
export class Hud {
  private el: Record<string, HTMLElement> = {};

  constructor(
    root: HTMLElement,
    private readonly ctl: SimulationController,
    onCameraHome: () => void,
  ) {
    root.innerHTML = `
      <header class="hud-top">
        <div class="brand">BUGWORKS <small>縦切り試作</small></div>
        <div class="status" data-k="status" role="status" aria-live="polite"></div>
      </header>
      <section class="readout" aria-label="計測値">
        <div><span>tick</span><b data-k="tick">0</b></div>
        <div><span>時間</span><b data-k="time">0.00 s</b></div>
        <div><span>球数</span><b data-k="balls">0 / ${MAX_BALLS}</b></div>
        <div><span>描画</span><b data-k="fps">– fps</b></div>
        <div><span>物理</span><b data-k="tps">– tick/s</b></div>
        <div><span>物理負荷</span><b data-k="pms">– ms</b></div>
        <div class="warn" data-k="warn" hidden></div>
      </section>
      <nav class="controls" aria-label="シミュレーション操作">
        <button type="button" data-a="play" class="primary"></button>
        <button type="button" data-a="step" aria-label="1ステップ進める"><i>⏭</i><span>1ステップ</span></button>
        <button type="button" data-a="reset" aria-label="リセット"><i>↺</i><span>リセット</span></button>
        <button type="button" data-a="speed" aria-label="再生速度"></button>
        <button type="button" data-a="home" aria-label="視点を戻す"><i>⌂</i><span>視点</span></button>
        <button type="button" data-a="help" aria-label="操作説明" aria-expanded="false"><i>?</i><span>操作</span></button>
      </nav>
      <aside class="help" data-k="help" hidden>
        <h2>操作</h2>
        <dl>
          <dt>タッチ</dt><dd>1本指ドラッグ：回転／2本指ドラッグ：平行移動／ピンチ：ズーム</dd>
          <dt>マウス</dt><dd>左/右ドラッグ：回転／中ドラッグ・Shift+左ドラッグ：平行移動／ホイール：ズーム</dd>
          <dt>キー</dt><dd>Space：再生/一時停止／. ：1ステップ／Q・E：上下移動／矢印：平行移動</dd>
        </dl>
        <p>物理は固定 ${PHYSICS_HZ}Hz、描画は端末のフレームレートで補間表示しています。</p>
      </aside>
    `;
    root.querySelectorAll<HTMLElement>('[data-k]').forEach((n) => (this.el[n.dataset.k!] = n));
    root.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((b) => (this.el['btn-' + b.dataset.a!] = b));

    const on = (k: string, fn: () => void) => this.el['btn-' + k].addEventListener('click', fn);
    on('play', () => ctl.togglePlay());
    on('step', () => ctl.stepOnce());
    on('reset', () => ctl.reset());
    on('speed', () => ctl.cycleSpeed());
    on('home', onCameraHome);
    on('help', () => {
      const h = this.el.help;
      h.hidden = !h.hidden;
      this.el['btn-help'].setAttribute('aria-expanded', String(!h.hidden));
    });

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        ctl.togglePlay();
      } else if (e.key === '.') {
        ctl.stepOnce();
      }
    });

    ctl.onChange(() => this.syncControls());
    this.syncControls();
  }

  private syncControls(): void {
    const s = STATE_LABEL[this.ctl.state];
    this.el.status.innerHTML = `<i aria-hidden="true">${s.icon}</i> ${s.text}`;
    this.el.status.dataset.state = this.ctl.state;
    const running = this.ctl.state === 'running';
    this.el['btn-play'].innerHTML = running ? '<i>❚❚</i><span>一時停止</span>' : '<i>▶</i><span>再生</span>';
    this.el['btn-play'].setAttribute('aria-label', running ? '一時停止' : '再生');
    this.el['btn-speed'].innerHTML = `<i>×</i><span>速度 ${this.ctl.speed}</span>`;
  }

  update(stats: HudStats): void {
    const sim = this.ctl.sim;
    this.el.tick.textContent = String(sim.tick);
    this.el.time.textContent = `${sim.timeSeconds.toFixed(2)} s`;
    this.el.balls.textContent = `${sim.ballCount} / ${MAX_BALLS}`;
    this.el.fps.textContent = `${stats.fps.toFixed(0)} fps`;
    this.el.tps.textContent = `${stats.ticksPerSecond.toFixed(0)} tick/s`;
    this.el.pms.textContent = `${stats.physicsMsPerFrame.toFixed(2)} ms`;
    const waiting = sim.launcherWaiting;
    const warn = waiting === 'max_balls'
      ? `⚠ 球が上限（${MAX_BALLS}個）に達したため、発射を止めています`
      : waiting === 'loading'
        ? '⚠ 次の球を装填できないため、発射を待っています（装填口の近くに球が残っています）'
        : sim.lostBalls > 0
          ? `⚠ 場外に落ちた球を ${sim.lostBalls} 個取り除きました`
          : stats.droppedSeconds > 0
        ? '⚠ 処理落ち：一部のシミュレーション時間を省略しました'
        : '';
    this.el.warn.hidden = warn === '';
    this.el.warn.textContent = warn;
  }
}
