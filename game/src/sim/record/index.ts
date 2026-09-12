// Records the player's run in Tiger Data through the server: one snapshot per
// game day (net worth and where it sits) and every life event, for the
// charts, the calendar, the newspaper, rewind, and the leaderboard. Days are
// buffered and sent in batches (about a month of play, or a whole
// fast-forward in 5,000-row chunks); a batch leaves the buffer only after the
// server has it, so nothing is lost while the server is down. Off when the
// server isn't running. Server side: server/src/routes/snapshot.ts.

import type { LifeEvent, PlayerLife } from "../life/player.ts";

export interface SnapshotEntry {
  day: number;
  netWorth: number;
  checking: number;
  /** Savings plus the emergency fund. */
  savings: number;
  /** Brokerage cash plus holdings at the day's prices. */
  brokerage: number;
  /** 401(k) and Roth IRA. */
  retirement: number;
  debt: number;
  /** The player's investing line: brokerage plus cash sells took out (sim/life/twins.ts). */
  you: number;
  /** The same buys, never sold. */
  held: number;
  /** The same new money at 90/10 LTM/BOND, never sold. */
  autopilot: number;
}

export interface EventEntry {
  /** `day:sequence`, stable across retries, so the server stores each event once. */
  key: string;
  day: number;
  kind: LifeEvent["type"];
  payload: LifeEvent;
}

/** The server takes at most this many rows per request. */
export const MAX_BATCH = 5000;

const round2 = (x: number) => Math.round(x * 100) / 100;

export function snapshotOf(life: PlayerLife, day: number): SnapshotEntry {
  const accounts = [...life.ledger.accounts.values()];
  const sum = (kinds: string[]) => accounts.filter((a) => kinds.includes(a.kind)).reduce((s, a) => s + a.balance, 0);
  const retirement = round2(sum(["k401", "roth_ira"]));
  const last = life.history[life.history.length - 1];
  const lines = last && last.day === day ? last : life.snapshot(day);
  return {
    day,
    netWorth: life.netWorth(),
    checking: round2(sum(["checking"])),
    savings: round2(sum(["savings", "emergency"])),
    brokerage: round2(life.investments() - retirement),
    retirement,
    debt: life.totalDebt(),
    you: lines.you,
    held: lines.held,
    autopilot: lines.autopilot,
  };
}

export interface RunRecorderOptions {
  life: PlayerLife;
  seed: number;
  /** The server's API root, "/api" by default. */
  base?: string;
  /** Send once this many days are waiting (about a month of play). */
  flushDays?: number;
  fetchFn?: typeof fetch;
  log?: (message: string) => void;
  /** A saved game's run: record into it instead of starting a new one. */
  runId?: string;
}

export class RunRecorder {
  runId: string | null = null;
  private readonly life: PlayerLife;
  private readonly seed: number;
  private readonly base: string;
  private readonly flushDays: number;
  private readonly fetchFn: typeof fetch;
  private readonly log: (message: string) => void;
  /** Unsent snapshots by day (a day recorded twice keeps its latest). */
  private readonly snaps = new Map<number, SnapshotEntry>();
  private events: EventEntry[] = [];
  private readonly seq = new Map<number, number>();
  private sending: Promise<void> | null = null;
  /** A rewind asking the server for its branch; nothing sends until it answers. */
  private forking: Promise<void> | null = null;

  constructor(o: RunRecorderOptions) {
    this.life = o.life;
    this.seed = o.seed;
    this.base = o.base ?? "/api";
    this.flushDays = o.flushDays ?? 30;
    this.fetchFn = o.fetchFn ?? ((...a) => fetch(...a));
    this.log = o.log ?? ((m) => console.info(m));
    this.runId = o.runId ?? null;
    // Record from the start, so days played before the server answers aren't lost.
    this.snaps.set(o.life.today, snapshotOf(o.life, o.life.today));
    o.life.onEvents((events) => this.record(events));
  }

  get enabled(): boolean {
    return this.runId !== null;
  }

  /** Days and events waiting to be sent. */
  get pending(): { days: number; events: number } {
    return { days: this.snaps.size, events: this.events.length };
  }

  /** Starts a run on the server; the recorder stays off (and the game unaffected) if that fails. */
  async begin(): Promise<boolean> {
    if (this.runId) return true;
    try {
      const r = await this.send("/runs", { seed: this.seed });
      if (r.ok) this.runId = ((await r.json()) as { runId: string }).runId;
    } catch {
      // No server: stay off.
    }
    if (!this.runId) this.log("Run recording is off: the API server or its database isn't available.");
    return this.enabled;
  }

  /** Call after each game day; sends once enough days are waiting, or now with `force` (after a fast-forward). */
  tick(force = false): Promise<void> {
    if (!this.enabled || this.sending) return this.sending ?? Promise.resolve();
    if (!force && this.snaps.size < this.flushDays) return Promise.resolve();
    this.sending = this.flush().finally(() => (this.sending = null));
    return this.sending;
  }

  /** Resolves once nothing is in flight. */
  async idle(): Promise<void> {
    while (this.sending || this.forking) await (this.sending ?? this.forking);
  }

  /**
   * After the life rewinds to `day`: the old run keeps everything lived on it
   * (days not sent yet go to it first), and a fork of it through the day before
   * becomes this run, so the coach and the newspaper read the new branch. The
   * rewound day itself is recorded again from the life as it is now.
   */
  rewind(day: number): Promise<void> {
    const oldRun = this.runId;
    const oldSnaps = [...this.snaps.values()];
    const oldEvents = this.events;
    for (const d of [...this.snaps.keys()]) if (d >= day) this.snaps.delete(d);
    this.events = this.events.filter((e) => e.day < day);
    this.seq.clear();
    this.record(this.life.log.filter((e) => e.day === day));
    if (!oldRun) return Promise.resolve();
    // Nothing sends until the branch exists.
    this.runId = null;
    this.forking = (async () => {
      while (this.sending) await this.sending;
      try {
        await this.post(oldRun, oldSnaps, oldEvents);
      } catch (e) {
        this.log(`Run recording: the old branch keeps what it had (${e instanceof Error ? e.message : String(e)})`);
      }
      if (day > 0) {
        const r = await this.send(`/runs/${oldRun}/fork`, { throughDay: day - 1 }).catch(() => null);
        if (r?.ok) {
          this.runId = ((await r.json()) as { runId: string }).runId;
          return;
        }
      }
      // Day 0, or the server wouldn't fork: record the branch as a fresh run from here.
      await this.begin();
    })().finally(() => (this.forking = null));
    return this.forking;
  }

  private record(events: LifeEvent[]): void {
    const day = events.length ? events[events.length - 1].day : this.life.today;
    this.snaps.set(day, snapshotOf(this.life, day));
    for (const e of events) {
      const n = this.seq.get(e.day) ?? 0;
      this.seq.set(e.day, n + 1);
      this.events.push({ key: `${e.day}:${n}`, day: e.day, kind: e.type, payload: e });
    }
    // Only today's sequence can still grow (a trade later in the day).
    for (const d of this.seq.keys()) if (d < day - 1) this.seq.delete(d);
  }

  /** Sends days and events to a run in batches the server accepts; throws at the first failure. */
  private async post(runId: string, snaps: SnapshotEntry[], events: EventEntry[]): Promise<void> {
    const days = [...snaps].sort((a, b) => a.day - b.day);
    for (let i = 0; i < days.length; i += MAX_BATCH) {
      const r = await this.send("/snapshot", { runId, entries: days.slice(i, i + MAX_BATCH) });
      if (!r.ok) throw new Error(`snapshots failed (${r.status})`);
    }
    for (let i = 0; i < events.length; i += MAX_BATCH) {
      const r = await this.send("/events", { runId, events: events.slice(i, i + MAX_BATCH) });
      if (!r.ok) throw new Error(`events failed (${r.status})`);
    }
  }

  private async flush(): Promise<void> {
    // The run this flush started on, even if a rewind switches runs while it's in flight.
    const runId = this.runId;
    try {
      const days = [...this.snaps.values()].sort((a, b) => a.day - b.day);
      for (let i = 0; i < days.length; i += MAX_BATCH) {
        const batch = days.slice(i, i + MAX_BATCH);
        const r = await this.send("/snapshot", { runId, entries: batch });
        if (!r.ok) throw new Error(`snapshots failed (${r.status})`);
        // A day re-recorded while this was in flight keeps its newer copy for the next send.
        for (const s of batch) if (this.snaps.get(s.day) === s) this.snaps.delete(s.day);
      }
      const events = this.events;
      for (let i = 0; i < events.length; i += MAX_BATCH) {
        const batch = events.slice(i, i + MAX_BATCH);
        const r = await this.send("/events", { runId, events: batch });
        if (!r.ok) throw new Error(`events failed (${r.status})`);
        const sent = new Set(batch);
        this.events = this.events.filter((e) => !sent.has(e));
      }
    } catch (e) {
      this.log(`Run recording: ${e instanceof Error ? e.message : String(e)}; will retry`);
    }
  }

  private send(path: string, body: unknown): Promise<Response> {
    return this.fetchFn(`${this.base}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
}
