// The owl's poses: the frame table covers each strip, talking poses stay on one
// sheet, moods follow delivery tags, and poses never repeat back to back.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CUES, stripTags } from "../src/narration/lines.ts";
import { EXPRESSIONS, MOOD_POSES, pickPose, TAG_REACH, wordMoods, type Mood } from "../src/narration/poses.ts";

/** Frame counts per strip, from the manifest the slicer writes (game/art/owl/slice.py). */
const manifest = JSON.parse(readFileSync(new URL("../public/owl/owl.json", import.meta.url), "utf8")) as {
  animations: Record<string, { frames: number }>;
};
const framesOf = (strip: string) => manifest.animations[strip].frames;

test("each pose strip's frames are classified exactly once", () => {
  for (const [strip, groups] of Object.entries(EXPRESSIONS)) {
    const frames = Object.values(groups as Record<string, readonly number[]>).flat().sort((a, b) => a - b);
    assert.deepEqual(frames, [...Array(framesOf(strip)).keys()], strip);
  }
});

test("talking poses all come from the idle and talk sheets, so the vest never changes mid-sentence", () => {
  for (const [mood, poses] of Object.entries(MOOD_POSES)) {
    assert.ok(poses.length >= 3, `${mood} needs a few poses to vary`);
    for (const p of poses) {
      assert.ok(p.anim === "talk" || p.anim === "idle", `${mood}: ${p.anim}`);
      assert.ok(p.frame >= 0 && p.frame < framesOf(p.anim), `${mood}: frame ${p.frame}`);
    }
  }
});

test("pickPose never shows the same pose twice in a row", () => {
  for (const mood of Object.keys(MOOD_POSES) as Mood[]) {
    let last = pickPose(mood, null, () => 0);
    for (let i = 0; i < 40; i++) {
      const next = pickPose(mood, last, () => (i * 0.37) % 1);
      assert.ok(next.anim !== last.anim || next.frame !== last.frame, `${mood} repeated ${JSON.stringify(last)}`);
      last = next;
    }
  }
});

test("wordMoods uses the base mood, and a delivery tag shifts the next few words", () => {
  assert.deepEqual(wordMoods("One less debt.", "warm"), ["warm", "warm", "warm"]);
  const moods = wordMoods("Not mad. [slow] Just writing it down. In pen.", "plain");
  assert.deepEqual(moods, ["plain", "plain", "dry", "dry", "dry", "dry", "dry", "plain"]);
  assert.equal(moods.length, 8);
  assert.equal(TAG_REACH, 5);
  assert.deepEqual(wordMoods("[whispers] Both eyes.", "plain"), ["sly", "sly"]);
});

test("every line has one mood per word shown in the bubble", () => {
  for (const [cue, def] of Object.entries(CUES)) {
    for (const line of def.lines) {
      assert.equal(wordMoods(line, def.mood).length, stripTags(line).split(" ").length, `${cue}: ${line}`);
    }
  }
});
