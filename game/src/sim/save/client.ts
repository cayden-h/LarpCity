// The server's profile and save routes (server/src/routes/save.ts).

import { apiFetch } from "../../net/api.ts";
import type { SlotId } from "./slot.ts";

export type ProfileSource = "voice" | "typed" | "skipped";

export interface Profile {
  displayName: string | null;
  job: string | null;
  salary: number | null;
  rent: number | null;
  debt: number | null;
  savings: number | null;
  state: string;
  source: ProfileSource;
}

export interface SaveRecord {
  runId: string;
  seed: number;
  version: number;
  gameDay: number;
  state: unknown;
  rev: number;
  updatedAt: string;
}

/** What the slot picker shows about a saved life (server/src/store/saves.ts). */
export interface SlotSummary {
  slot: number;
  gameDay: number;
  updatedAt: string;
  age: number | null;
  job: string | null;
  state: string | null;
  netWorth: number | null;
}

export interface Me {
  player: { id: string; name: string | null };
  profile: Profile | null;
  /** The asked-for slot's save. */
  save: SaveRecord | null;
  /** All three slots, null when empty; missing from a server older than slots. */
  slots?: (SlotSummary | null)[];
}

export interface SavePut {
  runId: string;
  seed: number;
  version: number;
  gameDay: number;
  state: unknown;
  baseRev: number | null;
}

export interface SaveApi {
  me(): Promise<Me>;
  putProfile(p: Omit<Profile, "displayName">): Promise<void>;
  putSave(body: SavePut): Promise<{ rev: number }>;
  /** Fire-and-forget with keepalive, for a page that is going away. Takes the exact JSON already sized against KEEPALIVE_MAX. */
  putSaveKeepalive(json: string): void;
  deleteSave(): Promise<void>;
}

/** The routes for one of the player's save slots (sim/save/slot.ts); slot 0 is the one saves always used. */
export function saveApi(baseUrl?: string, slot: SlotId = 0): SaveApi {
  const o = baseUrl === undefined ? {} : { baseUrl };
  const q = `?slot=${slot}`;
  return {
    me: () => apiFetch<Me>(`/me${q}`, o),
    putProfile: (p) => apiFetch<void>("/profile", { ...o, method: "PUT", body: JSON.stringify(p) }),
    putSave: (body) => apiFetch<{ rev: number }>(`/save${q}`, { ...o, method: "PUT", body: JSON.stringify(body) }),
    putSaveKeepalive: (json) => {
      void apiFetch<{ rev: number }>(`/save${q}`, { ...o, method: "PUT", body: json, keepalive: true }).catch(() => undefined);
    },
    deleteSave: () => apiFetch<void>(`/save${q}`, { ...o, method: "DELETE" }),
  };
}
