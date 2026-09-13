// Cross-engine contracts: daily play, goal skips, seeded replay and recording.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PlayerLife, type LifeEvent, type Place } from "../src/sim/life/player.ts";
import { MarketPath } from "../src/sim/market/index.ts";
import { RunRecorder, type EventEntry } from "../src/sim/record/index.ts";
import { applyOrders, currentOrders, runSkip } from "../src/sim/skip/index.ts";
import { finalScore, wellbeing } from "../src/sim/wellbeing/index.ts";

const PLACE: Place = { abbr: "TX", name: "Texas", rpp: { all: 100, goods: 100, housing: 100 } };
const START = new Date(2026, 8, 11);
// The marriage stream for seed 8 hits on January 1, 2027.
const SEED = 8;
const MARRIAGE_DAY = 112;
const dateOf = (day: number) => {
  const date = new Date(START);
  date.setDate(date.getDate() + day);
  return date;
};

function newLife() {
  const life = new PlayerLife({
    place: PLACE, day: 0, market: new MarketPath(SEED, START),
    grossAnnual: 100_000, monthlyTakeHome: 6_000,
    holdings: { LTM: 6_000, BOND: 800 },
  });
  applyOrders(life, { ...currentOrders(life), depositMonthly: 200, k401Pct: 0.06 });
  return life;
}

test("marriage goal skips and daily play have identical events, daily scores and balances", () => {
  const daily = newLife();
  const skipped = newLife();
  const dailyEvents: LifeEvent[] = [];
  const skipEvents: LifeEvent[] = [];
  daily.onEvents((events) => dailyEvents.push(...events));
  skipped.onEvents((events) => skipEvents.push(...events));

  const result = runSkip(skipped, { goal: { kind: "marriage" }, fromDay: 0, startDate: START, capAge: 90 });
  assert.equal(result.stoppedBy, "goal");
  assert.equal(result.toDay, MARRIAGE_DAY);
  assert.equal(result.counts.marriage, 1);
  for (let day = 1; day <= result.toDay; day++) {
    daily.onDay(day, dateOf(day));
    daily.autoFilePending(day);
  }
  assert.deepEqual(skipEvents, dailyEvents);
  assert.deepEqual(skipped.history, daily.history);
  assert.deepEqual(finalScore(skipped, result.toDay), finalScore(daily, result.toDay));
  assert.equal(result.end.wellbeing, wellbeing(skipped, result.toDay).W);
  assert.equal(result.end.score, skipped.book.profile.score, "credit score remains separate");
});

test("replaying with different money choices preserves marriage luck and scores each branch independently", () => {
  const original = newLife();
  const replay = newLife();
  const originalMarriage: LifeEvent[] = [];
  const replayMarriage: LifeEvent[] = [];
  original.onEvents((events) => originalMarriage.push(...events.filter((e) => e.type === "marriage")));
  replay.onEvents((events) => replayMarriage.push(...events.filter((e) => e.type === "marriage")));
  replay.ledger.get("savings").balance += 100_000;
  original.runHeadless(0, MARRIAGE_DAY, START);
  replay.runHeadless(0, MARRIAGE_DAY, START);
  assert.deepEqual(originalMarriage, [{ type: "marriage", day: MARRIAGE_DAY }]);
  assert.deepEqual(replayMarriage, originalMarriage);
  assert.ok(finalScore(replay, MARRIAGE_DAY).final > finalScore(original, MARRIAGE_DAY).final);
  const ghost = structuredClone(original.history);
  replay.runHeadless(MARRIAGE_DAY, 10, dateOf(MARRIAGE_DAY));
  assert.deepEqual(original.history, ghost, "another branch cannot change the original history");
});

test("a real marriage event uses the existing recorder contract and retains its key on retry", async () => {
  const life = newLife();
  const sent: EventEntry[][] = [];
  let rejectEvents = true;
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (String(input).endsWith("/runs")) return Response.json({ runId: "run-1" }, { status: 201 });
    if (String(input).endsWith("/events")) {
      sent.push(body.events);
      if (rejectEvents) return Response.json({}, { status: 503 });
    }
    return Response.json({ stored: 1 });
  }) as typeof fetch;
  const recorder = new RunRecorder({ life, seed: SEED, fetchFn, log: () => {} });
  assert.equal(await recorder.begin(), true);
  life.runHeadless(0, MARRIAGE_DAY, START);
  await recorder.tick(true);
  assert.ok(recorder.pending.events > 0, "failed delivery remains buffered");
  rejectEvents = false;
  await recorder.tick(true);
  const marriage = sent.map((batch) => batch.filter((event) => event.kind === "marriage"));
  assert.equal(marriage.length, 2);
  assert.equal(marriage[0].length, 1);
  assert.deepEqual(marriage[1], marriage[0]);
  assert.match(marriage[0][0].key, /^112:\d+$/);
  assert.deepEqual(marriage[0][0].payload, { type: "marriage", day: MARRIAGE_DAY });
  assert.deepEqual(recorder.pending, { days: 0, events: 0 });
});
