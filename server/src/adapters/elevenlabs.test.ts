import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCaptions, captionsFromResponse } from "./elevenlabs.js";

test("captionsFromResponse reads the SDK's camelCase alignment", () => {
  const alignment = {
    characters: ["h", "i", " ", "y", "o", "u"],
    characterStartTimesSeconds: [0.0, 0.1, 0.2, 0.3, 0.4, 0.5],
    characterEndTimesSeconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
  };
  const expected = [
    { word: "hi", start: 0.0 },
    { word: "you", start: 0.3 },
  ];
  assert.deepEqual(captionsFromResponse({ alignment }), expected);
  assert.deepEqual(captionsFromResponse({ normalizedAlignment: alignment }), expected);
});

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

test("buildCaptions leaves delivery tags like [sighs] out of the captions", () => {
  const chars = [..."[sighs] So. [slow] Naturally."];
  const starts = chars.map((_, i) => i / 10);
  assert.deepEqual(buildCaptions(chars, starts), [
    { word: "So.", start: 0.8 },
    { word: "Naturally.", start: 1.9 },
  ]);
});

test("buildCaptions returns an empty array for empty input", () => {
  assert.deepEqual(buildCaptions([], []), []);
});
