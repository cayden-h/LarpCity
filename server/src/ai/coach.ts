// server/src/ai/coach.ts
// The AI coach and the newspaper. Gemini writes from the fact sheets in
// facts.ts, answers in a fixed JSON shape, and every answer is checked; a
// busy model, a bad answer, or no model at all falls back to the plain-text
// versions from the same facts, so the game always gets something true.

import { z } from "zod";
import type { JsonModel } from "../adapters/gemini.js";
import { logger } from "../logger.js";
import { templateFeedback, templateNews, type Feedback, type FeedbackFacts, type NewsFacts, type Story, type Trigger } from "./facts.js";

export type Source = "gemini" | "template";

const FEEDBACK_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "At most 8 words." },
    tip: { type: "string", description: "One or two sentences, at most 45 words, using only numbers from the facts." },
    mood: { type: "string", enum: ["cheer", "warn", "console"] },
  },
  required: ["headline", "tip", "mood"],
};

const feedbackOut = z.object({
  headline: z.string().trim().min(1).max(80),
  tip: z.string().trim().min(1).max(400),
  mood: z.enum(["cheer", "warn", "console"]),
});

const NEWS_SCHEMA = {
  type: "object",
  properties: {
    stories: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "A newspaper headline, at most 10 words." },
          where: { type: "string", description: '"Your finances", or a state named in the facts.' },
          blurb: { type: "string", description: "One or two sentences on what happened." },
          impact: { type: "string", description: "One sentence on what it means for the player's money." },
        },
        required: ["title", "where", "blurb", "impact"],
      },
    },
  },
  required: ["stories"],
};

const newsOut = z.object({
  stories: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(100),
        where: z.string().trim().min(1).max(40),
        blurb: z.string().trim().min(1).max(500),
        impact: z.string().trim().min(1).max(300),
      }),
    )
    .min(1)
    .max(4),
});

const MOMENT: Record<Trigger, string> = {
  goal: "The player just reached a goal. Say what got them there, and how they could reach the next goal sooner.",
  bankruptcy: "The player just became eligible for bankruptcy. Explain what went wrong and what could have been done differently, kindly.",
  swing: "The player's investments moved a lot in three months. Up or down, nudge them toward diversifying and staying the course.",
  recovery:
    "Stocks just got back to their old high after a crash. Compare what the player has now with what holding and the autopilot would have, name what their choice cost or earned in dollars, and say what that teaches about crashes.",
};

export function coachPrompt(f: FeedbackFacts): string {
  return [
    "You are the coach in Larp City, a game that teaches personal finance by letting players live out their money decisions.",
    MOMENT[f.trigger],
    "Rules:",
    "- Use only the facts below. Don't invent numbers, names, or events.",
    "- Be kind and specific: name what happened, then one concrete thing that would help next time.",
    "- This is education, not financial advice: no product names and no stock picks.",
    "- headline: at most 8 words. tip: one or two sentences, at most 45 words. mood: cheer for a win, warn for a risk worth fixing, console after a loss.",
    "- Write money as whole dollars with a dollar sign and commas, like $12,345 or -$12,345.",
    "Facts (JSON; money in US dollars; dates are game dates):",
    JSON.stringify(f),
  ].join("\n");
}

export function newsPrompt(f: NewsFacts): string {
  return [
    "You write the Larp City Ledger, the in-game newspaper that sums up a stretch of the player's financial life.",
    `Write 1 to 4 short stories about ${f.from} to ${f.to}.`,
    "Rules:",
    "- Use only the facts below; every number must come from them. Don't invent events, places, or people.",
    "- Put the biggest story first. The routine counts are context only: never write a story about paychecks, bills, or regular payments.",
    "- If only one thing really happened, write fewer stories rather than filler.",
    "- Write money as whole dollars with a dollar sign and commas, like $12,345 or -$12,345, and dates like January 9, 2027.",
    '- where: "Your finances", or a state the facts name. impact: one sentence on what it means for the player\'s money.',
    "- Plain, warm newspaper style. Education, not financial advice.",
    "Facts (JSON; money in US dollars; dates are game dates):",
    JSON.stringify(f),
  ].join("\n");
}

export async function coachFeedback(model: JsonModel | null, f: FeedbackFacts): Promise<{ feedback: Feedback; source: Source; model?: string }> {
  if (model) {
    try {
      const r = await model.json(coachPrompt(f), FEEDBACK_SCHEMA);
      return { feedback: feedbackOut.parse(r.value), source: "gemini", model: r.model };
    } catch (err) {
      logger.warn({ message: err instanceof Error ? err.message : String(err) }, "coach feedback fell back to the template");
    }
  }
  return { feedback: templateFeedback(f), source: "template" };
}

export async function writeNews(model: JsonModel | null, f: NewsFacts): Promise<{ stories: Story[]; source: Source; model?: string }> {
  if (model) {
    try {
      const r = await model.json(newsPrompt(f), NEWS_SCHEMA);
      return { stories: newsOut.parse(r.value).stories, source: "gemini", model: r.model };
    } catch (err) {
      logger.warn({ message: err instanceof Error ? err.message : String(err) }, "newspaper fell back to the template");
    }
  }
  return { stories: templateNews(f), source: "template" };
}
