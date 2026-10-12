import type { Rapier } from '../sim/rapier';
import { Simulation } from '../sim/Simulation';
import type { SliceLayout } from '../sim/layout';
import type { ExternalInputs, Machine, MachineState } from './verify';

/** 物理シミュレーションを検証用の機械として包む（画面で動いているものとは別の、新しいワールド） */
export class SimMachine implements Machine {
  readonly sim: Simulation;
  private limitHit = false;

  constructor(R: Rapier, layout: SliceLayout) {
    this.sim = new Simulation(R, layout);
  }

  get tick(): number {
    return this.sim.tick;
  }

  step(): void {
    this.sim.step();
    if (this.sim.launcherWaiting === 'max_balls') this.limitHit = true;
  }

  state(): MachineState {
    return this.sim.verifierState();
  }

  outputs(): number {
    return this.sim.outputEvents();
  }

  external(): ExternalInputs {
    return this.sim.externalInputs();
  }

  bugs(): string[] {
    return [...new Set(this.sim.bugEvents().map((b) => b.id))];
  }

  ballLimitHit(): boolean {
    return this.limitHit;
  }

  dispose(): void {
    this.sim.dispose();
  }
}
