// server/src/adapters/nessie.ts
import { env } from "../env.js";

async function nessie<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${env.NESSIE_BASE_URL}${path}?key=${env.NESSIE_API_KEY}`;
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`Nessie ${method} ${path} ${r.status} ${await r.text()}`);
  const j = (await r.json()) as any;
  return (j.objectCreated ?? j) as T;
}

export interface NessieAccounts {
  customerId: string;
  checkingId: string;
  savingsId: string;
  creditId: string;
}

export async function provisionPlayer(playerId: string): Promise<NessieAccounts> {
  const customer = await nessie<{ _id: string }>("POST", "/customers", {
    first_name: "Larp",
    last_name: `${env.NESSIE_TAG}-${playerId.slice(0, 6)}`,
    address: { street_number: "6100", street_name: "Main Street", city: "Houston", state: "TX", zip: "77005" },
  });

  const open = (type: string, balance: number) =>
    nessie<{ _id: string }>("POST", `/customers/${customer._id}/accounts`, {
      type,
      nickname: `${env.NESSIE_TAG}:${playerId}:${type}`,
      rewards: 0,
      balance,
    });

  const [checking, savings, credit] = await Promise.all([
    open("Checking", 500),
    open("Savings", 0),
    open("Credit Card", 0),
  ]);

  return {
    customerId: customer._id,
    checkingId: checking._id,
    savingsId: savings._id,
    creditId: credit._id,
  };
}

export async function getAccount(accountId: string): Promise<unknown> {
  return nessie("GET", `/accounts/${accountId}`);
}

export async function postDeposit(accountId: string, amount: number, description: string): Promise<unknown> {
  return nessie("POST", `/accounts/${accountId}/deposits`, {
    medium: "balance",
    transaction_date: new Date().toISOString().slice(0, 10),
    status: "completed",
    amount,
    description,
  });
}
