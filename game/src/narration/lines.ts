// What the owl says, and when. The game raises cues (a debt paid off, a market
// crash, a move); each cue has a pool of dry, third-person lines, a reaction
// the owl plays before speaking, a priority, and a cooldown so a month-long
// time-lapse doesn't turn into a monologue. Bracketed tags ([sighs], [slow],
// [whispers], [laughs]) are performed by the narrator's expressive voice and
// never shown. Hard moments (bankruptcy) are handled plainly and kindly.

import type { LifeEvent } from "../sim/life/player.ts";
import type { OwlAnim } from "../ui/owl.ts";

export type Cue =
  | "arrival"
  | "paid_off"
  | "missed"
  | "collections"
  | "bankruptcy"
  | "score_up"
  | "score_down"
  | "home_up"
  | "home_down"
  | "moved"
  | "crash"
  | "boom"
  | "disaster"
  | "fast_forward";

interface CueDef {
  /** What the owl does before it speaks. */
  anim: OwlAnim;
  /** Higher cues jump the queue; 90 and up skip the gap between lines. */
  priority: number;
  /** The shortest wait before this cue can speak again, in milliseconds. */
  cooldownMs: number;
  lines: string[];
}

/** Delivery tags the narrator's voice performs; anything else in brackets would be read aloud. */
export const DELIVERY_TAGS = ["sighs", "slow", "whispers", "laughs"] as const;

export const CUES: Record<Cue, CueDef> = {
  arrival: {
    anim: "wave",
    priority: 40,
    cooldownMs: 0,
    lines: [
      "And so the new arrival stepped into Larp City, full of plans. Some of them were even about money.",
      "This is Larp City. [slow] Rent is due on the first. The Narrator felt it was only fair to mention it.",
      "The new arrival looked out over the city and decided, quite firmly, to be responsible. It was a lovely thought.",
    ],
  },
  paid_off: {
    anim: "cheer",
    priority: 70,
    cooldownMs: 30_000,
    lines: [
      "And just like that, a debt was paid off. The Narrator was genuinely impressed. [whispers] Don't let it go to your head.",
      "One debt, gone. The player stood a little taller. The bank stood a little shorter.",
      "Paid in full. [slow] The Narrator made a note of it, in case it never happens again.",
    ],
  },
  missed: {
    anim: "proud",
    priority: 80,
    cooldownMs: 90_000,
    lines: [
      "[sighs] A payment was missed. The late fee arrived right on time, as late fees always do.",
      "The due date came. The payment did not. The late fee, of course, was right on schedule.",
      "A bill went unpaid. The Narrator is not angry. [slow] Just disappointed.",
    ],
  },
  collections: {
    anim: "proud",
    priority: 90,
    cooldownMs: 120_000,
    lines: [
      "The debt has been handed to a collections agency. [sighs] They are, the Narrator is told, very persistent.",
      "Collections has entered the story. The Narrator would like it on record that there were warnings. Several.",
    ],
  },
  bankruptcy: {
    anim: "think",
    priority: 100,
    cooldownMs: 600_000,
    lines: [
      "[slow] And here the story takes a hard turn. The money has run out. It happens to real people, and it is a chapter, not the ending.",
      "The numbers no longer add up, and bankruptcy is on the table now. [slow] It is a hard choice, and plenty of people come back from it.",
    ],
  },
  score_up: {
    anim: "hop",
    priority: 30,
    cooldownMs: 180_000,
    lines: [
      "The credit score went up. Somewhere, a lender smiled for the first time in years.",
      "A better credit score. The Narrator raised an eyebrow. [whispers] Approvingly.",
    ],
  },
  score_down: {
    anim: "proud",
    priority: 35,
    cooldownMs: 180_000,
    lines: [
      "The credit score dropped. The Narrator has decided not to comment. [sighs] Loudly.",
      "Down went the credit score, quietly, the way bad news prefers to travel.",
    ],
  },
  home_up: {
    anim: "tip-hat",
    priority: 55,
    cooldownMs: 60_000,
    lines: [
      "A new home. Bigger, brighter, and with considerably more cupboards. The player had arrived.",
      "The player moved up in the world. [slow] The furniture did not come with it.",
    ],
  },
  home_down: {
    anim: "think",
    priority: 55,
    cooldownMs: 60_000,
    lines: [
      "The player downsized. The Narrator prefers to call it cozy.",
      "A smaller home now. [sighs] Fewer rooms to clean, the Narrator pointed out, helpfully.",
    ],
  },
  moved: {
    anim: "fly",
    priority: 60,
    cooldownMs: 0,
    lines: [
      "A new state, a new rent, and the same player. The Narrator hopes at least one of those is an improvement.",
      "And so the player packed up their whole life and moved. The bills, loyal to the end, followed.",
    ],
  },
  crash: {
    anim: "think",
    priority: 50,
    cooldownMs: 45_000,
    lines: [
      "The market fell. [slow] Portfolios everywhere observed a moment of silence.",
      "Stocks tumbled. Selling in a panic, the Narrator would note, is also a decision. Usually the wrong one.",
    ],
  },
  boom: {
    anim: "cheer",
    priority: 50,
    cooldownMs: 45_000,
    lines: [
      "The market soared, and everyone felt like a genius. [whispers] Not everyone was a genius.",
      "Stocks are up. The Narrator suspects this will be remembered as skill.",
    ],
  },
  disaster: {
    anim: "think",
    priority: 45,
    cooldownMs: 45_000,
    lines: [
      "Disaster struck the city. [slow] This, the Narrator notes, is what emergency funds are for.",
      "The weather turned on Larp City. Insurance suddenly seemed far less boring.",
    ],
  },
  fast_forward: {
    anim: "magic",
    priority: 65,
    cooldownMs: 0,
    lines: [
      "Time rushed forward. The player blinked, and years had passed. Money, as always, had been busy.",
      "And so the years went by, the way years do: slowly at first, then all at once.",
    ],
  },
};

/** A credit score move smaller than this isn't worth a line. */
export const SCORE_STEP = 15;
/** Lines below this priority wait this long after the previous line. */
const MIN_GAP_MS = 8_000;
const URGENT = 90;

/** The most important cue among one day's life events, or null. */
export function cueForEvents(events: readonly LifeEvent[]): Cue | null {
  let best: Cue | null = null;
  const consider = (cue: Cue) => {
    if (best === null || CUES[cue].priority > CUES[best].priority) best = cue;
  };
  for (const e of events) {
    if (e.type === "bankruptcy_eligible") consider("bankruptcy");
    else if (e.type === "collections") consider("collections");
    else if (e.type === "missed") consider("missed");
    else if (e.type === "paid_off") consider("paid_off");
    else if (e.type === "moved") consider("moved");
    else if (e.type === "score_change") {
      if (e.to - e.from >= SCORE_STEP) consider("score_up");
      else if (e.from - e.to >= SCORE_STEP) consider("score_down");
    }
  }
  return best;
}

/** A line for `cue`, never the same as `last`. `random` is for tests. */
export function pickLine(cue: Cue, last?: string, random: () => number = Math.random): string {
  const pool = CUES[cue].lines;
  const options = pool.length > 1 ? pool.filter((l) => l !== last) : pool;
  return options[Math.min(options.length - 1, Math.floor(random() * options.length))];
}

/** A line as shown in the bubble: delivery tags removed and spacing tidied. */
export function stripTags(line: string): string {
  return line
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Decides which cues get spoken: a gap between lines and a cooldown per cue; urgent cues skip the gap. */
export class CueGate {
  private lastAt = Number.NEGATIVE_INFINITY;
  private readonly lastByCue = new Map<Cue, number>();

  allow(cue: Cue, now: number): boolean {
    const def = CUES[cue];
    if (def.priority < URGENT && now - this.lastAt < MIN_GAP_MS) return false;
    if (now - (this.lastByCue.get(cue) ?? Number.NEGATIVE_INFINITY) < def.cooldownMs) return false;
    this.lastAt = now;
    this.lastByCue.set(cue, now);
    return true;
  }
}
