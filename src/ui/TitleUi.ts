import type { Sound } from './Sound';

/**
 * タイトル画面（メインメニュー, DECISIONS.md D-47）。UI デザインシート「02 メインメニュー」を手本に、HTML と SVG で作る（画像は使わない）。
 * 起動すると最初に出る。後ろでは研究所の 3D がそのまま見える。
 * - ゲーム開始：ステージ選択へ
 * - 設計図を読み込む：自由研究にして、設計図の画面を開く
 * - 設定：効果音・BGM の ON/OFF（この端末に保存）
 * - クレジット：使っているもの
 * - 終了：ブラウザではページを閉じられないので、閉じ方と「進み具合は保存済み」を知らせる
 * 上のバーの「タイトル」でいつでも戻れる。
 */
export const S404_BIG_SVG = `<svg class="title-robot" viewBox="0 0 260 300" aria-hidden="true">
  <defs>
    <radialGradient id="tr-helm" cx="40%" cy="30%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.7" stop-color="#d9dee5"/><stop offset="1" stop-color="#9aa3ae"/></radialGradient>
    <linearGradient id="tr-visor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2027"/><stop offset="1" stop-color="#07090b"/></linearGradient>
    <filter id="tr-glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <g class="tr-bob">
    <path d="M56 78 L66 14 L108 52 Z" fill="#ff7a1a" stroke="#b44f0a" stroke-width="3" stroke-linejoin="round"/>
    <path d="M204 78 L194 14 L152 52 Z" fill="#ff7a1a" stroke="#b44f0a" stroke-width="3" stroke-linejoin="round"/>
    <path d="M78 186 Q130 166 182 186 L192 268 Q130 290 68 268 Z" fill="url(#tr-helm)" stroke="#8a929c" stroke-width="3"/>
    <rect x="110" y="206" width="40" height="28" rx="7" fill="#ff7a1a" stroke="#b44f0a" stroke-width="2"/>
    <circle cx="130" cy="220" r="6" fill="#ffd23f" filter="url(#tr-glow)"/>
    <rect x="44" y="196" width="30" height="64" rx="15" fill="url(#tr-helm)" stroke="#8a929c" stroke-width="3" transform="rotate(14 59 228)"/>
    <rect x="186" y="196" width="30" height="64" rx="15" fill="url(#tr-helm)" stroke="#8a929c" stroke-width="3" transform="rotate(-24 201 228)"/>
    <g transform="rotate(-30 222 238)"><rect x="214" y="200" width="14" height="70" rx="5" fill="#9aa3ae" stroke="#5b636d" stroke-width="2"/><path d="M206 196 h30 v18 h-8 v-8 h-14 v8 h-8 Z" fill="#9aa3ae" stroke="#5b636d" stroke-width="2"/></g>
    <ellipse cx="130" cy="110" rx="94" ry="86" fill="url(#tr-helm)" stroke="#8a929c" stroke-width="3"/>
    <circle cx="38" cy="118" r="26" fill="#2a2f36" stroke="#ff7a1a" stroke-width="7"/>
    <circle cx="222" cy="118" r="26" fill="#2a2f36" stroke="#ff7a1a" stroke-width="7"/>
    <rect x="60" y="58" width="140" height="110" rx="52" fill="url(#tr-visor)" stroke="#2a2f36" stroke-width="3"/>
    <path d="M78 76 Q110 62 150 66" stroke="#ffffff" stroke-opacity="0.18" stroke-width="7" fill="none" stroke-linecap="round"/>
    <g class="tr-eyes" filter="url(#tr-glow)"><rect x="94" y="90" width="22" height="44" rx="11" fill="#ffb02e"/><rect x="144" y="90" width="22" height="44" rx="11" fill="#ffb02e"/></g>
  </g>
</svg>`;

export class TitleUi {
  private el: Record<string, HTMLElement> = {};

  constructor(
    root: HTMLElement,
    private readonly actions: { start: () => void; loadBlueprint: () => void; sound: Sound; onSettings: () => void },
  ) {
    const box = document.createElement('div');
    box.className = 'title-screen';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'title-logo');
    box.innerHTML = `
      <div class="title-menu">
        <h1 id="title-logo" class="title-logo"><span>仕様です。</span><small>BUGWORKS</small></h1>
        <nav class="title-buttons" aria-label="メインメニュー">
          <button type="button" data-t="start" class="primary">ゲーム開始</button>
          <button type="button" data-t="blueprint">設計図を読み込む</button>
          <button type="button" data-t="settings">設定</button>
          <button type="button" data-t="credits">クレジット</button>
          <button type="button" data-t="quit">終了</button>
        </nav>
        <p class="title-note" data-k="note" role="status"></p>
      </div>
      <div class="title-art">${S404_BIG_SVG}<p class="title-says"><b>S-404</b>「研究所へようこそ。バグは……仕様です。」</p></div>`;
    root.appendChild(box);
    this.el.box = box;

    const sub = document.createElement('div');
    sub.className = 'stage-modal title-sub';
    sub.hidden = true;
    sub.innerHTML = `
      <div class="stage-dialog" role="dialog" aria-modal="true" aria-labelledby="title-sub-h">
        <h2 id="title-sub-h" data-k="subTitle"></h2>
        <div data-k="subBody" class="title-sub-body"></div>
        <div class="stage-actions"><button type="button" data-t="close-sub"><i>✕</i><span>閉じる</span></button></div>
      </div>`;
    root.appendChild(sub);
    this.el.sub = sub;
    for (const b of [box, sub]) b.querySelectorAll<HTMLElement>('[data-k]').forEach((n) => (this.el[n.dataset.k!] = n));

    const onClick = (e: Event) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-t]');
      if (b) this.run(b.dataset.t!);
    };
    box.addEventListener('click', onClick);
    sub.addEventListener('click', onClick);
  }

  get visible(): boolean {
    return !this.el.box.hidden;
  }

  show(): void {
    this.el.note.textContent = '';
    this.el.box.hidden = false;
    this.el.box.querySelector<HTMLElement>('[data-t="start"]')?.focus();
  }

  hide(): void {
    this.el.box.hidden = true;
    this.el.sub.hidden = true;
  }

  private run(action: string): void {
    switch (action) {
      case 'start':
        this.hide();
        this.actions.start();
        break;
      case 'blueprint':
        this.hide();
        this.actions.loadBlueprint();
        break;
      case 'settings':
        this.openSettings();
        break;
      case 'credits':
        this.openSub(
          'クレジット',
          `<dl class="title-credits">
            <dt>BUGWORKS（縦切り試作）</dt><dd>3D物理工作パズルの Web 試作です。</dd>
            <dt>物理エンジン</dt><dd>Rapier（Dimforge, Apache License 2.0）</dd>
            <dt>3D 描画</dt><dd>three.js（MIT License）</dd>
            <dt>研究所の部屋</dt><dd>提供された 3D モデル（industrial room）</dd>
            <dt>効果音・BGM</dt><dd>Web Audio でその場で合成</dd>
          </dl>`,
        );
        break;
      case 'quit':
        this.el.note.textContent = 'ブラウザのタブ（またはホーム画面のアプリ）を閉じると終了します。クリアの記録と設計図は、この端末に保存されています。';
        break;
      case 'close-sub':
        this.el.sub.hidden = true;
        break;
      case 'toggle-sound':
        this.actions.sound.setEnabled(!this.actions.sound.enabled);
        this.actions.onSettings();
        this.openSettings();
        break;
      case 'toggle-bgm':
        this.actions.sound.setBgmEnabled(!this.actions.sound.bgmEnabled);
        this.actions.onSettings();
        this.openSettings();
        break;
    }
  }

  private openSettings(): void {
    const s = this.actions.sound;
    const row = (key: string, label: string, on: boolean) =>
      `<div class="title-row"><span>${label}</span><button type="button" class="toggle" data-t="${key}" role="switch" aria-checked="${on}" aria-label="${label}"><i></i><span>${on ? 'オン' : 'オフ'}</span></button></div>`;
    this.openSub('設定', `${row('toggle-sound', '効果音', s.enabled)}${row('toggle-bgm', 'BGM', s.bgmEnabled)}<p class="bp-note">設定はこの端末に保存されます。上のバーの ♪・♫ でも切り替えられます。</p>`);
  }

  private openSub(title: string, html: string): void {
    this.el.subTitle.textContent = title;
    this.el.subBody.innerHTML = html;
    this.el.sub.hidden = false;
  }
}
