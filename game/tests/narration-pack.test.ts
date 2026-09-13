// The narration pack (public/narration, built by scripts/build-narration.ts)
// has a clip and word timings for every line the owl can say, so no line
// needs ElevenLabs at play time. Editing a line without rebuilding fails here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AWAITING_VOICE } from "../src/narration/learn.ts";
import { allLines, stripTags } from "../src/narration/lines.ts";

const DIR = fileURLToPath(new URL("../public/narration/", import.meta.url));
const pack = JSON.parse(readFileSync(DIR + "index.json", "utf8")) as { lines: Record<string, { file: string; words: { word: string; start: number }[] }> };
/** Lines that should have a clip: all of them except those waiting for voice credits (narration/learn.ts). */
const voiced = () => allLines().filter((l) => !AWAITING_VOICE.has(l));

test("every line has a clip in the pack (run npm run narration:pack after editing lines)", () => {
  for (const line of voiced()) {
    const entry = pack.lines[line];
    assert.ok(entry, `missing from the pack: ${line}`);
    assert.ok(existsSync(DIR + entry.file) && statSync(DIR + entry.file).size > 10_000, `clip missing or empty: ${entry.file}`);
  }
});

test("the pack holds no stale lines", () => {
  const current = new Set(allLines());
  for (const line of Object.keys(pack.lines)) assert.ok(current.has(line), `no longer a line: ${line}`);
});

test("a line waiting for a voice has none yet (once the pack voices it, empty AWAITING_VOICE)", () => {
  for (const line of AWAITING_VOICE) assert.ok(!pack.lines[line], `voiced now, drop it from AWAITING_VOICE: ${line}`);
});

test("each clip's captions match the words shown in the bubble, in order", () => {
  for (const line of voiced()) {
    const { words } = pack.lines[line];
    assert.deepEqual(
      words.map((w) => w.word),
      stripTags(line).split(" "),
      line,
    );
    for (let i = 1; i < words.length; i++) assert.ok(words[i].start >= words[i - 1].start, `${line}: timings out of order`);
  }
});
