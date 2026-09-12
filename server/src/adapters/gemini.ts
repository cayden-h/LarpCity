import { env, geminiKeys } from "../env.js";
import { logger } from "../logger.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export async function callGemini(model: string, body: unknown): Promise<any> {
  let lastError: unknown;
  for (const key of geminiKeys) {
    const r = await fetch(`${BASE}/models/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) return r.json();
    if (r.status === 429 || r.status === 503) {
      lastError = new Error(`Gemini ${model} ${r.status}`);
      logger.warn({ status: r.status }, "gemini key exhausted, rotating");
      continue;
    }
    throw new Error(`Gemini ${model} ${r.status} ${await r.text()}`);
  }
  throw lastError ?? new Error("Gemini: no keys configured");
}

export async function generateAvatar(selfieBase64: string, styleBase64: string): Promise<string> {
  const result = await callGemini(env.GEMINI_IMAGE_MODEL, {
    contents: [
      {
        parts: [
          {
            text:
              "Image 1 is the player. Image 2 is the art style. Draw a 4-column turnaround " +
              "sheet (front, 3/4, side, back) of this person as a chibi isometric citizen, " +
              "full body, feet on one baseline, flat #FF00FF background.",
          },
          { inlineData: { mimeType: "image/jpeg", data: selfieBase64 } },
          { inlineData: { mimeType: "image/png", data: styleBase64 } },
        ],
      },
    ],
  });
  const part = result.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
  if (!part) throw new Error("Gemini returned no image");
  return part.inlineData.data as string;
}

export interface Feedback {
  headline: string;
  tip: string;
  mood: "cheer" | "warn" | "console";
}

export async function generateFeedback(eventSummary: string): Promise<Feedback> {
  const result = await callGemini(env.GEMINI_TEXT_MODEL, {
    contents: [
      {
        parts: [
          {
            text:
              `Player event: ${eventSummary}. Give short, kind financial coaching as JSON ` +
              `with keys headline, tip, mood (cheer|warn|console).`,
          },
        ],
      },
    ],
    generationConfig: { responseMimeType: "application/json" },
  });
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no feedback text");
  return JSON.parse(text) as Feedback;
}

export interface NewsStory {
  title: string;
  where: string;
  blurb: string;
  impact: string;
}

export async function generateNewsDigest(eventsSummary: string): Promise<NewsStory[]> {
  const result = await callGemini(env.GEMINI_TEXT_MODEL, {
    contents: [
      {
        parts: [
          {
            text:
              `Summarize these skipped game events into a short newspaper digest as JSON ` +
              `{"stories": [{"title","where","blurb","impact"}]}: ${eventsSummary}`,
          },
        ],
      },
    ],
    generationConfig: { responseMimeType: "application/json" },
  });
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no digest text");
  const parsed = JSON.parse(text);
  return parsed.stories as NewsStory[];
}
