// Shadow portfolios for honest comparisons (research/03, "Showing counterfactuals").
// Every dollar of new money the player invests is copied, same day and same price, into two twins:
// Held buys the same instrument, and Autopilot splits the dollars 90/10 between
// the total market fund and the bond fund. Neither twin ever sells. The market
// path never depends on the player, so the gap between the player and a twin
// comes only from the player's choices.

import type { InstrumentId, MarketPath } from "../market/index.ts";

/** Autopilot's fixed mix, close to a target-date fund decades from retirement. */
export const AUTOPILOT_MIX: readonly (readonly [InstrumentId, number])[] = [
  ["LTM", 0.9],
  ["BOND", 0.1],
];

type Units = Partial<Record<InstrumentId, number>>;

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Twins as plain JSON, for the saved game (sim/save). */
export interface TwinsSave {
  invested: number;
  cashOut: number;
  heldUnits: Units;
  autoUnits: Units;
}

export class Twins {
  /** New money the player has put into the brokerage (not reinvested sale proceeds). */
  invested = 0;
  /** Dollars the player's sells took out of the brokerage. */
  cashOut = 0;
  private readonly market: MarketPath;
  private readonly heldUnits: Units = {};
  private readonly autoUnits: Units = {};

  constructor(market: MarketPath) {
    this.market = market;
  }

  toSave(): TwinsSave {
    return { invested: this.invested, cashOut: this.cashOut, heldUnits: { ...this.heldUnits }, autoUnits: { ...this.autoUnits } };
  }

  static fromSave(s: TwinsSave, market: MarketPath): Twins {
    const t = new Twins(market);
    t.invested = s.invested;
    t.cashOut = s.cashOut;
    Object.assign(t.heldUnits, s.heldUnits);
    Object.assign(t.autoUnits, s.autoUnits);
    return t;
  }

  buy(id: InstrumentId, dollars: number, day: number): void {
    // Sale proceeds go back in first: they are already on the player's line, and the twins never sold them.
    // Any buy while cashOut is positive counts as a buy-back, even one funded by a paycheck: the sale cash is still in checking.
    const reinvested = Math.min(this.cashOut, dollars);
    this.cashOut = round2(this.cashOut - reinvested);
    const fresh = dollars - reinvested;
    if (fresh <= 0) return;
    this.invested = round2(this.invested + fresh);
    this.add(this.heldUnits, id, fresh, day);
    for (const [i, w] of AUTOPILOT_MIX) this.add(this.autoUnits, i, fresh * w, day);
  }

  /**
   * A position the player already owns when the life starts on `day`, so every line starts at the same value:
   * Held gets the same units, and Autopilot gets the dollars those units are worth on `day`, at `day`'s prices.
   * What the player paid for it earlier doesn't matter; any later gap comes only from the player's choices.
   */
  seedHolding(id: InstrumentId, units: number, day: number): void {
    const value = units * this.market.price(id, day);
    this.invested = round2(this.invested + value);
    this.heldUnits[id] = (this.heldUnits[id] ?? 0) + units;
    for (const [i, w] of AUTOPILOT_MIX) this.add(this.autoUnits, i, value * w, day);
  }

  sell(proceeds: number): void {
    this.cashOut = round2(this.cashOut + proceeds);
  }

  /** The player's line: what the brokerage holds now plus what sells took out. */
  you(brokerageValue: number): number {
    return round2(brokerageValue + this.cashOut);
  }

  held(day: number): number {
    return this.value(this.heldUnits, day);
  }

  autopilot(day: number): number {
    return this.value(this.autoUnits, day);
  }

  private add(units: Units, id: InstrumentId, dollars: number, day: number): void {
    units[id] = (units[id] ?? 0) + dollars / this.market.price(id, day);
  }

  private value(units: Units, day: number): number {
    let s = 0;
    for (const [id, n] of Object.entries(units) as [InstrumentId, number][]) s += n * this.market.price(id, day);
    return round2(s);
  }
}
