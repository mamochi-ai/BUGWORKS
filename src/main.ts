import * as THREE from 'three';
import { EditorModel } from './edit/EditorModel';
import { CameraRig } from './input/CameraRig';
import { PartDragController } from './input/PartDragController';
import { LabView } from './render/LabView';
import { VERTICAL_SLICE_LAYOUT } from './sim/layout';
import { loadRapier } from './sim/rapier';
import { Simulation } from './sim/Simulation';
import { SimulationController } from './sim/SimulationController';
import { EditPanel } from './ui/EditPanel';
import { Hud } from './ui/Hud';
import { StageController } from './stage/StageController';
import { StageUi } from './ui/StageUi';
import { BlueprintUi } from './ui/BlueprintUi';
import { BugUi } from './ui/BugUi';

async function boot(): Promise<void> {
  const viewport = document.getElementById('viewport')!;
  const hudRoot = document.getElementById('hud')!;
  hudRoot.innerHTML = '<div class="boot">物理エンジンを初期化中…</div>';

  const R = await loadRapier();
  const editor = new EditorModel(VERTICAL_SLICE_LAYOUT.devices, VERTICAL_SLICE_LAYOUT.seed);
  const sim = new Simulation(R, editor.layout);
  const ctl = new SimulationController(sim);
  const view = new LabView(viewport, sim);
  const rig = new CameraRig(view.canvas);
  const hud = new Hud(hudRoot, ctl, () => rig.home());
  new EditPanel(hudRoot, { editor, ctl, addPosition: () => ({ x: rig.controls.target.x, z: rig.controls.target.z }) });
  const stage = new StageController(editor, ctl, sim, VERTICAL_SLICE_LAYOUT);
  new StageUi(hudRoot, stage, ctl);
  new BlueprintUi(hudRoot, editor, ctl, stage);
  const bugUi = new BugUi(hudRoot);
  // この再生で発動したバグのうち、まだ画面に出していないもの（同じバグは1回の再生で1回だけ知らせる）
  let bugSeen = 0;
  const bugShown = new Set<string>();
  ctl.onChange(() => {
    if (ctl.state === 'ready') {
      bugSeen = 0;
      bugShown.clear();
    }
  });
  stage.onChange((c) => {
    if (c !== 'stage') return;
    hud.goalBanner = stage.current === null;
    rig.home();
  });

  // 配置が変わったら物理を作り直し、描画を追従させる
  const syncRails = () => view.devices.sync(editor.devices, editor.connections(), editor.selectedId);
  editor.onChange((kind) => {
    if (kind === 'layout') {
      ctl.applyLayout(editor.layout);
      syncRails();
    } else if (kind === 'selection') {
      view.devices.setSelected(editor.selectedId);
    }
  });
  ctl.onChange(() => view.devices.setEditMode(ctl.state === 'ready'));
  syncRails();
  view.devices.setEditMode(true);

  // 部品に触れたら部品操作、何もない所ならカメラ操作
  new PartDragController(viewport, view.canvas, rig.camera, rig.controls, () => view.devices.pickables, {
    onPick: (id) => {
      ctl.ensureEditable();
      editor.select(id);
    },
    onTapEmpty: () => editor.select(null),
    positionOf: (id) => {
      const d = editor.devices.find((x) => x.id === id);
      return d ? new THREE.Vector3(...d.position) : null;
    },
    onDrag: (id, x, z) => {
      const ev = editor.previewMove(id, x, z);
      if (ev) view.devices.preview(ev.device, ev.ok, ev.snap?.other ?? null);
    },
    onDrop: (id, x, z) => {
      const ev = editor.previewMove(id, x, z);
      if (!ev || !editor.commitMove(id, ev)) syncRails(); // 置けなければ元の位置に戻す
    },
    onCancel: () => syncRails(),
  });

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

    stage.update();
    const bugs = sim.bugEvents();
    // 配置の差し替えなどで記録が消えたら、数え直す
    if (bugs.length < bugSeen) {
      bugSeen = 0;
      bugShown.clear();
    }
    for (; bugSeen < bugs.length; bugSeen++) {
      if (bugShown.has(bugs[bugSeen].id)) continue;
      bugShown.add(bugs[bugSeen].id);
      bugUi.handle(bugs[bugSeen]);
    }
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
  (window as unknown as { __bugworks?: unknown }).__bugworks = { ctl, sim, rig, editor, view, stage };
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('hud')!.innerHTML = `<div class="boot">起動に失敗しました：${String(err)}</div>`;
});
