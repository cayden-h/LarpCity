import assert from "node:assert/strict";
import { test } from "node:test";
import { expressionFor } from "../src/ui/happiness.ts";

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
