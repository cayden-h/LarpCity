// The owl's lines: which cue a day's events raise, how lines are picked and
// shown, and the timing rules that keep the narrator from chattering.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CUES, CueGate, cueForEvents, DELIVERY_TAGS, pickLine, SCORE_STEP, stripTags, type Cue } from "../src/narration/lines.ts";

test("stripTags removes delivery tags and tidies the spacing", () => {
  assert.equal(stripTags("[sighs] A payment was missed. [slow] Just  disappointed."), "A payment was missed. Just disappointed.");
  assert.equal(stripTags("No tags here."), "No tags here.");
});

test("every line fits the bubble, uses only tags the voice performs, and has no em dash", () => {
  const allowed = new Set<string>(DELIVERY_TAGS);
  for (const [cue, def] of Object.entries(CUES)) {
    assert.ok(def.lines.length >= 2 || cue === "none", `${cue} needs at least two lines`);
    for (const line of def.lines) {
      assert.ok(stripTags(line).length <= 150, `${cue}: too long for the bubble: ${line}`);
      for (const [, tag] of line.matchAll(/\[([^\]]*)\]/g)) assert.ok(allowed.has(tag), `${cue}: unknown tag [${tag}]`);
      assert.ok(!line.includes("—"), `${cue}: em dash in ${line}`);
    }
  }
});

test("cueForEvents picks the most important event of the day", () => {
  const paid = { type: "paid_off", day: 3, debtId: "card", name: "Credit card" } as const;
  const missed = { type: "missed", day: 3, debtId: "loan", due: 120, fee: 29 } as const;
  const bankrupt = { type: "bankruptcy_eligible", day: 3, reason: "minimums exceed income" } as const;
  assert.equal(cueForEvents([paid]), "paid_off");
  assert.equal(cueForEvents([paid, missed]), "missed");
  assert.equal(cueForEvents([missed, bankrupt, paid]), "bankruptcy");
  assert.equal(cueForEvents([{ type: "paycheck", day: 1, takeHome: 2000, garnished: 0, unemployed: false }]), null);
  assert.equal(cueForEvents([]), null);
});

test("the owl reacts to the market's crash and recovery", () => {
  const bear = { type: "bear_market", day: 40, drop: 0.22, stocks: 3100 } as const;
  const recovered = { type: "market_recovered", day: 400, you: 5200, held: 5200, autopilot: 5300 } as const;
  const missed = { type: "missed", day: 40, debtId: "loan", due: 120, fee: 29 } as const;
  const scoreUp = { type: "score_change", day: 40, from: 650, to: 650 + SCORE_STEP } as const;
  assert.equal(cueForEvents([bear]), "crash");
  assert.equal(cueForEvents([recovered]), "boom");
  // A missed payment outranks the market; the market outranks a credit score move.
  assert.equal(cueForEvents([bear, missed]), "missed");
  assert.equal(cueForEvents([scoreUp, recovered]), "boom");
});

test("small credit score moves stay quiet", () => {
  const score = (from: number, to: number) => [{ type: "score_change", day: 5, from, to }] as const;
  assert.equal(cueForEvents(score(700, 700 + SCORE_STEP)), "score_up");
  assert.equal(cueForEvents(score(700, 700 - SCORE_STEP)), "score_down");
  assert.equal(cueForEvents(score(700, 700 + SCORE_STEP - 1)), null);
});

test("pickLine never repeats the line it used last time", () => {
  const cue: Cue = "paid_off";
  let last = pickLine(cue, undefined, () => 0);
  for (let i = 0; i < 20; i++) {
    const next = pickLine(cue, last, () => (i % 7) / 7);
    assert.notEqual(next, last);
    last = next;
  }
  assert.ok(CUES[cue].lines.includes(last));
});

test("CueGate spaces lines out, holds each cue's cooldown, and lets urgent cues through", () => {
  const gate = new CueGate();
  assert.equal(gate.allow("paid_off", 0), true);
  // Another line too soon after the last one.
  assert.equal(gate.allow("boom", 3_000), false);
  // Urgent news skips the gap.
  assert.equal(gate.allow("collections", 3_500), true);
  // A cue waits out its own cooldown even after the gap.
  assert.equal(gate.allow("paid_off", 20_000), false);
  assert.equal(gate.allow("paid_off", 40_000), true);
});

import { welcomeBackLine } from "../src/narration/lines.ts";

test("the welcome back names the date and, when there is one, the job", () => {
  const date = new Date(2031, 2, 4);
  assert.equal(welcomeBackLine("Nurse", date), "Welcome back, nurse. It's March 4, 2031, and your money is right where you left it.");
  assert.equal(welcomeBackLine(null, date), "Welcome back. It's March 4, 2031, and your money is right where you left it.");
  assert.equal(welcomeBackLine("  ", date), "Welcome back. It's March 4, 2031, and your money is right where you left it.");
});
