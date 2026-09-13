// Going back in time (sim/rewind) is for the end-of-game review only (meeting
// 2026-09-13): during play the Calendar shows the past but can't return to it,
// so every choice sticks. Skipping ahead to the next decision stays available
// the whole game; it's a different thing.

export class ReviewGate {
  private open = false;
  private readonly listeners: (() => void)[] = [];

  /** Whether the player may go back to a past day. */
  get unlocked(): boolean {
    return this.open;
  }

  /** The run ended at retirement: the review may go back to any day. */
  unlock(): void {
    if (this.open) return;
    this.open = true;
    for (const fn of this.listeners) fn();
  }

  onUnlock(fn: () => void): void {
    this.listeners.push(fn);
  }
}
