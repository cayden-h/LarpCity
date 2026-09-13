// The narration pack builder voices only lines with no clip yet (scripts/narration-plan.ts),
// so rebuilding after a new line costs credits for that line alone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { planPack, type PackEntry } from "../scripts/narration-plan.ts";

const entry = (file: string): PackEntry => ({ file, words: [{ word: "Hi.", start: 0 }] });
const onDisk = (...files: string[]) => (f: string) => files.includes(f);

test("a first build voices every line", () => {
  const plan = planPack(["A.", "B."], {}, onDisk());
  assert.deepEqual(plan.voice, ["A.", "B."]);
  assert.deepEqual(plan.keep, {});
  assert.deepEqual(plan.drop, []);
});

test("an unchanged pack voices nothing and keeps every entry as it is", () => {
  const existing = { "A.": entry("a.mp3"), "B.": entry("b.mp3") };
  const plan = planPack(["A.", "B."], existing, onDisk("a.mp3", "b.mp3"));
  assert.deepEqual(plan.voice, []);
  assert.deepEqual(plan.keep, existing);
  assert.deepEqual(plan.drop, []);
});

test("a new line is the only one voiced", () => {
  const plan = planPack(["A.", "Welcome back.", "B."], { "A.": entry("a.mp3"), "B.": entry("b.mp3") }, onDisk("a.mp3", "b.mp3"));
  assert.deepEqual(plan.voice, ["Welcome back."]);
  assert.deepEqual(Object.keys(plan.keep), ["A.", "B."]);
});

test("a line whose clip file is missing is voiced again", () => {
  const plan = planPack(["A.", "B."], { "A.": entry("a.mp3"), "B.": entry("b.mp3") }, onDisk("a.mp3"));
  assert.deepEqual(plan.voice, ["B."]);
  assert.deepEqual(Object.keys(plan.keep), ["A."]);
});

test("lines the game no longer says have their clips dropped", () => {
  const plan = planPack(["A."], { "A.": entry("a.mp3"), "Old.": entry("old.mp3") }, onDisk("a.mp3", "old.mp3"));
  assert.deepEqual(plan.voice, []);
  assert.deepEqual(plan.drop, ["old.mp3"]);
});

test("a line listed twice is voiced once", () => {
  assert.deepEqual(planPack(["A.", "A."], {}, onDisk()).voice, ["A."]);
});
