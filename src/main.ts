import { CameraRig } from './input/CameraRig';
import { LabView } from './render/LabView';
import { VERTICAL_SLICE_LAYOUT } from './sim/layout';
import { loadRapier } from './sim/rapier';
import { Simulation } from './sim/Simulation';
import { SimulationController } from './sim/SimulationController';
import { Hud } from './ui/Hud';

async function boot(): Promise<void> {
  const viewport = document.getElementById('viewport')!;
  const hudRoot = document.getElementById('hud')!;
  hudRoot.innerHTML = '<div class="boot">物理エンジンを初期化中…</div>';

  const R = await loadRapier();
  const sim = new Simulation(R, VERTICAL_SLICE_LAYOUT);
  const ctl = new SimulationController(sim);
  const view = new LabView(viewport, sim);
  const rig = new CameraRig(view.canvas);
  const hud = new Hud(hudRoot, ctl, () => rig.home());

  const resize = () => view.resize(viewport.clientWidth, viewport.clientHeight, rig.camera);
  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe(viewport);
  resize();

  // 計測（HUD表示用。0.5秒ごとに集計）
  let last = performance.now();
  let acc = { t: 0, frames: 0, ticks: 0, physMs: 0, dropped: 0 };
  let stats = { fps: 0, ticksPerSecond: 0, physicsMsPerFrame: 0, droppedSeconds: 0 };
  let alpha = 1;

  const loop = (now: number) => {
    const realDt = (now - last) / 1000;
    last = now;

    const t0 = performance.now();
    const fr = ctl.frame(realDt);
    const physMs = performance.now() - t0;
    if (ctl.state === 'running') alpha = fr.alpha;
    else alpha = 1;

    rig.update(Math.min(realDt, 0.1));
    view.render(rig.camera, alpha);

    acc.t += realDt;
    acc.frames++;
    acc.ticks += fr.stepsRun;
    acc.physMs += physMs;
    acc.dropped += fr.droppedSeconds;
    if (acc.t >= 0.5) {
      stats = {
        fps: acc.frames / acc.t,
        ticksPerSecond: acc.ticks / acc.t,
        physicsMsPerFrame: acc.physMs / acc.frames,
        droppedSeconds: acc.dropped,
      };
      acc = { t: 0, frames: 0, ticks: 0, physMs: 0, dropped: 0 };
    }
    hud.update(stats);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // 開発時の手動確認・E2E用フック（ゲームロジックは公開しない）
  (window as unknown as { __bugworks?: unknown }).__bugworks = { ctl, sim, rig };
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('hud')!.innerHTML = `<div class="boot">起動に失敗しました：${String(err)}</div>`;
});
