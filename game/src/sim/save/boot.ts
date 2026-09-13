// How the city boots, as small pure pieces main.ts runs in order: ask the
// server who this is (fetchMe, retrying a blip), pick the path (bootPath), and
// place a resumed game (resumePlace). A failed /me is never "no save": that
// would run the intake and overwrite a returning player's profile and save.

import { ApiError } from "../../net/api.ts";
import type { Me } from "./client.ts";

export type MeOutcome = { ok: true; me: Me } | { ok: false };

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
  for (let i = 0; i < o.tries; i++) {
    try {
      return { ok: true, me: await me() };
    } catch (err) {
      const transient = !(err instanceof ApiError) || err.status >= 500;
      if (!transient || i === o.tries - 1) break;
      await sleep(o.delayMs);
    }
  }
  return { ok: false };
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
