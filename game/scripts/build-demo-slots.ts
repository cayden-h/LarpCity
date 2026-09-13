// Builds the judges' demo lives (meeting 2026-09-13) into public/demo/<id>.json.
// Each is a saved game that the slot picker (src/ui/slots.ts) loads into a save
// slot as a new run. Deterministic: the same seed and the same scripted life, so
// a rebuild writes the same files. Rebuild after anything that changes the save
// format or the starting life:
//
//   npm run demo:slots
//
// The starting life is P1's onboarding (lifeFromIntake): 22, San Francisco pay at
// its $60k ceiling, $30k of starting debt, a 600 score, the $500 car loan and $200
// car insurance, and the four permanent goals (DEFAULT_GOALS).

import { mkdirSync, writeFileSync } from "node:fs";
import { STATES } from "../src/data/states.ts";
import { DEFAULT_GOALS, lifeFromIntake } from "../src/sim/life/intake.ts";
import { PlayerLife, STARTER_PORTFOLIO, type LifeEvent } from "../src/sim/life/player.ts";
import { Inbox } from "../src/sim/mail/inbox.ts";
import { MarketPath, type InstrumentId } from "../src/sim/market/index.ts";
import { NpcTown } from "../src/sim/npcs/index.ts";
import { encodeGame } from "../src/sim/save/codec.ts";
import { DEMOS } from "../src/sim/save/slot.ts";
import { retirementReadiness } from "../src/sim/wellbeing/retirement.ts";

/** main.ts's default seed and Clock.start, so a demo plays the same market the city does. */
const SEED = 20260912;
const START = new Date(2026, 8, 11);
const CA = STATES.find((s) => s.abbr === "CA")!;
const HASH = "san-francisco";
const GROSS = 60_000;
const OUT = new URL("../public/demo/", import.meta.url);

/** A restaurant career, the meeting's LARPedIn idea: a title and a raise every few years. */
const CAREER: [year: number, job: string, raise: number][] = [
  [0, "Line cook", 1],
  [3, "Shift lead", 1.12],
  [7, "Kitchen manager", 1.15],
  [12, "General manager", 1.2],
  [20, "Regional director", 1.25],
];

function starter(market: MarketPath, holdings: Partial<Record<InstrumentId, number>> = STARTER_PORTFOLIO): PlayerLife {
  return lifeFromIntake(
    // With roommates: San Francisco's median rent is out of reach at 22.
    { job: CAREER[0][1], salary: GROSS, debt: 30_000, rent: 1_400, savings: 2_500, name: "Alex", avatar: "female", insurancePlanId: "silver", goals: DEFAULT_GOALS },
    { place: CA, day: 0, market, holdings },
  );
}

/** Plays `days` from `from`, failing the build if the life goes bankrupt on the way. */
function live(life: PlayerLife, from: number, days: number): LifeEvent[] {
  const r = life.runHeadless(from, days, new MarketPath(SEED, START).dateOf(from));
  if (r.stoppedBy) throw new Error(`the demo life went bankrupt on day ${from + r.daysRun}; retune the starting life`);
  return r.events;
}

function write(id: string, life: PlayerLife, day: number, market: MarketPath): void {
  if (!DEMOS.some((d) => d.id === id)) throw new Error(`${id} is not in DEMOS (src/sim/save/slot.ts)`);
  const town = new NpcTown({ place: CA, day, market, start: START });
  const json = JSON.stringify(encodeGame({ seed: SEED, day, hash: HASH, bankRun: "", life, town, mail: new Inbox(), desk: null }));
  writeFileSync(new URL(`${id}.json`, OUT), `${json}\n`);
  const waiting = life.pendingChoices().map((c) => c.kind).join(", ") || "none";
  console.log(`${id}: ${market.dateOf(day).toDateString()}, age ${life.age.toFixed(1)}, net worth $${Math.round(life.netWorth()).toLocaleString("en-US")}, choices waiting: ${waiting}, ${Math.round(json.length / 1024)} KB`);
}

mkdirSync(OUT, { recursive: true });

// 1. Year one: two days before the first tax day, where the year-1 tutorial asks for the bottom line.
{
  const market = new MarketPath(SEED, START);
  const life = starter(market);
  const day = market.dayOf(new Date(2027, 3, 13));
  live(life, 0, day);
  write("first-taxes", life, day, market);
}

// 2. The AI bubble: heavy in NNST after the boom, married that morning (the prenup asks first),
// four days before stocks cross the crash line and the desk asks what to do.
{
  const holdings = { LTM: 3_000, NNST: 5_000 };
  const probeMarket = new MarketPath(SEED, START);
  const probe = starter(probeMarket, holdings);
  const from = probeMarket.presets.popDay - 30;
  live(probe, 0, from);
  const crash = live(probe, from, 700).find((e) => e.type === "bear_market");
  if (!crash) throw new Error("no crash within two years of the AI bubble pop");
  const market = new MarketPath(SEED, START);
  const life = starter(market, holdings);
  const day = crash.day - 4;
  live(life, 0, day);
  life.marry(day);
  write("ai-bubble", life, day, market);
}

// 3. Almost retired: forty years of steady saving with a restaurant career's raises, a few months
// short of 62, where the Retire button and the look back are close.
{
  const market = new MarketPath(SEED, START);
  const life = starter(market);
  life.orders = { depositMonthly: 300, k401Pct: 0.08, stockPct: 0.8, debtStrategy: "avalanche", extraMonthly: 100, emergencyMonths: 6, lifestyle: "normal", crashRule: "hold" };
  life.recurring = [{ id: "LTM", amount: 150 }];
  let day = 0;
  for (let year = 1; year <= 40; year++) {
    live(life, day, 365);
    day += 365;
    const step = CAREER.find(([at]) => at === year);
    if (step) {
      life.job = step[1];
      life.grossAnnual = Math.round(life.grossAnnual * step[2]);
      life.monthlyTakeHome = Math.round(life.monthlyTakeHome * step[2]);
      if (life.employed) life.book.monthlyTakeHome = life.monthlyTakeHome;
    }
    // The house goal: a small house with 10% down, the first year the bank says yes.
    if (year >= 8 && life.homeTier() < 2) life.chooseHome(2, day, { downPct: 0.1 });
  }
  if (life.homeTier() < 2) throw new Error("almost-retired never bought its house; retune its saving");
  // The judges' end screen: Retire must be on the moment the demo loads (ui/endgame.ts, retirementReady).
  if (retirementReadiness(life) < 85) throw new Error(`almost-retired can't retire on load (readiness ${retirementReadiness(life)}); retune its saving`);
  write("almost-retired", life, day, market);
}
