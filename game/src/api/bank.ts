// A small caching client over GET /api/bank/:entity (server/src/routes/nessie.ts),
// which already answers from the Nessie mirror or its local fallback
// transparently (docs/superpowers/specs/2026-09-12-nessie-fallback-design.md).
// This file's only job is to keep the game from refetching the same NPC's
// statement on every click: a short TTL plus in-flight de-dupe.

import type { BankView } from "../sim/mirror/types.ts";

const TTL_MS = 30_000;

interface CacheEntry {
  at: number;
  value: BankView;
}

export class BankClient {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<BankView>>();
  private readonly base: string;
  private readonly fetchFn: typeof fetch;

  constructor(base: string, fetchFn: typeof fetch = (...a) => fetch(...a)) {
    this.base = base;
    this.fetchFn = fetchFn;
  }

  /** This session's statement for `entity` ("npc-maya", etc.), cached for 30s unless `force`. */
  async statement(entity: string, opts: { force?: boolean } = {}): Promise<BankView> {
    const cached = this.cache.get(entity);
    if (!opts.force && cached && Date.now() - cached.at < TTL_MS) return cached.value;
    const pending = this.inflight.get(entity);
    if (pending && !opts.force) return pending;
    const p = this.load(entity).finally(() => this.inflight.delete(entity));
    this.inflight.set(entity, p);
    return p;
  }

  private async load(entity: string): Promise<BankView> {
    const r = await this.fetchFn(`${this.base}/${entity}`, { credentials: "include" });
    if (!r.ok) throw new Error(`bank_statement_failed:${r.status}`);
    const value = (await r.json()) as BankView;
    this.cache.set(entity, { at: Date.now(), value });
    return value;
  }
}
