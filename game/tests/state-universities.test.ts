import { test } from "node:test";
import assert from "node:assert/strict";
import { STATES } from "../src/data/states.ts";
import { STATE_UNIVERSITY, stateUniversity } from "../src/data/state-universities.ts";

test("every state abbreviation used by the game's Place data has a university entry", () => {
  for (const place of STATES) assert.ok(STATE_UNIVERSITY[place.abbr], place.abbr);
});

test("an unknown abbreviation falls back instead of throwing", () => {
  assert.equal(stateUniversity("ZZ"), "the state university");
});

test("stateUniversity resolves a known abbreviation to its cited university", () => {
  assert.equal(stateUniversity("TX"), "Texas A&M University");
  assert.equal(stateUniversity("OH"), "Ohio State University");
});
