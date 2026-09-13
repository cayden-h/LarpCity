// Sammy's Learn walkthrough, the script: what he says after the player presses
// Learn on the title screen (ui/title.ts), in the order the team's notes give it.
// The goal, the phone, milestones and where you live, time and skips, what
// stops a skip, his tips, then off to set up a life and pick goals.

import type { OwlAnim } from "../ui/owl.ts";
import type { Mood } from "./poses.ts";

export interface LearnStep {
  line: string;
  /** What Sammy does before he speaks. */
  anim: OwlAnim;
  mood: Mood;
}

export const LEARN: readonly LearnStep[] = [
  { anim: "wave", mood: "warm", line: "Hello. I'm Sammy. Welcome to Larp City. You're twenty-two, fresh out of college, with a first job and a pile of student debt." },
  { anim: "proud", mood: "dry", line: "The goal is simple. Retire. [slow] Preferably before sixty-five, and preferably not broke. You'll learn a few money tricks on the way." },
  { anim: "type", mood: "plain", line: "Your phone runs everything. Money, stocks, goals, the map, and a calendar where every day actually happens." },
  { anim: "think", mood: "dry", line: "Along the way: a house, a wedding, paying off those loans. Where you live matters. San Francisco rent is [sighs] a lot." },
  { anim: "step", mood: "plain", line: "Time moves a day at a time. Speed it up, or skip straight to the next thing that needs you." },
  { anim: "magic", mood: "sly", line: "Skips stop for the big stuff. A market crash, a car breakdown, a trip to the hospital, a divorce. I'll explain what happened. Calmly." },
  { anim: "tip-hat", mood: "sly", line: "I'll pop in with tips when you reach a goal, go broke, or your stocks swing. [whispers] Mostly: diversify." },
  { anim: "cheer", mood: "warm", line: "Your goals are set: retire by sixty-five, get married, be debt-free by forty-five, and buy a house. Now, who's moving in?" },
];

export const learnLines = (): string[] => LEARN.map((s) => s.line);

/**
 * The first and last lines, rewritten for the default life, aren't in the narration pack yet:
 * ElevenLabs is out of credits until 2026-10-12, so until then they read silently. Rebuild the
 * pack for just these two and empty this; tests/narration-pack.test.ts fails once one has a clip.
 */
export const AWAITING_VOICE: ReadonlySet<string> = new Set([LEARN[0].line, LEARN[LEARN.length - 1].line]);
