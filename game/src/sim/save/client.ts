// The server's profile and save routes (server/src/routes/save.ts).

import { apiFetch } from "../../net/api.ts";

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

export interface Me {
  player: { id: string; name: string | null };
  profile: Profile | null;
  save: SaveRecord | null;
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
  /** Fire-and-forget with keepalive, for a page that is going away. */
  putSaveKeepalive(body: SavePut): void;
  deleteSave(): Promise<void>;
}

export function saveApi(baseUrl?: string): SaveApi {
  const o = baseUrl === undefined ? {} : { baseUrl };
  return {
    me: () => apiFetch<Me>("/me", o),
    putProfile: (p) => apiFetch<void>("/profile", { ...o, method: "PUT", body: JSON.stringify(p) }),
    putSave: (body) => apiFetch<{ rev: number }>("/save", { ...o, method: "PUT", body: JSON.stringify(body) }),
    putSaveKeepalive: (body) => {
      void apiFetch<{ rev: number }>("/save", { ...o, method: "PUT", body: JSON.stringify(body), keepalive: true }).catch(() => undefined);
    },
    deleteSave: () => apiFetch<void>("/save", { ...o, method: "DELETE" }),
  };
}
