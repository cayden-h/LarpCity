// The market the player invests in. Before game day 0 it is real history from
// the FRED snapshot; from day 0 on it is research/03's templated regime model
// run on trading days: a calm bull regime and a volatile bear regime with
// fat-tailed (Student-t, 4 degrees of freedom) daily noise. Every draw is keyed
// by (seed, day), so nothing the player does can change the market path, which
// keeps rewinds and "if you had held" comparisons honest.

import { MARKET } from "../../data/market.ts";
import { seriesOn } from "../life/rates.ts";

export type InstrumentId = "LTM" | "BOND" | "NNST";
export type Regime = "bull" | "bear";

export interface Instrument {
  id: InstrumentId;
  name: string;
  kind: "fund" | "stock";
  /** Annual fee as a fraction, taken out of the price every trading day. */
  expenseRatio: number;
  /** How strongly it follows the whole market (1 = moves with it). */
  beta: number;
  /** Daily volatility of its own moves on top of the market's. */
  idioVol: number;
  /** Price on game day 0. */
  start: number;
  /** One plain-language line for beginners. */
  blurb: string;
}

export const INSTRUMENTS: readonly Instrument[] = [
  { id: "LTM", name: "Larp Total Market", kind: "fund", expenseRatio: 0.0003, beta: 1, idioVol: 0, start: 312.4, blurb: "Owns a sliver of every big US company. The default good choice." },
  { id: "BOND", name: "City Bond Fund", kind: "fund", expenseRatio: 0.0004, beta: 0, idioVol: 0, start: 72.1, blurb: "Loans to governments and companies. Steadier, grows slower, and still not risk-free." },
  { id: "NNST", name: "NeuralNest", kind: "stock", expenseRatio: 0, beta: 1.8, idioVol: 0.6 / Math.sqrt(252), start: 188.2, blurb: "One hyped AI company. Big swings both ways; one stock can fall 80%." },
];

export const instrument = (id: InstrumentId): Instrument => INSTRUMENTS.find((i) => i.id === id)!;

/**
 * The meeting fixed the AI Boom and the AI Bubble Pop to the same calendar
 * dates in every run (research/03 events 3 and 4). These are placeholders
 * until the team picks the dates.
 */
export const AI_BOOM_START = new Date(2027, 2, 1);
export const AI_BUBBLE_POP_START = new Date(2028, 8, 1);
/** The pop's fall lasts about 30 weeks (the Dot-Bomb template). */
const POP_WEEKS = 30;

/** Where the preset AI arc lands in this run, as game days. */
export interface MarketPresets {
  boomDay: number;
  popDay: number;
  /** First trading day after the fall; the market returns to the bull regime here. */
  popEndDay: number;
  /** How many times over NeuralNest multiplies during the boom (3 to 4). */
  boomMultiple: number;
  /** How far the whole market falls in the pop (0.2 to 0.3). */
  popDepth: number;
  /** How far NeuralNest falls in the pop (0.7 to 0.85). */
  nnstPopDepth: number;
}

// Research/03's weekly calibration, divided into 5 trading days (drift / 5, volatility / sqrt 5).
const BULL = { mu: 0.0038 / 5, sigma: 0.0194 / Math.sqrt(5), exit: 0.0045 / 5 };
const BEAR = { mu: -0.0105 / 5, sigma: 0.0416 / Math.sqrt(5), exit: 0.024 / 5 };
const BOND = { mu: 0.0009 / 5, sigma: 0.012 / Math.sqrt(5), corr: -0.2 };
/** Daily noise during the scripted pop, on top of the steered drift. */
const POP_SIGMA = BULL.sigma * 1.4;
/** Bond price sensitivity to the 10-year yield, for the historical part (duration ~8). */
const BOND_DURATION = 8;
const T4_SCALE = Math.sqrt(2 / 4);

function hash(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const ch of parts.join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Four independent uniforms in (0, 1] for one key. */
function uniforms(seed: number, stream: string, day: number): [number, number, number, number] {
  let a = hash(seed, stream, day);
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) + 1) / 4294967297;
  };
  return [next(), next(), next(), next()];
}

const normal = (u1: number, u2: number) => Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
/** Student-t with 4 degrees of freedom, scaled to unit variance (a chi-square(4) is -2 ln(u3 u4)). */
const t4 = (u: [number, number, number, number]) => (normal(u[0], u[1]) / Math.sqrt(-2 * Math.log(u[2] * u[3]) / 4)) * T4_SCALE;

const DAY_MS = 86_400_000;
const SP_POINTS = MARKET.series.SP500.points;
const SP_LAST = SP_POINTS[SP_POINTS.length - 1][1];
const Y10_LAST = MARKET.series.DGS10.points[MARKET.series.DGS10.points.length - 1][1];

export interface PricePoint {
  day: number;
  value: number;
}

export class MarketPath {
  readonly seed: number;
  readonly start: Date;
  /** Index level and instrument prices for game days 0..n (weekends repeat Friday). */
  private readonly index: number[] = [SP_LAST];
  private readonly prices: Record<InstrumentId, number[]> = { LTM: [instrument("LTM").start], BOND: [instrument("BOND").start], NNST: [instrument("NNST").start] };
  private readonly regimes: Regime[] = ["bull"];
  readonly presets: MarketPresets;

  constructor(seed = 20260911, start = new Date(2026, 8, 11), dates: { boom?: Date; pop?: Date } = {}) {
    this.seed = seed;
    this.start = start;
    const u = uniforms(seed, "pop", 0);
    const popDay = this.weekdayFrom(Math.max(1, this.dayOf(dates.pop ?? AI_BUBBLE_POP_START)));
    this.presets = {
      boomDay: Math.max(1, this.dayOf(dates.boom ?? AI_BOOM_START)),
      popDay,
      popEndDay: this.weekdayFrom(popDay + POP_WEEKS * 7),
      boomMultiple: 3 + u[2],
      popDepth: 0.2 + 0.1 * u[0],
      nnstPopDepth: 0.7 + 0.15 * u[1],
    };
  }

  /** Game day of a calendar date. */
  dayOf(date: Date): number {
    const a = new Date(this.start);
    const b = new Date(date);
    a.setHours(12, 0, 0, 0);
    b.setHours(12, 0, 0, 0);
    return Math.round((b.getTime() - a.getTime()) / DAY_MS);
  }

  private weekdayFrom(day: number): number {
    let d = day;
    while ([0, 6].includes(this.dateOf(d).getDay())) d++;
    return d;
  }

  /** Trading days in [from, to). */
  private tradingDays(from: number, to: number): number {
    let n = 0;
    for (let d = from; d < to; d++) if (![0, 6].includes(this.dateOf(d).getDay())) n++;
    return n;
  }

  /** Calendar date of a game day. */
  dateOf(day: number): Date {
    // Calendar arithmetic like Clock.date: adding 24-hour blocks drifts an hour across daylight saving.
    const d = new Date(this.start);
    d.setDate(d.getDate() + day);
    return d;
  }

  /** The earliest game day with real history (the snapshot's first S&P close). */
  get firstDay(): number {
    const noon = new Date(this.start);
    noon.setHours(12, 0, 0, 0);
    return Math.round((new Date(`${SP_POINTS[0][0]}T12:00:00`).getTime() - noon.getTime()) / DAY_MS);
  }

  /** S&P 500 level on a game day. */
  level(day: number): number {
    if (day < 0) return seriesOn("SP500", this.dateOf(day));
    this.extend(day);
    return this.index[day];
  }

  price(id: InstrumentId, day: number): number {
    if (day < 0) return this.pastPrice(id, day);
    this.extend(day);
    return this.prices[id][day];
  }

  regime(day: number): Regime {
    if (day < 0) return "bull";
    this.extend(day);
    return this.regimes[day];
  }

  /** Daily points from `from` to `to` inclusive, clamped to the real history's start. */
  series(id: InstrumentId | "SP500", from: number, to: number): PricePoint[] {
    const out: PricePoint[] = [];
    for (let d = Math.max(from, this.firstDay); d <= to; d++) out.push({ day: d, value: id === "SP500" ? this.level(d) : this.price(id, d) });
    return out;
  }

  private pastPrice(id: InstrumentId, day: number): number {
    const inst = instrument(id);
    const date = this.dateOf(day);
    if (id === "BOND") return inst.start * Math.exp((-BOND_DURATION * (seriesOn("DGS10", date) - Y10_LAST)) / 100);
    return inst.start * (seriesOn("SP500", date) / SP_LAST) ** inst.beta;
  }

  private extend(day: number) {
    for (let d = this.index.length; d <= day; d++) {
      const prevRegime = this.regimes[d - 1];
      const weekday = this.dateOf(d).getDay();
      if (weekday === 0 || weekday === 6) {
        this.index.push(this.index[d - 1]);
        this.regimes.push(prevRegime);
        for (const i of INSTRUMENTS) this.prices[i.id].push(this.prices[i.id][d - 1]);
        continue;
      }
      const pr = this.presets;
      const inPop = d >= pr.popDay && d < pr.popEndDay;
      let regime: Regime;
      if (inPop) regime = "bear";
      else if (d === pr.popEndDay) regime = "bull";
      else {
        const flip = uniforms(this.seed, "regime", d)[0] < (prevRegime === "bull" ? BULL : BEAR).exit;
        regime = flip ? (prevRegime === "bull" ? "bear" : "bull") : prevRegime;
      }
      const p = regime === "bull" ? BULL : BEAR;
      const zm = t4(uniforms(this.seed, "market", d));
      // In the scripted pop the drift steers each day toward the preset depth, and the last
      // day carries no noise, so the fall always lands exactly on it.
      const left = inPop ? this.tradingDays(d, pr.popEndDay) : 0;
      const steer = (now: number, target: number) => Math.log(target / now) / left;
      const noise = inPop ? (left > 1 ? POP_SIGMA * zm : 0) : p.sigma * zm;
      const rm = (inPop ? steer(this.index[d - 1], this.index[pr.popDay - 1] * (1 - pr.popDepth)) : p.mu) + noise;
      this.index.push(this.index[d - 1] * Math.exp(rm));
      this.regimes.push(regime);
      for (const i of INSTRUMENTS) {
        let r: number;
        if (i.id === "BOND") {
          const zb = normal(...(uniforms(this.seed, "bond", d).slice(0, 2) as [number, number]));
          // Mildly opposite to the market's shock (flight to safety), clamped so a fat-tailed crash day can't whipsaw bonds.
          r = BOND.mu + BOND.sigma * (BOND.corr * Math.max(-4, Math.min(4, zm)) + Math.sqrt(1 - BOND.corr ** 2) * zb);
        } else {
          const zi = i.idioVol ? normal(...(uniforms(this.seed, `idio:${i.id}`, d).slice(0, 2) as [number, number])) : 0;
          const inBoom = d >= pr.boomDay && d < pr.popDay;
          if (i.id === "NNST" && (inPop || inBoom)) {
            // Both halves of the AI arc are steered like the pop: noise along the way, landing on the preset.
            const end = inPop ? pr.popEndDay : pr.popDay;
            const n = this.tradingDays(d, end);
            const target = inPop ? this.prices.NNST[pr.popDay - 1] * (1 - pr.nnstPopDepth) : this.prices.NNST[pr.boomDay - 1] * pr.boomMultiple;
            const wobble = n > 1 ? i.beta * (inPop ? noise : p.sigma * zm) + 0.5 * i.idioVol * zi : 0;
            r = Math.log(target / this.prices.NNST[d - 1]) / n + wobble;
          } else {
            r = i.beta * rm + i.idioVol * zi;
          }
        }
        this.prices[i.id].push(this.prices[i.id][d - 1] * Math.exp(r - i.expenseRatio / 252));
      }
    }
  }
}
