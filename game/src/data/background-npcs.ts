// ~38 procedurally generated background NPCs: real, seeded financial lives
// like the primary roster (data/npcs.ts), but they never become live Nessie
// customers (server/src/mirror.ts routes them to the fallback-only mirror,
// see the server tasks in GameEnginePlan.md Part 2) because Nessie's shared
// sandbox allows only 12 undeletable customers total, already spent on the
// primary roster. Generated once from fixed archetypes rather than
// hand-authored, so growing the roster later is a one-line count change.

import { hashKeys, pick, pickWeighted, range, rngFor } from "../engine/rng.ts";
import type { JobCategoryId, JobLevel, NpcDebtKind, NpcProfile } from "./npcs.ts";
import { NPCS } from "./npcs.ts";

export const BACKGROUND_NPC_COUNT = 38;

const FIRST = ["Luis", "Aisha", "Wei", "Hannah2", "Omar", "Grace2", "Mateo", "Zoe", "Tariq2", "Elena", "Kwame", "Lily", "Andre", "Nadia", "Sam", "Rosa", "Jamal", "Mei", "Carlos", "Ava", "Dev", "Fatima", "Noah", "Imani"];
const LAST = ["Kim", "Smith", "Chen", "Williams", "Brown", "Ali", "Lopez", "Davis", "Singh", "Rossi", "Jackson", "Moore", "Cohen", "Reyes", "Baker", "Diaz"];
const JOBS = ["line cook", "retail associate", "truck driver", "graphic designer", "mechanic", "real estate agent", "bus driver", "welder", "dental hygienist", "warehouse associate", "landscaper", "security guard"];

interface Archetype {
  name: string;
  payRange: [number, number];
  debt: { kind: NpcDebtKind; aprRange: [number, number]; balanceShare: [number, number] } | null;
  strategy: NpcProfile["strategy"];
  savingsMonths: [number, number];
  /**
   * Approximate: the shared `JOBS` pool spans multiple real categories, so a
   * single categoryId/level per archetype is a simplification, not a
   * financial-literacy lesson like the primary NPCs' tags. Closest fit only.
   */
  categoryId: JobCategoryId;
  level: JobLevel;
  story: (job: string) => string;
}

const ARCHETYPES: Archetype[] = [
  {
    name: "tight-budget-card",
    payRange: [2_200, 3_400],
    debt: { kind: "card", aprRange: [0.22, 0.28], balanceShare: [0.7, 1.1] },
    strategy: "minimums",
    savingsMonths: [0, 0.3],
    categoryId: "sales_retail",
    level: "entry",
    story: (job) => `Works as a ${job} and carries a card balance most months don't quite clear.`,
  },
  {
    name: "steady-saver",
    payRange: [3_500, 5_500],
    debt: null,
    strategy: "avalanche",
    savingsMonths: [2, 5],
    categoryId: "business_finance",
    level: "mid",
    story: (job) => `A ${job} with no debt, slowly building a real cushion.`,
  },
  {
    name: "auto-loan",
    payRange: [2_800, 4_200],
    debt: { kind: "auto", aprRange: [0.07, 0.15], balanceShare: [4, 7] },
    strategy: "minimums",
    savingsMonths: [0.2, 1],
    categoryId: "transport",
    level: "entry",
    story: (job) => `Financed the car this ${job} needs for work, still a few years of payments left.`,
  },
  {
    name: "high-earner-card",
    payRange: [6_000, 9_000],
    debt: { kind: "card", aprRange: [0.2, 0.25], balanceShare: [1.5, 3] },
    strategy: "minimums",
    savingsMonths: [1, 3],
    categoryId: "tech",
    level: "senior",
    story: (job) => `A well-paid ${job} whose card balance grew quietly alongside the raises.`,
  },
];

function buildProfile(id: string, first: string, last: string, seed: string): NpcProfile {
  const rng = rngFor("background-npc", seed);
  const archetype = pickWeighted(rng, ARCHETYPES.map((a) => ({ weight: 1, value: a })));
  const job = pick(rng, JOBS);
  const age = 21 + Math.floor(range(rng, 0, 45));
  const monthlyTakeHome = Math.round(range(rng, archetype.payRange[0], archetype.payRange[1]) / 10) * 10;
  const debts = archetype.debt
    ? [
        {
          kind: archetype.debt.kind,
          name: archetype.debt.kind === "card" ? "Everyday card" : archetype.debt.kind === "auto" ? "Car loan" : "Personal loan",
          balance: Math.round((monthlyTakeHome * range(rng, ...archetype.debt.balanceShare)) / 10) * 10,
          apr: range(rng, ...archetype.debt.aprRange),
          limit: archetype.debt.kind === "card" ? Math.round((monthlyTakeHome * 3) / 100) * 100 : undefined,
          months: archetype.debt.kind !== "card" ? 48 : undefined,
        },
      ]
    : [];
  const savings = Math.round((monthlyTakeHome * range(rng, ...archetype.savingsMonths)) / 10) * 10;
  return {
    id,
    first,
    last,
    age,
    job,
    categoryId: archetype.categoryId,
    level: archetype.level,
    monthlyTakeHome,
    accounts: { checking: Math.round(monthlyTakeHome * 0.15), savings, emergency: Math.round(savings * 0.4) },
    debts,
    strategy: archetype.strategy,
    extraMonthly: 0,
    story: archetype.story(job),
  };
}

function buildRoster(): NpcProfile[] {
  const taken = new Set(NPCS.map((n) => n.id));
  const roster: NpcProfile[] = [];
  let i = 0;
  while (roster.length < BACKGROUND_NPC_COUNT) {
    const seed = String(hashKeys("background-roster", i));
    const rng = rngFor("background-name", seed);
    const first = pick(rng, FIRST).replace(/\d+$/, "");
    const last = pick(rng, LAST);
    const idBase = (first + last).toLowerCase().replace(/[^a-z]/g, "").slice(0, 16);
    let id = `npc-${idBase}`;
    let suffix = "a";
    while (taken.has(id)) {
      id = `npc-${idBase}${suffix}`;
      suffix = String.fromCharCode(suffix.charCodeAt(0) + 1);
    }
    taken.add(id);
    roster.push(buildProfile(id, first, last, seed));
    i++;
  }
  return roster;
}

export const BACKGROUND_NPCS: NpcProfile[] = buildRoster();
