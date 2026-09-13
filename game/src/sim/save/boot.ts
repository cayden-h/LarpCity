// How the city boots, as small pure pieces main.ts runs in order: ask the
// server who this is (fetchMe, retrying a blip), pick the path (bootPath), and
// place a resumed game (resumePlace). A failed /me is never "no save": that
// would run the intake and overwrite a returning player's profile and save.

import { ApiError } from "../../net/api.ts";
import type { Me } from "./client.ts";

/** A failed /me carries the server's last answer (a status), or none when the server was never reached. */
export type MeOutcome = { ok: true; me: Me } | { ok: false; status?: number };

/** resume: load the save. fromProfile: build a life from the profile. intake: ask first.
 *  offline: the server can't be reached, so nothing may be read or overwritten. */
export type BootPath = "resume" | "fromProfile" | "intake" | "offline";

export function bootPath(me: MeOutcome, url: { intake: boolean }): BootPath {
  if (!me.ok) return "offline";
  if (url.intake) return "intake";
  if (me.me.save) return "resume";
  if (me.me.profile) return "fromProfile";
  return "intake";
}

/** Asks /me, retrying network failures and 5xx answers; any other answer is final. */
export async function fetchMe(
  me: () => Promise<Me>,
  o: { tries: number; delayMs: number; sleep?: (ms: number) => Promise<void> },
): Promise<MeOutcome> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let status: number | undefined;
  for (let i = 0; i < o.tries; i++) {
    try {
      return { ok: true, me: await me() };
    } catch (err) {
      status = err instanceof ApiError ? err.status : undefined;
      const transient = !(err instanceof ApiError) || err.status >= 500;
      if (!transient || i === o.tries - 1) break;
      await sleep(o.delayMs);
    }
  }
  return status === undefined ? { ok: false } : { ok: false, status };
}

/** What the boot notice says when /me failed: a 4xx is the server refusing this save, not the server being unreachable. */
export function offlineNotice(me: MeOutcome): { title: string; body: string } {
  const status = me.ok ? undefined : me.status;
  if (status !== undefined && status >= 400 && status < 500) {
    return {
      title: "Larp City couldn't open your save",
      body: `The server answered but wouldn't open your saved life (error ${status}). Nothing was changed. Try again, or play a new life that won't be saved.`,
    };
  }
  return {
    title: "Can't reach Larp City's server",
    body: "Your saved life is safe, but it can't be loaded right now. Try again in a moment, or play a new life that won't be saved.",
  };
}

/** A resumed game stays in the state it was saved in (its rent depends on it). The saved hash only
 *  picks a city inside that state; anything else shows the state itself. Null when the state is unknown. */
export function resumePlace<S extends { abbr: string }>(
  savedAbbr: string | undefined,
  hash: string,
  states: S[],
  lookup: (hash: string) => S | undefined,
): { home: S; city: S } | null {
  const home = states.find((s) => s.abbr === savedAbbr);
  if (!home) return null;
  const picked = hash ? lookup(hash) : undefined;
  return { home, city: picked && picked.abbr === home.abbr ? picked : home };
}
