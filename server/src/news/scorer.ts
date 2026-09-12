// server/src/news/scorer.ts
// Turns one recorded event into a newsworthiness score, or null for routine
// events (paychecks, bills, buys, statements) that stay in `events` only —
// the same "notable vs. routine" split server/src/ai/facts.ts's describe()
// already makes, just as a number instead of a line of prose. Pure: no
// database, no network, so a 40-year fast-forward can call this per event
// without slowing down (docs/superpowers/specs/2026-09-12-news-progression-engine-design.md).

export type Category = "personal" | "financial" | "world";
export type Prominence = "front_page" | "section" | "brief";

export interface ScoreInput {
  kind: string;
  payload: Record<string, unknown>;
  /** The player's own net worth just before this event, from player_snapshots. Makes magnitude relative, not absolute. */
  netWorthBaseline: number;
  /** How many times this kind has already happened to this player (this run's root branch). */
  priorCount: number;
}

export interface ScoreResult {
  score: number;
  prominence: Prominence;
  category: Category;
}

/** Static per-kind severity. Kinds not listed here are routine and never scored (mirrors ai/facts.ts's describe()). */
const SEVERITY: Record<string, number> = {
  bankruptcy_eligible: 100,
  repossessed: 85,
  collections: 80,
  default: 75,
  bear_market: 70,
  market_recovered: 65,
  cannot_cover: 60,
  job: 55,
  paid_off: 50,
  penalty_apr: 45,
  // Below PUBLISH_THRESHOLD (40) on its own, unlike every other kind above: a missed payment must
  // clear the bar with rarity + the dollar amount's own magnitude, so a small one at a big net worth
  // can score null (this is the case the design spec's "$500 matters more at $2k than $2M" example
  // is about — every other kind here is already newsworthy at severity alone, missed isn't).
  missed: 25,
  moved: 40,
  late_mark: 35,
  trade: 20,
};

/** Per-kind score floor for events that should always be newsworthy no matter the dollar size. Only bankruptcy_eligible
 *  exists as a typed event today; marriage/divorce/hospitalization/kids/home-purchase belong here once they're modeled
 *  (docs/superpowers/specs/2026-09-12-news-progression-engine-design.md's "explicitly out of scope"). */
const FLOOR: Record<string, number> = {
  bankruptcy_eligible: 100,
};

const CATEGORY: Record<string, Category> = {
  bankruptcy_eligible: "personal",
  job: "personal",
  moved: "personal",
  repossessed: "financial",
  collections: "financial",
  default: "financial",
  cannot_cover: "financial",
  paid_off: "financial",
  penalty_apr: "financial",
  missed: "financial",
  late_mark: "financial",
  trade: "financial",
  bear_market: "world",
  market_recovered: "world",
};

const PUBLISH_THRESHOLD = 40;
const RARITY_BASE = 20;
const MAGNITUDE_SCALE = 15;
const MAGNITUDE_CAP = 30;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The dollar figure that makes this kind's magnitude personal, or 0 for kinds with no natural dollar figure. */
function amountOf(kind: string, payload: Record<string, unknown>): number {
  switch (kind) {
    case "missed":
    case "cannot_cover":
      return num(payload.due);
    case "collections":
      return num(payload.balance);
    case "repossessed":
      return num(payload.deficiency);
    case "bear_market":
      return num(payload.stocks);
    case "market_recovered":
      return num(payload.you);
    case "trade":
      return num(payload.amount);
    case "moved":
      return num(payload.rent) * 12; // a year of the new rent signals how big a move this was
    default:
      return 0;
  }
}

function rarity(priorCount: number): number {
  return RARITY_BASE / (1 + priorCount);
}

/** Log-scaled so a dollar amount matters relative to the player's own net worth, not in absolute terms. */
function magnitude(amount: number, baseline: number): number {
  if (amount <= 0) return 0;
  const ratio = amount / Math.max(1, baseline);
  return Math.min(MAGNITUDE_CAP, Math.log10(1 + ratio) * MAGNITUDE_SCALE);
}

function prominenceOf(total: number): Prominence {
  if (total >= 80) return "front_page";
  if (total >= 55) return "section";
  return "brief";
}

/** True for a kind/payload combination this scorer should even consider; `trade` only counts on the sell side (a buy is routine, matching ai/facts.ts's describe()). */
export function isEligible(kind: string, payload: Record<string, unknown>): boolean {
  if (!(kind in SEVERITY)) return false;
  if (kind === "trade" && payload.side !== "sell") return false;
  return true;
}

/** null means "stays in events only" (below the publish threshold, or not an eligible kind at all). */
export function score(input: ScoreInput): ScoreResult | null {
  if (!isEligible(input.kind, input.payload)) return null;
  const sev = SEVERITY[input.kind];
  const rar = rarity(input.priorCount);
  const mag = magnitude(amountOf(input.kind, input.payload), input.netWorthBaseline);
  let total = sev + rar + mag;
  const floor = FLOOR[input.kind];
  if (floor !== undefined) total = Math.max(total, floor);
  if (total < PUBLISH_THRESHOLD) return null;
  return { score: Math.round(total * 100) / 100, prominence: prominenceOf(total), category: CATEGORY[input.kind] };
}
