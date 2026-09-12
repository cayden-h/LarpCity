import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCaptions } from "./elevenlabs.js";

test("buildCaptions groups characters into words at spaces", () => {
  const chars = ["h", "i", " ", "y", "o", "u"];
  const starts = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5];
  assert.deepEqual(buildCaptions(chars, starts), [
    { word: "hi", start: 0.0 },
    { word: "you", start: 0.3 },
  ]);
});

test("buildCaptions handles a single word with no spaces", () => {
  const chars = ["o", "k"];
  const starts = [1.0, 1.1];
  assert.deepEqual(buildCaptions(chars, starts), [{ word: "ok", start: 1.0 }]);
});

test("buildCaptions returns an empty array for empty input", () => {
  assert.deepEqual(buildCaptions([], []), []);
});
