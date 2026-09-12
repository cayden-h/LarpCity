// server/src/adapters/elevenlabs-webhook.ts
// ElevenLabs post-call webhook: signature check and payload parsing.
// We verify here instead of with the SDK's webhooks.constructEvent, which
// compares signatures with !== and accepts timestamps from the future.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const TOLERANCE_SECONDS = 30 * 60;

/**
 * Checks an `elevenlabs-signature` header: `t=<unix seconds>,v0=<hex HMAC-SHA256
 * of "<t>.<raw body>">`, with the timestamp within 30 minutes of now.
 */
export function verifyElevenLabsSignature(
  header: string,
  rawBody: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const parts = new Map<string, string>();
  for (const pair of header.split(",")) {
    const eq = pair.indexOf("=");
    if (eq > 0) parts.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  const t = parts.get("t");
  const v0 = parts.get("v0");
  if (!t || !v0 || !/^\d+$/.test(t) || !/^[0-9a-f]+$/i.test(v0)) return false;
  if (Math.abs(nowSeconds - Number(t)) > TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  const actual = Buffer.from(v0, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const postCallSchema = z.object({
  type: z.literal("post_call_transcription"),
  data: z.object({
    conversation_id: z.string().min(1),
    agent_id: z.string().min(1),
    status: z.string().optional(),
    analysis: z
      .object({
        data_collection_results: z.record(z.object({ value: z.unknown() }).passthrough()).nullish(),
        transcript_summary: z.string().nullish(),
      })
      .nullish(),
  }),
});

export interface PostCall {
  conversationId: string;
  agentId: string;
  status: string | null;
  /** Data collection field id to the value the agent extracted (e.g. salary: 85000). */
  answers: Record<string, unknown>;
  summary: string | null;
}

/** The fields we keep from a post_call_transcription event, or null for any other event. */
export function parsePostCall(event: unknown): PostCall | null {
  const parsed = postCallSchema.safeParse(event);
  if (!parsed.success) return null;
  const { data } = parsed.data;
  const results = data.analysis?.data_collection_results ?? {};
  return {
    conversationId: data.conversation_id,
    agentId: data.agent_id,
    status: data.status ?? null,
    answers: Object.fromEntries(Object.entries(results).map(([id, r]) => [id, r.value ?? null])),
    summary: data.analysis?.transcript_summary ?? null,
  };
}
