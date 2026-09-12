// server/src/test/fake-local-nessie.ts
// An in-memory LocalNessieLike, for testing FailoverNessie and the replay sweep without a database.
import type { Account, AccountType, Customer } from "../adapters/nessie.js";
import type { LocalAccount, LocalCustomer, LocalNessieLike, LocalTx } from "../store/local-nessie.js";

export function fakeLocalNessie(): LocalNessieLike & { customers: LocalCustomer[]; accounts: LocalAccount[]; txns: LocalTx[] } {
  const customers: LocalCustomer[] = [];
  const accounts: LocalAccount[] = [];
  const txns: LocalTx[] = [];
  let seq = 0;
  const id = () => `local-${++seq}`;

  return {
    customers,
    accounts,
    txns,

    async listCustomers() {
      return [...customers];
    },
    async getCustomer(id) {
      return customers.find((c) => c._id === id) ?? null;
    },
    async insertCustomer(c: Omit<Customer, "_id">) {
      const created: LocalCustomer = { ...c, _id: id(), nessieId: null };
      customers.push(created);
      return created;
    },
    async markCustomerSynced(localId, nessieId) {
      const c = customers.find((x) => x._id === localId);
      if (c) c.nessieId = nessieId;
    },

    async listAccounts(customerId) {
      return accounts.filter((a) => a.customer_id === customerId && !a.deleted);
    },
    async getAccount(id) {
      return accounts.find((a) => a._id === id) ?? null;
    },
    async insertAccount(customerId, a: { type: AccountType; nickname: string; balance: number; rewards?: number }) {
      if (a.balance < 0) throw new Error("balance must be >= 0");
      const created: LocalAccount = {
        _id: id(),
        type: a.type,
        nickname: a.nickname,
        rewards: a.rewards ?? 0,
        balance: Math.trunc(a.balance),
        account_number: id(),
        customer_id: customerId,
        nessieId: null,
        deleted: false,
      };
      accounts.push(created);
      return created;
    },
    async markAccountSynced(localId, nessieId) {
      const a = accounts.find((x) => x._id === localId);
      if (a) a.nessieId = nessieId;
    },
    async softDeleteAccount(localId, deleteSynced) {
      const a = accounts.find((x) => x._id === localId);
      if (a) {
        a.deleted = true;
        (a as unknown as { deleteSynced: boolean }).deleteSynced = deleteSynced;
      }
    },
    async markAccountDeleteSynced(localId) {
      const a = accounts.find((x) => x._id === localId);
      if (a) (a as unknown as { deleteSynced: boolean }).deleteSynced = true;
    },

    async insertTransaction(accountId, kind, tx) {
      const created = { _id: id(), accountId, kind, medium: "balance" as const, nessieId: null, ...tx, amount: Math.trunc(tx.amount) } as LocalTx;
      txns.push(created);
      return created;
    },
    async markTransactionSynced(localId, nessieId) {
      const t = txns.find((x) => x._id === localId);
      if (t) t.nessieId = nessieId;
    },
    async listTransactions(accountId, kind) {
      return txns.filter((t) => t.accountId === accountId && t.kind === kind);
    },

    async listUnsyncedCustomers() {
      return customers.filter((c) => c.nessieId === null);
    },
    async listUnsyncedAccounts() {
      return accounts.filter((a) => !a.deleted && a.nessieId === null && customers.find((c) => c._id === a.customer_id)?.nessieId != null);
    },
    async listUnsyncedDeletes() {
      return accounts.filter((a) => a.deleted && a.nessieId != null && !(a as unknown as { deleteSynced?: boolean }).deleteSynced);
    },
    async listUnsyncedTransactions() {
      return txns.filter((t) => {
        const account = accounts.find((a) => a._id === t.accountId);
        return t.nessieId === null && account?.nessieId != null && !account.deleted;
      });
    },
  };
}
