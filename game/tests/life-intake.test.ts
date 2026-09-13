// Proof that a new life's goals, name, and avatar survive a full save/restore
// cycle unchanged (sim/save/codec.ts), same as every other permanent choice.

import { test } from "node:test";
import assert from "node:assert/strict";
import { lifeFromIntake } from "../src/sim/life/intake.ts";
import type { Place } from "../src/sim/life/index.ts";
import { encodeGame, parseSave, restoreGame } from "../src/sim/save/codec.ts";
import { NpcTown } from "../src/sim/npcs/index.ts";
import { Inbox } from "../src/sim/mail/inbox.ts";
import { MarketPath } from "../src/sim/market/index.ts";

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };
const START = new Date(2026, 8, 11);

test("goals, name, and avatar set at intake survive an encode/restore cycle unchanged", () => {
  const market = new MarketPath(11, START);
  const life = lifeFromIntake(
    {
      job: "Nurse",
      salary: 72_000,
      rent: 1_400,
      debt: 15_000,
      savings: 3_000,
      name: "Alex",
      avatar: "female",
      goals: [
        { kind: "retirement_age", targetAge: 60 },
        { kind: "marriage" },
        { kind: "debt_free_by_age", targetAge: 45 },
        { kind: "house", downPct: 0.1 },
      ],
    },
    { place: TX, day: 0, market },
  );
  const town = new NpcTown({ place: TX, day: 0, market, start: START });
  const mail = new Inbox();
  const save = encodeGame({ seed: 11, day: 0, hash: "TX", bankRun: "11-abc", life, town, mail, desk: null });
  const parsed = parseSave(JSON.parse(JSON.stringify(save)));
  const back = restoreGame(parsed, { market: new MarketPath(11, START), place: TX, start: START });
  assert.deepEqual(back.life.goals, life.goals);
  assert.equal(back.life.name, "Alex");
  assert.equal(back.life.avatar, "female");
});
