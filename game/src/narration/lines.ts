// What Sammy says, and when. The game raises cues (a debt paid off, a market
// crash, a move); each cue has a pool of lines, a reaction the owl plays
// before speaking, the mood it talks in (narration/poses.ts), a priority, and
// a cooldown so a month-long time-lapse doesn't turn into a monologue.
//
// Sammy's voice is a dry English narrator talking plainly: concrete, a little
// deadpan, often with a short re-say at the end ("So, cozy."). Bracketed tags
// ([sighs], [slow], [whispers], [laughs]) are performed by the expressive
// voice and never shown. Hard moments (bankruptcy) stay plain and kind.

import type { LifeEvent } from "../sim/life/player.ts";
import type { OwlAnim } from "../ui/owl.ts";
import { learnLines } from "./learn.ts";
import type { Mood } from "./poses.ts";
import { tourLines } from "./tour.ts";
import { TOURS } from "./tours.ts";

/**
 * The narrator's name, for every name the player sees. The wire and storage ids stay "narrator"
 * (the voice API's `voice: "narrator"`, ELEVENLABS_VOICE_NARRATOR, and the larp.narrator.* keys):
 * renaming them would break saved mute settings and the deployed server's contract.
 */
export const NARRATOR_NAME = "Sammy";

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
  | "fast_forward"
  | "tax_ready";

interface CueDef {
  /** What the owl does before it speaks. */
  anim: OwlAnim;
  /** How the owl carries itself while it talks; delivery tags shift it for a few words. */
  mood: Mood;
  /** Higher cues jump the queue; 90 and up skip the gap between lines. */
  priority: number;
  /** The shortest wait before this cue can speak again, in milliseconds. */
  cooldownMs: number;
  lines: string[];
}

/** Delivery tags Sammy's voice performs; anything else in brackets would be read aloud. */
export const DELIVERY_TAGS = ["sighs", "slow", "whispers", "laughs"] as const;

export const CUES: Record<Cue, CueDef> = {
  arrival: {
    anim: "wave",
    mood: "plain",
    priority: 40,
    cooldownMs: 0,
    lines: [
      "So this is Larp City. Rent is due on the first. [slow] Every first. Sammy checked.",
      "And so the new arrival moved in, with big plans and a budget that was, honestly, more of a vibe.",
      "Welcome to Larp City. I'm Sammy, and I'll be keeping an eye on your money. [whispers] Both eyes, actually.",
    ],
  },
  paid_off: {
    anim: "cheer",
    mood: "warm",
    priority: 70,
    cooldownMs: 30_000,
    lines: [
      "A debt, paid off. Honestly? Kind of impressive. [whispers] Sammy is telling everyone.",
      "Paid in full. The bank is sad about it. Sammy is not. So yeah, good day.",
      "One less debt. [laughs] The player did a little dance. Sammy pretended not to see it.",
    ],
  },
  missed: {
    anim: "proud",
    mood: "dry",
    priority: 80,
    cooldownMs: 90_000,
    lines: [
      "[sighs] A payment was missed. The late fee showed up right on time, though. So at least someone's punctual.",
      "The due date came and went. The payment did not. [slow] Bold strategy.",
      "A bill went unpaid. Sammy is not mad. [slow] Just writing it down. In pen.",
    ],
  },
  collections: {
    anim: "proud",
    mood: "dry",
    priority: 90,
    cooldownMs: 120_000,
    lines: [
      "The debt went to collections. [sighs] They will call. A lot. Like, a lot a lot.",
      "Collections has joined the story. Sammy would like it on record that there were warnings. Several. In writing.",
    ],
  },
  bankruptcy: {
    anim: "think",
    mood: "plain",
    priority: 100,
    cooldownMs: 600_000,
    lines: [
      "[slow] And here the story gets hard. The money ran out. This happens to real people, and it is a chapter, not the ending.",
      "The numbers stopped adding up, so bankruptcy is on the table. [slow] It is a hard call, and plenty of people come back from it.",
    ],
  },
  score_up: {
    anim: "hop",
    mood: "warm",
    priority: 30,
    cooldownMs: 180_000,
    lines: [
      "The credit score went up. Somewhere, a lender just smiled for the first time in years.",
      "Better credit score. Sammy raised an eyebrow. [whispers] Approvingly. Very approvingly.",
    ],
  },
  score_down: {
    anim: "proud",
    mood: "dry",
    priority: 35,
    cooldownMs: 180_000,
    lines: [
      "The credit score dropped. Sammy has decided not to comment. [sighs] Loudly.",
      "Down went the credit score. Quietly. The way bad news kind of just shows up.",
    ],
  },
  home_up: {
    anim: "tip-hat",
    mood: "warm",
    priority: 55,
    cooldownMs: 60_000,
    lines: [
      "A new home. Bigger, brighter, and honestly way more cupboards than anyone needs.",
      "The player moved up in the world. [slow] The couch, sadly, did not get the memo.",
    ],
  },
  home_down: {
    anim: "think",
    mood: "dry",
    priority: 55,
    cooldownMs: 60_000,
    lines: [
      "The player downsized. Sammy prefers the word cozy. So, cozy.",
      "A smaller place now. [sighs] Fewer rooms to clean, Sammy pointed out. Helpfully.",
    ],
  },
  moved: {
    anim: "fly",
    mood: "plain",
    priority: 60,
    cooldownMs: 0,
    lines: [
      "A new state, a new rent, same player. Sammy hopes at least one of those is an upgrade.",
      "And so the player packed up their whole life and moved. The bills, loyal to the end, came too.",
    ],
  },
  crash: {
    anim: "think",
    mood: "dry",
    priority: 50,
    cooldownMs: 45_000,
    lines: [
      "The market fell. [slow] Portfolios everywhere observed a moment of silence.",
      "Stocks tumbled. Selling in a panic is also a decision, Sammy notes. Usually the wrong one.",
    ],
  },
  boom: {
    anim: "cheer",
    mood: "sly",
    priority: 50,
    cooldownMs: 45_000,
    lines: [
      "The market soared and everyone felt like a genius. [whispers] Not everyone was a genius.",
      "Stocks are up. Sammy suspects this will be remembered as skill. [laughs] It was mostly timing.",
    ],
  },
  disaster: {
    anim: "think",
    mood: "plain",
    priority: 45,
    cooldownMs: 45_000,
    lines: [
      "Disaster hit the city. [slow] This, Sammy notes, is exactly what emergency funds are for. Exactly this.",
      "The weather turned on Larp City. Suddenly, insurance didn't seem so boring, right?",
    ],
  },
  fast_forward: {
    anim: "magic",
    mood: "plain",
    priority: 65,
    cooldownMs: 0,
    lines: [
      "Time rushed forward. The player blinked and years went by. Money, as always, had been busy.",
      "And so the years kind of just happened. Slowly at first, then all at once.",
    ],
  },
  // Flags the deadline once, without pausing time (docs/superpowers/specs/2026-09-12-tax-filing-design.md).
  tax_ready: {
    anim: "read",
    mood: "plain",
    priority: 60,
    cooldownMs: 0,
    lines: [
      "Tax season. Your return is ready in the Taxes app, and it's due April 15. [slow] Sammy has circled the date. Twice.",
      "The tax return is ready. See the little File badge on the Taxes app? April 15 is the deadline. [whispers] The IRS is not known for its sense of humor.",
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
    // The market: a bear market (the Money window opens on the crash decision) and its return to the old high.
    else if (e.type === "bear_market") consider("crash");
    else if (e.type === "market_recovered") consider("boom");
    // A return that filed itself the same day (the tutorial was passed) needs no reminder.
    else if (e.type === "tax_ready" && !events.some((f) => f.type === "tax_filed" && f.auto)) consider("tax_ready");
    else if (e.type === "score_change") {
      if (e.to - e.from >= SCORE_STEP) consider("score_up");
      else if (e.from - e.to >= SCORE_STEP) consider("score_down");
    }
  }
  return best;
}

/** Every fixed line, cues and tours, for pre-generating the voice. */
export function allLines(): string[] {
  return [...Object.values(CUES).flatMap((c) => c.lines), ...TOURS.flatMap((t) => tourLines(t)), ...learnLines()];
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

/** Sammy's greeting for a returning player: their job (from the intake) and the game date they're back on. */
export function welcomeBackLine(job: string | null, date: Date): string {
  const t = job?.trim() ?? "";
  // "Nurse" reads "nurse" mid-sentence, but "CEO at AWS" keeps its capitals.
  const plain = t.length > 1 && t[1] === t[1].toLowerCase() && t[1] !== t[1].toUpperCase();
  const who = t ? `, ${plain ? t[0].toLowerCase() + t.slice(1) : t}` : "";
  const when = date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return `Welcome back${who}. It's ${when}, and your money is right where you left it.`;
}
