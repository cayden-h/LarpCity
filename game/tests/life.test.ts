// PlayerLife tests: the city-scene wiring of paychecks, bills, the ledger, and the debt engine.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PlayerLife, STARTER_PORTFOLIO, cashRateOn, seriesOn, US_MEDIAN_RENT, type Place } from "../src/sim/life/index.ts";
import { MARKET } from "../src/data/market.ts";
import { fileReturn } from "../src/sim/tax/filing.ts";

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

test("a second year's shortfall never overwrites or loses an unresolved first year's balance (Task 11: it may have already become a Debt)", () => {
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

  // The ~490-day gap between year 1's filing and year 2's is longer than Task
  // 11's 180-day threshold, so by now year 1's shortfall has already escalated
  // out of `unpaidTax` entirely and into its own real "IRS balance" Debt
  // (verified below) — the accumulate-don't-overwrite scenario this test
  // originally guarded against can only happen while year 1 is still sitting
  // in `unpaidTax`, i.e. within 180 days of its due date.
  assert.equal(life.unpaidTaxBalance(), null);
  assert.ok(life.book.debts.some((d) => d.name === "IRS balance"), "year 1's shortfall should have converted to a real Debt by now");

  checking.balance = 0; // drain checking again before the second filing
  life.fileTaxes(day2 + 1);
  const afterYear2 = life.unpaidTaxBalance();
  assert.ok(afterYear2 !== null);
  // Year 1 already left `unpaidTax` for a real Debt, so year 2's shortfall
  // starts a fresh entry rather than adding to (or, the bug this originally
  // guarded against, overwriting) anything — nothing from year 1 is lost, it's
  // just tracked as a separate Debt instead of inside `unpaidTax`.
  assert.equal(afterYear2!.amount, year2Unpaid);
  assert.equal(afterYear2!.originalOwed, year2Unpaid);
  assert.equal(afterYear2!.filedDay, day2 + 1);
  assert.ok(life.book.debts.some((d) => d.name === "IRS balance"), "year 1's Debt should still be there alongside year 2's fresh unpaidTax");
});

// Both tests below reuse the "second year's shortfall" test's trick above:
// moving to CA the day *before* the April-15 payday/deadline day means the
// return (computed against whatever state is current when it's built) taxes
// the whole partial year at CA's real rates, while every paycheck that
// actually withheld anything for that year did so at TX's $0 state rate (or,
// for the one CA payday itself, only a sliver) — guaranteeing a real,
// repeatable shortfall instead of a coin flip. A high income (like the
// existing test) is needed too: at ordinary incomes withholding already
// tracks the liability closely enough that this mid-year move alone doesn't
// reliably flip the sign.
function moveToCARightBeforeDeadline(life: PlayerLife): number {
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
  return day;
}

test("a second year's shortfall filed inside the 180-day conversion window merges into the still-unresolved first year's unpaidTax", () => {
  // This is the merge branch in fileTaxes() (`if (this.unpaidTax) { ...merge... }`,
  // as opposed to the `else` that starts a fresh unpaidTax): it only runs when
  // a prior year's balance is filed on top of ANOTHER still-unresolved,
  // not-yet-converted balance. Two *real* consecutive tax years are always
  // ~365 days apart (April 15 to April 15, hardcoded in onDay()), which is
  // well past the 180ish-day threshold that turns an unresolved unpaidTax
  // into a real "IRS balance" Debt - confirmed empirically: with the
  // moveToCARightBeforeDeadline trick, day 1's balance converts to a Debt
  // ~200 days after its due day, long before a second real April 15 could
  // ever roll around. So the merge branch can no longer be reached by
  // advancing the clock through two genuine tax years; this test manufactures
  // year 2's return the same way onDay() would (via the same fileReturn()
  // used internally) but attaches it directly, well inside the 180-day
  // window, instead of waiting a full calendar year for a second one to
  // become ready.
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 2_000_000 });
  const checking = life.ledger.get("checking");
  const day = moveToCARightBeforeDeadline(life);
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

  // Year 2's return, built the same way the April 15 tick would build it,
  // reusing year 1's own wages/withholding so it reliably owes too - but
  // attached only 60 days after year 1's filing (well under the ~180-200 day
  // conversion window), not a full calendar year later.
  const ret2 = fileReturn({
    year: 2028,
    state: "CA",
    wagesYtd: ret1!.wages,
    federalWithheldYtd: ret1!.federalWithheld,
    stateWithheldYtd: ret1!.stateWithheld,
  });
  const year2Unpaid = round2(-(ret2.federalRefundOrOwed + ret2.stateRefundOrOwed));
  assert.ok(year2Unpaid > 0, `expected year 2 to owe money, got ${year2Unpaid}`);
  const day2 = day + 61; // 60 days after year 1's filing: still inside the window
  (life as unknown as { pendingReturn: unknown }).pendingReturn = ret2;
  (life as unknown as { taxReadyDay: number }).taxReadyDay = day2 - 1;

  // Sanity: year 1's balance must still be a live unpaidTax, not yet a Debt,
  // or this test would not actually be exercising the merge branch.
  assert.ok(life.unpaidTaxBalance() !== null);
  assert.ok(!life.book.debts.some((d) => d.name === "IRS balance"));

  checking.balance = 0; // drain checking again before the second filing
  life.fileTaxes(day2);
  const afterYear2 = life.unpaidTaxBalance();
  assert.ok(afterYear2 !== null);
  assert.equal(afterYear2!.amount, round2(year1Unpaid + year2Unpaid));
  assert.equal(afterYear2!.originalOwed, round2(year1Unpaid + year2Unpaid));
  assert.equal(afterYear2!.filedDay, day2);
});

test("an unpaid tax balance accrues failure-to-file penalties if the deadline passes with no filing", () => {
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 2_000_000 });
  const day = moveToCARightBeforeDeadline(life);
  assert.ok(life.pendingTaxReturn() !== null);
  // No fileTaxes() call: carries well past the April 15 deadline unfiled.
  const events = live(life, 160, day);
  assert.ok(events.some((e) => e.type === "tax_penalty"));
});

test("an unpaid tax balance becomes a real Debt after 180 days unpaid", () => {
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 2_000_000 });
  const checking = life.ledger.get("checking");
  const day = moveToCARightBeforeDeadline(life);
  const ret = life.pendingTaxReturn();
  assert.ok(ret !== null);
  assert.ok(ret!.stateRefundOrOwed < 0, "moving to a tax state right before filing should leave the state portion owed");
  checking.balance = 0; // guarantee it can't be paid in full at filing
  life.fileTaxes(day + 1);
  // 210 days, not 180: the escalation only ticks on the 1st of each calendar
  // month, and calendar months run ~30.4 days on average vs. the 30-day
  // months penaltyFor's floor-division counts in, so a little slack is needed
  // to guarantee a tick has landed past the 180-day (6-month) threshold.
  live(life, 210, day + 1);
  assert.ok(life.book.debts.some((debt) => debt.name === "IRS balance"));
});

test("once converted to a Debt, the shadow unpaidTax balance stops escalating (no phantom double-tracking)", () => {
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 2_000_000 });
  const checking = life.ledger.get("checking");
  const day = moveToCARightBeforeDeadline(life);
  checking.balance = 0;
  life.fileTaxes(day + 1);
  live(life, 210, day + 1); // past the 180-day conversion threshold
  assert.ok(life.book.debts.some((debt) => debt.name === "IRS balance"));
  // Once it's a real Debt, unpaidTaxBalance() should stop being tracked
  // separately: otherwise it would keep accruing its own phantom penalties
  // forever, disconnected from the real Debt's own (already-amortizing)
  // balance.
  assert.equal(life.unpaidTaxBalance(), null);
  const events = live(life, 90, day + 1 + 210);
  assert.ok(!events.some((e) => e.type === "tax_penalty"));
});
