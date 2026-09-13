import { test } from "node:test";
import assert from "node:assert/strict";
import type { JsonModel } from "../adapters/gemini.js";
import type { NewsStoryRow } from "./store.js";
import { storyPrompt, templateStory, writeStory } from "./writer.js";

const row: NewsStoryRow = {
  id: "s1",
  runId: "r1",
  branchId: "r1",
  day: 50,
  eventKey: "50:0",
  kind: "paid_off",
  category: "financial",
  score: 72,
  prominence: "section",
  facts: { debtId: "d1", name: "Car loan" },
  headline: null,
  blurb: null,
  impact: null,
  source: null,
};

const model = (value: unknown | (() => never)): JsonModel & { prompts: string[] } => {
  const prompts: string[] = [];
  return {
    prompts,
    async json(prompt) {
      prompts.push(prompt);
      if (typeof value === "function") (value as () => never)();
      return { value, model: "gemini-test" };
    },
  };
};

test("templateStory reuses ai/facts.ts's describe() and impactOf() verbatim", () => {
  const s = templateStory(row);
  assert.match(s.headline, /Paid off the Car loan/);
  assert.match(s.impact, /free for savings/);
});

test("the prompt carries only the story's own facts, not the browser's text", () => {
  const p = storyPrompt(row);
  assert.match(p, /Larp City Ledger/);
  // gameDate(50) with GAME_START_MS = Date.UTC(2026, 8, 11) lands on 2026-10-31 (verified: node -e
  // "console.log(new Date(Date.UTC(2026,8,11) + 50*86400000).toISOString().slice(0,10))").
  assert.ok(p.includes(JSON.stringify({ kind: row.kind, day: "2026-10-31", ...row.facts })));
});

test("a valid Gemini answer is used and labeled", async () => {
  const m = model({ headline: "Car loan paid off", blurb: "The last payment cleared it.", impact: "More room for savings." });
  const r = await writeStory(m, row);
  assert.equal(r.source, "gemini");
  assert.equal(r.story.headline, "Car loan paid off");
});

test("a bad answer, a thrown error, or no model falls back to the template", async () => {
  for (const bad of [{ headline: "x" }, {}, "text"]) {
    assert.equal((await writeStory(model(bad), row)).source, "template", JSON.stringify(bad));
  }
  const throws = model(() => {
    throw new Error("503 high demand");
  });
  assert.equal((await writeStory(throws, row)).source, "template");
  const none = await writeStory(null, row);
  assert.equal(none.source, "template");
  assert.match(none.story.headline, /Car loan/);
});
