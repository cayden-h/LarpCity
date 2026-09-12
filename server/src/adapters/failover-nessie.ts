// server/src/adapters/failover-nessie.ts
// Sits between MirrorService and live Nessie (docs/superpowers/specs/2026-09-12-nessie-fallback-design.md):
// every write tries live first and falls back to the local mirror on failure; every read comes
// from local only, since local shadow-copies every successful live write too. No circuit breaker,
// no manual toggle — each call independently decides, every time.
import type { LocalNessieLike } from "../store/local-nessie.js";
import type { Account, AccountType, Customer, MoneyTx, NessieLike, NewTx } from "./nessie.js";

export class FailoverNessie implements NessieLike {
  constructor(
    private readonly live: NessieLike,
    private readonly local: LocalNessieLike,
  ) {}

  async listCustomers(): Promise<Customer[]> {
    return this.local.listCustomers();
  }

  async createCustomer(c: Omit<Customer, "_id">): Promise<Customer> {
    const created = await this.local.insertCustomer(c);
    try {
      const live = await this.live.createCustomer(c);
      await this.local.markCustomerSynced(created._id, live._id);
    } catch {
      // stays local-only; the replay sweep will retry once live recovers
    }
    return created;
  }

  async listAccounts(customerId: string): Promise<Account[]> {
    return this.local.listAccounts(customerId);
  }

  async createAccount(
    customerId: string,
    a: { type: AccountType; nickname: string; balance: number; rewards?: number },
  ): Promise<Account> {
    const created = await this.local.insertAccount(customerId, a);
    const customer = await this.local.getCustomer(customerId);
    if (customer?.nessieId) {
      try {
        const live = await this.live.createAccount(customer.nessieId, a);
        await this.local.markAccountSynced(created._id, live._id);
      } catch {
        // stays local-only
      }
    }
    return created;
  }

  async deleteAccount(id: string): Promise<void> {
    const account = await this.local.getAccount(id);
    if (!account) return;
    const deleteSynced = !account.nessieId; // nothing live to delete if it never synced
    await this.local.softDeleteAccount(id, deleteSynced);
    if (account.nessieId) {
      try {
        await this.live.deleteAccount(account.nessieId);
        await this.local.markAccountDeleteSynced(id);
      } catch {
        // delete_synced stays false; the replay sweep retries
      }
    }
  }

  async deposit(accountId: string, tx: NewTx): Promise<MoneyTx> {
    return this.postTx(accountId, "deposit", tx);
  }

  async withdraw(accountId: string, tx: NewTx): Promise<MoneyTx> {
    return this.postTx(accountId, "withdrawal", tx);
  }

  private async postTx(accountId: string, kind: "deposit" | "withdrawal", tx: NewTx): Promise<MoneyTx> {
    const entry = { transaction_date: tx.transaction_date, status: tx.status, amount: tx.amount, description: tx.description };
    const created = await this.local.insertTransaction(accountId, kind, entry);
    const account = await this.local.getAccount(accountId);
    if (account?.nessieId) {
      try {
        const live = kind === "deposit" ? await this.live.deposit(account.nessieId, tx) : await this.live.withdraw(account.nessieId, tx);
        await this.local.markTransactionSynced(created._id, live._id);
      } catch {
        // stays local-only
      }
    }
    return created;
  }

  async listDeposits(accountId: string): Promise<MoneyTx[]> {
    return this.local.listTransactions(accountId, "deposit");
  }

  async listWithdrawals(accountId: string): Promise<MoneyTx[]> {
    return this.local.listTransactions(accountId, "withdrawal");
  }
}
