// Asks the coach for the recovery lesson (POST /api/feedback, trigger "recovery"; server/src/routes/ai.ts).
// The server writes it from the run's own data in Tiger Data, so the desk sends only the run and the day.
// Null when the server can't answer (including 409 before that day's recovery is stored); the desk keeps its own lesson text.

import { apiFetch } from "./api.ts";

export type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

export interface CoachAnswer {
  headline: string;
  tip: string;
  mood: "cheer" | "warn" | "console";
  source: "gemini" | "template";
}

export async function fetchRecoveryLesson(runId: string, day: number, api: Api = apiFetch): Promise<CoachAnswer | null> {
  try {
    return await api<CoachAnswer>("/feedback", { method: "POST", body: JSON.stringify({ runId, trigger: "recovery", day }) });
  } catch {
    return null;
  }
}
