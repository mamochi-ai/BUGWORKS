import type { Rapier } from './rapier';
import type { Vec3 } from './catalog';
import { GRAVITY, PHYSICS_DT } from './constants';
import { buildLabBoxes, type LabBox } from './lab';
import { LAUNCHER_BASE, MAX_BALLS, planLauncher, type LauncherPlan } from './launcher';
import type { SliceLayout } from './layout';
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
  /** 直前の発射を見送った理由 */
  waiting: 'max_balls' | 'blocked' | null;
}

export interface SimSnapshot {
  tick: number;
  balls: BallSnapshot[];
  launchers: LauncherState[];
  /** 場外に落ちて取り除いた球の数 */
  lostBalls: number;
}

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

  /** 発射を見送っている発射機があれば、その理由（HUD表示用） */
  get launcherWaiting(): LauncherState['waiting'] {
    return this.launchers.find((l) => l.waiting === 'max_balls')?.waiting ?? this.launchers.find((l) => l.waiting)?.waiting ?? null;
  }

  get launcherPlans(): readonly LauncherPlan[] {
    return this.launchers;
  }

  /**
   * 1 tick 進める。順序は固定：①前tickの状態を記録 ②発射（配置順） ③物理 ④場外の球を除去。
   */
  step(): void {
    for (const b of this.balls) b.prev = readBody(b.body);
    for (const l of this.launchers) {
      if (this._tick < l.nextFireTick) continue;
      l.nextFireTick += l.periodTicks;
      l.waiting = this.fire(l);
    }
    this.world.step();
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      if (b.body.translation().y < KILL_PLANE_Y) {
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

  /** 描画用：発射機ごとの次の発射 tick と間隔 */
  snapshotLaunchers(): { deviceId: string; nextFireTick: number; periodTicks: number }[] {
    return this.launchers.map((l) => ({ deviceId: l.deviceId, nextFireTick: l.nextFireTick, periodTicks: l.periodTicks }));
  }

  snapshot(): SimSnapshot {
    return {
      tick: this._tick,
      balls: this.readBalls(),
      launchers: this.launchers.map((l) => ({ deviceId: l.deviceId, nextFireTick: l.nextFireTick, waiting: l.waiting })),
      lostBalls: this._lostBalls,
    };
  }

  private fire(l: LauncherPlan): LauncherState['waiting'] {
    if (this.balls.length >= MAX_BALLS) return 'max_balls';
    // 出口に前の球が残っていたら撃たない（重なって生成すると物理が破綻するため）
    for (const b of this.balls) {
      const p = b.body.translation();
      if (Math.hypot(p.x - l.spawn[0], p.y - l.spawn[1], p.z - l.spawn[2]) < BALL_RADIUS * 2.05) return 'blocked';
    }
    const R = this.R;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(...l.spawn)
        .setLinvel(...l.velocity)
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
    const state = readBody(body);
    this.balls.push({ id: this.nextBallId++, body, prev: state });
    return null;
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
      if (d.type !== 'launcher') continue;
      const yaw = (d.rotationYDeg * Math.PI) / 180;
      const body = world.createRigidBody(
        R.RigidBodyDesc.fixed()
          .setTranslation(...add(d.position, rotateY(LAUNCHER_BASE.center, yaw)))
          .setRotation(quatFromYawPitch(yaw, 0)),
      );
      const [sx, sy, sz] = LAUNCHER_BASE.size;
      world.createCollider(R.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setFriction(MATERIAL.floorFriction), body);
      // 最初の発射は tick 0（再生した瞬間）
      this.launchers.push({ ...planLauncher(d, this._layout.devices), nextFireTick: 0, waiting: null });
    }
  }

  /** レール＝底板＋左右の側壁。走行面（底板上面）がポートを結ぶ線分を通る */
  private addRailColliders(track: RailTrack): void {
    const R = this.R;
    const mid: Vec3 = [
      (track.start[0] + track.end[0]) / 2,
      (track.start[1] + track.end[1]) / 2,
      (track.start[2] + track.end[2]) / 2,
    ];
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.fixed()
        .setTranslation(...mid)
        .setRotation(quatFromYawPitch(track.yawRad, track.pitch)),
    );
    for (const part of railParts(track.length)) {
      this.world.createCollider(
        R.ColliderDesc.cuboid(part.half[0], part.half[1], part.half[2])
          .setTranslation(...part.offset)
          .setFriction(MATERIAL.railFriction),
        body,
      );
    }
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
