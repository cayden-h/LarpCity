// server/src/adapters/nessie.ts
// Capital One Nessie client. Request and response shapes were checked against
// the live API on 2026-09-12 (SETUP.md, "What the live API does"):
//
// - The key goes in the query string, so it is redacted from every error.
// - POST responses wrap the new object as { code, message, objectCreated }.
// - Nessie never applies transactions to `balance`: it is set once when the
//   account is created (cents truncated, never below zero), and PUT ignores
//   it. The simulation owns balances; Nessie is the log that mirrors it.
// - Amounts are truncated to whole dollars.
// - Transfers take no payee, so a transfer is recorded on the sending account
//   only; to move money between two mirrored accounts, post a withdrawal and a
//   deposit with the same description.
// - Purchases need a merchant; loans and bills are free-form records.
// - Accounts can be deleted; customers and merchants cannot (403).
// - Any transaction_date is accepted, past or future.
// - GET /customers lists only this key's customers, but /enterprise/* and
//   /accounts list every team's data: never send real names or PII.

export type AccountType = "Checking" | "Savings" | "Credit Card";
export type TxStatus = "pending" | "cancelled" | "completed";

export interface Address {
  street_number: string;
  street_name: string;
  city: string;
  state: string;
  zip: string;
}

export interface Customer {
  _id: string;
  first_name: string;
  last_name: string;
  address: Address;
}

export interface Account {
  _id: string;
  type: AccountType;
  nickname: string;
  rewards: number;
  /** The opening balance; Nessie never changes it. */
  balance: number;
  account_number: string;
  customer_id: string;
}

export interface MoneyTx {
  _id: string;
  medium: "balance" | "rewards";
  transaction_date: string;
  status: TxStatus;
  amount: number;
  description: string;
}

export interface Transfer {
  _id: string;
  transaction_date: string;
  status: TxStatus;
  amount: number;
  description: string;
}

export interface Bill {
  _id: string;
  status: TxStatus | "recurring";
  payee: string;
  nickname: string;
  payment_date: string;
  recurring_date: number;
  upcoming_payment_date?: string;
  payment_amount: number;
  account_id: string;
}

export interface Loan {
  _id: string;
  type: "home" | "auto" | "small business";
  status: string;
  credit_score: number;
  monthly_payment: number;
  amount: number;
  description: string;
}

export class NessieError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "NessieError";
    this.status = status;
  }
}

type NewTx = Omit<MoneyTx, "_id" | "medium"> & { medium?: MoneyTx["medium"] };

export interface NessieOptions {
  baseUrl: string;
  apiKey: string;
  fetchFn?: typeof fetch;
  /** Retries for throttling (any method) and server errors on reads and deletes. Default 2. */
  retries?: number;
  retryDelayMs?: number;
}

export class Nessie {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;
  private readonly retries: number;
  private readonly retryDelayMs: number;

  constructor(opts: NessieOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.fetchFn = opts.fetchFn ?? ((...a) => fetch(...a));
    this.retries = opts.retries ?? 2;
    this.retryDelayMs = opts.retryDelayMs ?? 300;
  }

  // Customers (cannot be deleted)
  listCustomers = () => this.call<Customer[]>("GET", "/customers");
  createCustomer = (c: Omit<Customer, "_id">) => this.call<Customer>("POST", "/customers", c);

  // Accounts
  listAccounts = (customerId: string) => this.call<Account[]>("GET", `/customers/${customerId}/accounts`);
  getAccount = (id: string) => this.call<Account>("GET", `/accounts/${id}`);
  createAccount = (customerId: string, a: { type: AccountType; nickname: string; balance: number; rewards?: number }) =>
    this.call<Account>("POST", `/customers/${customerId}/accounts`, { rewards: 0, ...a });
  renameAccount = (id: string, nickname: string) => this.call<Account>("PUT", `/accounts/${id}`, { nickname });
  deleteAccount = (id: string) => this.call<void>("DELETE", `/accounts/${id}`);

  // Transactions
  deposit = (accountId: string, tx: NewTx) => this.call<MoneyTx>("POST", `/accounts/${accountId}/deposits`, { medium: "balance", ...tx });
  withdraw = (accountId: string, tx: NewTx) => this.call<MoneyTx>("POST", `/accounts/${accountId}/withdrawals`, { medium: "balance", ...tx });
  transfer = (accountId: string, tx: Omit<Transfer, "_id">) => this.call<Transfer>("POST", `/accounts/${accountId}/transfers`, tx);
  createBill = (accountId: string, b: Omit<Bill, "_id" | "account_id" | "upcoming_payment_date">) =>
    this.call<Bill>("POST", `/accounts/${accountId}/bills`, b);
  createLoan = (accountId: string, l: Omit<Loan, "_id">) => this.call<Loan>("POST", `/accounts/${accountId}/loans`, l);

  listDeposits = (accountId: string) => this.list<MoneyTx>(`/accounts/${accountId}/deposits`);
  listWithdrawals = (accountId: string) => this.list<MoneyTx>(`/accounts/${accountId}/withdrawals`);
  listTransfers = (accountId: string) => this.list<Transfer>(`/accounts/${accountId}/transfers`);
  listBills = (accountId: string) => this.list<Bill>(`/accounts/${accountId}/bills`);

  /** List endpoints answer 404 with a message instead of [] when there is nothing yet. */
  private async list<T>(path: string): Promise<T[]> {
    try {
      return await this.call<T[]>("GET", path);
    } catch (e) {
      if (e instanceof NessieError && e.status === 404) return [];
      throw e;
    }
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once<T>(method, path, body);
      } catch (e) {
        // Retry only what can't double-post: throttling anywhere, server errors on reads and deletes.
        const retryable = e instanceof NessieError && (e.status === 429 || (e.status >= 500 && method !== "POST"));
        if (!retryable || attempt >= this.retries) throw e;
        await new Promise((r) => setTimeout(r, this.retryDelayMs * 2 ** attempt));
      }
    }
  }

  private async once<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}?key=${encodeURIComponent(this.apiKey)}`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new NessieError(502, `Nessie ${method} ${path} failed: ${this.redact(e instanceof Error ? e.message : String(e))}`);
    }
    const text = await res.text();
    if (!res.ok) throw new NessieError(res.status, `Nessie ${method} ${path} ${res.status}: ${this.redact(text).slice(0, 300)}`);
    if (!text) return undefined as T;
    const json = JSON.parse(text) as { objectCreated?: T; objectUpdated?: T } & T;
    return (json.objectCreated ?? json.objectUpdated ?? json) as T;
  }

  private redact(s: string): string {
    return this.apiKey ? s.split(this.apiKey).join("***") : s;
  }
}
