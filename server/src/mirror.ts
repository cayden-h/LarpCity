// server/src/mirror.ts
// Option B of the Nessie plan (SETUP.md): the player and the game's named NPCs
// each get a Nessie customer, and each game session gets a Checking, Savings,
// and Credit Card account per run under it. The game works out each month's
// entries (game/src/sim/mirror); this service posts them idempotently by key
// and reads them back as a bank statement.
//
// What Nessie actually does (probed 2026-09-12) shapes every choice here:
// - Customers can't be deleted, so NPC customers are shared and created once
//   (capped), and a player gets one customer per session.
// - Accounts can be deleted, so a session's new run replaces its old accounts.
// - An account's `balance` is fixed when it's created and cents are
//   truncated, so balances are the opening balance plus this run's
//   whole-dollar entries, computed here.
// - Transfers carry no payee, so every entry is a deposit or a withdrawal.

import { z } from "zod";
import type { Account, AccountType, Customer, MoneyTx, NessieLike } from "./adapters/nessie.js";
import { HttpError } from "./http.js";

export type MirrorAccount = "checking" | "savings" | "credit";
export const MIRROR_ACCOUNTS: readonly MirrorAccount[] = ["checking", "savings", "credit"];
const TYPES: Record<MirrorAccount, AccountType> = { checking: "Checking", savings: "Savings", credit: "Credit Card" };
const isMirrorAccount = (s: string): s is MirrorAccount => (MIRROR_ACCOUNTS as readonly string[]).includes(s);

/** Nessie customers can't be deleted, so no more NPC customers than this are ever created. */
export const MAX_NPC_CUSTOMERS = 12;

/** Who can be mirrored: the session's player, or a named NPC (`npc-maya`). */
export const ENTITY = /^(player|npc-[a-z]{2,20})$/;

const dollars = z.number().int().min(0).max(1_000_000_000);
const balancesSchema = z.object({ checking: dollars, savings: dollars, credit: dollars });
const runSchema = z.string().regex(/^[A-Za-z0-9-]{1,40}$/);

export const openBody = z.object({
  run: runSchema,
  name: z.string().regex(/^[A-Za-z][A-Za-z .'-]{0,29}$/).optional(),
  opening: balancesSchema,
});

const entrySchema = z.object({
  key: z.string().regex(/^[A-Za-z0-9.:_-]{1,80}$/),
  account: z.enum(["checking", "savings", "credit"]),
  kind: z.enum(["deposit", "withdrawal"]),
  amount: z.number().int().positive().max(1_000_000_000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memo: z.string().min(1).max(80),
});

export const entriesBody = z.object({ run: runSchema, entries: z.array(entrySchema).max(200) });

export type MirrorBalances = z.infer<typeof balancesSchema>;
export type MirrorEntry = z.infer<typeof entrySchema>;
export type OpenBody = z.infer<typeof openBody>;
export type EntriesBody = z.infer<typeof entriesBody>;

export interface StatementTransaction {
  date: string;
  /** Signed: positive adds to the balance (on credit, to what's owed). */
  amount: number;
  memo: string;
  key: string;
}

export interface StatementAccount {
  account: MirrorAccount;
  nessieId: string;
  accountNumber: string;
  opening: number;
  balance: number;
  transactions: StatementTransaction[];
}

export interface Statement {
  entity: string;
  name: string;
  run: string;
  accounts: StatementAccount[];
}

/** A mirror rule the request broke (409 run not open, 404 unknown, 429 NPC cap); the routes answer with its status. */
export class MirrorError extends HttpError {}

interface Live {
  run: string;
  name: string;
  accounts: Record<MirrorAccount, Account>;
  keys: Set<string>;
  balances: MirrorBalances;
}

const HOUSTON = { street_number: "6100", street_name: "Main Street", city: "Houston", state: "TX", zip: "77005" };

export class MirrorService {
  private readonly nessie: NessieLike;
  private readonly tag: string;
  private readonly live = new Map<string, Live>();
  private readonly chains = new Map<string, Promise<unknown>>();
  private customers: Promise<Map<string, Customer>> | null = null;
  private readonly customerCreates = new Map<string, Promise<Customer>>();

  constructor(nessie: NessieLike, tag: string) {
    this.nessie = nessie;
    this.tag = tag;
  }

  /** Nessie is reachable with our key; counts our customers. */
  async status(): Promise<{ customers: number }> {
    return { customers: (await this.nessie.listCustomers()).length };
  }

  /** Opens (or reopens) this session's accounts for a run and returns what they add up to. */
  open(session: string, entity: string, body: OpenBody): Promise<{ run: string; reused: number; balances: MirrorBalances }> {
    return this.serial(session, entity, async () => {
      const customer = await this.customer(session, entity, body.name);
      const prefix = this.prefix(session, entity);
      const found: Partial<Record<MirrorAccount, Account>> = {};
      let reused = 0;
      for (const a of await this.nessie.listAccounts(customer._id)) {
        if (!a.nickname.startsWith(prefix)) continue;
        const [run, kind] = a.nickname.slice(prefix.length).split(":");
        if (run === body.run && isMirrorAccount(kind) && !found[kind]) {
          found[kind] = a;
          reused++;
        } else await this.nessie.deleteAccount(a._id); // an older run of this session
      }
      // One at a time: if one fails, the reopen reuses the ones already made instead of orphaning them.
      for (const kind of MIRROR_ACCOUNTS) {
        found[kind] ??= await this.nessie.createAccount(customer._id, { type: TYPES[kind], nickname: `${prefix}${body.run}:${kind}`, balance: body.opening[kind] });
      }
      const accounts = found as Record<MirrorAccount, Account>;
      const read = await this.readBack(body.run, accounts);
      const balances = balancesOf(read);
      this.live.set(this.liveKey(session, entity), { run: body.run, name: customer.first_name, accounts, keys: new Set(read.flatMap((a) => a.transactions.map((t) => t.key))), balances });
      return { run: body.run, reused, balances };
    });
  }

  /** Posts a batch; entries whose key is already in Nessie are skipped, so a retried batch never double-posts. */
  post(session: string, entity: string, body: EntriesBody): Promise<{ posted: number; skipped: number; balances: MirrorBalances }> {
    return this.serial(session, entity, async () => {
      const live = this.live.get(this.liveKey(session, entity));
      if (!live || live.run !== body.run) throw new MirrorError(409, "Open this run first.");
      let posted = 0;
      let skipped = 0;
      for (const e of body.entries) {
        if (live.keys.has(e.key)) {
          skipped++;
          continue;
        }
        const tx = { transaction_date: e.date, status: "completed" as const, amount: e.amount, description: `${this.tag}|${body.run}|${e.key}|${e.memo.replace(/\|/g, "/")}` };
        const id = live.accounts[e.account]._id;
        await (e.kind === "deposit" ? this.nessie.deposit(id, tx) : this.nessie.withdraw(id, tx));
        live.keys.add(e.key);
        live.balances[e.account] += e.kind === "deposit" ? e.amount : -e.amount;
        posted++;
      }
      return { posted, skipped, balances: { ...live.balances } };
    });
  }

  /** This session's statement for an entity, read back from Nessie. */
  statement(session: string, entity: string): Promise<Statement> {
    return this.serial(session, entity, async () => {
      const live = this.live.get(this.liveKey(session, entity)) ?? (await this.discover(session, entity));
      const accounts = await this.readBack(live.run, live.accounts);
      return { entity, name: live.name, run: live.run, accounts };
    });
  }

  private async readBack(run: string, accounts: Record<MirrorAccount, Account>): Promise<StatementAccount[]> {
    const mine = `${this.tag}|${run}|`;
    return Promise.all(
      MIRROR_ACCOUNTS.map(async (kind) => {
        const a = accounts[kind];
        const [deposits, withdrawals] = await Promise.all([this.nessie.listDeposits(a._id), this.nessie.listWithdrawals(a._id)]);
        const parse = (t: MoneyTx, sign: 1 | -1): StatementTransaction | null => {
          if (!t.description.startsWith(mine)) return null;
          const [key, ...memo] = t.description.slice(mine.length).split("|");
          return { date: t.transaction_date, amount: sign * t.amount, memo: memo.join("|"), key };
        };
        const transactions = [...deposits.map((t) => parse(t, 1)), ...withdrawals.map((t) => parse(t, -1))]
          .filter((t): t is StatementTransaction => t !== null)
          .sort((x, y) => (x.date === y.date ? x.key.localeCompare(y.key) : x.date < y.date ? -1 : 1));
        const balance = transactions.reduce((s, t) => s + t.amount, a.balance);
        return { account: kind, nessieId: a._id, accountNumber: a.account_number, opening: a.balance, balance, transactions };
      }),
    );
  }

  /** Finds a session's accounts after a server restart (no live state). */
  private async discover(session: string, entity: string): Promise<Live> {
    const customer = (await this.customerMap()).get(this.customerName(session, entity));
    if (!customer) throw new MirrorError(404, "Not mirrored yet.");
    const prefix = this.prefix(session, entity);
    const runs = new Map<string, Partial<Record<MirrorAccount, Account>>>();
    for (const a of await this.nessie.listAccounts(customer._id)) {
      if (!a.nickname.startsWith(prefix)) continue;
      const [run, kind] = a.nickname.slice(prefix.length).split(":");
      if (!isMirrorAccount(kind)) continue;
      const set = runs.get(run) ?? {};
      set[kind] = a;
      runs.set(run, set);
    }
    const complete = [...runs].find(([, set]) => MIRROR_ACCOUNTS.every((k) => set[k]));
    if (!complete) throw new MirrorError(404, "Not mirrored yet.");
    return { run: complete[0], name: customer.first_name, accounts: complete[1] as Record<MirrorAccount, Account>, keys: new Set(), balances: { checking: 0, savings: 0, credit: 0 } };
  }

  private async customer(session: string, entity: string, name: string | undefined): Promise<Customer> {
    const last = this.customerName(session, entity);
    const map = await this.customerMap();
    const existing = map.get(last);
    if (existing) return existing;
    // Two sessions can both miss the map for the same (usually NPC) name at once; serialize the
    // find-or-create per name so only one of them creates it and the other awaits that creation.
    const pending = this.customerCreates.get(last);
    if (pending) return pending;
    const create = (async () => {
      const freshMap = await this.customerMap();
      const already = freshMap.get(last);
      if (already) return already;
      if (entity !== "player") {
        const npcs = [...freshMap.keys()].filter((k) => k.startsWith(`${this.tag}-npc-`)).length;
        if (npcs >= MAX_NPC_CUSTOMERS) throw new MirrorError(429, `At most ${MAX_NPC_CUSTOMERS} NPC customers (Nessie customers can't be deleted).`);
      }
      const first = name ?? (entity === "player" ? "Player" : entity.slice(4, 5).toUpperCase() + entity.slice(5));
      const created = await this.nessie.createCustomer({ first_name: first, last_name: last, address: HOUSTON });
      freshMap.set(last, created);
      return created;
    })();
    this.customerCreates.set(last, create);
    try {
      return await create;
    } finally {
      this.customerCreates.delete(last);
    }
  }

  /** Concurrent first opens share one load of Nessie's customer list; a failed load is retried. */
  private customerMap(): Promise<Map<string, Customer>> {
    return (this.customers ??= this.nessie.listCustomers().then(
      (list) => new Map(list.map((c) => [c.last_name, c])),
      (err) => {
        this.customers = null;
        throw err;
      },
    ));
  }

  /** NPC customers are shared by every session; a player's is its session's own. */
  private customerName(session: string, entity: string): string {
    return entity === "player" ? `${this.tag}-player-${short(session)}` : `${this.tag}-${entity}`;
  }

  private prefix(session: string, entity: string): string {
    return `${this.tag}:${entity}:${short(session)}:`;
  }

  private liveKey(session: string, entity: string): string {
    return `${session}|${entity}`;
  }

  /** One request per session and entity at a time, so a reopen and a post can't interleave. */
  private serial<T>(session: string, entity: string, fn: () => Promise<T>): Promise<T> {
    const key = this.liveKey(session, entity);
    const next = (this.chains.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
    this.chains.set(key, next);
    return next;
  }
}

const short = (session: string) => session.replace(/[^A-Za-z0-9]/g, "").slice(0, 12);

function balancesOf(accounts: StatementAccount[]): MirrorBalances {
  const b: MirrorBalances = { checking: 0, savings: 0, credit: 0 };
  for (const a of accounts) b[a.account] = a.balance;
  return b;
}
