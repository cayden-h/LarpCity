// Asks the coach for the recovery lesson (POST /api/feedback, trigger "recovery"; server/src/routes/ai.ts).
// The server writes it from the run's own data in Tiger Data, so the desk sends only the run and the day.
// Each attempt carries a timeout, since the server may try two Gemini models for 15 seconds each; a 409
// (the recovery isn't stored yet) is retried once after a short wait. Null when the server still can't
// answer, including any other error; the desk keeps its own lesson text.

import { apiFetch, ApiError } from "./api.ts";

export type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

export interface CoachAnswer {
  headline: string;
  tip: string;
  mood: "cheer" | "warn" | "console";
  source: "gemini" | "template";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchRecoveryLesson(runId: string, day: number, api: Api = apiFetch, o: { retryMs?: number; timeoutMs?: number } = {}): Promise<CoachAnswer | null> {
  const attempt = () => api<CoachAnswer>("/feedback", { method: "POST", body: JSON.stringify({ runId, trigger: "recovery", day }), signal: AbortSignal.timeout(o.timeoutMs ?? 40_000) });
  try {
    return await attempt();
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      await sleep(o.retryMs ?? 3_000);
      try {
        return await attempt();
      } catch (retryErr) {
        console.warn("Recovery lesson unavailable:", retryErr instanceof Error ? retryErr.message : String(retryErr));
        return null;
      }
    }
    console.warn("Recovery lesson unavailable:", err instanceof Error ? err.message : String(err));
    return null;
  }
}
