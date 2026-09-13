// A saved game stays under the server's limit (server/src/routes/save.ts, MAX_STATE_BYTES) however
// long it's played: the whole town's NPC lives ride in it, so their history can't grow with time.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PlayerLife, STARTER_PORTFOLIO, type Place } from "../src/sim/life/index.ts";
import { Inbox } from "../src/sim/mail/inbox.ts";
import { MarketPath } from "../src/sim/market/index.ts";
import { NPC_SAVE_DAYS, NpcTown } from "../src/sim/npcs/index.ts";
import { encodeGame } from "../src/sim/save/codec.ts";

const TX: Place = { abbr: "TX", name: "Texas", rpp: { all: 97.4, goods: 97.0, housing: 88.6 } };
const START = new Date(2026, 8, 11);
/** The server's MAX_STATE_BYTES. */
const SERVER_LIMIT = 1_500_000;

test("three game years in, the whole save is well under the server's limit", () => {
  const market = new MarketPath(20260912, START);
  const life = new PlayerLife({ place: TX, day: 0, market, holdings: STARTER_PORTFOLIO });
  const town = new NpcTown({ place: TX, day: 0, market, start: START });
  const days = 365 * 3;
  const date = new Date(START);
  for (let day = 1; day <= days; day++) {
    date.setDate(date.getDate() + 1);
    life.onDay(day, new Date(date));
  }
  town.catchUp(days);
  const save = encodeGame({ seed: 20260912, day: days, hash: "TX", bankRun: "", life, town, mail: new Inbox(), desk: null });
  for (const npc of Object.values(save.npcs)) assert.ok(npc.history.length <= NPC_SAVE_DAYS, `an NPC kept ${npc.history.length} days of history`);
  const bytes = Buffer.byteLength(JSON.stringify(save));
  assert.ok(bytes < SERVER_LIMIT / 2, `${Math.round(bytes / 1024)} KB`);
});
