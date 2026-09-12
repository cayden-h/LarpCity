// Builds the saved game from the live pieces and checks one read back from
// the server. A save in a format this build doesn't know is refused whole
// (SaveFormatError) so the game offers a new life instead of half-loading.
// Bump SAVE_VERSION whenever a saved shape changes incompatibly.

import type { PlayerLife } from "../life/player.ts";
import type { Inbox } from "../mail/inbox.ts";
import type { NpcTown } from "../npcs/index.ts";
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
    mail: isObject(raw.mail) ? (raw.mail as unknown as GameSave["mail"]) : { items: [], seq: 0 },
    desk: isObject(raw.desk) ? (raw.desk as unknown as DeskState) : null,
  };
}
