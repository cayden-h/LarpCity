import assert from "node:assert/strict";
import { test } from "node:test";
import { cashCushion, commute, debtLoad, healthCoverage, homeStability, realIncome, relationships, retirementOnTrack, work } from "../src/sim/wellbeing/factors.ts";
import { finalScore, triggerPulse, wellbeing, type WellbeingLife } from "../src/sim/wellbeing/index.ts";
import { cushionSoftening, decay, PULSE_TABLE } from "../src/sim/wellbeing/pulses.ts";
import { retirementReadiness } from "../src/sim/wellbeing/retirement.ts";
import { PlayerLife, type Place } from "../src/sim/life/index.ts";

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };

test("pulse decay and cushion softening use the adopted formulas", () => {
  assert.equal(decay({ p0: 6, halfLifeDays: 365, startDay: 0 }, 365), 3);
  assert.equal(decay({ p0: -6, halfLifeDays: 365, startDay: 0 }, 730), -1.5);
  assert.equal(decay({ p0: 6, halfLifeDays: 365, startDay: 10 }, 0), 0);
  assert.equal(cushionSoftening(0), 1.3);
  assert.equal(cushionSoftening(0.5), 1.05);
  assert.equal(cushionSoftening(1), 0.8);
  assert.deepEqual(Object.keys(PULSE_TABLE), ["marriage", "firstChild", "divorce", "layoff", "bankruptcy", "retiredOnTrack", "forcedRetirement", "vacation", "familyTime"]);
  assert.deepEqual(PULSE_TABLE.bankruptcy, { p0: -6, halfLifeDays: 730, startDay: 0 });
});

test("vacation pulse boosts wellbeing and decays over time", () => {
  const pulse = { ...PULSE_TABLE.vacation, startDay: 0 };
  assert.ok(pulse.p0 > 0);
  const atStart = decay(pulse, 0);
  const later = decay(pulse, pulse.halfLifeDays);
  assert.ok(later < atStart);
  assert.ok(later > 0);
});

test("familyTime pulse boosts wellbeing and decays over time", () => {
  const pulse = { ...PULSE_TABLE.familyTime, startDay: 0 };
  assert.ok(pulse.p0 > 0);
  const atStart = decay(pulse, 0);
  const later = decay(pulse, pulse.halfLifeDays);
  assert.ok(later < atStart);
  assert.ok(later > 0);
});

test("triggerPulse pushes the named pulse onto the life's pulse list via addPulse", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  assert.equal(life.pulses.length, 0);
  triggerPulse(life, "vacation", 5);
  assert.equal(life.pulses.length, 1);
  assert.deepEqual(life.pulses[0], { p0: PULSE_TABLE.vacation.p0, halfLifeDays: PULSE_TABLE.vacation.halfLifeDays, startDay: 5 });
});

test("a vacation pulse blocks another one for 90 days, so triggering it twice within the window only adds one pulse", async () => {
  // vacation.ts's goOnVacation also touches the DOM (a pop-up appended to document.body), which
  // Node's built-in test runner doesn't provide; onVacationCooldown is the DOM-free guard it uses,
  // exported so the cooldown logic itself tests without stubbing a document.
  const { onVacationCooldown, VACATION_COOLDOWN_DAYS } = await import("../src/ui/vacation.ts");
  const life = new PlayerLife({ place: TX, day: 0 });

  // Attempt 1 on day 0: not on cooldown, so it fires.
  assert.equal(onVacationCooldown(life, 0), false);
  triggerPulse(life, "vacation", 0);
  assert.equal(life.pulses.length, 1);

  // Attempt 2, well inside the cooldown: blocked, no second pulse.
  assert.equal(onVacationCooldown(life, VACATION_COOLDOWN_DAYS - 1), true);
  assert.equal(life.pulses.length, 1);

  // Attempt 3, once the cooldown has elapsed: fires again.
  assert.equal(onVacationCooldown(life, VACATION_COOLDOWN_DAYS), false);
  triggerPulse(life, "vacation", VACATION_COOLDOWN_DAYS);
  assert.equal(life.pulses.length, 2);
});

test("the nine factors match their thresholds and research weights", () => {
  assert.equal(work({ employed: true, reemployedDay: null }, 0).s, 1);
  assert.equal(work({ employed: false, reemployedDay: null }, 0).s, 0);
  assert.equal(work({ employed: true, reemployedDay: 0 }, 365.25).s, 0.75);
  assert.equal(cashCushion({ cash: () => 200, monthlyExpenses: () => 3_000 }).s, 0);
  assert.equal(cashCushion({ cash: () => 9_000, monthlyExpenses: () => 3_000 }).s, 0.5);
  assert.equal(realIncome({ grossAnnual: 25_000, place: { rpp: { all: 100 } } }).s, 0);
  assert.equal(realIncome({ grossAnnual: 200_000, place: { rpp: { all: 100 } } }).s, 1);
  assert.equal(relationships({ relationship: "single" }).s, 0.9);
  assert.equal(relationships({ relationship: "partnered" }).s, 1);
  assert.equal(retirementOnTrack({ age: 30, grossAnnual: 60_000, retirementSavings: () => 30_000 }).s, 0.5);
  assert.equal(healthCoverage({ insured: false, book: { debts: [] } }).s, 0.4);
  assert.equal(commute({ employed: true, commuteMinutes: 30 }).s, 0.5);
  assert.equal(commute({ employed: false, commuteMinutes: 90 }).s, 1);
  assert.equal(homeStability({ homeTier: () => 0 }).s, 0);
});

test("debt load handles DTI, delinquency, collections, bankruptcy, and negative inputs", () => {
  const shape = (dti: number, pastDue = false, bankruptcyDay: number | null = null) => ({
    dti: () => dti,
    hasPastDue: () => pastDue,
    inCollectionsOrRecentBankruptcy: (today = 0) => bankruptcyDay !== null && today >= bankruptcyDay && today - bankruptcyDay < 730,
  });
  assert.equal(debtLoad(shape(0.2)).s, 0.5);
  assert.equal(debtLoad(shape(0, true)).s, 0.5);
  assert.equal(debtLoad(shape(0, false, 0), 729).s, 0);
  assert.equal(debtLoad(shape(0, false, 0), 730).s, 1);
  assert.equal(debtLoad(shape(-1)).s, 1);
});

test("medical debt in collections zeroes health coverage", () => {
  const medicalCollections = { insured: true, book: { debts: [{ kind: "medical", status: "collections" }] } };
  assert.equal(healthCoverage(medicalCollections).s, 0);
});

test("retirement readiness implements the adopted 50/20/15/15 formula", () => {
  const alex = {
    retirementSavings: () => 5 * 220_000, grossAnnual: 220_000,
    book: { profile: { score: 680 } }, netWorth: () => 5 * 220_000, totalDebt: () => 0,
  };
  assert.equal(retirementReadiness(alex), 61.3);
  assert.equal(retirementReadiness({ ...alex, retirementSavings: () => -10, grossAnnual: 0, netWorth: () => -10, totalDebt: () => 10 }), 13.8);
  // Salary is guarded to $1 exactly: savings 5 + credit 13.8 + net worth 1.5 + debt-free 15.
  assert.equal(retirementReadiness({ ...alex, grossAnnual: 0, retirementSavings: () => 1, netWorth: () => 1, totalDebt: () => 0 }), 35.3);
});

function fullLife(overrides: Partial<WellbeingLife> = {}): WellbeingLife {
  return {
    employed: true, reemployedDay: null, cash: () => 18_000, monthlyExpenses: () => 3_000,
    dti: () => 0, hasPastDue: () => false, inCollectionsOrRecentBankruptcy: () => false,
    grossAnnual: 100_000, place: { rpp: { all: 100 } }, relationship: "partnered",
    age: 30, retirementSavings: () => 100_000, insured: true, commuteMinutes: 0, homeTier: () => 1,
    book: { debts: [{ kind: "personal", status: "current" }], profile: { score: 850 } }, netWorth: () => 1_000_000,
    totalDebt: () => 0, pulses: [], history: [], ...overrides,
  };
}

test("wellbeing sums all factors, applies pulses, and final score uses lifetime wellbeing", () => {
  const life = fullLife({ pulses: [{ p0: -10, halfLifeDays: 365, startDay: 0 }] });
  const snapshot = wellbeing(life, 0);
  assert.equal(snapshot.factors.length, 9);
  assert.equal(snapshot.W, 88);
  const scored = finalScore(fullLife({ history: [{ wellbeing: 50 }, { wellbeing: 70 }] }), 0);
  assert.equal(scored.RR, 55);
  assert.equal(scored.Wlife, 78);
  assert.equal(scored.final, 64.2);
});
