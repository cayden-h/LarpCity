// The saved game's shape (docs/superpowers/specs/2026-09-12-save-and-connected-apps-design.md).
// The server stores it as an opaque JSON document; only the game reads it.

import type { LifeSave } from "../life/player.ts";
import type { InboxSave } from "../mail/inbox.ts";

export type DeskTone = "up" | "down" | "flat";

/** One line of the Money desk's activity feed. */
export interface DeskFeedItem {
  day: number;
  text: string;
  amount?: number;
  tone: DeskTone;
}

/** One line on the Money desk's Cash tab statement. */
export interface DeskBankTxn {
  day: number;
  name: string;
  category: string;
  icon: string;
  amount: number;
  kind: "in" | "out" | "move";
}

/** What the Money desk remembers between visits. */
export interface DeskState {
  feed: DeskFeedItem[];
  bank: DeskBankTxn[];
  crash: { day: number; drop: number; choice: string } | null;
  recovery: { day: number; you: number; held: number; autopilot: number } | null;
  /** The Gemini recovery lesson shown on the recovery card; added after version 1, read as null when missing. */
  recap: { headline: string; lesson: string } | null;
}

export interface GameSave {
  version: number;
  seed: number;
  /** The clock's game day. */
  day: number;
  /** Where the player is: a state (TX) or a specialized city (dallas), as in the URL hash. */
  hash: string;
  /** The Nessie mirror's run id, so a resumed game keeps the same bank accounts. */
  bankRun: string;
  life: LifeSave;
  npcs: Record<string, LifeSave>;
  mail: InboxSave;
  desk: DeskState | null;
}
