/**
 * 画面の演出（D-40）。どれも見た目だけで、時間でゲームを進めたりしない。
 * 「動きを減らす」設定の端末では出さない。
 */
export function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** S-404（研究所の案内ロボット）の顔。文字の「S-404」と一緒に使う（絵だけに頼らない） */
export const S404_SVG = `<svg class="s404-face" viewBox="0 0 40 40" aria-hidden="true">
  <line x1="20" y1="3" x2="20" y2="9" stroke="#3fd4ff" stroke-width="2"/>
  <circle cx="20" cy="3" r="2.5" fill="#ff7a1a"/>
  <rect x="6" y="9" width="28" height="22" rx="7" fill="#2a2f36" stroke="#3fd4ff" stroke-width="2"/>
  <g class="s404-eyes"><circle cx="15" cy="20" r="3.2" fill="#3fd4ff"/><circle cx="25" cy="20" r="3.2" fill="#3fd4ff"/></g>
  <rect x="14" y="26" width="12" height="2" rx="1" fill="#9aa3ae"/>
  <rect x="11" y="31" width="18" height="6" rx="2" fill="#ff7a1a"/>
</svg>`;

/** クリアのときの紙ふぶき（決まった並びで作り、1.8秒で消える） */
export function celebrate(root: HTMLElement): void {
  if (reducedMotion()) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  box.setAttribute('aria-hidden', 'true');
  const colors = ['#ff7a1a', '#3fd4ff', '#e6e9ee', '#ffd23f'];
  for (let i = 0; i < 40; i++) {
    const p = document.createElement('span');
    const x = (i * 37) % 100;
    p.style.left = `${x}%`;
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = `${(i % 8) * 40}ms`;
    p.style.setProperty('--drift', `${((i * 53) % 120) - 60}px`);
    p.style.setProperty('--spin', `${((i * 97) % 720) - 360}deg`);
    box.appendChild(p);
  }
  root.appendChild(box);
  setTimeout(() => box.remove(), 1900);
}
