// What the city remembers of the Money desk, trimmed on a rewind the same way
// the desk trims its own lists (debt-demo/main.ts, host.onRewind), so a save
// taken right after going back doesn't bring the discarded days back.

import type { DeskState } from "./types.ts";

/** The desk as it stood on the morning of `day`: anything from `day` on is dropped. */
export function trimDesk(desk: DeskState, day: number): DeskState {
  const recovery = desk.recovery && desk.recovery.day < day ? desk.recovery : null;
  return {
    feed: desk.feed.filter((f) => f.day < day),
    bank: desk.bank.filter((t) => t.day < day),
    crash: desk.crash && desk.crash.day < day ? desk.crash : null,
    recovery,
    // The recap is the recovery card's lesson, so it goes with the recovery.
    recap: recovery ? desk.recap : null,
  };
}
