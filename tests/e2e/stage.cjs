// ステージの実ブラウザ確認（iPadタッチをエミュレート）。vitest対象外。使い方は docs/TEST_PLAN.md 参照。
const { chromium, devices } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.argv[2] || '.';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ ...devices['iPad Pro 11 landscape'] });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type()==='error' && errs.push(m.text()));
  await p.goto(process.env.BUGWORKS_URL || 'http://localhost:5173/'); await p.waitForFunction(() => window.__bugworks, null, { timeout: 60000 });
  await p.evaluate(() => localStorage.clear());
  await p.waitForTimeout(400);
  await p.screenshot({ path: out + '/stage_select.png' });
  await p.getByRole('button', { name: /ステージ 1-1/ }).tap(); await p.waitForTimeout(400);
  const palette = await p.evaluate(() => [...document.querySelectorAll('.palette button')].filter(x => !x.hidden).map(x => x.textContent.trim()));
  console.log('palette in 1-1:', palette);
  // 固定の装置は動かせない
  const lockedMove = await p.evaluate(() => { const e = window.__bugworks.editor; e.previewMove('rail_1', 1, -2); return e.message; });
  console.log('locked move:', lockedMove);
  await p.locator('[data-e="add-rail"]').tap(); await p.waitForTimeout(300);
  const left = await p.evaluate(() => document.querySelector('[data-e="add-rail"]').disabled);
  console.log('rail button disabled after add:', left);
  // 置いたレールを正解の位置へ（ドラッグの代わりに編集モデルを直接使う）
  await p.evaluate(() => { const e = window.__bugworks.editor; const id = e.devices.find(d => !e.isLocked(d.id)).id;
    e.changeHeight(id, 2 - Math.round(e.devices.find(d => d.id === id).position[1] / 0.1));
    const ev = e.previewMove(id, 0, 0); e.commitMove(id, ev); });
  console.log('placed:', await p.evaluate(() => window.__bugworks.editor.message));
  await p.screenshot({ path: out + '/stage_before_play.png' });
  await p.getByRole('button', { name: '再生', exact: true }).tap();
  // ソフトウェア描画では処理落ちで物理時間の進みが遅いので、長めに待つ
  await p.waitForSelector('#stage-clear-title', { state: 'visible', timeout: 120000 }).catch(async (e) => {
    console.log('not cleared:', await p.evaluate(() => { const s = window.__bugworks.sim; return { tick: s.tick, goals: s.goalHits, balls: s.ballCount }; })); throw e; });
  await p.waitForTimeout(300);
  await p.screenshot({ path: out + '/stage_clear.png' });
  console.log('progress:', await p.evaluate(() => localStorage.getItem('bugworks.progress.v1')));
  await p.getByRole('button', { name: '次のステージへ' }).tap(); await p.waitForTimeout(400);
  console.log('now:', await p.evaluate(() => window.__bugworks.stage.current.id));
  await p.screenshot({ path: out + '/stage_next.png' });
  await p.getByRole('button', { name: 'ステージ選択を開く' }).tap(); await p.waitForTimeout(300);
  await p.screenshot({ path: out + '/stage_select_after.png' });
  console.log('errors:', errs);
  await b.close();
})();
