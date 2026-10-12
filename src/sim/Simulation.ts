import type { Rapier } from './rapier';
import { getDeviceDef, type Vec3 } from './catalog';
import { GRAVITY, PHYSICS_DT } from './constants';
import { buildLabBoxes, type LabBox } from './lab';
import { CHUTE_LENGTH, CHUTE_STOP_D, LAUNCHER_SHAPE, MAX_BALLS, chuteLocal, launcherToWorld, planLauncher, type LauncherPlan } from './launcher';
import type { PlacedDevice, SliceLayout } from './layout';
import { inGoal, platformHeight } from './goal';
import { curveShape, pathMesh, shapeMesh } from './curveGeometry';
import { LOOP, loopFrame, loopRadius } from './loopGeometry';
import { BRIDGE, PADDLE, approach, bridgeTargetAngle, inPaddleZone, solveDrive, type ShaftLink } from './drive';
import { findConnections, footprint } from '../edit/placement';
import { magnetAccel, magnetParams } from './magnet';
import { BUG_TUNING, facingRepelPairs, onFloor, slickDirection, wornFrictionFactor, type BugTrigger, type MagnetPair } from './bugs';
import { inSwitchZone, signalSources } from './switch';
import { ROTATOR, alignedWithEntry, atRotatorEntry, exitFor, rotatorParams, rotatorToLocal, rotatorToWorld, travelDir } from './rotator';
import { SPRING_SHAPE, canCapture, compressionAt, planSpring, plateTop, toPlate, type SpringPlan } from './spring';
import { BALL_RADIUS, RAIL_PROFILE, add, buildRailTrack, rotateY, type RailTrack } from './railGeometry';

type World = InstanceType<Rapier['World']>;
type RigidBody = ReturnType<World['createRigidBody']>;

export type Quat = [number, number, number, number];

export interface BallState {
  position: Vec3;
  rotation: Quat;
  linvel: Vec3;
  angvel: Vec3;
}

export interface BallSnapshot extends BallState {
  /** 発射された順の通し番号（同じ配置・同じtickなら毎回同じ） */
  id: number;
}

export interface LauncherState {
  deviceId: string;
  /** 次に発射を試みる tick */
  nextFireTick: number;
  /** 最後に撃った tick（まだ撃っていなければ null） */
  lastFireTick: number | null;
  /** 装填中の球の id（無ければ null） */
  loadedBallId: number | null;
  /** 発射を見送っている理由：球の上限 / 装填が間に合っていない */
  waiting: 'max_balls' | 'loading' | null;
  /** 見送りが始まった tick */
  waitingSince: number | null;
}

export interface SpringState {
  deviceId: string;
  phase: 'ready' | 'compress' | 'recover';
  /** 今の段階に入ってからの tick 数 */
  t: number;
  /** 受け止めている球 */
  heldBallId: number | null;
  /** 受け止めた位置（天板の面内座標 s, a と、天板からの浮き h） */
  heldAt: [number, number, number] | null;
  /** 打ち上げた回数 */
  launches: number;
}

export interface GoalState {
  deviceId: string;
  /** 回収した球の数 */
  hits: number;
  /** 最初に入った tick（まだなら null） */
  firstHitTick: number | null;
  /** 最後に入った tick（演出用） */
  lastHitTick: number | null;
}

export interface PaddleState {
  deviceId: string;
  /** 羽根の角度と、目標の角度（rad） */
  angle: number;
  target: number;
  /** 通った球の数 */
  passes: number;
}

export interface BridgeState {
  deviceId: string;
  /** 跳ね上がりの角度（rad、0 = つながった） */
  angle: number;
  /** 受け取った回転（rad） */
  input: number;
}

export interface SwitchState {
  deviceId: string;
  on: boolean;
  /** 切り替わった回数 */
  toggles: number;
}

export interface RotatorState {
  deviceId: string;
  /** 台の角度（rad、上から見て反時計回りが +） */
  angle: number;
  /** 入口で待っている球（先頭から） */
  queue: number[];
  /** 台に乗っている球 */
  riding: { ballId: number; phase: 'slide' | 'ride'; t: number; turned: number } | null;
  /** 送り出した回数 */
  releases: number;
}

export interface SimSnapshot {
  tick: number;
  paddles: PaddleState[];
  bridges: BridgeState[];
  goals: GoalState[];
  springs: SpringState[];
  balls: BallSnapshot[];
  launchers: LauncherState[];
  switches: SwitchState[];
  rotators: RotatorState[];
  /** この再生で発動した隠しバグ */
  bugs: BugTrigger[];
  /** 場外に落ちて取り除いた球の数 */
  lostBalls: number;
}

/** バネの天板の厚みの半分（m） */
const SPRING_PLATE_HALF_THICKNESS = 0.03;

/** レール・溝の底板の角の丸め（m）。継ぎ目での引っかかり防止。試作値 */
const PLATE_EDGE_ROUNDING = 0.01;
/** レールの当たり判定の入口側を下げる量（m）。継ぎ目を必ず下りの段差にする。試作値（DECISIONS.md D-20） */
export const JOINT_DROP = 0.005;

/** これより下に落ちた鉄球は場外として取り除く（試作値） */
export const KILL_PLANE_Y = -5;

/** 物理材質（試作値、端末実測で調整 → physicsProfile を更新） */
const MATERIAL = {
  ballFriction: 0.6,
  ballRestitution: 0.2,
  ballDensity: 7.8, // 鉄 ≒ 7800kg/m³ だが Rapier の質量単位は任意。相対値として使用
  ballAngularDamping: 0.3,
  railFriction: 0.6,
  floorFriction: 0.8,
};

/**
 * 物理ワールド。描画・入力・UIに一切依存しない（ヘッドレスでテスト可能）。
 * 1回の step() が厳密に 1 tick = PHYSICS_DT 秒。
 * リセットは「ワールドを破棄して同じレイアウトから作り直す」ことで初期状態を完全再現する。
 */
/**
 * 回転装置の台を「まっすぐの向き（π の倍数）」で止めるための、このtickの回転量。
 * すでにまっすぐなら 0。次のまっすぐの向きを越えるなら、ちょうどそこまで。
 */
/** BUG-16 の効果：しりぞけるはずの磁石が、決められた範囲でだけ引きよせる（力は上限まで） */
function flippedAccel(m: PlacedDevice, p: Vec3): Vec3 | null {
  const { radius, maxForceNewton } = magnetParams(m);
  const flipped: PlacedDevice = { ...m, params: { ...m.params, mode: 1, radius, maxForceNewton: Math.min(maxForceNewton, BUG_TUNING.flipMaxForce) } };
  return magnetAccel(flipped, p);
}

export function parkStep(angle: number, dA: number): number {
  const k = angle / Math.PI;
  if (Math.abs(k - Math.round(k)) < 1e-9) return 0;
  const next = (dA > 0 ? Math.ceil(k) : Math.floor(k)) * Math.PI;
  return Math.abs(next - angle) <= Math.abs(dA) ? next - angle : dA;
}

export class Simulation {
  private _tracks: RailTrack[] = [];
  readonly labBoxes: LabBox[];
  private world!: World;
  private balls: { id: number; body: RigidBody; prev: BallState }[] = [];
  private launchers: (LauncherPlan & LauncherState)[] = [];
  private springs: (SpringPlan & SpringState & { plate: RigidBody })[] = [];
  private goals: (GoalState & { device: PlacedDevice })[] = [];
  private paddles: (PaddleState & { device: PlacedDevice; inside: Set<number> })[] = [];
  private bridges: (BridgeState & { device: PlacedDevice; deck: RigidBody; hinge: Vec3; deckCenter: Vec3; deckPitch: number; yaw: number })[] = [];
  private shaftLinks: ShaftLink[] = [];
  private magnets: PlacedDevice[] = [];
  private rotators: (RotatorState & { device: PlacedDevice })[] = [];
  // ---- 隠しバグ（D-37）の状態。どれも再生ごと（リセットで初期化）
  private bugTriggers: BugTrigger[] = [];
  private stillTicks = new Map<number, number>();
  private slick = new Map<number, { left: number; dir: Vec3 }>();
  private magnetPairs: (MagnetPair & { centerTicks: number; flipped: boolean })[] = [];
  private railColliders = new Map<string, ReturnType<World['createCollider']>[]>();
  private railPasses = new Map<string, number>();
  private railAlong = new Map<string, number>();
  private switches: (SwitchState & { device: PlacedDevice; inside: Set<number> })[] = [];
  /** 信号を受ける装置ID → 配線されたスイッチID */
  private signalFrom = new Map<string, string[]>();
  private nextBallId = 0;
  private _tick = 0;
  private _lostBalls = 0;

  constructor(
    private readonly R: Rapier,
    private _layout: SliceLayout,
  ) {
    this.labBoxes = buildLabBoxes();
    this.applyTracks();
    this.build();
  }

  get layout(): SliceLayout {
    return this._layout;
  }

  get tracks(): readonly RailTrack[] {
    return this._tracks;
  }

  /** 配置を差し替えて初期状態から作り直す（編集後に呼ぶ） */
  setLayout(layout: SliceLayout): void {
    this._layout = layout;
    this.applyTracks();
    this.world.free();
    this.build();
  }

  private applyTracks(): void {
    // 固定の直線走行路：レールと羽根車（可動橋は動くので別に作る）
    this._tracks = this._layout.devices.filter((d) => d.type === 'rail' || d.type === 'paddle' || d.type === 'switch').map(buildRailTrack);
  }

  get tick(): number {
    return this._tick;
  }

  get timeSeconds(): number {
    return this._tick * PHYSICS_DT;
  }

  get lostBalls(): number {
    return this._lostBalls;
  }

  get ballCount(): number {
    return this.balls.length;
  }

  /**
   * 発射を見送っている発射機があれば、その理由（HUD表示用）。
   * 装填待ちは発射間隔が短いと毎回起きるので、2周期以上続いたときだけ知らせる。
   */
  get launcherWaiting(): LauncherState['waiting'] {
    if (this.launchers.some((l) => l.waiting === 'max_balls')) return 'max_balls';
    const stuck = this.launchers.some(
      (l) => l.waiting === 'loading' && l.waitingSince !== null && this._tick - l.waitingSince >= 2 * l.periodTicks,
    );
    return stuck ? 'loading' : null;
  }

  get launcherPlans(): readonly LauncherPlan[] {
    return this.launchers;
  }

  /**
   * 1 tick 進める。順序は固定：①前tickの状態を記録 ②発射機ごとに（配置順）発射→次の球の装填 ③物理 ④場外の球を除去。
   */
  step(): void {
    for (const b of this.balls) b.prev = readBody(b.body);
    this.stepSwitches();
    for (const l of this.launchers) {
      // 配線された発射機は信号が ON の間だけ撃つ（OFF の間は発射を待たせ、ON になったらすぐ撃つ）
      if (!this.signalOn(l.deviceId)) l.nextFireTick = Math.max(l.nextFireTick, this._tick + 1);
      else if (this._tick >= l.nextFireTick) {
        l.nextFireTick += l.periodTicks;
        this.fire(l);
      }
      const reloadReady = l.lastFireTick === null || this._tick - l.lastFireTick >= l.reloadTicks;
      if (l.loadedBallId === null && reloadReady) this.load(l, l.hopperPoint);
    }
    for (const sp of this.springs) this.stepSpring(sp);
    this.stepDrive();
    this.stepMagnets();
    this.stepRotators();
    this.applyBugEffects();
    this.world.step();
    this.detectBugs();
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      const t = b.body.translation();
      // ゴールに入った球は回収して数える（配置順で最初に当てはまったゴール）
      const goal = this.goals.find((g) => inGoal(g.device, [t.x, t.y, t.z]));
      if (goal) {
        goal.hits++;
        goal.firstHitTick ??= this._tick;
        goal.lastHitTick = this._tick;
        this.removeBall(i);
        continue;
      }
      if (t.y < KILL_PLANE_Y) {
        this.removeBall(i);
        this._lostBalls++;
      }
    }
    this._tick++;
  }

  reset(): void {
    this.world.free();
    this.build();
  }

  /** 現tickの鉄球（発射順） */
  readBalls(): BallSnapshot[] {
    return this.balls.map((b) => ({ id: b.id, ...readBody(b.body) }));
  }

  /** 描画補間用：各球の 1tick 前と現在 */
  readBallFrames(): { id: number; prev: BallState; curr: BallState }[] {
    return this.balls.map((b) => ({ id: b.id, prev: b.prev, curr: readBody(b.body) }));
  }

  /** 球を取り除く（装填中・受け止め中の記録も外す） */
  private removeBall(index: number): void {
    const b = this.balls[index];
    for (const l of this.launchers) if (l.loadedBallId === b.id) l.loadedBallId = null;
    for (const sp of this.springs) {
      if (sp.heldBallId === b.id) {
        sp.heldBallId = null;
        sp.heldAt = null;
      }
    }
    for (const r of this.rotators) {
      r.queue = r.queue.filter((id) => id !== b.id);
      if (r.riding?.ballId === b.id) r.riding = null;
    }
    this.stillTicks.delete(b.id);
    this.slick.delete(b.id);
    for (const k of [...this.railAlong.keys()]) if (k.endsWith(`:${b.id}`)) this.railAlong.delete(k);
    this.world.removeRigidBody(b.body);
    this.balls.splice(index, 1);
  }

  /** ゴールに入った球の合計 */
  get goalHits(): number {
    return this.goals.reduce((n, g) => n + g.hits, 0);
  }

  /** 最初に球がゴールに入った tick（クリア）。まだなら null */
  get firstGoalTick(): number | null {
    const ticks = this.goals.map((g) => g.firstHitTick).filter((t): t is number => t !== null);
    return ticks.length ? Math.min(...ticks) : null;
  }

  /**
   * 回転の伝わり（物理の前に呼ぶ）：羽根車が球を数えて回る → 軸・歯車装置を通って可動橋が下りる。
   */
  private stepDrive(): void {
    if (this.paddles.length === 0 && this.bridges.length === 0) return;
    const dt = PHYSICS_DT;
    for (const p of this.paddles) {
      // 範囲に入ってきた球（前のtickにはいなかった球）を数える
      const now = new Set<number>();
      for (const b of this.balls) {
        const t = b.body.translation();
        if (inPaddleZone(p.device, [t.x, t.y, t.z])) now.add(b.id);
      }
      for (const id of now) {
        if (!p.inside.has(id)) {
          p.target += PADDLE.stepRad;
          p.passes++;
        }
      }
      p.inside = now;
      p.angle = approach(p.angle, p.target, PADDLE.maxSpeed * dt);
    }
    const paddleAngle = new Map(this.paddles.map((p) => [p.deviceId, p.angle]));
    const { input } = solveDrive(this._layout.devices, this.shaftLinks, (id) => paddleAngle.get(id) ?? 0);
    for (const br of this.bridges) {
      br.input = input.get(br.deviceId) ?? 0;
      const next = approach(br.angle, bridgeTargetAngle(br.input), BRIDGE.maxSpeed * dt);
      if (next !== br.angle) {
        br.angle = next;
        this.poseBridge(br, true);
      }
    }
  }

  /** 可動橋の床板を、出口側の蝶番を軸に angle だけ跳ね上げた位置へ */
  private poseBridge(br: (typeof this.bridges)[number], kinematic: boolean): void {
    const a = br.angle;
    const [, cy, cz] = br.deckCenter; // 蝶番から見た床板の中心（ローカル）
    const rel: Vec3 = [0, cy * Math.cos(a) - cz * Math.sin(a), cy * Math.sin(a) + cz * Math.cos(a)];
    const p = add(br.hinge, rotateY(rel, br.yaw));
    // Rx(pitch)・Rx(a) = Rx(pitch + a)：入口側が上がる向き
    const q = quatFromYawPitch(br.yaw, br.deckPitch + a);
    if (kinematic) {
      br.deck.setNextKinematicTranslation({ x: p[0], y: p[1], z: p[2] });
      br.deck.setNextKinematicRotation(q);
    } else {
      br.deck.setTranslation({ x: p[0], y: p[1], z: p[2] }, false);
      br.deck.setRotation(q, false);
    }
  }

  /** 描画用：羽根車・可動橋・回転を伝える装置の角度 */
  driveAngles(): { paddles: Map<string, number>; bridges: Map<string, number>; shafts: { input: Map<string, number>; output: Map<string, number> } } {
    const paddleAngle = new Map(this.paddles.map((p) => [p.deviceId, p.angle]));
    return {
      paddles: paddleAngle,
      bridges: new Map(this.bridges.map((b) => [b.deviceId, b.angle])),
      shafts: solveDrive(this._layout.devices, this.shaftLinks, (id) => paddleAngle.get(id) ?? 0),
    };
  }

  /**
   * ステージのクリア判定に使う出来事（この再生で一度でも起きたか）。
   * 判定は物理の状態から読むだけで、ゲームの進行には影響しない。
   */
  events(): { ball_enter_goal: boolean; spring_triggered: boolean; paddle_turned: boolean; bridge_connected: boolean; switch_on: boolean; all_goals: boolean } {
    return {
      ball_enter_goal: this.goalHits > 0,
      spring_triggered: this.springs.some((s) => s.launches > 0),
      paddle_turned: this.paddles.some((p) => p.passes > 0),
      bridge_connected: this.bridges.some((b) => b.angle === 0),
      switch_on: this.switches.some((s) => s.toggles > 0),
      all_goals: this.goals.length > 0 && this.goals.every((g) => g.hits > 0),
    };
  }

  /** 描画用：バネごとの縮み量 */
  springCompressions(): { deviceId: string; offset: number }[] {
    return this.springs.map((sp) => ({ deviceId: sp.deviceId, offset: compressionAt(sp.phase, sp.t, sp) }));
  }

  /**
   * バネ1台分の1tick（物理の前に呼ぶ）。
   * ready：天板の上の球を探して受け止める → compress：天板と一緒に球を下げる → 縮みきったら打ち上げ → recover：天板が戻る
   */
  private stepSpring(sp: SpringPlan & SpringState & { plate: RigidBody }): void {
    if (sp.phase === 'ready') {
      const held = new Set(this.springs.map((x) => x.heldBallId).filter((id) => id !== null));
      for (const l of this.launchers) if (l.loadedBallId !== null) held.add(l.loadedBallId);
      const candidate = this.balls.find((b) => {
        if (held.has(b.id)) return false;
        const p = b.body.translation();
        const v = b.body.linvel();
        return canCapture(sp, [p.x, p.y, p.z], [v.x, v.y, v.z], BALL_RADIUS);
      });
      if (!candidate) return;
      const p = candidate.body.translation();
      const local = toPlate(sp, 0, [p.x, p.y, p.z]);
      sp.phase = 'compress';
      sp.t = 0;
      sp.heldBallId = candidate.id;
      sp.heldAt = [local.s, local.a, Math.max(0, local.h - BALL_RADIUS)];
    }
    sp.t++;
    const offset = compressionAt(sp.phase, sp.t, sp);
    const top = plateTop(sp, offset);
    const [hx, hy, hz] = [sp.normal[0] * SPRING_PLATE_HALF_THICKNESS, sp.normal[1] * SPRING_PLATE_HALF_THICKNESS, sp.normal[2] * SPRING_PLATE_HALF_THICKNESS];
    sp.plate.setNextKinematicTranslation({ x: top[0] - hx, y: top[1] - hy, z: top[2] - hz });

    if (sp.phase === 'compress') {
      const ball = this.balls.find((b) => b.id === sp.heldBallId);
      if (!ball) {
        sp.phase = 'recover';
        sp.t = 0;
        sp.heldBallId = null;
        sp.heldAt = null;
        return;
      }
      // 受け止めた球は、浮いていた分を縮む前半で天板へ下ろし、そのまま天板と一緒に下げる
      const [s, a, h0] = sp.heldAt!;
      const settle = Math.max(0, 1 - sp.t / (sp.compressTicks / 2));
      const at = top.map((v, i) => v + sp.side[i] * s + sp.along[i] * a + sp.normal[i] * (BALL_RADIUS + h0 * settle));
      ball.body.setTranslation({ x: at[0], y: at[1], z: at[2] }, true);
      ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      if (sp.t >= sp.compressTicks) {
        const v = sp.params.launchSpeed;
        ball.body.setLinvel({ x: sp.normal[0] * v, y: sp.normal[1] * v, z: sp.normal[2] * v }, true);
        sp.phase = 'recover';
        sp.t = 0;
        sp.heldBallId = null;
        sp.heldAt = null;
        sp.launches++;
      } else {
        ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
      return;
    }
    if (sp.phase === 'recover' && sp.t >= sp.recoverTicks) {
      sp.phase = 'ready';
      sp.t = 0;
    }
  }

  /** 描画用：発射機ごとの次の発射 tick と間隔 */
  snapshotLaunchers(): { deviceId: string; lastFireTick: number | null }[] {
    return this.launchers.map((l) => ({ deviceId: l.deviceId, lastFireTick: l.lastFireTick }));
  }

  snapshot(): SimSnapshot {
    return {
      tick: this._tick,
      goals: this.goals.map((g) => ({ deviceId: g.deviceId, hits: g.hits, firstHitTick: g.firstHitTick, lastHitTick: g.lastHitTick })),
      paddles: this.paddles.map((p) => ({ deviceId: p.deviceId, angle: p.angle, target: p.target, passes: p.passes })),
      bridges: this.bridges.map((b) => ({ deviceId: b.deviceId, angle: b.angle, input: b.input })),
      springs: this.springs.map((sp) => ({
        deviceId: sp.deviceId,
        phase: sp.phase,
        t: sp.t,
        heldBallId: sp.heldBallId,
        heldAt: sp.heldAt ? [sp.heldAt[0], sp.heldAt[1], sp.heldAt[2]] : null,
        launches: sp.launches,
      })),
      bugs: this.bugTriggers.map((b) => ({ ...b, at: [...b.at] as Vec3 })),
      rotators: this.rotators.map((r) => ({ deviceId: r.deviceId, angle: r.angle, queue: [...r.queue], riding: r.riding ? { ...r.riding } : null, releases: r.releases })),
      switches: this.switches.map((s) => ({ deviceId: s.deviceId, on: s.on, toggles: s.toggles })),
      balls: this.readBalls(),
      launchers: this.launchers.map((l) => ({
        deviceId: l.deviceId,
        nextFireTick: l.nextFireTick,
        lastFireTick: l.lastFireTick,
        loadedBallId: l.loadedBallId,
        waiting: l.waiting,
        waitingSince: l.waitingSince,
      })),
      lostBalls: this._lostBalls,
    };
  }

  /** 装填済みで溝の上に落ち着いている球を押し出す。無ければ理由を記録して見送る */
  private fire(l: LauncherPlan & LauncherState): void {
    const loaded = this.balls.find((b) => b.id === l.loadedBallId);
    const settled =
      loaded !== undefined &&
      (() => {
        const p = loaded.body.translation();
        return Math.hypot(p.x - l.loadPoint[0], p.y - l.loadPoint[1], p.z - l.loadPoint[2]) < 0.035 && Math.hypot(...readBody(loaded.body).linvel) < 0.2;
      })();
    if (!loaded || !settled) {
      l.waiting = !loaded && this.balls.length >= MAX_BALLS ? 'max_balls' : 'loading';
      l.waitingSince ??= this._tick;
      return;
    }
    loaded.body.setLinvel({ x: l.velocity[0], y: l.velocity[1], z: l.velocity[2] }, true);
    loaded.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    l.loadedBallId = null;
    l.lastFireTick = this._tick;
    l.waiting = null;
    l.waitingSince = null;
  }

  /** 次の球を装填する（上限や、置き場所に他の球があるときは見送る） */
  private load(l: LauncherPlan & LauncherState, at: Vec3): void {
    if (this.balls.length >= MAX_BALLS) return;
    // 置き場所の周りに球があれば重ねて生成しない（物理が破綻するため）
    for (const b of this.balls) {
      const p = b.body.translation();
      for (const q of [at, l.loadPoint]) {
        if (Math.hypot(p.x - q[0], p.y - q[1], p.z - q[2]) < BALL_RADIUS * 2.05) return;
      }
    }
    const R = this.R;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(...at)
        .setAngularDamping(MATERIAL.ballAngularDamping)
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    this.world.createCollider(
      R.ColliderDesc.ball(BALL_RADIUS)
        .setDensity(MATERIAL.ballDensity)
        .setFriction(MATERIAL.ballFriction)
        .setRestitution(MATERIAL.ballRestitution),
      body,
    );
    const id = this.nextBallId++;
    this.balls.push({ id, body, prev: readBody(body) });
    l.loadedBallId = id;
  }

  dispose(): void {
    this.world.free();
  }

  private build(): void {
    const R = this.R;
    const world = new R.World(GRAVITY);
    world.timestep = PHYSICS_DT;
    this.world = world;
    this._tick = 0;
    this._lostBalls = 0;
    this.balls = [];
    this.launchers = [];
    this.springs = [];
    this.goals = [];
    this.paddles = [];
    this.magnets = this._layout.devices.filter((d) => d.type === 'magnet');
    this.switches = this._layout.devices
      .filter((d) => d.type === 'switch')
      .map((d) => ({ deviceId: d.id, device: d, on: false, toggles: 0, inside: new Set<number>() }));
    this.signalFrom = signalSources(this._layout.devices);
    this.bugTriggers = [];
    this.stillTicks = new Map();
    this.slick = new Map();
    this.magnetPairs = facingRepelPairs(this.magnets).map((p) => ({ ...p, centerTicks: 0, flipped: false }));
    this.railColliders = new Map();
    this.railPasses = new Map();
    this.railAlong = new Map();
    this.rotators = this._layout.devices
      .filter((d) => d.type === 'rotator')
      .map((d) => ({ deviceId: d.id, device: d, angle: 0, queue: [], riding: null, releases: 0 }));
    this.bridges = [];
    this.shaftLinks = findConnections(this._layout.devices)
      .filter((c) => c.type === 'shaft')
      .map((c) => ({ from: c.from.deviceId, to: c.to.deviceId }));
    this.nextBallId = 0;

    for (const box of this.labBoxes) {
      const body = world.createRigidBody(
        R.RigidBodyDesc.fixed()
          .setTranslation(...box.center)
          .setRotation(quatFromYawPitch((box.rotationYDeg * Math.PI) / 180, 0)),
      );
      world.createCollider(
        R.ColliderDesc.cuboid(box.size[0] / 2, box.size[1] / 2, box.size[2] / 2).setFriction(MATERIAL.floorFriction),
        body,
      );
    }

    for (const track of this.tracks) this.addRailColliders(track);
    for (const d of this._layout.devices) if (d.type === 'curve') this.addCurveColliders(d);
    for (const d of this._layout.devices) if (d.type === 'loop') this.addLoopColliders(d);
    for (const d of this._layout.devices) {
      if (d.type === 'paddle') this.paddles.push({ deviceId: d.id, device: d, angle: 0, target: 0, passes: 0, inside: new Set() });
      if (d.type === 'bridge') this.addBridge(d);
      if (d.type === 'gearbox' || d.type === 'shaft' || d.type === 'magnet') this.addDriveBox(d);
      if (d.type === 'rotator') this.addRotatorDeck(d);
    }

    for (const d of this._layout.devices) {
      if (d.type === 'goal') this.goals.push({ deviceId: d.id, device: d, hits: 0, firstHitTick: null, lastHitTick: null });
      if (d.type !== 'platform') continue;
      const [sx, , sz] = getDeviceDef('platform').size;
      const h = platformHeight(d);
      const body = world.createRigidBody(
        R.RigidBodyDesc.fixed()
          .setTranslation(d.position[0], d.position[1] + h / 2, d.position[2])
          .setRotation(quatFromYawPitch((d.rotationYDeg * Math.PI) / 180, 0)),
      );
      world.createCollider(R.ColliderDesc.cuboid(sx / 2, h / 2, sz / 2).setFriction(MATERIAL.floorFriction), body);
    }

    for (const d of this._layout.devices) {
      if (d.type !== 'spring') continue;
      const plan = planSpring(d);
      const [bx, by, bz] = SPRING_SHAPE.base.size;
      const base = world.createRigidBody(
        R.RigidBodyDesc.fixed()
          .setTranslation(...add(d.position, rotateY(SPRING_SHAPE.base.center, plan.yaw)))
          .setRotation(quatFromYawPitch(plan.yaw, 0)),
      );
      world.createCollider(R.ColliderDesc.cuboid(bx / 2, by / 2, bz / 2).setFriction(MATERIAL.floorFriction), base);
      // 天板：位置で動かすキネマティック（縮む・戻る）。上面中心を軸に前へ傾ける
      const c = plateTop(plan, 0);
      const t = SPRING_PLATE_HALF_THICKNESS;
      const plate = world.createRigidBody(
        R.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(c[0] - plan.normal[0] * t, c[1] - plan.normal[1] * t, c[2] - plan.normal[2] * t)
          .setRotation(quatFromYawPitch(plan.yaw, plan.tilt)),
      );
      const [hx, , hz] = SPRING_SHAPE.plateHalf;
      const r = 0.01;
      world.createCollider(
        R.ColliderDesc.roundCuboid(hx - r, t - r, hz - r, r).setFriction(MATERIAL.railFriction).setRestitution(plan.params.restitution),
        plate,
      );
      this.springs.push({ ...plan, deviceId: d.id, phase: 'ready', t: 0, heldBallId: null, heldAt: null, launches: 0, plate });
    }

    for (const d of this._layout.devices) {
      if (d.type !== 'launcher') continue;
      const yaw = (d.rotationYDeg * Math.PI) / 180;
      const S = LAUNCHER_SHAPE;
      const base = world.createRigidBody(
        R.RigidBodyDesc.fixed()
          .setTranslation(...launcherToWorld(d, S.base.center))
          .setRotation(quatFromYawPitch(yaw, 0)),
      );
      const [sx, sy, sz] = S.base.size;
      world.createCollider(R.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setFriction(MATERIAL.floorFriction), base);
      // 溝（レールと同じ断面）＋球の止め（押し板を縮めた位置）。後端を軸に plan.angle だけ上へ傾く
      const plan = planLauncher(d, this._layout.devices);
      const len = CHUTE_LENGTH;
      const chute = world.createRigidBody(
        R.RigidBodyDesc.fixed()
          .setTranslation(...launcherToWorld(d, chuteLocal(plan.angle, len / 2, 0)))
          .setRotation(quatFromYawPitch(yaw, -plan.angle)),
      );
      railParts(len).forEach((part, i) => world.createCollider(this.trackPartDesc(part, i === 0), chute));
      const halfW = RAIL_PROFILE.innerWidth / 2 + RAIL_PROFILE.wallThickness;
      world.createCollider(R.ColliderDesc.cuboid(halfW, 0.08, 0.02).setTranslation(0, 0.04, -len / 2 + CHUTE_STOP_D - 0.02), chute);

      // 最初の球は装填済み（初期状態で溝の上に見える）。最初の発射は再生した瞬間（tick 0）
      const runtime = {
        ...plan,
        nextFireTick: 0,
        lastFireTick: null,
        loadedBallId: null,
        waiting: null,
        waitingSince: null,
      };
      this.launchers.push(runtime);
      this.load(runtime, runtime.loadPoint);
    }
  }

  /**
   * レール・溝の部品の当たり判定。底板は角を丸めた箱にする：
   * 別々の箱がつながる継ぎ目で、球が次の箱の角に引っかかって跳ね上がるのを防ぐ（外形は同じ）。
   */
  private trackPartDesc(part: RailPart, isPlate: boolean) {
    const R = this.R;
    const [hx, hy, hz] = part.half;
    const b = PLATE_EDGE_ROUNDING;
    const desc = isPlate ? R.ColliderDesc.roundCuboid(hx - b, hy - b, hz - b, b) : R.ColliderDesc.cuboid(hx, hy, hz);
    return desc.setTranslation(...part.offset).setFriction(MATERIAL.railFriction);
  }

  /** 可動橋：床板（レールと同じ断面）をキネマティックにして、出口側の蝶番で跳ね上げる */
  private addBridge(d: PlacedDevice): void {
    const R = this.R;
    const track = buildRailTrack(d);
    // 直線レールと同じく入口側を JOINT_DROP 下げた走行面（D-20）。蝶番は出口
    const start: Vec3 = [track.start[0], track.start[1] - JOINT_DROP, track.start[2]];
    const end = track.end;
    const horiz = Math.hypot(end[0] - start[0], end[2] - start[2]);
    const pitch = Math.atan2(start[1] - end[1], horiz);
    const length = Math.hypot(horiz, end[1] - start[1]);
    // 蝶番から見た床板の中心（ヨー回転前のローカル：z は前方）
    const deckCenter: Vec3 = [0, (start[1] - end[1]) / 2, -horiz / 2];
    const deck = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
    railParts(length).forEach((part, i) => this.world.createCollider(this.trackPartDesc(part, i === 0), deck));
    const br = { deviceId: d.id, device: d, deck, hinge: end, deckCenter, deckPitch: pitch, yaw: track.yawRad, angle: BRIDGE.openRad, input: 0 };
    this.poseBridge(br, false);
    this.bridges.push(br);
  }

  /** スイッチ：範囲に入ってきた球（前のtickにはいなかった球）ごとに ON/OFF を切り替える */
  private stepSwitches(): void {
    for (const s of this.switches) {
      const now = new Set<number>();
      for (const b of this.balls) {
        const t = b.body.translation();
        if (inSwitchZone(s.device, [t.x, t.y, t.z])) now.add(b.id);
      }
      for (const id of now) {
        if (s.inside.has(id)) continue;
        s.on = !s.on;
        s.toggles++;
      }
      s.inside = now;
    }
  }

  /** 信号が ON か。配線が無い装置は常に ON（今までどおり動く） */
  private signalOn(deviceId: string): boolean {
    const from = this.signalFrom.get(deviceId);
    if (!from) return true;
    return this.switches.some((s) => s.on && from.includes(s.deviceId));
  }

  /** 描画用：スイッチの ON/OFF */
  switchStates(): Map<string, boolean> {
    return new Map(this.switches.map((s) => [s.deviceId, s.on]));
  }

  /**
   * 回転装置（D-32）：入口に来た球を待たせ、台のレールがそろったら中央へ運んで台と一緒に回し、
   * 球の進む向きが入口以外の辺を向いたら送り出す。球は位置を直接動かす（決定論のため順序は固定）。
   */
  private stepRotators(): void {
    if (this.rotators.length === 0) return;
    const dt = PHYSICS_DT;
    // 他の装置がつかんでいる球は対象にしない
    const busy = new Set<number>();
    for (const l of this.launchers) if (l.loadedBallId !== null) busy.add(l.loadedBallId);
    for (const sp of this.springs) if (sp.heldBallId !== null) busy.add(sp.heldBallId);
    for (const r of this.rotators) {
      for (const id of r.queue) busy.add(id);
      if (r.riding) busy.add(r.riding.ballId);
    }
    const lift = ROTATOR.surfaceY + BALL_RADIUS + 0.002;
    const place = (r: (typeof this.rotators)[number], ballId: number, local: Vec3, v: Vec3 = [0, 0, 0]) => {
      const b = this.balls.find((x) => x.id === ballId);
      if (!b) return;
      const w = rotatorToWorld(r.device, local);
      b.body.setTranslation({ x: w[0], y: w[1], z: w[2] }, true);
      b.body.setLinvel({ x: v[0], y: v[1], z: v[2] }, true);
      b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    };
    for (const r of this.rotators) {
      const { degreesPerSecond, direction } = rotatorParams(r.device);
      // 信号が ON（配線なしなら常に）の間は回る。OFF になったら、まっすぐの向き（180°ごと）まで回ってから止まる
      let dA = direction * ((degreesPerSecond * Math.PI) / 180) * dt;
      if (!this.signalOn(r.deviceId)) dA = parkStep(r.angle, dA);
      // 入口に来た球を列に並べる
      for (const b of this.balls) {
        if (busy.has(b.id)) continue;
        const t = b.body.translation();
        if (atRotatorEntry(rotatorToLocal(r.device, [t.x, t.y, t.z]))) {
          r.queue.push(b.id);
          busy.add(b.id);
        }
      }
      // 台が空いていて、レールが入口の向きにそろっていれば、先頭の球を乗せる
      if (!r.riding && r.queue.length > 0 && alignedWithEntry(r.angle)) {
        r.riding = { ballId: r.queue.shift()!, phase: 'slide', t: 0, turned: 0 };
      }
      r.queue.forEach((id, i) => place(r, id, [0, lift, -ROTATOR.gateD - i * ROTATOR.queueGap]));
      if (r.riding) {
        const ride = r.riding;
        ride.turned += dA;
        if (ride.phase === 'slide') {
          ride.t = Math.min(1, ride.t + dt / ROTATOR.slideSeconds);
          // 入口から中央へ（台と一緒に回りながら）
          const along = -ROTATOR.gateD * (1 - ride.t);
          const d = travelDir(ride.turned);
          place(r, ride.ballId, [d[0] * along, lift, d[2] * along]);
          if (ride.t >= 1) ride.phase = 'ride';
        } else {
          place(r, ride.ballId, [0, lift, 0]);
        }
        const dir = travelDir(ride.turned);
        if (ride.phase === 'ride' && exitFor(dir)) {
          // 出口の向きにぴったり合わせて送り出す
          const e = exitFor(dir)!;
          const exact: Vec3 = e === 'front' ? [0, 0, 1] : e === 'left' ? [1, 0, 0] : [-1, 0, 0];
          const yaw = (r.device.rotationYDeg * Math.PI) / 180;
          const wv = rotateY(exact, yaw).map((x) => x * ROTATOR.releaseSpeed) as Vec3;
          place(r, ride.ballId, [0, lift, 0], wv);
          r.riding = null;
          r.releases++;
        }
      }
      r.angle += dA;
    }
  }

  /** 台の角度（描画用） */
  rotatorAngles(): Map<string, number> {
    return new Map(this.rotators.map((r) => [r.deviceId, r.angle]));
  }

  /** 回転装置の台（走行面と同じ高さの平らな床）。台の回転は球の運び方で表し、当たり判定は回さない */
  private addRotatorDeck(d: PlacedDevice): void {
    const R = this.R;
    const yaw = (d.rotationYDeg * Math.PI) / 180;
    const c = rotatorToWorld(d, [0, ROTATOR.surfaceY - 0.025, 0]);
    const body = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(...c).setRotation(quatFromYawPitch(yaw, 0)));
    const h = ROTATOR.half;
    this.world.createCollider(R.ColliderDesc.roundCuboid(h - 0.01, 0.015, h - 0.01, 0.01).setFriction(MATERIAL.railFriction), body);
  }

  /** 隠しバグの効果（物理の前）。BUG-12：滑り出す球に加速を足す（速さに上限） */
  private applyBugEffects(): void {
    for (const [id, s] of this.slick) {
      const b = this.balls.find((x) => x.id === id);
      if (!b || s.left <= 0) {
        this.slick.delete(id);
        continue;
      }
      s.left--;
      const v = b.body.linvel();
      const nv = { x: v.x + s.dir[0] * BUG_TUNING.slickAccel * PHYSICS_DT, y: v.y, z: v.z + s.dir[2] * BUG_TUNING.slickAccel * PHYSICS_DT };
      const hs = Math.hypot(nv.x, nv.z);
      if (hs > BUG_TUNING.slickMaxSpeed) {
        nv.x *= BUG_TUNING.slickMaxSpeed / hs;
        nv.z *= BUG_TUNING.slickMaxSpeed / hs;
      }
      b.body.setLinvel(nv, true);
    }
  }

  /** 隠しバグの発動判定（物理の後）。順序は固定（BUG-12 → BUG-16 → BUG-18、球は発射順） */
  private detectBugs(): void {
    const T = BUG_TUNING;
    // BUG-12
    for (const b of this.balls) {
      const t = b.body.translation();
      const v = b.body.linvel();
      const p: Vec3 = [t.x, t.y, t.z];
      if (this.slick.has(b.id) || !onFloor(p) || Math.hypot(v.x, v.y, v.z) >= T.stillSpeed) {
        this.stillTicks.delete(b.id);
        continue;
      }
      const n = (this.stillTicks.get(b.id) ?? 0) + 1;
      this.stillTicks.set(b.id, n);
      if (n >= T.stillSeconds / PHYSICS_DT) {
        this.stillTicks.delete(b.id);
        this.slick.set(b.id, { left: Math.round(T.slickSeconds / PHYSICS_DT), dir: slickDirection(p) });
        this.bugTriggers.push({ id: 'BUG-12', tick: this._tick, at: p });
      }
    }
    // BUG-16
    for (const pair of this.magnetPairs) {
      if (pair.flipped) continue;
      const near = this.balls.some((b) => {
        const t = b.body.translation();
        const v = b.body.linvel();
        return Math.hypot(t.x - pair.mid[0], t.z - pair.mid[2]) <= T.centerRadius && Math.abs(t.y - pair.mid[1]) < 0.7 && Math.hypot(v.x, v.y, v.z) < T.centerStill;
      });
      pair.centerTicks = near ? pair.centerTicks + 1 : 0;
      if (pair.centerTicks >= T.centerSeconds / PHYSICS_DT) {
        pair.flipped = true;
        this.bugTriggers.push({ id: 'BUG-16', tick: this._tick, at: [...pair.mid] });
      }
    }
    // BUG-18（直線レールだけ）
    for (const track of this.tracks) {
      const dev = this._layout.devices.find((d) => d.id === track.deviceId);
      if (dev?.type !== 'rail') continue;
      for (const b of this.balls) {
        const t = b.body.translation();
        const rel: Vec3 = [t.x - track.start[0], t.y - track.start[1], t.z - track.start[2]];
        const along = rel[0] * track.dir[0] + rel[1] * track.dir[1] + rel[2] * track.dir[2];
        const lat = Math.hypot(rel[0] - along * track.dir[0], rel[1] - along * track.dir[1], rel[2] - along * track.dir[2]);
        const key = `${track.deviceId}:${b.id}`;
        const prev = this.railAlong.get(key);
        const goal = track.length - 0.05;
        if (lat < 0.3) this.railAlong.set(key, along);
        else this.railAlong.delete(key);
        if (prev === undefined || lat >= 0.3 || !(prev < goal && along >= goal)) continue;
        const passes = (this.railPasses.get(track.deviceId) ?? 0) + 1;
        this.railPasses.set(track.deviceId, passes);
        if (passes === T.passesToTrigger) this.bugTriggers.push({ id: 'BUG-18', tick: this._tick, at: [...track.end] });
        const f = wornFrictionFactor(passes);
        if (f < 1) for (const c of this.railColliders.get(track.deviceId) ?? []) c.setFriction(MATERIAL.railFriction * f);
      }
    }
  }

  /** BUG-16 が発動した向かい合う磁石の組の近くか */
  private flippedPairNear(magnetId: string, p: Vec3): boolean {
    return this.magnetPairs.some(
      (q) => q.flipped && (q.a === magnetId || q.b === magnetId) && Math.hypot(p[0] - q.mid[0], p[2] - q.mid[2]) <= BUG_TUNING.flipRegion,
    );
  }

  /** この再生で発動した隠しバグ（発動順） */
  bugEvents(): readonly BugTrigger[] {
    return this.bugTriggers;
  }

  /** 磁石：範囲内の鉄球に力を加える（配置順・球の順に固定。決定論のため力は速度の変化として直接加える） */
  private stepMagnets(): void {
    if (this.magnets.length === 0) return;
    for (const b of this.balls) {
      const t = b.body.translation();
      let ax = 0;
      let ay = 0;
      let az = 0;
      for (const m of this.magnets) {
        if (!this.signalOn(m.id)) continue;
        const flipped = this.flippedPairNear(m.id, [t.x, t.y, t.z]);
        const a = flipped ? flippedAccel(m, [t.x, t.y, t.z]) : magnetAccel(m, [t.x, t.y, t.z]);
        if (!a) continue;
        ax += a[0];
        ay += a[1];
        az += a[2];
      }
      if (ax === 0 && ay === 0 && az === 0) continue;
      const v = b.body.linvel();
      b.body.setLinvel({ x: v.x + ax * PHYSICS_DT, y: v.y + ay * PHYSICS_DT, z: v.z + az * PHYSICS_DT }, true);
    }
  }

  /** 歯車装置・軸・磁石：床（台）に置く箱の当たり判定 */
  private addDriveBox(d: PlacedDevice): void {
    const R = this.R;
    const f = footprint(d);
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.fixed().setTranslation((f.minX + f.maxX) / 2, (f.minY + f.maxY) / 2, (f.minZ + f.maxZ) / 2),
    );
    this.world.createCollider(
      R.ColliderDesc.cuboid((f.maxX - f.minX) / 2, (f.maxY - f.minY) / 2, (f.maxZ - f.minZ) / 2).setFriction(MATERIAL.floorFriction),
      body,
    );
  }

  /** ループ：縦の円に沿った走行面（円の外側）と側壁の三角形メッシュ */
  private addLoopColliders(d: PlacedDevice): void {
    const R = this.R;
    const radius = loopRadius(d);
    const { vertices, indices } = pathMesh((t) => loopFrame(radius, t), LOOP.segments, RAIL_PROFILE.innerWidth / 2, RAIL_PROFILE.wallHeight, JOINT_DROP);
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.fixed()
        .setTranslation(...d.position)
        .setRotation(quatFromYawPitch((d.rotationYDeg * Math.PI) / 180, 0)),
    );
    this.world.createCollider(R.ColliderDesc.trimesh(vertices, indices, R.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(MATERIAL.railFriction), body);
  }

  /** カーブレール：弧に沿った走行面と側壁の三角形メッシュ */
  private addCurveColliders(d: PlacedDevice): void {
    const R = this.R;
    const { vertices, indices } = shapeMesh(curveShape(d), RAIL_PROFILE.innerWidth / 2, RAIL_PROFILE.wallHeight, JOINT_DROP);
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.fixed()
        .setTranslation(...d.position)
        .setRotation(quatFromYawPitch((d.rotationYDeg * Math.PI) / 180, 0)),
    );
    this.world.createCollider(
      R.ColliderDesc.trimesh(vertices, indices, R.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(MATERIAL.railFriction),
      body,
    );
  }

  /** レール＝底板＋左右の側壁。走行面（底板上面）がポートを結ぶ線分を通る */
  private addRailColliders(track: RailTrack): void {
    const R = this.R;
    // 入口側だけ JOINT_DROP 下げる：前の溝/レールの終わり（ポートの高さ）から必ずわずかに「下る」段差になり、
    // 球が次のレールの角に当たって跳ね上がらない（出口側はポートの高さのまま）
    const start: Vec3 = [track.start[0], track.start[1] - JOINT_DROP, track.start[2]];
    const end = track.end;
    const mid: Vec3 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2];
    const horiz = Math.hypot(end[0] - start[0], end[2] - start[2]);
    const pitch = Math.atan2(start[1] - end[1], horiz);
    const length = Math.hypot(horiz, end[1] - start[1]);
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.fixed()
        .setTranslation(...mid)
        .setRotation(quatFromYawPitch(track.yawRad, pitch)),
    );
    const colliders = railParts(length).map((part, i) => this.world.createCollider(this.trackPartDesc(part, i === 0), body));
    this.railColliders.set(track.deviceId, colliders);
  }
}

export interface RailPart {
  /** レール中心（走行面中央）基準のローカルオフセット。X=横, Y=法線, Z=走行方向 */
  offset: Vec3;
  half: Vec3;
}

/** 物理と描画で同じ断面を使うための共通定義 */
export function railParts(length: number): RailPart[] {
  const { innerWidth, plateThickness, wallThickness, wallHeight } = RAIL_PROFILE;
  const halfL = length / 2;
  const wallX = innerWidth / 2 + wallThickness / 2;
  const wallY = wallHeight / 2 - plateThickness;
  const wallHalf: Vec3 = [wallThickness / 2, (wallHeight + plateThickness) / 2, halfL];
  return [
    { offset: [0, -plateThickness / 2, 0], half: [innerWidth / 2 + wallThickness, plateThickness / 2, halfL] },
    { offset: [-wallX, wallY + plateThickness / 2, 0], half: wallHalf },
    { offset: [wallX, wallY + plateThickness / 2, 0], half: wallHalf },
  ];
}

/** Ry(yaw) * Rx(pitch) のクォータニオン {x,y,z,w} */
export function quatFromYawPitch(yaw: number, pitch: number): { x: number; y: number; z: number; w: number } {
  const cy = Math.cos(yaw / 2);
  const sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2);
  const sp = Math.sin(pitch / 2);
  return { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp };
}

function readBody(body: RigidBody): BallState {
  const t = body.translation();
  const r = body.rotation();
  const v = body.linvel();
  const w = body.angvel();
  return {
    position: [t.x, t.y, t.z],
    rotation: [r.x, r.y, r.z, r.w],
    linvel: [v.x, v.y, v.z],
    angvel: [w.x, w.y, w.z],
  };
}
