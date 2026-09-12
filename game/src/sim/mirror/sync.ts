// Sends each mirrored life's monthly batches to the server's /api/bank
// routes, which post them to Nessie (server/src/mirror.ts). One request per
// life at a time; a batch is committed only after the server has it, so when
// the server is down the months simply wait and go out later as one summary.
// If the server or its Nessie key is missing at start, the mirror stays off
// and the game runs as before. Requests carry the session cookie, which is
// how the server knows whose accounts these are.

import type { PlayerLife } from "../life/player.ts";
import { MonthMirror } from "./month.ts";
import type { MirrorEntriesRequest, MirrorOpenRequest, MirrorOpenResponse } from "./types.ts";

export interface BankSyncOptions {
  /** This run's id; a new run gets fresh Nessie accounts. */
  run: string;
  /** Calendar date of game day 0. */
  start: Date;
  /** The server's bank routes, "/api/bank" by default. */
  base?: string;
  fetchFn?: typeof fetch;
  log?: (message: string) => void;
}

interface Item {
  entity: string;
  name: string;
  mirror: MonthMirror;
  busy: boolean;
}

export class BankSync {
  enabled = false;
  private readonly items: Item[] = [];
  private readonly inflight = new Set<Promise<void>>();
  private readonly base: string;
  private readonly fetchFn: typeof fetch;
  private readonly log: (message: string) => void;
  private readonly run: string;
  private readonly start: Date;

  constructor(o: BankSyncOptions) {
    this.run = o.run;
    this.start = o.start;
    this.base = o.base ?? "/api/bank";
    this.fetchFn = o.fetchFn ?? ((...a) => fetch(...a));
    this.log = o.log ?? ((m) => console.info(m));
  }

  /** Mirrors a life as `entity` ("player" or an NPC's "npc-<name>"). */
  add(entity: string, name: string, life: PlayerLife): MonthMirror {
    const mirror = new MonthMirror(life, this.start);
    this.items.push({ entity, name, mirror, busy: false });
    return mirror;
  }

  /** Turns the mirror on if the server can reach Nessie, then opens every account. */
  async begin(): Promise<boolean> {
    try {
      this.enabled = (await this.fetchFn(`${this.base}/status`, { credentials: "include" })).ok;
    } catch {
      this.enabled = false;
    }
    if (!this.enabled) {
      this.log("Bank mirror is off: the API server or its Nessie key isn't available.");
      return false;
    }
    await Promise.all(this.items.map((i) => this.guard(i, () => this.open(i))));
    return true;
  }

  /** Call after each game day (and after a fast-forward): posts every finished month. */
  tick(today: number): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    return Promise.all(this.items.map((i) => this.guard(i, () => (i.mirror.opened ? this.post(i, today) : this.open(i))))).then(() => undefined);
  }

  /** Resolves once nothing is in flight. */
  async idle(): Promise<void> {
    while (this.inflight.size) await Promise.all([...this.inflight]);
  }

  private guard(i: Item, fn: () => Promise<void>): Promise<void> {
    if (i.busy) return Promise.resolve();
    i.busy = true;
    const p = fn()
      .catch((e) => this.log(`Bank mirror (${i.entity}): ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        i.busy = false;
        this.inflight.delete(p);
      });
    this.inflight.add(p);
    return p;
  }

  private async open(i: Item): Promise<void> {
    const body: MirrorOpenRequest = { run: this.run, name: i.name, opening: i.mirror.open() };
    const r = await this.send(`/${i.entity}/open`, body);
    if (!r.ok) {
      // Leave it unopened so the next tick tries again.
      i.mirror.close();
      throw new Error(`open failed (${r.status})`);
    }
    i.mirror.rebase(((await r.json()) as MirrorOpenResponse).balances);
  }

  private async post(i: Item, today: number): Promise<void> {
    const batch = i.mirror.prepare(today);
    if (!batch) return;
    const body: MirrorEntriesRequest = { run: this.run, entries: batch.entries };
    const r = await this.send(`/${i.entity}/entries`, body);
    if (r.ok) return i.mirror.commit(batch);
    // 409: the server lost the run (a restart); reopen, which reads back what it already has.
    if (r.status === 409) i.mirror.close();
    throw new Error(`posting ${batch.months.join(", ")} failed (${r.status})`);
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
