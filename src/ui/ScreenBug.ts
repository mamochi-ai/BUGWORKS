import type { Vec3 } from '../sim/catalog';

/**
 * BUG-27 の効果（D-46）：画面の表示（HUD）が左右に反転し、隠し座標（いちばん古い球の位置）を出す。
 * 物理・操作には関わらない（ボタンの位置が入れ替わるだけで、押したボタンの働きは同じ）。リセットで元に戻る。
 */
export class ScreenBug {
  private box: HTMLElement;
  private _on = false;

  constructor(private readonly hud: HTMLElement) {
    this.box = document.createElement('div');
    this.box.className = 'hidden-coords';
    this.box.hidden = true;
    this.box.setAttribute('aria-live', 'off');
    hud.appendChild(this.box);
  }

  get on(): boolean {
    return this._on;
  }

  set(on: boolean): void {
    this._on = on;
    this.hud.classList.toggle('hud-mirror', on);
    this.box.hidden = !on;
  }

  update(ball: Vec3 | null, tick: number): void {
    if (!this._on) return;
    const f = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(3);
    this.box.textContent = ball ? `# T${tick}  X${f(ball[0])} Y${f(ball[1])} Z${f(ball[2])}` : `# T${tick}  NO SIGNAL`;
  }
}
