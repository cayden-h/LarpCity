// Game calendar plus the cosmetic time of day.
//
// The meeting set normal speed to 1 in-game week every 10 real seconds, which
// is about 1.4 s per game day. A real day/night cycle at that rate would
// strobe, so the sky runs its own cosmetic clock (one visual day per
// `visualDaySeconds`) and only the calendar (seasons, weather spells) follows
// game days. Skips hold the sky at a steady daytime look.

export const SECONDS_PER_GAME_WEEK = 10;

export type Season = "spring" | "summer" | "fall" | "winter";

export const SPEEDS = [0, 1, 2, 4] as const;

export class Clock {
  readonly start = new Date(2026, 8, 11); // HackRice Friday
  /** Whole game days since start. */
  day = 0;
  private dayFraction = 0;
  /** Calendar speed multiplier; 0 is paused. */
  speed = 1;
  /** Time of day, 0..1 where 0 and 1 are midnight and 0.5 is noon. */
  timeOfDay = 0.42;
  visualDaySeconds = 72;
  /** When set, the sky stays at this time of day (the dev scrubber). */
  pinnedTimeOfDay: number | null = null;
  /** True while a skip or fast-forward holds the sky still. */
  skipping = false;
  /**
   * Set while Sammy's tour is open: the calendar stops without touching `speed`, so it resumes at
   * the same speed afterward, and the speed buttons, skips, and fast-forward stay off meanwhile.
   */
  held = false;

  private readonly listeners: ((day: number) => void)[] = [];

  /** Subscribe to day changes; returns an unsubscribe function. */
  onDay(fn: (day: number) => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  update(dtSeconds: number): void {
    if (this.pinnedTimeOfDay !== null) {
      this.timeOfDay = this.pinnedTimeOfDay;
    } else if (this.skipping) {
      this.timeOfDay += (0.5 - this.timeOfDay) * Math.min(1, dtSeconds * 2);
    } else {
      this.timeOfDay = (this.timeOfDay + dtSeconds / this.visualDaySeconds) % 1;
    }

    if (this.speed === 0 || this.held) return;
    this.dayFraction += (dtSeconds * this.speed * 7) / SECONDS_PER_GAME_WEEK;
    while (this.dayFraction >= 1) {
      this.dayFraction -= 1;
      this.advanceDays(1);
    }
  }

  advanceDays(days: number): void {
    for (let i = 0; i < days; i++) {
      this.day += 1;
      for (const fn of this.listeners) fn(this.day);
    }
  }

  /** Sets the calendar to `day` without firing day listeners: a goal fast-forward already ran those days headless. */
  jumpTo(day: number): void {
    this.day = day;
    this.dayFraction = 0;
  }

  get date(): Date {
    const d = new Date(this.start);
    d.setDate(d.getDate() + this.day);
    return d;
  }

  get month(): number {
    return this.date.getMonth();
  }

  get season(): Season {
    return seasonOf(this.month);
  }

  /** 0 in full daylight, 1 in deep night, smooth through dawn and dusk. */
  get nightness(): number {
    return nightnessAt(this.timeOfDay);
  }
}

export function seasonOf(month: number): Season {
  if (month <= 1 || month === 11) return "winter";
  if (month <= 4) return "spring";
  if (month <= 7) return "summer";
  return "fall";
}

const smooth = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

export function nightnessAt(t: number): number {
  // Sunrise 0.22-0.3, sunset 0.72-0.8.
  return 1 - smooth(0.2, 0.3, t) + smooth(0.72, 0.82, t);
}

/** How strong the golden-hour glow is (peaks at dawn and dusk). */
export function goldenAt(t: number): number {
  const dawn = Math.exp(-(((t - 0.27) / 0.04) ** 2));
  const dusk = Math.exp(-(((t - 0.76) / 0.045) ** 2));
  return Math.max(dawn, dusk);
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
