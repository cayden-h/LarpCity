// The seeded market behind goal fast-forwards and their preview, month by
// month, calibrated to research/03: a bull market (+0.38% a week, 1.94% weekly
// volatility) interrupted by bear markets drawn from its named templates, plus
// the preset AI Boom and AI Bubble Pop on fixed dates in every run (meeting
// 2026-09-12). A bear is the falling phase; the ordinary bull market then
// climbs back, and the episode ends when the index regains its old peak.
// A path depends only on its seed and the month, never on the player's
// choices, so a different plan or a rewind sees the same market.

import { rngFor, type Rng } from "../../engine/rng.ts";
import type { CrashRule } from "./types.ts";

/** Placeholder dates until the team picks them (meeting 2026-09-12, "Demo timeline"). */
export const AI_BOOM_START = new Date(2027, 2, 1);
export const AI_BUBBLE_POP_START = new Date(2028, 8, 1);

const WEEKS_PER_MONTH = 52 / 12;
/** Bull phase: +0.38% a week with 1.94% weekly volatility (research/03), as monthly log returns. */
const BULL_DRIFT = 0.0038 * WEEKS_PER_MONTH;
const BULL_VOL = 0.0194 * Math.sqrt(WEEKS_PER_MONTH);
/** Noise around a bear template's fall; the template sets its depth and length. */
const BEAR_VOL = 0.03;
/**
 * A bear starts with a 0.45% chance a week whenever the market isn't already
 * falling, recoveries included (about one every 5 years), which is what gives
 * research/03's long-run 8.2% a year.
 */
const BEAR_HAZARD = 1 - (1 - 0.0045) ** WEEKS_PER_MONTH;
/** Extra monthly drift while the AI Boom lifts the market. */
const BOOM_EXTRA = 0.006;
/** Bonds earn about 4.3% a year and rally when stocks fall; cash after a panic sale earns about 3.6%. */
const BOND_DRIFT = 0.0035;
const BOND_VOL = 0.012;
const BOND_FLIGHT = 0.005;
const CASH_RETURN = 0.003;
/** A crash rule sells once the index is down this much from its peak (the usual bear-market line)... */
const PANIC_DRAWDOWN = 0.2;
/** ...and buys back only this long after the index is back at its old peak. */
const REENTRY_DELAY_MONTHS = 3;
/** An episode that hasn't recovered after this long is closed anyway. */
const MAX_EPISODE_MONTHS = 15 * 12;

interface Template {
  name: string;
  weight: number;
  depth: [number, number];
  fallWeeks: [number, number];
  /** Bonds fall too (the 2022 Rate Shock). */
  bondShock?: [number, number];
}

/** research/03, "Bear templates" (recovery times there come out of the bull market that follows). */
export const BEAR_TEMPLATES: Template[] = [
  { name: "Flash Crash", weight: 15, depth: [0.25, 0.35], fallWeeks: [2, 8] },
  { name: "Pandemic Plunge", weight: 15, depth: [0.3, 0.35], fallWeeks: [4, 6] },
  { name: "Housing Crunch", weight: 20, depth: [0.45, 0.57], fallWeeks: [60, 75] },
  { name: "Rate Shock", weight: 25, depth: [0.2, 0.27], fallWeeks: [35, 45], bondShock: [-0.15, -0.12] },
  { name: "Stagflation Squeeze", weight: 10, depth: [0.4, 0.5], fallWeeks: [80, 95] },
  { name: "Market correction", weight: 15, depth: [0.1, 0.19], fallWeeks: [6, 20] },
];

/** research/03 event 4: the market falls 20-30% over about 30 weeks. */
const AI_POP = { name: "AI Bubble Pop", depth: 0.25, fallMonths: 7 };

export const BULL = 0;
export const FALL = 1;
export const RECOVER = 2;

export interface MarketEpisode {
  name: string;
  startMonth: number;
  /** First month of the recovery. */
  bottomMonth: number;
  /** First month with the index back at its old peak (or the end of the path). */
  endMonth: number;
  /** Month the index first closed 20% below its peak, when panic sellers sell; null if it never did. */
  panicMonth: number | null;
  depth: number;
  scripted: boolean;
}

export interface MarketPath {
  seed: number;
  startYear: number;
  startMonth: number;
  months: number;
  /** Simple monthly returns. */
  stock: Float64Array;
  bond: Float64Array;
  regime: Uint8Array;
  /** The episode whose crash rule is in force (its fall, recovery, and re-entry delay), or -1. */
  episodeOf: Int16Array;
  episodes: MarketEpisode[];
}

function normal(rng: Rng): number {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const between = (rng: Rng, [lo, hi]: [number, number]) => lo + (hi - lo) * rng();
const toMonths = (weeks: number) => Math.max(1, Math.round(weeks / WEEKS_PER_MONTH));

/** Month index of `date` on the path (month 0 is the path's first month). */
export function monthIndex(path: Pick<MarketPath, "startYear" | "startMonth">, date: Date): number {
  return (date.getFullYear() - path.startYear) * 12 + date.getMonth() - path.startMonth;
}

interface Live {
  ep: MarketEpisode;
  index: number;
  peak: number;
  fallDrift: number;
  bondFallDrift: number | null;
}

export function createMarket(seed: number, start: Date, years = 80): MarketPath {
  const months = years * 12;
  const path: MarketPath = {
    seed,
    startYear: start.getFullYear(),
    startMonth: start.getMonth(),
    months,
    stock: new Float64Array(months),
    bond: new Float64Array(months),
    regime: new Uint8Array(months),
    episodeOf: new Int16Array(months).fill(-1),
    episodes: [],
  };
  const boomAt = monthIndex(path, AI_BOOM_START);
  const popAt = monthIndex(path, AI_BUBBLE_POP_START);
  const totalWeight = BEAR_TEMPLATES.reduce((s, t) => s + t.weight, 0);
  let level = 0; // log of the stock index
  let live: Live | null = null;

  const begin = (m: number, name: string, depth: number, fallMonths: number, scripted: boolean, bondShock: number | null): Live => {
    const ep: MarketEpisode = { name, startMonth: m, bottomMonth: m + fallMonths, endMonth: months, panicMonth: null, depth, scripted };
    path.episodes.push(ep);
    return {
      ep,
      index: path.episodes.length - 1,
      peak: level,
      fallDrift: Math.log(1 - depth) / fallMonths,
      bondFallDrift: bondShock === null ? null : Math.log(1 + bondShock) / fallMonths,
    };
  };

  for (let m = 0; m < months; m++) {
    const rng = rngFor(seed, "market", m);
    if (m === popAt) {
      // The preset pop happens in every run, even if it has to cut a random episode short.
      if (live) live.ep.endMonth = m;
      live = begin(m, AI_POP.name, AI_POP.depth, AI_POP.fallMonths, true, null);
    } else if ((!live || m >= live.ep.bottomMonth) && !(m >= popAt - 12 && m < popAt) && rng() < BEAR_HAZARD) {
      // A new bear can hit during a recovery too; the year before the pop stays calm so it starts from a bull market.
      if (live) live.ep.endMonth = m;
      const pick = rngFor(seed, "bear", m);
      let r = pick() * totalWeight;
      const t = BEAR_TEMPLATES.find((x) => (r -= x.weight) < 0) ?? BEAR_TEMPLATES[0];
      live = begin(m, t.name, between(pick, t.depth), toMonths(between(pick, t.fallWeeks)), false, t.bondShock ? between(pick, t.bondShock) : null);
    }

    if (live && m < live.ep.bottomMonth) {
      path.regime[m] = FALL;
      path.stock[m] = Math.exp(live.fallDrift + BEAR_VOL * normal(rng)) - 1;
      path.bond[m] = Math.exp((live.bondFallDrift ?? Math.log(1 + BOND_FLIGHT)) + BOND_VOL * normal(rng)) - 1;
    } else {
      path.regime[m] = live ? RECOVER : BULL;
      const drift = BULL_DRIFT + (m >= boomAt && m < popAt ? BOOM_EXTRA : 0);
      path.stock[m] = Math.exp(drift + BULL_VOL * normal(rng)) - 1;
      path.bond[m] = Math.exp(Math.log(1 + BOND_DRIFT) + BOND_VOL * normal(rng)) - 1;
    }
    level += Math.log(1 + path.stock[m]);

    if (live) {
      path.episodeOf[m] = live.index;
      if (live.ep.panicMonth === null && level <= live.peak + Math.log(1 - PANIC_DRAWDOWN)) live.ep.panicMonth = m;
      const recovered = m >= live.ep.bottomMonth && level >= live.peak;
      if (recovered || m - live.ep.startMonth >= MAX_EPISODE_MONTHS) {
        live.ep.endMonth = m + 1;
        live = null;
      }
    }
  }

  // Panic sellers stay out a little past the recovery.
  path.episodes.forEach((ep, i) => {
    for (let m = ep.endMonth; m < Math.min(months, ep.endMonth + REENTRY_DELAY_MONTHS); m++) if (path.episodeOf[m] === -1) path.episodeOf[m] = i;
  });
  return path;
}

/**
 * One month's return on a stock/bond mix. A crash rule other than "hold"
 * sells half or all of the stocks at the end of the month the market is first
 * down 20%, and buys back a few months after the index is back at its old
 * peak, which is how panic selling locks in the loss and misses the rebound.
 */
export function portfolioReturn(path: MarketPath, m: number, stockPct: number, rule: CrashRule): number {
  if (m < 0 || m >= path.months) return 0;
  let held = stockPct;
  const e = path.episodeOf[m];
  const panic = e >= 0 ? path.episodes[e].panicMonth : null;
  if (rule !== "hold" && panic !== null && m > panic) held *= rule === "sell_half" ? 0.5 : 0;
  return held * path.stock[m] + (1 - stockPct) * path.bond[m] + (stockPct - held) * CASH_RETURN;
}

/** Episodes under way at any point from month `from` through month `to`. */
export function episodesBetween(path: MarketPath, from: number, to: number): MarketEpisode[] {
  return path.episodes.filter((e) => e.startMonth <= to && e.endMonth > from);
}
