// server/src/test/fake-nessie.ts
// An in-memory Nessie that behaves the way the live API did on 2026-09-12:
// POSTs wrap the new object in `objectCreated`, account balances never move,
// cents are truncated, negative balances are rejected, empty transaction
// lists answer 404, and customers can't be deleted.

import type { Account, Customer, MoneyTx } from "../adapters/nessie.js";

interface Stored extends MoneyTx {
  accountId: string;
  kind: "deposits" | "withdrawals";
}

export function fakeNessie() {
  const customers: Customer[] = [];
  const accounts: Account[] = [];
  const txns: Stored[] = [];
  const calls: string[] = [];
  let seq = 0;
  const id = () => `id-${++seq}`;
  const json = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

  const fetchFn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const path = url.pathname;
    calls.push(`${method} ${path}`);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    let m: RegExpMatchArray | null;

    if (path === "/customers" && method === "GET") return json(200, customers);
    if (path === "/customers" && method === "POST") {
      const c: Customer = { ...body, _id: id() };
      customers.push(c);
      return json(201, { code: 201, message: "Customer created", objectCreated: c });
    }
    if ((m = path.match(/^\/customers\/([^/]+)$/)) && method === "DELETE") return json(403, { message: "Missing Authentication Token" });
    if ((m = path.match(/^\/customers\/([^/]+)\/accounts$/))) {
      const customerId = m[1];
      if (method === "GET") return json(200, accounts.filter((a) => a.customer_id === customerId));
      if (body.balance < 0) return json(400, '"ensure this value is greater than or equal to 0"');
      const a: Account = { ...body, balance: Math.trunc(body.balance), _id: id(), account_number: String(1e15 + seq), customer_id: customerId };
      accounts.push(a);
      return json(201, { code: 201, message: "Account created", objectCreated: a });
    }
    if ((m = path.match(/^\/accounts\/([^/]+)$/))) {
      const i = accounts.findIndex((a) => a._id === m![1]);
      if (i < 0) return json(404, '"Account not found"');
      if (method === "DELETE") {
        accounts.splice(i, 1);
        return json(200, "");
      }
      return json(200, accounts[i]);
    }
    if ((m = path.match(/^\/accounts\/([^/]+)\/(deposits|withdrawals)$/))) {
      const [, accountId, kind] = m as unknown as [string, string, "deposits" | "withdrawals"];
      if (method === "POST") {
        const t: Stored = { ...body, amount: Math.trunc(body.amount), _id: id(), accountId, kind };
        txns.push(t);
        return json(201, { code: 201, message: "Created", objectCreated: t });
      }
      const list = txns.filter((t) => t.accountId === accountId && t.kind === kind);
      return list.length ? json(200, list) : json(404, `"No ${kind} found for this account"`);
    }
    return json(403, { message: "Missing Authentication Token" });
  }) as typeof fetch;

  return { fetchFn, customers, accounts, txns, calls };
}
