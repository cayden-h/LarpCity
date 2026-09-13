// Sammy's Learn walkthrough, the script: what he says after the player presses
// Learn on the title screen (ui/title.ts), in the order the team's notes give it.
// The goal, the phone, milestones and where you live, time and skips, what
// stops a skip, his tips, then off to set up a life and pick goals. Every line
// is in the narration pack, so the walkthrough never needs live TTS.

import type { OwlAnim } from "../ui/owl.ts";
import type { Mood } from "./poses.ts";

export interface LearnStep {
  line: string;
  /** What Sammy does before he speaks. */
  anim: OwlAnim;
  mood: Mood;
}

export const LEARN: readonly LearnStep[] = [
  { anim: "wave", mood: "warm", line: "Hello. I'm Sammy. This is Larp City, and the life in it is yours: your salary, your rent, your debt." },
  { anim: "proud", mood: "dry", line: "The goal is simple. Retire. [slow] Preferably before sixty-five, and preferably not broke. You'll learn a few money tricks on the way." },
  { anim: "type", mood: "plain", line: "Your phone runs everything. Money, stocks, goals, the map, and a calendar where every day actually happens." },
  { anim: "think", mood: "dry", line: "Along the way: a house, a wedding, paying off those loans. Where you live matters. San Francisco rent is [sighs] a lot." },
  { anim: "step", mood: "plain", line: "Time moves a day at a time. Speed it up, or skip straight to the next thing that needs you." },
  { anim: "magic", mood: "sly", line: "Skips stop for the big stuff. A market crash, a car breakdown, a trip to the hospital, a divorce. I'll explain what happened. Calmly." },
  { anim: "tip-hat", mood: "sly", line: "I'll pop in with tips when you reach a goal, go broke, or your stocks swing. [whispers] Mostly: diversify." },
  { anim: "cheer", mood: "warm", line: "First, let's set up your life and pick your goals. They're permanent, so choose like a grown-up." },
];

export const learnLines = (): string[] => LEARN.map((s) => s.line);
