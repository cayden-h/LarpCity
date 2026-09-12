// server/src/replay.ts
// Periodically pushes anything the Nessie fallback (adapters/failover-nessie.ts) could only write
// locally back into live Nessie, once it's reachable again. Stops at the first failure in a sweep:
// if live Nessie is still down, every later attempt in that tick would fail too, so there's no
// point spending the retry/backoff time confirming that repeatedly before the next tick.
import type { NessieLike } from "./adapters/nessie.js";
import { logger } from "./logger.js";
import type { LocalNessieLike } from "./store/local-nessie.js";

export async function replayOnce(live: NessieLike, local: LocalNessieLike): Promise<void> {
  for (const c of await local.listUnsyncedCustomers()) {
    try {
      const created = await live.createCustomer({ first_name: c.first_name, last_name: c.last_name, address: c.address });
      await local.markCustomerSynced(c._id, created._id);
    } catch {
      return;
    }
  }

  for (const a of await local.listUnsyncedAccounts()) {
    const customer = await local.getCustomer(a.customer_id);
    if (!customer?.nessieId) continue; // parent didn't sync this tick after all; try again next tick
    try {
      const created = await live.createAccount(customer.nessieId, { type: a.type, nickname: a.nickname, balance: a.balance, rewards: a.rewards });
      await local.markAccountSynced(a._id, created._id);
    } catch {
      return;
    }
  }

  for (const a of await local.listUnsyncedDeletes()) {
    try {
      await live.deleteAccount(a.nessieId!);
      await local.markAccountDeleteSynced(a._id);
    } catch {
      return;
    }
  }

  for (const t of await local.listUnsyncedTransactions()) {
    const account = await local.getAccount(t.accountId);
    if (!account?.nessieId) continue;
    try {
      const entry = { transaction_date: t.transaction_date, status: t.status, amount: t.amount, description: t.description };
      const created = t.kind === "deposit" ? await live.deposit(account.nessieId, entry) : await live.withdraw(account.nessieId, entry);
      await local.markTransactionSynced(t._id, created._id);
    } catch {
      return;
    }
  }
}

/** Starts the periodic sweep; call the returned function to stop it (tests, graceful shutdown). */
export function startReplaySweep(live: NessieLike, local: LocalNessieLike, intervalMs = 60_000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    replayOnce(live, local)
      .catch((err: unknown) => logger.error({ err }, "nessie replay sweep failed"))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
