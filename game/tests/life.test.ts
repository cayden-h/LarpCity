// PlayerLife tests: the city-scene wiring of paychecks, bills, the ledger, and the debt engine.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PlayerLife, STARTER_PORTFOLIO, cashRateOn, seriesOn, US_MEDIAN_RENT, type Place, type LifeEvent } from "../src/sim/life/index.ts";
import { MARKET } from "../src/data/market.ts";
import { fileReturn } from "../src/sim/tax/filing.ts";
import { runSkip, type Goal } from "../src/sim/skip/index.ts";

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };
const CA: Place = { abbr: "CA", name: "California", rpp: { all: 110.72, goods: 106.098, housing: 154.346 } };
const WA: Place = { abbr: "WA", name: "Washington", rpp: { all: 100.9, goods: 99.6, housing: 116.6 } };
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

test("a January 1 reset does not erase the prior year's wages before the following April 15 files them (a full calendar year's wages, not ~3.5 months)", () => {
  // Life starts Sept 11, 2026 (day 0). 2027 is the first calendar year this
  // life lives through in full (Jan 1 - Dec 31), so its April 15, 2028 filing
  // is the one that should reflect a FULL year of wages. Before the fix, the
  // January 1, 2028 reset (which happens ~105 days before that April 15)
  // zeroed the accumulators and only Jan 1 - Apr 15, 2028's ~7 paydays had
  // re-accumulated by the time the filing check ran, so `wages` came out to
  // roughly 3.5 months' worth instead of a full year's.
  const grossAnnual = 60_000;
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual }); // TX: no state tax, so wages isn't muddied by state withholding quirks
  const firstEvents = live(life, 220);
  assert.ok(firstEvents.some((e) => e.type === "tax_ready" && e.year === 2026));
  life.fileTaxes(life.today + 1); // clear 2026's (partial-year) pending return so 2027's can come due
  const laterEvents = live(life, 380, 220);
  const ready2027 = laterEvents.find((e) => e.type === "tax_ready" && e.year === 2027);
  assert.ok(ready2027, "expected a tax_ready event for 2027");

  const ret = life.pendingTaxReturn()!;
  assert.ok(ret !== null);
  assert.equal(ret.year, 2027);
  // 24 paydays (the 1st and 15th of every month) make up a full calendar
  // year, computed independently of the buggy accumulator path.
  const expectedFullYearWages = round2((grossAnnual / 24) * 24);
  assert.ok(
    Math.abs(ret.wages - expectedFullYearWages) < 1,
    `expected ~a full year's wages (${expectedFullYearWages}), got ${ret.wages} (looks like ~3.5 months, the pre-fix bug)`,
  );
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

test("a second tax year's unfiled shortfall is still tracked after an earlier year's already converted to an IRS balance Debt", () => {
  // Regression test: tickTaxPenalty()'s lazy-creation guard used to check
  // `!this.book.debts.some((d) => d.name === "IRS balance")` to decide whether
  // a fresh unpaidTax could be started. That's a name-based proxy for "has
  // THIS balance already converted", but Debt names aren't unique across tax
  // years - once year 1 converted to its own "IRS balance" Debt, that check
  // stayed permanently true and silently blocked year 2's distinct shortfall
  // from ever being tracked (no unpaidTax, no tax_penalty events), even though
  // year 2's dueDay is completely different from year 1's. The fix tracks
  // converted due days individually (convertedTaxDueDays) instead of asking
  // "does any IRS Debt exist at all".
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 2_000_000 });
  const checking = life.ledger.get("checking");
  const day = moveToCARightBeforeDeadline(life);
  const ret1 = life.pendingTaxReturn();
  assert.ok(ret1 !== null);

  // Never file year 1: let tickTaxPenalty's lazy-creation guard start
  // unpaidTax on its own, then escalate it all the way into a real Debt.
  checking.balance = 0;
  live(life, 210, day); // past the 180-day conversion threshold
  assert.ok(life.book.debts.some((d) => d.name === "IRS balance"), "year 1's shortfall should have converted to a Debt");
  assert.equal(life.unpaidTaxBalance(), null, "year 1's shadow tracker should be cleared once it becomes a Debt");

  // Attach year 2's return directly (same trick the merge-branch test above
  // uses), well after year 1's conversion, with a distinct dueDay/taxReadyDay.
  const ret2 = fileReturn({
    year: 2028,
    state: "CA",
    wagesYtd: ret1!.wages,
    federalWithheldYtd: ret1!.federalWithheld,
    stateWithheldYtd: ret1!.stateWithheld,
  });
  const year2Unpaid = round2(-(ret2.federalRefundOrOwed + ret2.stateRefundOrOwed));
  assert.ok(year2Unpaid > 0, `expected year 2 to owe money, got ${year2Unpaid}`);
  const day2 = day + 210 + 30;
  (life as unknown as { pendingReturn: unknown }).pendingReturn = ret2;
  (life as unknown as { taxReadyDay: number }).taxReadyDay = day2 - 1;

  checking.balance = 0;
  // Never file year 2 either: let the deadline pass so the lazy-creation
  // guard is what's responsible for starting to track it. A full 90 days
  // guarantees at least two monthly (dom === 1) ticks past creation, since
  // the first tick that creates unpaidTax computes 0 months overdue.
  const events = live(life, 90, day2 - 1);

  assert.ok(events.some((e) => e.type === "tax_penalty"), "year 2's shortfall should be tracked and escalate, despite year 1's Debt still existing");
  const afterYear2 = life.unpaidTaxBalance();
  assert.ok(afterYear2 !== null, "year 2's shortfall should have been picked up by the lazy-creation guard");
  assert.equal(afterYear2!.originalOwed, year2Unpaid);
  assert.equal(afterYear2!.dueDay, day2 - 1);
  // Year 1's Debt must still be there, untouched, alongside year 2's live tracker.
  assert.ok(life.book.debts.some((d) => d.name === "IRS balance"), "year 1's Debt should still be on the books");
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

// day 220 (START is Sept 11, 2026) lands well past the April 15, 2027 deadline,
// but that return is for calendar year 2026 - and this life only started on
// Sept 11, 2026, so 2026 itself is a partial year for it (~6 paychecks), not
// a "full year of level paychecks". Withholding is computed per-paycheck as
// if annualizing a full year's employment, while fileReturn's standard
// deduction is a full annual amount applied against only a partial year's
// wages, so a partial first year does NOT reconcile close to $0 (it
// legitimately produces a real refund, same as a real new hire's first
// partial year often does) - that's not the scenario this test is after.
// Instead, run into the following year (2027), which this life lives
// through in full, and check that return.
test("a full year of level paychecks in a no-tax state reconciles to a small refund or owed amount, never wildly off", () => {
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 60_000 });
  live(life, 220);
  life.fileTaxes(life.today + 1); // clear 2026's (partial-year) pending return so 2027's can come due
  live(life, 380, 220);
  const ret = life.pendingTaxReturn()!;
  assert.equal(ret.year, 2027);
  const total = Math.abs(ret.federalRefundOrOwed + ret.stateRefundOrOwed);
  // Annualize-and-divide should track the real annual liability closely for a level salary.
  assert.ok(total < 500, `expected a close reconciliation, got ${total}`);
});

test("an unemployed player (UNEMPLOYMENT_SHARE pay) still gets a filed return with lower wages", () => {
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 60_000 });
  life.setEmployed(false, 1);
  live(life, 220);
  const ret = life.pendingTaxReturn()!;
  assert.ok(ret.wages < 60_000);
});

test("a no-income-tax state never produces a state tax liability regardless of income", () => {
  const life = new PlayerLife({ place: WA, day: 0, grossAnnual: 300_000 });
  live(life, 220);
  const ret = life.pendingTaxReturn()!;
  assert.equal(ret.stateTax, 0);
});

test("a chronological, never-filed multi-year run doesn't permanently jam on year 1's pendingReturn once it converts to a Debt", () => {
  // Regression test for the pendingReturn-never-cleared bug: before the fix,
  // tickTaxPenalty() converted an unpaid balance to a real "IRS balance" Debt
  // but left `pendingReturn` pointing at the (now-resolved-via-Debt) return
  // that fed it. Since onDay()'s April-15 block only creates a new return
  // when `!this.pendingReturn`, that stale reference permanently blocked
  // every later year's return from ever being created. This test never calls
  // fileTaxes() at all - real calendar time (moveToCARightBeforeDeadline plus
  // `live()`) is what drives year 1 through its 180ish-day conversion and
  // into year 2's own April 15.
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 2_000_000 });
  const day = moveToCARightBeforeDeadline(life); // forces year 1 to reliably owe, not reconcile to ~$0
  const ret1 = life.pendingTaxReturn();
  assert.ok(ret1 !== null);
  const year1 = ret1!.year;

  // 400 days: past the ~180-210 day conversion window AND past the next real
  // April 15 (~365 days after the first), all without ever filing anything.
  const events = live(life, 400, day);

  assert.ok(life.book.debts.some((d) => d.name === "IRS balance"), "year 1's shortfall should have converted to a real Debt by now");
  const laterReturn = life.pendingTaxReturn();
  assert.ok(laterReturn !== null, "a later year's return should have formed once conversion cleared year 1's stale pendingReturn");
  assert.ok(
    laterReturn!.year > year1,
    `expected a later year's return (> ${year1}), got year ${laterReturn!.year} - stuck on year 1 is the permanent-jam bug`,
  );
  assert.ok(events.some((e) => e.type === "tax_ready" && e.year === laterReturn!.year));
});

test("runSkip (the player-facing fast-forward) auto-files when it crosses an April 15 deadline, same as runHeadless", () => {
  // Regression test for the runSkip-never-auto-files bug: the fix (autoFilePending())
  // is shared with runHeadless, but the reviewer's finding was specifically that
  // NPCs' runHeadless had it and the real player's runSkip did not. Exercise
  // runSkip directly (it takes a PlayerLife and plain options, no UI/goal-tracking
  // dependencies beyond what's already in sim/skip), across a span that crosses
  // a real April 15, and confirm it auto-files instead of leaving the return
  // pending for the player to silently accrue penalties on.
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 60_000 });
  const neverMet: Goal = { kind: "net_worth", amount: 1e12 };
  const result = runSkip(life, { goal: neverMet, fromDay: 0, startDate: START, capAge: life.age + 1 });
  assert.ok(result.counts["tax_filed"] >= 1, `expected at least one tax_filed event, got counts ${JSON.stringify(result.counts)}`);
  assert.equal(life.pendingTaxReturn(), null, "runSkip should auto-file, not leave a return sitting pending");
});

test("spend() withdraws through the wallet waterfall and emits a spend event", () => {
  const life = new PlayerLife({ place: TX, day: 0, monthlyTakeHome: 4_000 });
  const checking = life.ledger.get("checking");
  checking.balance = 50;
  const events: LifeEvent[] = [];
  life.onEvents((e) => events.push(...e));

  const event = life.spend(10, "Dining out", 30);

  assert.equal(event.type, "spend");
  assert.equal(event.category, "Dining out");
  assert.equal(event.amount, 30, "fully covered by checking");
  assert.equal(life.ledger.get("checking").balance, 20);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], event);
});

test("spend() never pays more than the wallet has", () => {
  const life = new PlayerLife({ place: TX, day: 0, monthlyTakeHome: 4_000 });
  life.ledger.get("checking").balance = 5;
  life.ledger.get("savings").balance = 0;
  const event = life.spend(10, "Shopping", 40);
  assert.equal(event.amount, 5, "capped at what the accounts actually held");
});
