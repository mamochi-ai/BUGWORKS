// 配置編集の実ブラウザ確認（iPadタッチをエミュレート）。vitest対象外。使い方は docs/TEST_PLAN.md 参照。
const { chromium, devices } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.argv[2] || '.';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ ...devices['iPad Pro 11 landscape'] });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type()==='error' && errs.push(m.text()));
  await p.goto(process.env.BUGWORKS_URL || 'http://localhost:5173/'); await p.waitForFunction(() => window.__bugworks, null, { timeout: 60000 });
  await p.waitForTimeout(500);
  const cdp = await ctx.newCDPSession(p);
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x,y],i)=>({x,y,id:i})) });
  const drag = async (from, to, steps = 12) => {
    await touch('touchStart', [from]);
    for (let i = 1; i <= steps; i++) await touch('touchMove', [[from[0] + (to[0]-from[0])*i/steps, from[1] + (to[1]-from[1])*i/steps]]);
    await touch('touchEnd', []);
    await p.waitForTimeout(300);
  };
  // ワールド座標→画面座標
  const screen = (v) => p.evaluate((v) => { const { rig } = window.__bugworks; const c = rig.camera; c.updateMatrixWorld(); const V = c.position.constructor; const w = new V(...v).project(c); const r = document.querySelector('canvas').getBoundingClientRect(); return [r.left + (w.x+1)/2*r.width, r.top + (1-w.y)/2*r.height]; }, v);
  const state = () => p.evaluate(() => { const { editor, ctl, sim, rig } = window.__bugworks; return { n: editor.devices.length, sel: editor.selectedId, msg: editor.message?.text, conns: editor.connections().map(c => c.from.deviceId + '>' + c.to.deviceId), state: ctl.state, ball: sim.readBall().position.map(v => +v.toFixed(2)), cam: rig.camera.position.toArray().map(v => +v.toFixed(2)) }; });
  const fix = (pos, tgt) => p.evaluate(([pos,tgt]) => { const r = window.__bugworks.rig; r.controls.enableDamping = false; r.camera.position.set(...pos); r.controls.target.set(...tgt); r.controls.update(); }, [pos,tgt]);

  await fix([7, 9, 3], [1.5, 0, -1]);
  await p.waitForTimeout(300);
  console.log('0 initial', await state());

  // 1) パレットからレールを追加
  await p.getByRole('button', { name: '＋ レール' }).tap();
  await p.waitForTimeout(300);
  let s = await state(); console.log('1 added', s);
  const newId = s.sel;
  const pos = await p.evaluate((id) => window.__bugworks.editor.devices.find(d => d.id === id).position, newId);

  // 2) 空き場所の1本指ドラッグはカメラ回転（部品は動かない）
  const camBefore = (await state()).cam;
  await drag([150, 650], [300, 650]);
  s = await state(); console.log('2 empty drag: camera moved', JSON.stringify(camBefore) !== JSON.stringify(s.cam), 'devices same', s.n);
  await fix([7, 9, 3], [1.5, 0, -1]); await p.waitForTimeout(300);

  // 3) 新しいレールを1本指でドラッグし、rail_1 の入口（z=-3）の手前へ → 吸着して接続
  const from = await screen([pos[0], pos[1] + 0.3, pos[2]]);
  console.log('rail_4 at', pos, 'from', from.map(Math.round));
  const to = await screen([0.2, 0, -4.1]);
  const camB = (await state()).cam;
  await drag(from, to, 16);
  s = await state(); console.log('3 dragged', s, 'camera unchanged', JSON.stringify(camB) === JSON.stringify(s.cam));
  await p.screenshot({ path: out + '/edit_snapped.png' });

  // 4) 再生すると鉄球は新しいレールから出発する
  const startBall = s.ball;
  await p.getByRole('button', { name: '再生', exact: true }).tap();
  await p.waitForTimeout(3000);
  s = await state(); console.log('4 running from', startBall, '->', s.ball, s.state);

  // 5) 実行中にレールに触れるとリセットされ編集できる。回転→元に戻す
  const r3 = await screen([0, 0.3, 2]);
  await touch('touchStart', [r3]); await touch('touchEnd', []); await p.waitForTimeout(300);
  s = await state(); console.log('5 tapped rail while running ->', s.state, s.sel);
  await p.getByRole('button', { name: '回転' }).tap(); await p.waitForTimeout(200);
  console.log('5b rotate', (await state()).msg);
  await p.getByRole('button', { name: '元に戻す' }).tap(); await p.waitForTimeout(200);
  console.log('5c undo', (await state()).msg);

  // 6) 置けない場所（他のレールに重ねる）→ 元に戻り理由表示
  await fix([7, 9, 3], [1.5, 0, -1]); await p.waitForTimeout(300);
  const r3b = await screen([0, 0.3, 2]);
  const r2 = await screen([0, 0, 0.2]);
  await drag(r3b, r2, 10);
  s = await state(); console.log('6 overlap drop', s.msg, s.conns);

  // 7) 何もない所をタップ → 選択解除
  await touch('touchStart', [[1050, 120]]); await touch('touchEnd', []); await p.waitForTimeout(200);
  console.log('7 tap empty sel', (await state()).sel);
  await p.screenshot({ path: out + '/edit_final.png' });
  console.log('errors', errs);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
