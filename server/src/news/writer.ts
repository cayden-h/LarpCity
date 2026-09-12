// server/src/news/writer.ts
// Fills in one news_stories row's headline/blurb/impact: Gemini first, the same
// deterministic-template-from-facts fallback pattern as server/src/ai/coach.ts otherwise.
import { z } from "zod";
import type { JsonModel } from "../adapters/gemini.js";
import { describe, gameDate, impactOf } from "../ai/facts.js";
import { logger } from "../logger.js";
import { markNewsStoryWritten, unwrittenNewsStories, type Db, type NewsStoryRow } from "./store.js";

export type Source = "gemini" | "template";

export interface WrittenStory {
  headline: string;
  blurb: string;
  impact: string;
}

const STORY_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "A newspaper headline, at most 10 words." },
    blurb: { type: "string", description: "One or two sentences on what happened." },
    impact: { type: "string", description: "One sentence on what it means for the player's money." },
  },
  required: ["headline", "blurb", "impact"],
};

const storyOut = z.object({
  headline: z.string().trim().min(1).max(100),
  blurb: z.string().trim().min(1).max(500),
  impact: z.string().trim().min(1).max(300),
});

export function storyPrompt(row: NewsStoryRow): string {
  return [
    "You write one story for the Larp City Ledger, the in-game newspaper.",
    `It ran on ${gameDate(row.day)} in the "${row.category}" section, prominence "${row.prominence}".`,
    "Rules:",
    "- Use only the facts below; every number must come from them. Don't invent events, places, or people.",
    "- Write money as whole dollars with a dollar sign and commas, like $12,345 or -$12,345.",
    "- headline: at most 10 words. blurb: one or two sentences. impact: one sentence on what it means for the player's money.",
    "- Plain, warm newspaper style. Education, not financial advice.",
    "Facts (JSON):",
    JSON.stringify({ kind: row.kind, day: gameDate(row.day), ...row.facts }),
  ].join("\n");
}

/** The deterministic fallback: the same plain-language line ai/facts.ts's newspaper digest already writes per event, split into headline/blurb/impact instead of one combined line. */
export function templateStory(row: NewsStoryRow): WrittenStory {
  const text = describe({ key: row.eventKey, day: row.day, kind: row.kind, payload: row.facts }) ?? `Something changed: ${row.kind.replace(/_/g, " ")}.`;
  return {
    headline: text.length > 70 ? `${text.slice(0, 67)}...` : text,
    blurb: `On ${gameDate(row.day)}: ${text.charAt(0).toLowerCase()}${text.slice(1)}.`,
    impact: impactOf(row.kind),
  };
}

export async function writeStory(model: JsonModel | null, row: NewsStoryRow): Promise<{ story: WrittenStory; source: Source; model?: string }> {
  if (model) {
    try {
      const r = await model.json(storyPrompt(row), STORY_SCHEMA);
      return { story: storyOut.parse(r.value), source: "gemini", model: r.model };
    } catch (err) {
      logger.warn({ message: err instanceof Error ? err.message : String(err) }, "news story fell back to the template");
    }
  }
  return { story: templateStory(row), source: "template" };
}

/** Writes prose for up to `limit` unwritten stories, oldest first. Returns how many were written. */
export async function writeUnwrittenNews(db: Db, model: JsonModel | null, runId: string, branchId: string, limit: number): Promise<number> {
  const rows = await unwrittenNewsStories(db, runId, branchId, limit);
  for (const row of rows) {
    const { story, source } = await writeStory(model, row);
    await markNewsStoryWritten(db, row.id, story.headline, story.blurb, story.impact, source);
  }
  return rows.length;
}
