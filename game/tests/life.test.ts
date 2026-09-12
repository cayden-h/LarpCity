// PlayerLife tests: the city-scene wiring of paychecks, bills, the ledger, and the debt engine.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PlayerLife, STARTER_PORTFOLIO, cashRateOn, seriesOn, US_MEDIAN_RENT, type Place } from "../src/sim/life/index.ts";
import { MARKET } from "../src/data/market.ts";

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };
const CA: Place = { abbr: "CA", name: "California", rpp: { all: 110.72, goods: 106.098, housing: 154.346 } };
const START = new Date(2026, 8, 11);
const dateOf = (day: number) => {
  const d = new Date(START);
  d.setDate(d.getDate() + day);
  return d;
};
const round2 = (x: number) => Math.round(x * 100) / 100;
const live = (life: PlayerLife, days: number, from = 0) => {
  const all = [];
  for (let day = from + 1; day <= from + days; day++) all.push(...life.onDay(day, dateOf(day)));
  return all;
};

test("rent and living costs scale with the state's price parity", () => {
  const tx = new PlayerLife({ place: TX, day: 0 });
  const ca = new PlayerLife({ place: CA, day: 0 });
  assert.equal(tx.rent, Math.round((US_MEDIAN_RENT * 88.6) / 100));
  assert.ok(ca.rent > tx.rent * 1.6, `CA ${ca.rent} vs TX ${tx.rent}`);
  assert.ok(ca.living > tx.living);
});

test("paychecks land on the 1st and 15th and rent is paid on the 1st", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  const events = live(life, 40);
  const pays = events.filter((e) => e.type === "paycheck");
  const rents = events.filter((e) => e.type === "bill" && e.name === "Rent");
  assert.equal(pays.length, 3); // Sep 15, Oct 1, Oct 15
  assert.equal(rents.length, 1);
  assert.ok(rents.every((e) => e.type === "bill" && e.paid === e.amount));
});

test("debt payments flow through the ledger's waterfall and the book shrinks", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  const debt0 = life.totalDebt();
  live(life, 365);
  assert.ok(life.totalDebt() < debt0 - 8_000, `debt ${life.totalDebt()}`);
  assert.equal(life.book.profile.lateMarks.length, 0);
  assert.ok(life.history.length === 366);
});

test("the engine's cash rate comes from the real Fed funds snapshot", () => {
  const last = MARKET.series.DFF.points.at(-1)!;
  assert.equal(cashRateOn(new Date(2030, 0, 1)), last[1] / 100);
  assert.ok(cashRateOn(START) > 0.02 && cashRateOn(START) < 0.08);
  assert.equal(seriesOn("SP500", new Date(1999, 0, 1)), MARKET.series.SP500.points[0][1]);
});

test("a layoff in California leads to missed payments and a lower home tier", () => {
  const life = new PlayerLife({ place: CA, day: 0 });
  life.setEmployed(false, 0);
  const events = live(life, 200);
  assert.ok(events.some((e) => e.type === "missed"));
  assert.ok(life.book.profile.lateMarks.length > 0);
  assert.ok(life.homeTier() <= 1);
});

test("runHeadless stops at bankruptcy (the meeting's rule)", () => {
  const life = new PlayerLife({ place: CA, day: 0, monthlyTakeHome: 1_200 });
  life.setEmployed(false, 0);
  const r = life.runHeadless(0, 3_000, START);
  assert.equal(r.stoppedBy, "bankruptcy");
  assert.ok(r.daysRun < 3_000);
});

test("home tier follows net worth", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  assert.equal(life.homeTier(), 1); // about -$40k net worth: studio
  life.ledger.get("savings").balance = 200_000;
  assert.equal(life.homeTier(), 3); // about $160k: townhouse
});

test("a starter portfolio moves net worth with the market and gives charts a past", () => {
  const plain = new PlayerLife({ place: TX, day: 0 });
  const life = new PlayerLife({ place: TX, day: 0, holdings: STARTER_PORTFOLIO });
  const total = Object.values(STARTER_PORTFOLIO).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(life.investments() - total) < 0.02, `investments ${life.investments()}`);
  assert.ok(Math.abs(life.netWorth() - (plain.netWorth() + total)) < 0.02);
  // Bought a year ago at that day's real price, so the positions carry a gain or loss.
  assert.ok(life.positions().every((p) => p.cost > 0 && p.cost !== p.value));

  const past = life.pastSnapshots(-30);
  assert.deepEqual([past[0].day, past.at(-1)!.day, past.length], [-30, -1, 30]);
  // The past follows the real market: holdings move while cash and debt hold still.
  assert.ok(new Set(past.map((p) => p.investments)).size > 5);
  assert.ok(past.every((p) => p.cash === life.history[0].cash && p.debt === life.history[0].debt));
  assert.ok(plain.pastSnapshots(-30).every((p) => p.netWorth === plain.netWorth()));
  // The past is separate from the days lived.
  assert.equal(life.history.length, 1);
});

test("the life is deterministic", () => {
  const a = new PlayerLife({ place: TX, day: 0 });
  const b = new PlayerLife({ place: TX, day: 0 });
  assert.deepEqual(live(a, 300), live(b, 300));
  assert.deepEqual(a.history, b.history);
});

test("payday withholds real federal + state tax instead of the flat 80% approximation", () => {
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 60_000 }); // TX: no state tax
  const events = live(life, 5); // START is Sept 11, 2026 (day 0); day 4 (Sept 15) is the first payday
  const paycheck = events.find((e) => e.type === "paycheck");
  assert.ok(paycheck);
  if (paycheck?.type === "paycheck") {
    assert.ok(paycheck.federalWithheld > 0);
    assert.equal(paycheck.stateWithheld, 0); // TX has no income tax
    // Take-home should no longer just be 80% of the half-month gross.
    assert.notEqual(paycheck.takeHome, Math.round((60_000 / 24) * 0.8 * 100) / 100);
  }
});

test("wagesYtd resets to 0 on January 1", () => {
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 60_000 });
  live(life, 105); // START is Sept 11, 2026 (day 0); day 105 (Dec 25 2026) lands after 7 paydays, still in 2026
  const beforeReset = life.wagesYtd();
  assert.ok(beforeReset > 0);
  // Day 112 (Jan 1, 2027) is the first payday of the new year: the reset should
  // make wagesYtd just that one paycheck's gross, not the 2026 total plus it.
  live(life, 7, 105);
  assert.ok(life.wagesYtd() < beforeReset);
});

test("a tax_ready event fires on April 15 for the prior year's wages, and time is not paused by it", () => {
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 60_000 });
  const events = live(life, 220);
  assert.ok(life.pendingTaxReturn() !== null);
  assert.equal(life.pendingTaxReturn()!.year, 2026);
  assert.equal(life.needsDecision(events), false); // the deadline never pauses time
});

test("fileTaxes() applies a refund to checking and clears the pending return", () => {
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 20_000 }); // low income, likely a refund after EIC
  live(life, 220);
  const before = life.cash();
  const ret = life.pendingTaxReturn()!;
  const event = life.fileTaxes(life.today + 1);
  assert.equal(event.type, "tax_filed");
  assert.equal(life.pendingTaxReturn(), null);
  if (ret.federalRefundOrOwed + ret.stateRefundOrOwed > 0) assert.ok(life.cash() > before);
});

test("runHeadless auto-files at the deadline instead of leaving it pending", () => {
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 60_000 });
  const result = life.runHeadless(0, 220, dateOf(0));
  assert.ok(result.events.some((e) => e.type === "tax_filed" && e.auto === true));
  assert.equal(life.pendingTaxReturn(), null);
});

test("a second year's shortfall adds to an unresolved first year's unpaidTax instead of overwriting it", () => {
  // A player who never moves reconciles close to $0 (withholding tracks the
  // real liability), so whether they owe or get a refund is close to a coin
  // flip. To force a deterministic, repeatable shortfall two years running,
  // this player lives in TX (no state withholding) all year, then moves to
  // CA the day before the April 15 deadline: the return is filed against
  // CA's state tax on wages that were withheld at 0%, which reliably owes
  // more than the (structurally refund-leaning) federal side gives back.
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 2_000_000 });
  const checking = life.ledger.get("checking");

  let day = 0;
  for (day = 1; day <= 230; day++) {
    const d = dateOf(day);
    if (d.getFullYear() === 2027 && d.getMonth() === 3 && d.getDate() === 15) {
      life.setPlace(CA, day - 1);
      life.onDay(day, d);
      break;
    }
    life.onDay(day, d);
  }
  const ret1 = life.pendingTaxReturn();
  assert.ok(ret1 !== null);
  const year1Unpaid = round2(-(ret1!.federalRefundOrOwed + ret1!.stateRefundOrOwed));
  assert.ok(year1Unpaid > 0, `expected year 1 to owe money, got ${year1Unpaid}`);

  checking.balance = 0; // drain checking so none of the shortfall gets paid
  life.fileTaxes(day + 1);
  const afterYear1 = life.unpaidTaxBalance();
  assert.ok(afterYear1 !== null);
  assert.equal(afterYear1!.amount, year1Unpaid);
  assert.equal(afterYear1!.originalOwed, year1Unpaid);

  // Year 2: back to TX, then to CA again right before the next April 15 -
  // the same trick, guaranteeing another shortfall on top of the
  // still-unresolved year 1 balance.
  life.setPlace(TX, day + 1);
  let day2 = day + 2;
  for (; day2 <= 700; day2++) {
    const d = dateOf(day2);
    if (d.getFullYear() === 2028 && d.getMonth() === 3 && d.getDate() === 15) {
      life.setPlace(CA, day2 - 1);
      life.onDay(day2, d);
      break;
    }
    life.onDay(day2, d);
  }
  const ret2 = life.pendingTaxReturn();
  assert.ok(ret2 !== null);
  const year2Unpaid = round2(-(ret2!.federalRefundOrOwed + ret2!.stateRefundOrOwed));
  assert.ok(year2Unpaid > 0, `expected year 2 to owe money, got ${year2Unpaid}`);

  checking.balance = 0; // drain checking again before the second filing
  life.fileTaxes(day2 + 1);
  const afterYear2 = life.unpaidTaxBalance();
  assert.ok(afterYear2 !== null);
  // The bug this guards against: overwriting `amount`/`originalOwed` with just
  // year2Unpaid instead of adding it to the still-outstanding year 1 balance.
  assert.equal(afterYear2!.amount, round2(year1Unpaid + year2Unpaid));
  assert.equal(afterYear2!.originalOwed, round2(year1Unpaid + year2Unpaid));
  assert.equal(afterYear2!.filedDay, day2 + 1);
});
