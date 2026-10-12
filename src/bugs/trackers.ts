import { BUG_TUNING, watchable } from '../sim/bugs';
import type { PlacedDevice } from '../sim/layout';

/**
 * 物理の外で準備される隠しバグ（BUG-15・BUG-30, D-42）。条件は開発用資料に従い、画面・保存・ドキュメントには出さない。
 * 準備ができたら次の再生に渡し、バグが実際に起きるまで残す（起きる場面が無い再生では使わない）。
 */
export class RepeatTracker {
  private last: string | null = null;
  private streak = 0;
  private _armed = false;

  /** 再生の要約を記録する */
  record(print: string): void {
    if (print === this.last) this.streak++;
    else {
      this.last = print;
      this.streak = 1;
    }
    if (this.streak >= BUG_TUNING.repeatRuns) this._armed = true;
  }

  get armed(): boolean {
    return this._armed;
  }

  /** バグが起きた：最初から数え直す */
  consumed(): void {
    this._armed = false;
    this.last = null;
    this.streak = 0;
  }
}

export class WatchTracker {
  private counts = new Map<string, number>();
  private _armed: string | null = null;

  /** 装置が選ばれた */
  observe(device: PlacedDevice): void {
    if (!watchable(device.type)) return;
    const n = (this.counts.get(device.id) ?? 0) + 1;
    if (n >= BUG_TUNING.watchCount) {
      this.counts.delete(device.id);
      this._armed = device.id;
    } else this.counts.set(device.id, n);
  }

  /** 配置が変わった */
  layoutChanged(before: readonly PlacedDevice[], after: readonly PlacedDevice[]): void {
    const now = new Map(after.map((d) => [d.id, JSON.stringify(d)]));
    for (const d of before) {
      if (now.get(d.id) === JSON.stringify(d)) continue;
      this.counts.delete(d.id);
      if (this._armed === d.id) this._armed = null;
    }
  }

  get armed(): string | null {
    return this._armed;
  }

  consumed(): void {
    this._armed = null;
  }
}
