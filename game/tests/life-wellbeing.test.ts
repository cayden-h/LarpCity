import { test } from "node:test";
import assert from "node:assert/strict";
import { rngFor } from "../src/engine/rng.ts";
import { MarketPath } from "../src/sim/market/index.ts";
import { PlayerLife, type LifeEvent, type Place } from "../src/sim/life/index.ts";
import { finalScore, PULSE_TABLE } from "../src/sim/wellbeing/index.ts";

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97, housing: 88.6 } };
const CA: Place = { abbr: "CA", name: "California", rpp: { all: 110.72, goods: 106.098, housing: 154.346 } };

test("PlayerLife exposes the wellbeing inputs and snapshots wellbeing without recursion", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  assert.equal(life.relationship, "single");
  assert.equal(life.insured, true);
  assert.equal(life.commuteMinutes, 23);
  assert.equal(life.reemployedDay, null);
  assert.equal(typeof life.history[0].wellbeing, "number");
  assert.ok(life.history[0].wellbeing >= 0 && life.history[0].wellbeing <= 100);
});

test("commute can be supplied explicitly", () => {
  assert.equal(new PlayerLife({ place: TX, day: 0, commuteMinutes: 45 }).commuteMinutes, 45);
});

test("employment transitions add one layoff pulse, track re-employment, and refresh same-day history", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  life.setEmployed(false, 10);
  life.setEmployed(false, 10);
  assert.equal(life.insured, false);
  assert.deepEqual(life.pulses, [{ ...PULSE_TABLE.layoff, startDay: 10, name: "layoff" }]);
  assert.equal(life.history.at(-1)?.day, 10);
  assert.equal(life.history.at(-1)?.wellbeing, life.snapshot(10).wellbeing);

  life.setEmployed(true, 40);
  assert.equal(life.insured, true);
  assert.equal(life.reemployedDay, 40);
  assert.equal(life.pulses.length, 1);
});

test("addPulse and retirementSavings expose stable structural inputs", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  life.addPulse(6, 365, 12);
  assert.deepEqual(life.pulses.at(-1), { p0: 6, halfLifeDays: 365, startDay: 12 });
  assert.equal(life.retirementSavings(), 0);
  life.ledger.get("k401").balance = 1_234.567;
  assert.equal(life.retirementSavings(), 1_234.57);
});

test("debt stress helpers use active past due balances and a bounded two-year bankruptcy window", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  const debt = life.book.debts[0];
  debt.pastDue = 1;
  assert.equal(life.hasPastDue(), true);
  debt.status = "paid";
  assert.equal(life.hasPastDue(), false);
  life.book.profile.bankruptcy = { day: 100, chapter: 7 };
  assert.equal(life.inCollectionsOrRecentBankruptcy(99), false);
  assert.equal(life.inCollectionsOrRecentBankruptcy(829), true);
  assert.equal(life.inCollectionsOrRecentBankruptcy(830), false);
});

test("marriage waits for January 1, rolls once there, and replays identically", () => {
  const year = 2041;
  let seed = 0;
  while (rngFor("marriage", seed, year)() >= 0.08) seed++;
  const lateStart = new Date(year - 1, 6, 19);
  const januaryFirst = new Date(year, 0, 1);
  const run = () => {
    const life = new PlayerLife({ place: TX, day: 500, market: new MarketPath(seed) });
    const events: LifeEvent[] = [];
    events.push(...life.onDay(501, lateStart));
    assert.equal(events.some((event) => event.type === "marriage"), false);
    events.push(...life.onDay(667, januaryFirst));
    events.push(...life.onDay(667, januaryFirst));
    return { life, events };
  };
  const a = run();
  const b = run();
  assert.deepEqual(a.events, b.events);
  assert.equal(a.events.filter((event) => event.type === "marriage").length, 1);
  assert.equal(a.life.relationship, "partnered");
  assert.deepEqual(a.life.pulses, [{ ...PULSE_TABLE.marriage, startDay: 667, name: "marriage" }]);
});

test("bankruptcy eligibility has no pulse; filing has one pulse and immediately refreshes history", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  assert.equal(life.pulses.length, 0);
  life.fileBankruptcy(7, 20);
  assert.deepEqual(life.pulses, [{ ...PULSE_TABLE.bankruptcy, startDay: 20, name: "bankruptcy" }]);
  assert.equal(life.history.at(-1)?.day, 20);
  assert.equal(life.history.at(-1)?.wellbeing, life.snapshot(20).wellbeing);
});

test("moving and spending refresh same-day wellbeing history before listeners run", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  const emitted: string[] = [];
  life.onEvents((events, current) => {
    emitted.push(events[0].type);
    assert.deepEqual(current.history.at(-1), current.snapshot(events[0].day));
  });

  life.setPlace(CA, 0);
  assert.equal(life.history.length, 1);
  assert.equal(life.history[0].day, 0);
  assert.equal(life.history[0].wellbeing, life.snapshot(0).wellbeing);

  life.spend(0, "Dinner", 500);
  assert.equal(life.history.length, 1);
  assert.deepEqual(life.history[0], life.snapshot(0));
  assert.deepEqual(emitted, ["moved", "spend"]);
});

test("auto-filing after the daily tick leaves the final same-day snapshot current", () => {
  const life = new PlayerLife({ place: TX, day: 0, grossAnnual: 20_000 });
  const start = new Date(2026, 8, 11);
  const date = new Date(start);
  let day = 0;
  while (!(date.getFullYear() === 2027 && date.getMonth() === 3 && date.getDate() === 15)) {
    day++;
    date.setDate(date.getDate() + 1);
    life.onDay(day, new Date(date));
  }

  assert.ok(life.pendingTaxReturn());
  const beforeFiling = life.history.at(-1)!;
  const filed = life.autoFilePending(day);
  assert.equal(filed?.type, "tax_filed");
  assert.equal(filed?.auto, true);
  assert.equal(life.history.length, day + 1);
  assert.equal(life.history.at(-1)?.day, day);
  assert.deepEqual(life.history.at(-1), life.snapshot(day));
  assert.notDeepEqual(life.history.at(-1), beforeFiling);
});

test("finalScore falls back to current wellbeing for empty history", () => {
  const life = new PlayerLife({ place: TX, day: 0 });
  life.history.length = 0;
  const score = finalScore(life, 0);
  assert.ok(Number.isFinite(score.Wlife));
  assert.equal(score.Wlife, life.snapshot(0).wellbeing);
});
