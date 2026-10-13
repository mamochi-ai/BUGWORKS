// 永久機関の検証・BGM ボタン・ステージ4 の画面確認（vitest対象外）。使い方は docs/TEST_PLAN.md 参照。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.argv[2] || '.';
const url = process.env.BUGWORKS_URL || 'http://localhost:5173/';
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  for (const [name, w, h] of [['landscape', 1194, 834], ['portrait', 834, 1194]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    p.setDefaultTimeout(120000);
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message));
    await p.goto(url);
    await p.waitForFunction(() => window.__bugworks);
    await p.getByRole('button', { name: 'ゲーム開始' }).click(); await p.getByRole('button', { name: '自由研究' }).click();
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/${name}_top.png` });
    // 止まる機械（1球だけ撃ってゴール）で検証 → 不成立（止まっている）
    await p.evaluate(() => {
      const b = window.__bugworks;
      b.editor.loadLayout([
        { id: 'launcher_1', type: 'launcher', position: [0, 0, -3.65], rotationYDeg: 0, params: { shots: 1 } },
        { id: 'rail_1', type: 'rail', position: [0, 0.4, -2], rotationYDeg: 0 },
        { id: 'rail_2', type: 'rail', position: [0, 0.2, 0], rotationYDeg: 0 },
        { id: 'rail_3', type: 'rail', position: [0, 0, 2], rotationYDeg: 0 },
        { id: 'goal_1', type: 'goal', position: [0, 0, 3.75], rotationYDeg: 0 },
      ], 'e2e');
    });
    await p.getByRole('button', { name: '永久機関の検証' }).click();
    await p.getByRole('button', { name: '検証する' }).click();
    await p.waitForFunction(() => document.querySelector('.pm-result') && !document.querySelector('.pm-result').hidden, null, { timeout: 120000 });
    await p.screenshot({ path: `${out}/${name}_perpetual.png` });
    console.log(name, 'verdict:', await p.locator('.pm-verdict').textContent(), '/', await p.locator('.pm-reason').textContent());
    await p.getByRole('button', { name: '閉じる' }).last().click();
    await ctx.close();
  }
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})();
