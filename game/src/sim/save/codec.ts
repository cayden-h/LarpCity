// Builds the saved game from the live pieces, checks one read back from the
// server, and decodes it into a whole game. A save this build can't read is
// refused whole (SaveFormatError) so the game offers a new life instead of
// half-loading: parseSave checks the shape, and restoreGame decodes every
// piece before the boot flow touches live state.
//
// SAVE_VERSION discipline:
// - Bump it when a saved field is removed or renamed, or keeps its name but
//   changes meaning (units, what it counts, how it is compacted). Older saves
//   are then refused, not misread.
// - An added field needs no bump only if it is optional to the reader: read
//   it with a safe default (as parseSave does for DeskState.recap and
//   InboxSave.lastPay), because version-1 saves in the database lack it.

import type { MarketPath } from "../market/index.ts";
import { PlayerLife, type Place } from "../life/player.ts";
import { Inbox, type InboxSave, type MailItem } from "../mail/inbox.ts";
import { NpcTown } from "../npcs/index.ts";
import type { DeskState, GameSave } from "./types.ts";

export const SAVE_VERSION = 1;

export class SaveFormatError extends Error {}

export interface GameParts {
  seed: number;
  day: number;
  hash: string;
  bankRun: string;
  life: PlayerLife;
  town: NpcTown;
  mail: Inbox;
  desk: DeskState | null;
}

export function encodeGame(g: GameParts): GameSave {
  return {
    version: SAVE_VERSION,
    seed: g.seed,
    day: g.day,
    hash: g.hash,
    bankRun: g.bankRun,
    life: g.life.toSave(),
    npcs: g.town.toSave(),
    mail: g.mail.toSave(),
    desk: g.desk ? structuredClone(g.desk) : null,
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseSave(raw: unknown): GameSave {
  if (!isObject(raw)) throw new SaveFormatError("not a save");
  if (raw.version !== SAVE_VERSION) throw new SaveFormatError(`save version ${String(raw.version)}, this game reads ${SAVE_VERSION}`);
  if (typeof raw.seed !== "number" || typeof raw.day !== "number" || !isObject(raw.life)) throw new SaveFormatError("save is missing its life");
  return {
    version: SAVE_VERSION,
    seed: raw.seed,
    day: raw.day,
    hash: typeof raw.hash === "string" ? raw.hash : "",
    bankRun: typeof raw.bankRun === "string" ? raw.bankRun : "",
    life: raw.life as unknown as GameSave["life"],
    npcs: isObject(raw.npcs) ? (raw.npcs as GameSave["npcs"]) : {},
    mail: parseMail(raw.mail),
    desk: parseDesk(raw.desk),
  };
}

/** A missing or broken inbox is an empty one; a missing counter numbers on past the highest id. */
function parseMail(raw: unknown): InboxSave {
  if (!isObject(raw) || !Array.isArray(raw.items)) return { items: [], seq: 0 };
  const items = raw.items.filter(isObject) as unknown as MailItem[];
  const highest = items.reduce((n, m) => Math.max(n, Number(/^m(\d+)$/.exec(String(m.id))?.[1] ?? 0)), 0);
  const seq = typeof raw.seq === "number" ? Math.max(raw.seq, highest) : highest;
  return { items, seq, lastPay: parsePaySummary(raw.lastPay) };
}

/** A pay stub with a non-finite takeHome (NaN, Infinity, missing) is dropped, not carried into the game. */
function parsePaySummary(raw: unknown): InboxSave["lastPay"] {
  if (!isObject(raw) || typeof raw.takeHome !== "number" || !Number.isFinite(raw.takeHome)) return null;
  return { takeHome: raw.takeHome, garnished: raw.garnished === true, unemployed: raw.unemployed === true };
}

/**
 * The desk only remembers what the Money desk showed (feed, statement,
 * crash and recovery cards), and the life replays none of it, so a broken
 * desk is dropped (null, a fresh desk) rather than refusing the whole game.
 */
function parseDesk(raw: unknown): DeskState | null {
  if (!isObject(raw) || !Array.isArray(raw.feed) || !Array.isArray(raw.bank)) return null;
  const nullable = <T>(v: unknown) => (isObject(v) ? (v as unknown as T) : null);
  return {
    feed: raw.feed as DeskState["feed"],
    bank: raw.bank as DeskState["bank"],
    crash: nullable<DeskState["crash"]>(raw.crash),
    recovery: nullable<DeskState["recovery"]>(raw.recovery),
    recap: nullable<DeskState["recap"]>(raw.recap),
  };
}

export interface RestoredGame {
  life: PlayerLife;
  town: NpcTown;
  mail: Inbox;
}

/**
 * Decodes a parsed save into its live pieces, all or nothing: any error while
 * decoding, or while exercising the decoded life, becomes a SaveFormatError,
 * so the boot flow gets a complete game or a clean refusal before it touches
 * live state.
 */
export function restoreGame(
  save: GameSave,
  o: { market: MarketPath; place: Place; start: Date; cashRate?: (date: Date) => number },
): RestoredGame {
  try {
    const life = PlayerLife.fromSave(save.life, { market: o.market, cashRate: o.cashRate });
    // A cheap sanity pass over what the game reads first: balances, prices, and today's snapshot.
    if (!Number.isFinite(life.netWorth())) throw new Error("net worth is not a number");
    life.snapshot(life.today);
    const town = new NpcTown({ place: o.place, day: save.day, market: o.market, start: o.start, saved: save.npcs });
    const mail = new Inbox(save.mail);
    return { life, town, mail };
  } catch (err) {
    if (err instanceof SaveFormatError) throw err;
    throw new SaveFormatError(`save does not decode: ${err instanceof Error ? err.message : String(err)}`);
  }
}
