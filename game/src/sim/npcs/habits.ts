// Each named NPC's discretionary-spending personality: a small, seeded slice
// of their take-home split across a fixed set of categories by weight, spent
// out in small amounts through the month (not one lump sum) so their Nessie
// statement reads like an actual person, not a payroll ledger. Purely
// additive to their PlayerLife: it never changes their debt strategy or
// emergency-fund plan, and it's capped low enough (game/tests/habits.test.ts)
// that it can't undo either.

import { rngFor } from "../../engine/rng.ts";
import type { JobCategoryId } from "../../data/npcs.ts";
import type { PlayerLife } from "../life/player.ts";

export const SPEND_CATEGORIES = ["Dining out", "Entertainment", "Shopping", "Subscriptions", "Hobby", "Coffee"] as const;

/** Share of monthly take-home spent on discretionary categories, before per-NPC seeding narrows or widens it slightly. */
const BASE_SHARE = 0.03;

export interface HabitWeight {
  name: (typeof SPEND_CATEGORIES)[number];
  weight: number;
}

/**
 * Small, fixed nudges by job category (Task 17's `categoryId`): a correctional
 * officer's steady shift-work income and a university lecturer's thin, uneven
 * adjunct pay should read differently on their statements, without hand-authoring
 * a bespoke spending personality per occupation. Data, not branching logic —
 * only these four categories get an entry; everyone else is unbiased.
 */
const CATEGORY_BIAS: Partial<
  Record<JobCategoryId, { weights?: Partial<Record<(typeof SPEND_CATEGORIES)[number], number>>; shareMultiplier?: number }>
> = {
  protective: { weights: { Subscriptions: 1.2, "Dining out": 0.9 } }, // steady shift income, predictable subscriptions
  education: { shareMultiplier: 0.7 }, // adjunct pay: less discretionary room
  transport: { weights: { Coffee: 1.3 } }, // odd hours, more coffee-shop stops
  healthcare_pro: { weights: { Hobby: 0.85 } },
};

const cache = new Map<string, HabitWeight[]>();

/** Deterministic per-NPC category weights (sum to 1), seeded only by npcId so they never change between runs. */
export function habitProfile(npcId: string, categoryId?: JobCategoryId): HabitWeight[] {
  const key = categoryId ? `${npcId}:${categoryId}` : npcId;
  const hit = cache.get(key);
  if (hit) return hit;
  const rng = rngFor("habits", npcId);
  const raw = SPEND_CATEGORIES.map((name) => ({ name, weight: 0.15 + rng() }));
  const total = raw.reduce((s, w) => s + w.weight, 0);
  const weights = raw.map((w) => ({ name: w.name, weight: w.weight / total }));
  const bias = categoryId ? CATEGORY_BIAS[categoryId]?.weights : undefined;
  if (!bias) {
    cache.set(key, weights);
    return weights;
  }
  const biased = weights.map((w) => ({ name: w.name, weight: w.weight * (bias[w.name] ?? 1) }));
  const biasedTotal = biased.reduce((s, w) => s + w.weight, 0);
  const normalized = biased.map((w) => ({ name: w.name, weight: w.weight / biasedTotal }));
  cache.set(key, normalized);
  return normalized;
}

/** This NPC's share of take-home spent on discretionary categories, seeded so it stays low and stable. */
export function monthlyShare(npcId: string, categoryId?: JobCategoryId): number {
  const rng = rngFor("habits-share", npcId);
  const base = BASE_SHARE * (0.5 + rng()); // BASE_SHARE * 0.5 to BASE_SHARE * 1.5 of monthly take-home
  const multiplier = categoryId ? CATEGORY_BIAS[categoryId]?.shareMultiplier : undefined;
  return multiplier ? base * multiplier : base;
}

/** A one-line personality blurb for the NPC card, naming their top 1-2 categories. */
export function describeHabit(npcId: string): string {
  const top = [...habitProfile(npcId)].sort((a, b) => b.weight - a.weight).slice(0, 2);
  if (top.length === 1 || top[1].weight < top[0].weight * 0.6) return `Spends most on ${top[0].name.toLowerCase()}.`;
  return `Spends most on ${top[0].name.toLowerCase()} and ${top[1].name.toLowerCase()}.`;
}

/**
 * A seeded daily roll per category: on average, each category's spend lands
 * `hitsPerMonthPerCategory` times a month at `budget / hits` per hit, so the
 * expected monthly total matches this NPC's `monthlyShare` exactly while the
 * actual days vary. Call once per NPC per game day (NpcTown.onDay / catchUpLife).
 */
export function applyDailyHabit(life: PlayerLife, npcId: string, day: number, date: Date, categoryId?: JobCategoryId): void {
  const monthlyTakeHome = life.monthlyTakeHome;
  if (!(monthlyTakeHome > 0)) return;
  const budget = monthlyTakeHome * monthlyShare(npcId, categoryId);
  const hitsPerMonthPerCategory = 3; // small, frequent purchases rather than one lump sum
  const dailyProbability = hitsPerMonthPerCategory / 30;
  for (const cat of habitProfile(npcId, categoryId)) {
    const rng = rngFor("habit-roll", npcId, cat.name, day);
    if (rng() >= dailyProbability) continue;
    const amount = Math.round(((budget * cat.weight) / hitsPerMonthPerCategory) * 100) / 100;
    if (amount >= 0.5) life.spend(day, cat.name, amount);
  }
  void date; // kept in the signature: callers already have it (NpcTown.onDay), and a future seasonal weighting hook belongs here, not as a call-site change.
}
