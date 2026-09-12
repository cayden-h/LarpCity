// How the owl emotes while it talks and rests. Only the motion strips (a wave,
// a cheer, a hat tip) are meant to play in order; the talking and resting
// strips are sets of poses and expressions. So the owl holds a pose, then picks another that fits the
// mood of the words it's saying, instead of marching through the sheet.
// Which frame shows what was read off the sheets in game/art/owl.

import type { OwlAnim } from "../ui/owl.ts";

export interface Pose {
  anim: OwlAnim;
  frame: number;
}

/** plain: explaining; dry: deadpan and still; sly: a wink and an aside; warm: a grin. */
export type Mood = "plain" | "dry" | "sly" | "warm";

/**
 * Frames by expression, for the strips that are poses rather than motions;
 * each strip's frames appear exactly once. idle and talk are the 16-frame
 * sheets (game/art/owl/v2); think and proud are still the first set's 8.
 */
export const EXPRESSIONS = {
  idle: { calm: [0, 1, 2, 3, 7, 8, 9, 10, 11, 12, 14, 15], blink: [4, 5], wink: [6, 13] },
  talk: { open: [0, 1, 3, 6, 7, 10, 15], point: [4, 11, 14], aside: [8, 12], chest: [5], blink: [9], wink: [2, 13] },
  think: { calm: [0, 2, 4, 5, 6, 7, 8, 9, 12, 14, 15], squint: [1, 3, 11], wink: [10, 13] },
  proud: { calm: [4, 5, 6, 7, 11, 12, 13, 15], smug: [0, 1, 3, 8], wink: [2, 9, 10, 14] },
} as const;

const talk = (frames: readonly number[]): Pose[] => frames.map((frame) => ({ anim: "talk", frame }));
const idle = (frames: readonly number[]): Pose[] => frames.map((frame) => ({ anim: "idle", frame }));

/**
 * Talking poses by mood: plain explains with its wings, dry stands still and
 * deadpan, sly makes an aside or winks, warm opens up. They all come from the
 * idle and talk sheets, which share one costume, so a sentence never
 * flickers between vests.
 */
export const MOOD_POSES: Record<Mood, Pose[]> = {
  plain: [...talk(EXPRESSIONS.talk.open), ...talk([4, 14])],
  dry: [...talk([0, 5, 12]), ...idle([0, 3, 8, 11])],
  sly: [...talk(EXPRESSIONS.talk.aside), ...talk(EXPRESSIONS.talk.wink), ...idle([4, 6, 13])],
  warm: [...talk(EXPRESSIONS.talk.chest), ...talk(EXPRESSIONS.talk.blink), ...talk([10, 11, 14, 15])],
};

const TAG_MOOD: Record<string, Mood> = { sighs: "dry", slow: "dry", whispers: "sly", laughs: "warm" };
/** A delivery tag colours about the next four or five words (ElevenLabs' guidance for Expressive Mode). */
export const TAG_REACH = 5;

/** Hold times in milliseconds: long enough to read as a pose, short enough to feel alive. */
export const HOLD = {
  minTalk: 320,
  maxTalk: 1_300,
  blink: 120,
  wink: 380,
  restMin: 2_200,
  restMax: 5_200,
  winkChance: 0.15,
  /** A held reaction (think, proud) before the owl starts talking. */
  emote: 1_300,
} as const;

/** The mood of each spoken word in a line: the cue's base mood, shifted by a delivery tag for the next few words. */
export function wordMoods(line: string, base: Mood): Mood[] {
  const moods: Mood[] = [];
  let mood = base;
  let left = 0;
  for (const token of line.split(/\s+/).filter(Boolean)) {
    const tag = token.match(/^\[([^\]]+)\]$/);
    if (tag) {
      mood = TAG_MOOD[tag[1]] ?? base;
      left = TAG_REACH;
      continue;
    }
    moods.push(left > 0 ? mood : base);
    if (left > 0) left--;
  }
  return moods;
}

/** A pose for `mood`, never the one showing now. `random` is for tests. */
export function pickPose(mood: Mood, last: Pose | null, random: () => number = Math.random): Pose {
  const pool = MOOD_POSES[mood];
  const options = last ? pool.filter((p) => p.anim !== last.anim || p.frame !== last.frame) : pool;
  const from = options.length ? options : pool;
  return from[Math.min(from.length - 1, Math.floor(random() * from.length))];
}
