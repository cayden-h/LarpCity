// Sammy's Learn walkthrough on the title screen: the script's shape, and that
// every line is a real line the pack builder will voice.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEARN } from "../src/narration/learn.ts";
import { allLines, DELIVERY_TAGS } from "../src/narration/lines.ts";

const strips = Object.keys(
  (JSON.parse(readFileSync(new URL("../public/owl/owl.json", import.meta.url), "utf8")) as { animations: Record<string, unknown> }).animations,
);

test("eight steps: Sammy introduces himself first and sends the player to set up and pick goals last", () => {
  assert.equal(LEARN.length, 8);
  assert.match(LEARN[0].line, /I'm Sammy/);
  assert.match(LEARN[LEARN.length - 1].line, /goals/);
});

test("every step's reaction is an owl strip that exists", () => {
  for (const s of LEARN) assert.ok(strips.includes(s.anim), `${s.anim} is not in public/owl/owl.json`);
});

test("lines use only Sammy's delivery tags, and no em dashes", () => {
  for (const { line } of LEARN) {
    for (const [, tag] of line.matchAll(/\[([^\]]*)\]/g)) assert.ok((DELIVERY_TAGS as readonly string[]).includes(tag), `unknown tag [${tag}] in: ${line}`);
    assert.ok(!line.includes("—"), `em dash in: ${line}`);
  }
});

test("every Learn line is in allLines, so the pack builder voices it", () => {
  const all = new Set(allLines());
  for (const { line } of LEARN) assert.ok(all.has(line), line);
});
