// Rewind: a checkpoint of a life for every game day, so the calendar can go
// back to any past day exactly (the meeting's unlimited rewind). A checkpoint
// is taken on the first emit of each day, which is the day's tick; anything
// else the player does that day comes after it, so going back to a day lands
// on its morning. The market is seeded, so the days after a checkpoint replay
// identically unless the player chooses differently.
//
// Memory stays bounded without an action log: a checkpoint older than
// `window` days is dropped only if replaying the days from the previous kept
// checkpoint reproduces it exactly, so anything the player did in between
// (a trade, or a desk setting that emits nothing) keeps its checkpoint. A
// "shadow" copy advances one day per judgment instead of replaying from
// scratch, and at least one checkpoint survives every `maxGap` days, which
// bounds how many days a rewind has to replay.

import type { LifeCheckpoint, PlayerLife } from "../life/player.ts";
import { serialize } from "./copy.ts";

export { deepCopy, serialize } from "./copy.ts";

export interface TimelineOptions {
  /** Calendar date of game day 0. */
  start: Date;
  /** Days kept in full, one checkpoint each, before thinning. */
  window?: number;
  /** Most days between two kept checkpoints. */
  maxGap?: number;
  /** Nothing outside the sim ever changes this life (an NPC), so replaying always reproduces it: thin without checking. */
  neverActs?: boolean;
  /**
   * Something besides `life.onDay` also changes this life once a day (an NPC's
   * discretionary-spending habit, sim/npcs/habits.ts's `applyDailyHabit`, called
   * from `NpcTown.onDay` after `onDay` itself). Every internal replay here
   * (a rewind's catch-up, and `neverActs`'s shadow check) must call it too, or
   * a rewound life drifts from one that was never rewound.
   */
  onReplayDay?: (life: PlayerLife, day: number, date: Date) => void;
}

export class LifeTimeline {
  private readonly life: PlayerLife;
  private readonly start: Date;
  private readonly window: number;
  private readonly maxGap: number;
  private readonly neverActs: boolean;
  private readonly onReplayDay?: (life: PlayerLife, day: number, date: Date) => void;
  /** Oldest first, one per day inside the window. */
  private readonly cps: LifeCheckpoint[] = [];
  /** How many checkpoints at the front were judged and kept for good. */
  private judged = 0;
  /** The last kept checkpoint's state, replayed forward over the checkpoints dropped since. */
  private shadow: PlayerLife | null = null;
  private lastDay: number;

  constructor(life: PlayerLife, o: TimelineOptions) {
    this.life = life;
    this.start = o.start;
    this.window = o.window ?? 365;
    this.maxGap = o.maxGap ?? 90;
    this.neverActs = o.neverActs ?? false;
    this.onReplayDay = o.onReplayDay;
    this.cps.push(life.checkpoint());
    this.lastDay = life.today;
    life.onEvents(() => {
      if (life.today !== this.lastDay) this.take();
    });
  }

  /** Checkpoints held. */
  get size(): number {
    return this.cps.length;
  }

  /** The earliest day a rewind can reach. */
  get firstDay(): number {
    return this.cps[0].day;
  }

  /** Puts the life back to the morning of `day` (today or earlier) and forgets everything after it. */
  rewindTo(day: number): void {
    if (day > this.life.today) throw new Error(`Can't rewind forward to day ${day}.`);
    let i = this.cps.length - 1;
    while (i > 0 && this.cps[i].day > day) i--;
    const cp = this.cps[i];
    if (cp.day > day) throw new Error(`No checkpoint at or before day ${day}.`);
    this.life.restore(cp);
    this.life.quietly(() => {
      // A checkpoint is taken on its own day's `onDay` tick (the emit at the end of `onDay`), before
      // `onReplayDay` (an NPC's separately-timed daily habit spend) runs for that same day — so the
      // checkpoint's day is always missing its own `onReplayDay`, once, however it was reached.
      this.onReplayDay?.(this.life, cp.day, this.dateOf(cp.day));
      for (let d = cp.day + 1; d <= day; d++) {
        const date = this.dateOf(d);
        this.life.onDay(d, date);
        this.onReplayDay?.(this.life, d, date);
      }
    });
    this.cps.length = i + 1;
    this.judged = Math.min(this.judged, this.cps.length);
    this.shadow = null;
    this.lastDay = day;
    if (cp.day < day) this.cps.push(this.life.checkpoint());
  }

  private take(): void {
    this.lastDay = this.life.today;
    this.cps.push(this.life.checkpoint());
    const cutoff = this.lastDay - this.window;
    while (this.judged < this.cps.length && this.cps[this.judged].day < cutoff) this.judge();
  }

  /** Keeps or drops the oldest unjudged checkpoint. */
  private judge(): void {
    const i = this.judged;
    const cp = this.cps[i];
    const prev = i > 0 ? this.cps[i - 1] : null;
    if (prev && cp.day - prev.day < this.maxGap) {
      if (this.neverActs) {
        this.cps.splice(i, 1);
        return;
      }
      const fresh = !this.shadow;
      const shadow = this.shadow ?? prev.state.detached();
      // Same reason as rewindTo: a freshly detached checkpoint is missing its own day's onReplayDay.
      // A reused shadow (this.shadow) already had it applied on a prior judge() pass.
      if (fresh) this.onReplayDay?.(shadow, shadow.today, this.dateOf(shadow.today));
      for (let d = shadow.today + 1; d <= cp.day; d++) {
        const date = this.dateOf(d);
        shadow.onDay(d, date);
        this.onReplayDay?.(shadow, d, date);
      }
      shadow.history.length = 0;
      shadow.log.length = 0;
      if (serialize(shadow) === serialize(cp.state)) {
        this.shadow = shadow;
        this.cps.splice(i, 1);
        return;
      }
    }
    this.shadow = null;
    this.judged++;
  }

  private dateOf(day: number): Date {
    const d = new Date(this.start);
    d.setDate(d.getDate() + day);
    return d;
  }
}
