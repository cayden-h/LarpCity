// The narration pack (public/narration, built by scripts/build-narration.ts)
// has a clip and word timings for every line the owl can say, so no line
// needs ElevenLabs at play time. Editing a line without rebuilding fails here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { allLines, stripTags } from "../src/narration/lines.ts";

const DIR = fileURLToPath(new URL("../public/narration/", import.meta.url));
const pack = JSON.parse(readFileSync(DIR + "index.json", "utf8")) as { lines: Record<string, { file: string; words: { word: string; start: number }[] }> };

test("every line has a clip in the pack (run npm run narration:pack after editing lines)", () => {
  for (const line of allLines()) {
    const entry = pack.lines[line];
    assert.ok(entry, `missing from the pack: ${line}`);
    assert.ok(existsSync(DIR + entry.file) && statSync(DIR + entry.file).size > 10_000, `clip missing or empty: ${entry.file}`);
  }
});

test("the pack holds no stale lines", () => {
  const current = new Set(allLines());
  for (const line of Object.keys(pack.lines)) assert.ok(current.has(line), `no longer a line: ${line}`);
});

test("each clip's captions match the words shown in the bubble, in order", () => {
  for (const line of allLines()) {
    const { words } = pack.lines[line];
    assert.deepEqual(
      words.map((w) => w.word),
      stripTags(line).split(" "),
      line,
    );
    for (let i = 1; i < words.length; i++) assert.ok(words[i].start >= words[i - 1].start, `${line}: timings out of order`);
  }
});
