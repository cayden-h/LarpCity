// server/src/ai/coach.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { JsonModel } from "../adapters/gemini.js";
import type { SnapshotRow } from "../store/runs.js";
import { coachFeedback, coachPrompt, newsPrompt, writeNews } from "./coach.js";
import { feedbackFacts, newsFacts } from "./facts.js";

const snaps: SnapshotRow[] = Array.from({ length: 120 }, (_, day) => ({ day, netWorth: 1000 + day, checking: 500, savings: 500, brokerage: day, retirement: 0, debt: 400 }));
const facts = feedbackFacts("goal", 119, snaps, [], "an emergency fund");
const news = newsFacts(0, 119, snaps, [{ key: "50:0", day: 50, kind: "paid_off", payload: { name: "Car loan" } }]);

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

test("the prompts carry the facts and the rules, and nothing the browser wrote", () => {
  const p = coachPrompt(facts);
  assert.match(p, /reached a goal/);
  assert.match(p, /Use only the facts below/);
  assert.ok(p.includes(JSON.stringify(facts)));
  const n = newsPrompt(news);
  assert.match(n, /1 to 4 short stories/);
  assert.ok(n.includes("Paid off the Car loan"));
});

test("a valid Gemini answer is used and labeled", async () => {
  const m = model({ headline: "Cushion built", tip: "Your $1,119 net worth came from steady saving.", mood: "cheer" });
  const r = await coachFeedback(m, facts);
  assert.equal(r.source, "gemini");
  assert.equal(r.model, "gemini-test");
  assert.equal(r.feedback.headline, "Cushion built");
  const s = await writeNews(model({ stories: [{ title: "Car loan gone", where: "Your finances", blurb: "Paid off.", impact: "More room." }] }), news);
  assert.equal(s.source, "gemini");
  assert.equal(s.stories.length, 1);
});

test("a bad answer, an error, or no model falls back to the template", async () => {
  for (const bad of [{ headline: "x", tip: "y", mood: "angry" }, { headline: "x".repeat(200), tip: "y", mood: "cheer" }, {}, "text"]) {
    assert.equal((await coachFeedback(model(bad), facts)).source, "template", JSON.stringify(bad));
  }
  const throws = model(() => {
    throw new Error("503 high demand");
  });
  assert.equal((await coachFeedback(throws, facts)).source, "template");
  const none = await coachFeedback(null, facts);
  assert.equal(none.source, "template");
  assert.match(none.feedback.headline, /an emergency fund/);
  assert.equal((await writeNews(model({ stories: [] }), news)).source, "template", "an empty paper isn't a paper");
  assert.equal((await writeNews(null, news)).stories[1].title, "Paid off the Car loan");
});
