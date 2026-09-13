import assert from "node:assert/strict";
import { test } from "node:test";
import { explain, expressionFor } from "../src/ui/happiness.ts";

test("explain splits factors into costing points (costliest first) and going well, and keeps visible events", () => {
  const factor = (name: string, weight: number, s: number) => ({ name, weight, s, points: weight * s, note: "" }) as never;
  const { drags, good, events } = explain({
    W: 70,
    factors: [factor("work", 20, 1), factor("cashCushion", 18, 0.25), factor("relationships", 10, 0.9), factor("commute", 6, 0.95)],
    pulses: [{ name: "vacation", startDay: 0, points: 0.01 }, { name: "layoff", startDay: 0, points: -3 }, { name: "vacation", startDay: 0, points: 2 }],
  });
  assert.deepEqual(drags.map((f) => f.name), ["cashCushion", "relationships"]);
  assert.deepEqual(good.map((f) => f.name), ["work", "commute"]);
  assert.deepEqual(events.map((e) => e.points), [-3, 2]);
});

test("expressionFor maps 0-100 wellbeing bands to exactly 3 expressions", () => {
  assert.equal(expressionFor(0), "sad");
  assert.equal(expressionFor(20), "sad");
  assert.equal(expressionFor(32.9), "sad");
  assert.equal(expressionFor(33), "neutral");
  assert.equal(expressionFor(50), "neutral");
  assert.equal(expressionFor(65.9), "neutral");
  assert.equal(expressionFor(66), "happy");
  assert.equal(expressionFor(80), "happy");
  assert.equal(expressionFor(100), "happy");
});
