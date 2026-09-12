// server/src/store/local-nessie.ts
// The local half of the Nessie fallback (docs/superpowers/specs/2026-09-12-nessie-fallback-design.md):
// a Postgres-backed mirror of every customer/account/transaction the bank mirror has ever created,
// live or local-only. Local ids are permanent; nessieId is filled in once a live Nessie call for
// that row actually succeeds — nothing ever renames or remaps a local id.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Account, AccountType, Customer, MoneyTx } from "../adapters/nessie.js";

export interface LocalCustomer extends Customer {
  nessieId: string | null;
}
export interface LocalAccount extends Account {
  nessieId: string | null;
  deleted: boolean;
}
export interface LocalTx extends MoneyTx {
  nessieId: string | null;
  accountId: string;
  kind: "deposit" | "withdrawal";
}

export interface LocalNessieLike {
  listCustomers(): Promise<LocalCustomer[]>;
  getCustomer(id: string): Promise<LocalCustomer | null>;
  insertCustomer(c: Omit<Customer, "_id">): Promise<LocalCustomer>;
  markCustomerSynced(id: string, nessieId: string): Promise<void>;

  listAccounts(customerId: string): Promise<LocalAccount[]>;
  getAccount(id: string): Promise<LocalAccount | null>;
  insertAccount(customerId: string, a: { type: AccountType; nickname: string; balance: number; rewards?: number }): Promise<LocalAccount>;
  markAccountSynced(id: string, nessieId: string): Promise<void>;
  softDeleteAccount(id: string, deleteSynced: boolean): Promise<void>;
  markAccountDeleteSynced(id: string): Promise<void>;

  insertTransaction(accountId: string, kind: "deposit" | "withdrawal", tx: { transaction_date: string; status: string; amount: number; description: string }): Promise<LocalTx>;
  markTransactionSynced(id: string, nessieId: string): Promise<void>;
  listTransactions(accountId: string, kind: "deposit" | "withdrawal"): Promise<LocalTx[]>;

  listUnsyncedCustomers(): Promise<LocalCustomer[]>;
  listUnsyncedAccounts(): Promise<LocalAccount[]>;
  listUnsyncedDeletes(): Promise<LocalAccount[]>;
  listUnsyncedTransactions(): Promise<LocalTx[]>;
}

const localId = () => `local-${randomUUID()}`;

const CUSTOMER_COLS = `id AS "_id", first_name, last_name, address, nessie_id AS "nessieId"`;
const ACCOUNT_COLS = `id AS "_id", type, nickname, rewards, balance, account_number, customer_id, nessie_id AS "nessieId", deleted`;
const TX_COLS = `id AS "_id", account_id AS "accountId", kind, amount, transaction_date, status, description, nessie_id AS "nessieId"`;

export class LocalNessie implements LocalNessieLike {
  constructor(private readonly db: pg.Pool) {}

  async listCustomers(): Promise<LocalCustomer[]> {
    const { rows } = await this.db.query<LocalCustomer>(`SELECT ${CUSTOMER_COLS} FROM nessie_customers ORDER BY created_at`);
    return rows;
  }

  async getCustomer(id: string): Promise<LocalCustomer | null> {
    const { rows } = await this.db.query<LocalCustomer>(`SELECT ${CUSTOMER_COLS} FROM nessie_customers WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  async insertCustomer(c: Omit<Customer, "_id">): Promise<LocalCustomer> {
    const { rows } = await this.db.query<LocalCustomer>(
      `INSERT INTO nessie_customers (id, first_name, last_name, address) VALUES ($1, $2, $3, $4) RETURNING ${CUSTOMER_COLS}`,
      [localId(), c.first_name, c.last_name, JSON.stringify(c.address)],
    );
    return rows[0];
  }

  async markCustomerSynced(id: string, nessieId: string): Promise<void> {
    await this.db.query(`UPDATE nessie_customers SET nessie_id = $2 WHERE id = $1`, [id, nessieId]);
  }

  async listAccounts(customerId: string): Promise<LocalAccount[]> {
    const { rows } = await this.db.query<LocalAccount>(
      `SELECT ${ACCOUNT_COLS} FROM nessie_accounts WHERE customer_id = $1 AND NOT deleted ORDER BY created_at`,
      [customerId],
    );
    return rows;
  }

  async getAccount(id: string): Promise<LocalAccount | null> {
    const { rows } = await this.db.query<LocalAccount>(`SELECT ${ACCOUNT_COLS} FROM nessie_accounts WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  async insertAccount(customerId: string, a: { type: AccountType; nickname: string; balance: number; rewards?: number }): Promise<LocalAccount> {
    const balance = Math.trunc(a.balance);
    if (balance < 0) throw new Error("balance must be >= 0");
    const { rows } = await this.db.query<LocalAccount>(
      `INSERT INTO nessie_accounts (id, customer_id, type, nickname, rewards, balance, account_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${ACCOUNT_COLS}`,
      [localId(), customerId, a.type, a.nickname, a.rewards ?? 0, balance, String(1_000_000_000_000_000 + Math.floor(Math.random() * 1e9))],
    );
    return rows[0];
  }

  async markAccountSynced(id: string, nessieId: string): Promise<void> {
    await this.db.query(`UPDATE nessie_accounts SET nessie_id = $2 WHERE id = $1`, [id, nessieId]);
  }

  async softDeleteAccount(id: string, deleteSynced: boolean): Promise<void> {
    await this.db.query(`UPDATE nessie_accounts SET deleted = true, delete_synced = $2 WHERE id = $1`, [id, deleteSynced]);
  }

  async markAccountDeleteSynced(id: string): Promise<void> {
    await this.db.query(`UPDATE nessie_accounts SET delete_synced = true WHERE id = $1`, [id]);
  }

  async insertTransaction(
    accountId: string,
    kind: "deposit" | "withdrawal",
    tx: { transaction_date: string; status: string; amount: number; description: string },
  ): Promise<LocalTx> {
    const { rows } = await this.db.query<Omit<LocalTx, "medium">>(
      `INSERT INTO nessie_transactions (id, account_id, kind, amount, transaction_date, status, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${TX_COLS}`,
      [localId(), accountId, kind, Math.trunc(tx.amount), tx.transaction_date, tx.status, tx.description],
    );
    return { ...rows[0], medium: "balance" as const };
  }

  async markTransactionSynced(id: string, nessieId: string): Promise<void> {
    await this.db.query(`UPDATE nessie_transactions SET nessie_id = $2 WHERE id = $1`, [id, nessieId]);
  }

  async listTransactions(accountId: string, kind: "deposit" | "withdrawal"): Promise<LocalTx[]> {
    const { rows } = await this.db.query<Omit<LocalTx, "medium">>(
      `SELECT ${TX_COLS} FROM nessie_transactions WHERE account_id = $1 AND kind = $2 ORDER BY created_at`,
      [accountId, kind],
    );
    return rows.map((r) => ({ ...r, medium: "balance" as const }));
  }

  async listUnsyncedCustomers(): Promise<LocalCustomer[]> {
    const { rows } = await this.db.query<LocalCustomer>(`SELECT ${CUSTOMER_COLS} FROM nessie_customers WHERE nessie_id IS NULL ORDER BY created_at`);
    return rows;
  }

  async listUnsyncedAccounts(): Promise<LocalAccount[]> {
    const { rows } = await this.db.query<LocalAccount>(
      `SELECT a.id AS "_id", a.type, a.nickname, a.rewards, a.balance, a.account_number, a.customer_id,
              a.nessie_id AS "nessieId", a.deleted
       FROM nessie_accounts a JOIN nessie_customers c ON c.id = a.customer_id
       WHERE a.nessie_id IS NULL AND c.nessie_id IS NOT NULL ORDER BY a.created_at`,
    );
    return rows;
  }

  async listUnsyncedDeletes(): Promise<LocalAccount[]> {
    const { rows } = await this.db.query<LocalAccount>(
      `SELECT ${ACCOUNT_COLS} FROM nessie_accounts WHERE deleted AND NOT delete_synced AND nessie_id IS NOT NULL ORDER BY created_at`,
    );
    return rows;
  }

  async listUnsyncedTransactions(): Promise<LocalTx[]> {
    const { rows } = await this.db.query<Omit<LocalTx, "medium">>(
      `SELECT t.id AS "_id", t.account_id AS "accountId", t.kind, t.amount, t.transaction_date, t.status,
              t.description, t.nessie_id AS "nessieId"
       FROM nessie_transactions t JOIN nessie_accounts a ON a.id = t.account_id
       WHERE t.nessie_id IS NULL AND a.nessie_id IS NOT NULL ORDER BY t.created_at`,
    );
    return rows.map((r) => ({ ...r, medium: "balance" as const }));
  }
}
