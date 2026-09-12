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
}

export class LifeTimeline {
  private readonly life: PlayerLife;
  private readonly start: Date;
  private readonly window: number;
  private readonly maxGap: number;
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
      for (let d = cp.day + 1; d <= day; d++) this.life.onDay(d, this.dateOf(d));
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
      const shadow = this.shadow ?? prev.state.detached();
      for (let d = shadow.today + 1; d <= cp.day; d++) shadow.onDay(d, this.dateOf(d));
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
