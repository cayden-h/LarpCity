// Autosave. The game calls request() after a decision, on each new game
// month, and after a skip; requests within a second collapse into one
// write. Each write names the rev it started from, so a second tab can't
// silently overwrite this one's progress (the server answers 409 and this
// manager stops for good: the other tab owns the life now). While the server
// is down it keeps retrying, waiting longer each time, and never drops a
// save. A 400, 403, 404, or 413 means this exact save will never succeed no
// matter how many times it's retried (a bad body, no access, no such run, or
// a save too large), so those stop retrying too and mark the save "failed".

import { ApiError } from "../../net/api.ts";
import type { SaveApi, SavePut } from "./client.ts";
import type { GameSave } from "./types.ts";

export type SaveStatus = "idle" | "saving" | "saved" | "offline" | "conflict" | "failed";

/** Browsers refuse keepalive requests with bodies over 64 KB; stay under it. */
export const KEEPALIVE_MAX = 60_000;
const DEBOUNCE_MS = 1_000;
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;

/** Statuses a write will never succeed from if retried unchanged. */
const NO_RETRY_STATUSES = new Set([400, 403, 404, 413]);

export interface Timers {
  set(fn: () => void, ms: number): number;
  clear(id: number): void;
}

export interface SaveManagerOptions {
  api: SaveApi;
  /** The game as it stands right now. */
  build: () => GameSave;
  /** The run the save belongs to; null while run recording is off. */
  runId: () => string | null;
  /** The loaded save's rev, or null for a new life. */
  baseRev: number | null;
  timers?: Timers;
  onStatus?: (status: SaveStatus) => void;
}

const browserTimers: Timers = { set: (fn, ms) => window.setTimeout(fn, ms), clear: (id) => window.clearTimeout(id) };

export class SaveManager {
  status: SaveStatus = "idle";
  private rev: number | null;
  private readonly o: SaveManagerOptions;
  private readonly timers: Timers;
  private timer: number | null = null;
  private failures = 0;
  private inflight: Promise<void> | null = null;
  private again = false;

  constructor(o: SaveManagerOptions) {
    this.o = o;
    this.rev = o.baseRev;
    this.timers = o.timers ?? browserTimers;
  }

  /** Save soon; a burst of requests sends one write. */
  request(): void {
    if (this.done()) return;
    this.schedule(DEBOUNCE_MS);
  }

  /** Save now (resolves when this write, and any it had to wait for, is done). */
  async flush(): Promise<void> {
    if (this.done()) return;
    if (this.inflight) {
      this.again = true;
      return this.inflight;
    }
    this.inflight = this.write().finally(() => (this.inflight = null));
    await this.inflight;
    if (this.again) {
      this.again = false;
      await this.flush();
    }
  }

  /** The page is going away: one keepalive write when it fits, otherwise the last save stands. */
  flushOnUnload(): void {
    if (this.done()) return;
    const body = this.body();
    if (!body || JSON.stringify(body).length >= KEEPALIVE_MAX) return;
    this.o.api.putSaveKeepalive(body);
  }

  /** Once a conflict or failure has landed, request()/flush() become no-ops. */
  private done(): boolean {
    return this.status === "conflict" || this.status === "failed";
  }

  private body(): SavePut | null {
    const runId = this.o.runId();
    if (!runId) return null;
    const g = this.o.build();
    return { runId, seed: g.seed, version: g.version, gameDay: g.day, state: g, baseRev: this.rev };
  }

  private schedule(ms: number): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = this.timers.set(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  private async write(): Promise<void> {
    const body = this.body();
    if (!body) return this.setStatus("offline");
    this.setStatus("saving");
    try {
      this.rev = (await this.o.api.putSave(body)).rev;
      this.failures = 0;
      this.setStatus("saved");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) return this.setStatus("conflict");
      if (err instanceof ApiError && NO_RETRY_STATUSES.has(err.status)) return this.setStatus("failed");
      this.setStatus("offline");
      this.schedule(Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.failures++));
    }
  }

  private setStatus(s: SaveStatus): void {
    if (s === this.status) return;
    this.status = s;
    this.o.onStatus?.(s);
  }
}
