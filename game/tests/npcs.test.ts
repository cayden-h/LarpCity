// Named NPC tests: the roster fits what the server accepts, and every NPC's
// money life runs on the city clock and catches up after a fast-forward.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_NPCS } from "../src/data/background-npcs.ts";
import type { JobCategoryId } from "../src/data/npcs.ts";
import { MIRROR_ENTITIES, NPCS } from "../src/data/npcs.ts";
import type { Place } from "../src/sim/life/index.ts";
import { MarketPath } from "../src/sim/market/index.ts";
import { NpcTown } from "../src/sim/npcs/index.ts";
import { serialize } from "../src/sim/rewind/index.ts";

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };
const START = new Date(2026, 8, 11);

test("roster ids and names are what the server's bank routes accept", () => {
  // Mirrors server/src/mirror.ts: ENTITY, MAX_NPC_CUSTOMERS, and the open body's name rule.
  const ids = MIRROR_ENTITIES.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "unique ids");
  assert.ok(ids.every((id) => /^(player|npc-[a-z]{2,20})$/.test(id)), ids.join(", "));
  assert.ok(NPCS.length <= 12, "within the server's cap on NPC customers");
  assert.ok(MIRROR_ENTITIES.every((e) => /^[A-Za-z][A-Za-z .'-]{0,29}$/.test(e.name)));
});

test("every NPC lives a year on the city clock", () => {
  const town = new NpcTown({ place: TX, day: 0, market: new MarketPath(11, START), start: START });
  for (let day = 1; day <= 365; day++) town.onDay(day);
  for (const [id, life] of town.lives) {
    assert.equal(life.today, 365, id);
    assert.ok(Number.isFinite(life.netWorth()), id);
  }
  const maya = town.lives.get("npc-maya")!;
  assert.ok(maya.totalDebt() < 1_200, "Maya pays her card down");
  assert.ok(maya.cash() > 17_400, "and keeps saving");
});

test("the background roster also runs a year on the city clock without throwing", () => {
  const town = new NpcTown({ place: TX, day: 0, market: new MarketPath(11, START), start: START, roster: [...NPCS, ...BACKGROUND_NPCS] });
  for (let day = 1; day <= 365; day++) town.onDay(day);
  assert.equal(town.lives.size, NPCS.length + BACKGROUND_NPCS.length);
  for (const [id, life] of town.lives) assert.ok(Number.isFinite(life.netWorth()), id);
});

test("every NPC has a valid job category and level", () => {
  // A Record keyed by the real JobCategoryId union: if the type gains or loses
  // an id, this object literal fails to typecheck until it's updated, so the
  // runtime set of known ids can never drift from the type.
  const KNOWN: Record<JobCategoryId, true> = {
    management: true, business_finance: true, tech: true, engineering: true, science: true,
    social_services: true, legal: true, education: true, arts_media: true, healthcare_pro: true,
    healthcare_support: true, protective: true, food_service: true, cleaning_grounds: true,
    personal_care: true, sales_retail: true, office_admin: true, farming: true, construction: true,
    repair: true, production: true, transport: true,
  };
  for (const npc of NPCS) {
    assert.ok(Object.hasOwn(KNOWN, npc.categoryId), `${npc.id}: unknown category ${npc.categoryId}`);
    assert.ok(["entry", "mid", "senior", "lead", "top"].includes(npc.level), npc.id);
  }
});

test("after a fast-forward, the town catches every NPC up to the new day", () => {
  const town = new NpcTown({ place: TX, day: 0, market: new MarketPath(11, START), start: START });
  town.catchUp(3_650);
  for (const [id, life] of town.lives) assert.equal(life.today, 3_650, id);
  town.onDay(3_651);
  for (const life of town.lives.values()) assert.equal(life.today, 3_651);
});

test("the town rewinds with the player: every NPC is back on that day, and replays the same days", () => {
  const town = new NpcTown({ place: TX, day: 0, market: new MarketPath(11, START), start: START });
  const state = () => new Map([...town.lives].map(([id, life]) => [id, serialize(life.detached())]));
  let at80 = new Map<string, string>();
  for (let day = 1; day <= 200; day++) {
    town.onDay(day);
    if (day === 80) at80 = state();
  }
  const at200 = state();
  town.rewind(80);
  for (const [id, life] of town.lives) assert.equal(life.today, 80, id);
  assert.deepEqual(state(), at80);
  for (let day = 81; day <= 200; day++) town.onDay(day);
  assert.deepEqual(state(), at200);
});
