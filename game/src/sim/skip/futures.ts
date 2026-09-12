// Other possible markets for the setup screen's preview: the same MarketPath
// model (sim/market) under seeds derived from the run's seed, never the run's
// own seed, so moving a slider can't reveal the real future. Each future keeps
// only the LTM and BOND prices on the 1st of every month. A path costs about
// 15 ms per 40 years to build, so the UI builds the 100 futures once in a Web
// Worker (futures.worker.ts) and reuses them for every slider move.

import { hashKeys } from "../../engine/rng.ts";
import { MarketPath } from "../market/index.ts";

export const PREVIEW_RUNS = 100;
/** Long enough for a 27-year-old to look ahead to age 90. */
export const PREVIEW_YEARS = 64;

export interface Future {
  /** Prices on game day 0, then on the 1st of each month after it. */
  stock: Float64Array;
  bond: Float64Array;
}

export function previewSeed(seed: number, i: number): number {
  return hashKeys(seed, "preview", i);
}

/** Game day of the 1st of the `k`th month after the path's start (k = 0 is day 0 itself). */
function sampleDay(start: Date, k: number): number {
  if (k === 0) return 0;
  const first = new Date(start.getFullYear(), start.getMonth() + k, 1);
  const origin = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  // Rounding absorbs the hour that daylight saving adds or removes.
  return Math.round((first.getTime() - origin.getTime()) / 86_400_000);
}

export function buildFuture(seed: number, years = PREVIEW_YEARS): Future {
  const path = new MarketPath(seed);
  const n = years * 12;
  const stock = new Float64Array(n + 1);
  const bond = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) {
    const day = sampleDay(path.start, k);
    stock[k] = path.price("LTM", day);
    bond[k] = path.price("BOND", day);
  }
  return { stock, bond };
}

/** Builds every future on this thread (tests, and the fallback when workers aren't available). */
export function buildFutures(seed: number, runs = PREVIEW_RUNS, years = PREVIEW_YEARS): Future[] {
  return Array.from({ length: runs }, (_, i) => buildFuture(previewSeed(seed, i), years));
}

/** Month offset of `date` into a future whose path starts on `start`. */
export function futureMonth(start: Date, date: Date): number {
  return (date.getFullYear() - start.getFullYear()) * 12 + date.getMonth() - start.getMonth();
}
