import { test } from "node:test";
import assert from "node:assert/strict";
import { NPCS } from "../src/data/npcs.ts";
import { habitProfile, describeHabit, applyDailyHabit, monthlyShare, SPEND_CATEGORIES } from "../src/sim/npcs/habits.ts";
import { PlayerLife } from "../src/sim/life/index.ts";
import type { Place } from "../src/sim/life/index.ts";

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };
const START = new Date(2026, 8, 11);

test("every NPC's habit weights sum to 1 and use only known categories", () => {
  for (const npc of NPCS) {
    const weights = habitProfile(npc.id);
    assert.ok(weights.length > 0, npc.id);
    const total = weights.reduce((s, w) => s + w.weight, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `${npc.id} weights should sum to 1, got ${total}`);
    for (const w of weights) assert.ok(SPEND_CATEGORIES.includes(w.name), `${npc.id}: unknown category ${w.name}`);
  }
});

test("habit weights are deterministic and differ between NPCs", () => {
  assert.deepEqual(habitProfile("npc-maya"), habitProfile("npc-maya"), "same NPC, same seed, same weights every call");
  const distinct = new Set(NPCS.map((n) => JSON.stringify(habitProfile(n.id))));
  assert.ok(distinct.size > 1, "at least some NPCs should have visibly different habits");
});

test("describeHabit names the NPC's top category", () => {
  const line = describeHabit("npc-jordan");
  const top = habitProfile("npc-jordan").sort((a, b) => b.weight - a.weight)[0];
  assert.ok(line.toLowerCase().includes(top.name.toLowerCase()), `"${line}" should mention "${top.name}"`);
});

test("occupation bias shifts weights without breaking the sum-to-1 or known-category invariants", () => {
  const withBias = habitProfile("npc-kenji", "protective");
  const total = withBias.reduce((s, w) => s + w.weight, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  for (const w of withBias) assert.ok(SPEND_CATEGORIES.includes(w.name), `unknown category ${w.name}`);
  const noBias = habitProfile("npc-kenji");
  assert.notDeepEqual(withBias, noBias, "a category bias should visibly change at least one weight");
});

test("an adjunct's discretionary share is lower than an unbiased NPC with the same take-home", () => {
  const biased = monthlyShare("npc-marcus", "education");
  const unbiased = monthlyShare("npc-marcus");
  assert.ok(biased < unbiased, `education shareMultiplier should lower the share: ${biased} vs ${unbiased}`);
});

test("applyDailyHabit only ever spends a small, capped share of take-home over a month, and never on a day it can't afford", () => {
  const npc = NPCS.find((n) => n.id === "npc-jordan")!; // paycheck-to-paycheck NPC: the tightest case
  const life = new PlayerLife({ place: TX, day: 0, monthlyTakeHome: npc.monthlyTakeHome });
  life.ledger.get("checking").balance = 0;
  let spentThisMonth = 0;
  life.onEvents((events) => {
    for (const e of events) if (e.type === "spend") spentThisMonth += e.amount;
  });
  const date = new Date(START);
  for (let day = 1; day <= 30; day++) {
    date.setDate(date.getDate() + 1);
    applyDailyHabit(life, npc.id, day, new Date(date));
  }
  assert.ok(spentThisMonth <= npc.monthlyTakeHome * 0.06 + 1, `spent ${spentThisMonth}, over the 6% cap`);
  assert.ok(life.ledger.get("checking").balance >= -0.01, "never overdrawn (spend() caps at what's available)");
});
