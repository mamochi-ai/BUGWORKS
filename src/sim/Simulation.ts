import type { Rapier } from './rapier';
import type { Vec3 } from './catalog';
import { GRAVITY, PHYSICS_DT } from './constants';
import { buildLabBoxes, type LabBox } from './lab';
import { chooseBallStart } from '../edit/placement';
import { BALL_START_OFFSET, type SliceLayout } from './layout';
import { BALL_RADIUS, RAIL_PROFILE, ballRestPosition, buildRailTrack, type RailTrack } from './railGeometry';

type World = InstanceType<Rapier['World']>;
type RigidBody = ReturnType<World['createRigidBody']>;

export type Quat = [number, number, number, number];

export interface BallState {
  position: Vec3;
  rotation: Quat;
  linvel: Vec3;
  angvel: Vec3;
}

export interface SimSnapshot {
  tick: number;
  ball: BallState;
  outOfBounds: boolean;
}

/** これより下に落ちた鉄球は場外として凍結する（試作値） */
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
  private ball!: RigidBody;
  private _tick = 0;
  private _outOfBounds = false;
  private prev!: BallState;

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

  get outOfBounds(): boolean {
    return this._outOfBounds;
  }

  step(): void {
    this.prev = this.readBall();
    if (!this._outOfBounds) {
      this.world.step();
      if (this.ball.translation().y < KILL_PLANE_Y) {
        this._outOfBounds = true;
        this.ball.setLinvel({ x: 0, y: 0, z: 0 }, false);
        this.ball.setAngvel({ x: 0, y: 0, z: 0 }, false);
        this.ball.setBodyType(this.R.RigidBodyType.Fixed, false);
      }
    }
    this._tick++;
  }

  reset(): void {
    this.world.free();
    this.build();
  }

  /** 現tickの鉄球状態 */
  readBall(): BallState {
    const t = this.ball.translation();
    const r = this.ball.rotation();
    const v = this.ball.linvel();
    const w = this.ball.angvel();
    return {
      position: [t.x, t.y, t.z],
      rotation: [r.x, r.y, r.z, r.w],
      linvel: [v.x, v.y, v.z],
      angvel: [w.x, w.y, w.z],
    };
  }

  /** 1tick前の鉄球状態（描画補間用） */
  readPrevBall(): BallState {
    return this.prev;
  }

  snapshot(): SimSnapshot {
    return { tick: this._tick, ball: this.readBall(), outOfBounds: this._outOfBounds };
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
    this._outOfBounds = false;

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

    // 発射機ができるまでの暫定：つながっていない入口のうち最も高いレールに置く（DECISIONS.md D-16）
    const startId = chooseBallStart(this._layout.devices);
    const start = this._tracks.find((t) => t.deviceId === startId);
    const p: Vec3 = start ? ballRestPosition(start, BALL_START_OFFSET) : [0, BALL_RADIUS, 0];
    this.ball = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(...p)
        .setAngularDamping(MATERIAL.ballAngularDamping)
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    world.createCollider(
      R.ColliderDesc.ball(BALL_RADIUS)
        .setDensity(MATERIAL.ballDensity)
        .setFriction(MATERIAL.ballFriction)
        .setRestitution(MATERIAL.ballRestitution),
      this.ball,
    );
    this.prev = this.readBall();
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
