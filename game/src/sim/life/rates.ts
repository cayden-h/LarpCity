// Market rates for the simulation, from the shipped FRED snapshot. Until the
// seeded market path (research/03) drives rates, the game holds the latest
// real value past the snapshot's last date.

import { MARKET, type SeriesId } from "../../data/market.ts";

export const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The series value on or before `date` (the first value if the date is earlier). */
export function seriesOn(id: SeriesId, date: Date): number {
  const pts = MARKET.series[id].points;
  const iso = toIso(date);
  let lo = 0;
  let hi = pts.length - 1;
  if (iso < pts[0][0]) return pts[0][1];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid][0] <= iso) lo = mid;
    else hi = mid - 1;
  }
  return pts[lo][1];
}

/** Effective Fed funds rate as a fraction; the debt engine's cash rate. */
export function cashRateOn(date: Date): number {
  return seriesOn("DFF", date) / 100;
}

export function latest(id: SeriesId): { date: string; value: number; change: number; changePct: number } {
  const pts = MARKET.series[id].points;
  const [date, value] = pts[pts.length - 1];
  const prev = pts.length > 1 ? pts[pts.length - 2][1] : value;
  return { date, value, change: value - prev, changePct: prev ? (value - prev) / prev : 0 };
}
