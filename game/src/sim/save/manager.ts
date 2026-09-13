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
import type { Me, SaveApi, SavePut } from "./client.ts";
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
  /** Never write (the player chose to play without saving, or the server couldn't be trusted with
   *  this life); the status stays "offline". */
  off?: boolean;
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
  /** True from a write() call after a change (request()) until a write that started at or after that change succeeds. */
  private dirty = false;
  /** Bumped by every request(); a write remembers the value at its start to tell if a newer change arrived. */
  private dirtyMark = 0;
  /** Set when a write got no response (a network-level failure, not a server answer): the write may have
   *  actually committed. A 409 while this is set doesn't mean a real conflict until /me says otherwise. */
  private uncertain = false;
  /** The exact serialized state of the write that left `uncertain` set, to compare against what the server
   *  says it actually stored. */
  private uncertainState: string | null = null;

  constructor(o: SaveManagerOptions) {
    this.o = o;
    this.rev = o.baseRev;
    this.timers = o.timers ?? browserTimers;
    if (o.off) this.status = "offline";
  }

  /** Save soon; a burst of requests sends one write. */
  request(): void {
    if (this.done()) return;
    this.dirty = true;
    this.dirtyMark++;
    // While offline with a retry already pending, keep its backoff delay instead of
    // replacing it with the 1s debounce (which would never let the wait grow).
    if (this.status === "offline" && this.timer !== null) return;
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
      // A write that just failed offline already has its own retry scheduled;
      // recursing here would send a second attempt right away instead of waiting.
      if (this.status !== "offline") await this.flush();
    }
  }

  /** The page is going away: one keepalive write when it fits and there's something new to save,
   *  otherwise the last save (in flight, or already landed) stands. */
  flushOnUnload(): void {
    if (this.done()) return;
    if (this.inflight) return;
    if (this.status === "saved" && !this.dirty) return;
    const body = this.body();
    if (!body) return;
    const json = JSON.stringify(body);
    if (new TextEncoder().encode(json).length >= KEEPALIVE_MAX) return;
    this.o.api.putSaveKeepalive(json);
  }

  /** Once a conflict or failure has landed, or when saving is off, request()/flush() become no-ops. */
  private done(): boolean {
    return this.o.off === true || this.status === "conflict" || this.status === "failed";
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
    if (!body) {
      // No run yet (recording is starting, or a rewind is forking it): try again later rather than drop the save.
      this.setStatus("offline");
      this.schedule(Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.failures++));
      return;
    }
    const mark = this.dirtyMark;
    this.setStatus("saving");
    try {
      this.rev = (await this.o.api.putSave(body)).rev;
      this.failures = 0;
      this.uncertain = false;
      this.uncertainState = null;
      if (mark === this.dirtyMark) this.dirty = false;
      this.setStatus("saved");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        if (this.uncertain) {
          await this.resolveUncertain(body.runId);
          return;
        }
        return this.setStatus("conflict");
      }
      if (err instanceof ApiError && NO_RETRY_STATUSES.has(err.status)) return this.setStatus("failed");
      // Not a server answer at all (a fetch-level failure, e.g. a dropped connection): the request may
      // have reached the server and committed even though this response never arrived. Remember exactly
      // what was sent so a later 409 can be checked against /me instead of assumed to be a real conflict.
      if (!(err instanceof ApiError)) {
        this.uncertain = true;
        this.uncertainState = JSON.stringify(body.state);
      }
      this.setStatus("offline");
      this.schedule(Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.failures++));
    }
  }

  /** A 409 arrived while a previous write's response was lost. Ask the server what it actually has: if it
   *  matches the write that seemed to fail, adopt its rev and try again; otherwise it's a real conflict. */
  private async resolveUncertain(runId: string): Promise<void> {
    let me: Me;
    try {
      me = await this.o.api.me();
    } catch {
      // Can't tell either way yet; stay offline and retry rather than guessing "conflict".
      this.setStatus("offline");
      this.schedule(Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.failures++));
      return;
    }
    if (me.save && me.save.runId === runId && JSON.stringify(me.save.state) === this.uncertainState) {
      this.rev = me.save.rev;
      this.uncertain = false;
      this.uncertainState = null;
      this.failures = 0;
      this.schedule(DEBOUNCE_MS);
    } else {
      this.uncertain = false;
      this.uncertainState = null;
      this.setStatus("conflict");
    }
  }

  private setStatus(s: SaveStatus): void {
    if (s === this.status) return;
    this.status = s;
    this.o.onStatus?.(s);
  }
}
