// server/src/adapters/gemini.ts
// Google Gemini client (generateContent), probed against the live API on 2026-09-12:
// - The key goes in the x-goog-api-key header, so it never lands in a URL or a log.
// - Structured output: generationConfig.responseMimeType "application/json" plus
//   responseJsonSchema returns the JSON as the text part.
// - Gemini 3.x models think first; thought parts are skipped, and maxOutputTokens
//   counts the thinking, so a small limit cuts the answer off (finishReason MAX_TOKENS).
// - gemini-3.8-flash often answers 503 "high demand", and now and then an empty 404
//   from Google's front end: both mean "try the next model". 429 means this key is out
//   of quota: try the next key. gemini-2.5-flash is closed to new users.
// - A busy gemini-3.8-flash can also just hang, so each try gets 15 seconds before the
//   next model; gemini-3.6-flash answers a feedback prompt in about 4 to 14 seconds.

import { logger } from "../logger.js";

export class GeminiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
  }
}

export interface InlineImage {
  mimeType: string;
  /** Base64. */
  data: string;
}

interface Part {
  text?: string;
  thought?: boolean;
  inlineData?: InlineImage;
}

interface GenerateResponse {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
}

export interface GeminiOptions {
  keys: string[];
  /** Text models in order of preference; the next one is tried when one is busy. */
  models: string[];
  baseUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

/** What the coach needs from a model; the tests pass a fake. */
export interface JsonModel {
  json(prompt: string, schema: object, o?: { maxOutputTokens?: number }): Promise<{ value: unknown; model: string }>;
}

export class Gemini implements JsonModel {
  private readonly keys: string[];
  private readonly models: string[];
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  /** The key to start with; moves on after each success so quota spreads across keys. */
  private nextKey = 0;

  constructor(o: GeminiOptions) {
    this.keys = o.keys;
    this.models = o.models;
    this.baseUrl = (o.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
    this.fetchFn = o.fetchFn ?? ((...a) => fetch(...a));
    this.timeoutMs = o.timeoutMs ?? 15_000;
  }

  /** A JSON answer matching `schema` (JSON Schema), parsed but not yet validated. */
  async json(prompt: string, schema: object, o: { maxOutputTokens?: number } = {}): Promise<{ value: unknown; model: string }> {
    const { parts, model } = await this.generate(this.models, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema, maxOutputTokens: o.maxOutputTokens ?? 4096 },
    });
    const text = parts
      .filter((p) => !p.thought && p.text)
      .map((p) => p.text)
      .join("");
    try {
      return { value: JSON.parse(text), model };
    } catch {
      throw new GeminiError(502, `Gemini ${model} returned text that isn't JSON`);
    }
  }

  /** An image from an image model, given a prompt and reference images; returns base64. */
  async image(model: string, prompt: string, images: InlineImage[]): Promise<string> {
    const { parts } = await this.generate([model], {
      contents: [{ role: "user", parts: [{ text: prompt }, ...images.map((inlineData) => ({ inlineData }))] }],
    });
    const image = parts.find((p) => p.inlineData)?.inlineData;
    if (!image) throw new GeminiError(502, "Gemini returned no image");
    return image.data;
  }

  private async generate(models: string[], body: unknown): Promise<{ parts: Part[]; model: string }> {
    if (!this.keys.length) throw new GeminiError(503, "No Gemini keys configured");
    let last: GeminiError | null = null;
    for (const model of models) {
      if (last) logger.warn({ message: last.message }, "gemini: trying the next model");
      for (let tried = 0; tried < this.keys.length; tried++) {
        const k = (this.nextKey + tried) % this.keys.length;
        let res: Response;
        try {
          res = await this.fetchFn(`${this.baseUrl}/models/${model}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": this.keys[k] },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.timeoutMs),
          });
        } catch (e) {
          last = new GeminiError(504, `Gemini ${model} didn't answer: ${e instanceof Error ? e.name : String(e)}`);
          break; // a slow model: try the next one
        }
        if (res.ok) {
          this.nextKey = (k + 1) % this.keys.length;
          const candidate = ((await res.json()) as GenerateResponse).candidates?.[0];
          if (candidate?.finishReason && candidate.finishReason !== "STOP") {
            last = new GeminiError(502, `Gemini ${model} stopped early: ${candidate.finishReason}`);
            break;
          }
          return { parts: candidate?.content?.parts ?? [], model };
        }
        const text = await res.text();
        last = new GeminiError(res.status, `Gemini ${model} ${res.status}: ${text.slice(0, 200)}`);
        if (res.status === 429) continue; // this key is out of quota
        if (res.status >= 500 || (res.status === 404 && !text)) break; // the model is busy
        throw last; // a bad request won't get better on another key or model
      }
    }
    throw last ?? new GeminiError(503, "Gemini is unavailable");
  }
}
