// Wire contract between the game's bank mirror (this folder) and the server
// (server/src/mirror.ts). No imports, so the server can import it as is.

/** The three Nessie accounts each mirrored life gets. */
export type MirrorAccount = "checking" | "savings" | "credit";

/**
 * Whole-dollar balances (Nessie truncates cents). Savings is savings plus the
 * emergency fund; credit is what the credit cards owe, as a positive number,
 * because Nessie can't open an account below zero.
 */
export type MirrorBalances = Record<MirrorAccount, number>;

export interface MirrorEntry {
  /** Unique within the run for this entity; a repeated key is never posted twice. */
  key: string;
  account: MirrorAccount;
  /**
   * A deposit adds to the account's balance and a withdrawal subtracts. On the
   * credit account the balance is what's owed, so a payment is a withdrawal
   * and interest or new charges are deposits.
   */
  kind: "deposit" | "withdrawal";
  /** Whole dollars, above zero. */
  amount: number;
  /** Game date, YYYY-MM-DD. */
  date: string;
  memo: string;
}

/** POST /api/bank/:entity/open */
export interface MirrorOpenRequest {
  run: string;
  /** First name for the Nessie customer (NPCs); the player's is "Player". */
  name?: string;
  opening: MirrorBalances;
}

export interface MirrorOpenResponse {
  run: string;
  /** Accounts that already existed for this run (a reopen after a restart or a lost response). */
  reused: number;
  /** What Nessie's transactions add up to now; the game continues from these. */
  balances: MirrorBalances;
}

/** POST /api/bank/:entity/entries */
export interface MirrorEntriesRequest {
  run: string;
  entries: MirrorEntry[];
}

export interface MirrorEntriesResponse {
  posted: number;
  skipped: number;
}

export interface BankTransaction {
  date: string;
  /** Signed: positive adds to the balance. */
  amount: number;
  memo: string;
  key: string;
}

export interface BankAccountView {
  account: MirrorAccount;
  nessieId: string;
  accountNumber: string;
  opening: number;
  /** Opening plus this run's transactions (Nessie never updates its own `balance`). */
  balance: number;
  transactions: BankTransaction[];
}

/** GET /api/bank/:entity (the session's statement). */
export interface BankView {
  entity: string;
  name: string;
  run: string;
  accounts: BankAccountView[];
}
