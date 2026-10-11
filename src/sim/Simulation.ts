import type { Rapier } from './rapier';
import type { Vec3 } from './catalog';
import { GRAVITY, PHYSICS_DT } from './constants';
import { buildLabBoxes, type LabBox } from './lab';
import { CHUTE_LENGTH, CHUTE_STOP_D, LAUNCHER_SHAPE, MAX_BALLS, chuteLocal, launcherToWorld, planLauncher, type LauncherPlan } from './launcher';
import type { SliceLayout } from './layout';
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

export interface SimSnapshot {
  tick: number;
  springs: SpringState[];
  balls: BallSnapshot[];
  launchers: LauncherState[];
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
export class Simulation {
  private _tracks: RailTrack[] = [];
  readonly labBoxes: LabBox[];
  private world!: World;
  private balls: { id: number; body: RigidBody; prev: BallState }[] = [];
  private launchers: (LauncherPlan & LauncherState)[] = [];
  private springs: (SpringPlan & SpringState & { plate: RigidBody })[] = [];
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
    this._tracks = this._layout.devices.filter((d) => d.type === 'rail').map(buildRailTrack);
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
    for (const l of this.launchers) {
      if (this._tick >= l.nextFireTick) {
        l.nextFireTick += l.periodTicks;
        this.fire(l);
      }
      const reloadReady = l.lastFireTick === null || this._tick - l.lastFireTick >= l.reloadTicks;
      if (l.loadedBallId === null && reloadReady) this.load(l, l.hopperPoint);
    }
    for (const sp of this.springs) this.stepSpring(sp);
    this.world.step();
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      if (b.body.translation().y < KILL_PLANE_Y) {
        for (const l of this.launchers) if (l.loadedBallId === b.id) l.loadedBallId = null;
        this.world.removeRigidBody(b.body);
        this.balls.splice(i, 1);
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
      springs: this.springs.map((sp) => ({
        deviceId: sp.deviceId,
        phase: sp.phase,
        t: sp.t,
        heldBallId: sp.heldBallId,
        heldAt: sp.heldAt ? [sp.heldAt[0], sp.heldAt[1], sp.heldAt[2]] : null,
        launches: sp.launches,
      })),
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
    railParts(length).forEach((part, i) => this.world.createCollider(this.trackPartDesc(part, i === 0), body));
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
