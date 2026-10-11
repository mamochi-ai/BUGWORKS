// 実ブラウザでの手動スモークテスト（vitest対象外）。使い方は docs/TEST_PLAN.md 参照。
const { chromium, devices } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.argv[2] || '.';
const url = process.env.BUGWORKS_URL || 'http://localhost:5173/';
const camState = (p) => p.evaluate(() => { const r = window.__bugworks.rig; return { pos: r.camera.position.toArray().map(v=>+v.toFixed(3)), target: r.controls.target.toArray().map(v=>+v.toFixed(3)) }; });
const simState = (p) => p.evaluate(() => { const b = window.__bugworks; return { state: b.ctl.state, tick: b.sim.tick, ball: (b.sim.readBalls()[0]?.position ?? []).map(v=>+v.toFixed(3)) }; });
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const errors = [];
  // ---- Desktop
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => errors.push('desktop: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('desktop console: ' + m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.__bugworks);
  await page.getByRole('button', { name: '自由研究' }).click(); // 起動時のステージ選択を閉じる
  await page.waitForTimeout(500);
  await page.screenshot({ path: out + '/desktop_initial.png' });
  console.log('initial', await simState(page));
  await page.getByRole('button', { name: '再生', exact: true }).click();
  await page.waitForTimeout(2500);
  console.log('after play 2.5s', await simState(page));
  await page.screenshot({ path: out + '/desktop_running.png' });
  await page.getByRole('button', { name: '一時停止', exact: true }).click();
  const p1 = await simState(page); await page.waitForTimeout(400); const p2 = await simState(page);
  console.log('paused stable:', p1.tick === p2.tick, p2);
  await page.getByRole('button', { name: '1ステップ進める', exact: true }).click();
  console.log('after step', await simState(page));
  await page.getByRole('button', { name: 'リセット', exact: true }).click();
  console.log('after reset', await simState(page));
  // mouse right-drag rotate + wheel
  const c0 = await camState(page);
  await page.mouse.move(640, 400); await page.mouse.down({ button: 'right' }); await page.mouse.move(800, 380, { steps: 10 }); await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(400);
  const c1 = await camState(page);
  await page.mouse.wheel(0, -400); await page.waitForTimeout(400);
  const c2 = await camState(page);
  console.log('mouse rotate changed pos:', JSON.stringify(c0.pos) !== JSON.stringify(c1.pos), 'wheel:', c1.pos, '->', c2.pos);
  await page.keyboard.press('Space'); await page.waitForTimeout(300);
  console.log('space ->', (await simState(page)).state);
  await page.close();

  // ---- iPad (touch)
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'] });
  const ip = await ctx.newPage();
  ip.on('pageerror', e => errors.push('ipad: ' + e.message));
  await ip.goto(url);
  await ip.waitForFunction(() => window.__bugworks);
  await ip.getByRole('button', { name: '自由研究' }).tap();
  await ip.waitForTimeout(500);
  const cdp = await ctx.newCDPSession(ip);
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x,y],i)=>({x,y,id:i})) });
  const d0 = await camState(ip);
  await touch('touchStart', [[900,650]]);
  for (let i=1;i<=10;i++) await touch('touchMove', [[900+i*15,650]]);
  await touch('touchEnd', []);
  await ip.waitForTimeout(500);
  const d1 = await camState(ip);
  console.log('1-finger drag rotated:', JSON.stringify(d0.pos) !== JSON.stringify(d1.pos), 'target unchanged:', JSON.stringify(d0.target) === JSON.stringify(d1.target));
  const dist = (s) => Math.hypot(...s.pos.map((v,i)=>v-s.target[i]));
  await touch('touchStart', [[500,400],[700,400]]);
  for (let i=1;i<=10;i++) await touch('touchMove', [[500-i*10,400],[700+i*10,400]]);
  await touch('touchEnd', []);
  await ip.waitForTimeout(500);
  const d2 = await camState(ip);
  console.log('pinch-out distance', dist(d1).toFixed(3), '->', dist(d2).toFixed(3));
  await touch('touchStart', [[500,400],[700,400]]);
  for (let i=1;i<=10;i++) await touch('touchMove', [[500,400+i*12],[700,400+i*12]]);
  await touch('touchEnd', []);
  await ip.waitForTimeout(500);
  const d3 = await camState(ip);
  console.log('2-finger pan target', d2.target, '->', d3.target);
  await ip.getByRole('button', { name: '再生', exact: true }).tap();
  await ip.waitForTimeout(2000);
  console.log('ipad after tap play', await simState(ip));
  await ip.screenshot({ path: out + '/ipad_running.png' });
  const sizes = await ip.$$eval('.controls button', bs => bs.map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  console.log('button sizes', JSON.stringify(sizes));
  await ctx.close(); // 前のページを閉じてから次を開く（ソフトウェア描画でCPUを奪い合わないように）
  // ---- iPad Mini（縦向き）のレイアウト確認
  const ctx2 = await browser.newContext({ ...devices['iPad Mini'] });
  const pm = await ctx2.newPage(); await pm.goto(url); await pm.waitForFunction(() => window.__bugworks, null, { timeout: 120000 }); await pm.getByRole('button', { name: '自由研究' }).tap(); await pm.waitForTimeout(400);
  await pm.screenshot({ path: out + '/ipad_mini_portrait.png' });
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
