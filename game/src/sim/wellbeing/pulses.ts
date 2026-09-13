import type { Pulse } from "./types.ts";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** P0 and half-life values adopted from research/09 section 3.3. */
export const PULSE_TABLE = {
  marriage: { p0: 6, halfLifeDays: 365, startDay: 0 },
  firstChild: { p0: 4, halfLifeDays: 365, startDay: 0 },
  divorce: { p0: -6, halfLifeDays: 365, startDay: 0 },
  layoff: { p0: -5, halfLifeDays: 365, startDay: 0 },
  bankruptcy: { p0: -6, halfLifeDays: 730, startDay: 0 },
  retiredOnTrack: { p0: 4, halfLifeDays: 730, startDay: 0 },
  forcedRetirement: { p0: -6, halfLifeDays: 730, startDay: 0 },
} as const satisfies Record<string, Pulse>;

export function decay(pulse: Pulse, today: number): number {
  if (!Number.isFinite(pulse.p0) || !Number.isFinite(pulse.halfLifeDays) || pulse.halfLifeDays <= 0) return 0;
  if (today < pulse.startDay) return 0;
  const elapsed = today - pulse.startDay;
  return pulse.p0 * 0.5 ** (elapsed / pulse.halfLifeDays);
}

/** Negative events hurt 30% more without a cushion and 20% less with six months saved. */
export function cushionSoftening(cushionSubScore: number): number {
  return 1.3 - 0.5 * clamp01(cushionSubScore);
}
