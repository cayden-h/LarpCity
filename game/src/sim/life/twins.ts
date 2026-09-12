// Shadow portfolios for honest comparisons (research/03, "Showing counterfactuals").
// Every buy the player makes is copied, same day and same price, into two twins:
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

export class Twins {
  /** Dollars the player has put into the brokerage. */
  invested = 0;
  /** Dollars the player's sells took out of the brokerage. */
  cashOut = 0;
  private readonly market: MarketPath;
  private readonly heldUnits: Units = {};
  private readonly autoUnits: Units = {};

  constructor(market: MarketPath) {
    this.market = market;
  }

  buy(id: InstrumentId, dollars: number, day: number): void {
    this.invested = round2(this.invested + dollars);
    this.add(this.heldUnits, id, dollars, day);
    for (const [i, w] of AUTOPILOT_MIX) this.add(this.autoUnits, i, dollars * w, day);
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
