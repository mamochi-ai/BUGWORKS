import type { EditorModel } from '../edit/EditorModel';
import type { SliceLayout } from '../sim/layout';
import type { Simulation } from '../sim/Simulation';
import type { SimulationController } from '../sim/SimulationController';
import { loadProgress, saveProgress, type Progress } from './progress';
import { STAGES, STICKY_EVENTS, findStage, unlockState, type StageDef, type StageEvent } from './stages';

type Change = 'stage' | 'clear' | 'events';

/**
 * ステージの進行：ステージを始める／自由研究に戻る／クリアを判定して記録する。
 * クリアは「1回の再生で、必要な出来事がすべて起きた」とき（リセットでやり直し）。時間で勝手に進めることはしない。
 */
export class StageController {
  private _current: StageDef | null = null;
  private clearedThisRun = false;
  /** ステージを始めてからゴールに入ったことがあるか（保存のステージ用） */
  private goalSeen = false;
  /** ゴールに入ったあとに設計図を保存したか */
  private savedAfterGoal = false;
  private lastEvents = '';
  private progress: Progress = loadProgress();
  private listeners = new Set<(c: Change) => void>();

  constructor(
    private readonly editor: EditorModel,
    private readonly ctl: SimulationController,
    private readonly sim: Simulation,
    private readonly freeLayout: SliceLayout,
  ) {
    ctl.onChange(() => {
      if (ctl.state === 'ready') {
        this.clearedThisRun = false;
        this.emitEvents();
      }
    });
  }

  get current(): StageDef | null {
    return this._current;
  }

  isCleared(id: string): boolean {
    return this.progress.cleared.includes(id);
  }

  /** 遊べるか（ロック中なら理由つき） */
  unlock(id: string): { unlocked: boolean; reason?: string } {
    return unlockState(id, this.progress.cleared);
  }

  /** 今の再生で起きた出来事（保存のステージでは、ゴールと保存はステージの間ずっと覚えておく） */
  events(): Record<StageEvent, boolean> {
    const ev = this.sim.events();
    const sticky = this.isStickyStage();
    return {
      ...ev,
      ball_enter_goal: ev.ball_enter_goal || (sticky && this.goalSeen),
      blueprint_saved: this.savedAfterGoal,
    };
  }

  /** 設計図を保存した（この端末・ファイルのどちらでも）。ゴールに入れたあとなら記録する */
  markSaved(): void {
    if (!this._current || !this.goalSeen) return;
    this.savedAfterGoal = true;
    this.update();
  }

  /** 保存のステージ（覚えておく出来事がある）か */
  private isStickyStage(): boolean {
    return !!this._current?.required.some((e) => STICKY_EVENTS.includes(e));
  }

  start(id: string): boolean {
    const st = findStage(id);
    if (!st || st.comingSoon || !this.unlock(id).unlocked) return false;
    this.ctl.ensureEditable();
    this._current = st;
    this.clearedThisRun = false;
    this.goalSeen = false;
    this.savedAfterGoal = false;
    this.editor.startStage(st.devices, st.inventory, `ステージ ${st.id}「${st.name}」`);
    this.emit('stage');
    return true;
  }

  free(): void {
    this.ctl.ensureEditable();
    this._current = null;
    this.editor.startFree(this.freeLayout.devices, '自由研究：好きな装置を置いて試せます');
    this.emit('stage');
  }

  /** 次に遊べるステージ */
  next(): StageDef | null {
    if (!this._current) return null;
    const i = STAGES.findIndex((s) => s.id === this._current!.id);
    const n = STAGES[i + 1];
    return n && !n.comingSoon && this.unlock(n.id).unlocked ? n : null;
  }

  /** 描画フレームごとに呼ぶ */
  update(): void {
    if (!this._current) return;
    if (this.sim.events().ball_enter_goal) this.goalSeen = true;
    this.emitEvents();
    // 保存のステージは、保存（初期状態で行う）でもクリアになる
    if (this.clearedThisRun || (this.ctl.state === 'ready' && !this.isStickyStage())) return;
    const ev = this.events();
    if (this._current.required.every((e) => ev[e])) {
      this.clearedThisRun = true;
      if (!this.progress.cleared.includes(this._current.id)) {
        this.progress = { cleared: [...this.progress.cleared, this._current.id] };
        saveProgress(this.progress);
      }
      this.emit('clear');
    }
  }

  onChange(fn: (c: Change) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emitEvents(): void {
    const key = JSON.stringify(this.events());
    if (key === this.lastEvents) return;
    this.lastEvents = key;
    this.emit('events');
  }

  private emit(c: Change): void {
    for (const fn of this.listeners) fn(c);
  }
}
