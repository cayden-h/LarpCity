// server/src/adapters/nessie.test.ts
// Against a fake fetch that answers the way the live API did on 2026-09-12.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Nessie, NessieError } from "./nessie.js";

const KEY = "0123456789abcdef0123456789abcdef";

function fakeFetch(respond: (url: URL, init: RequestInit) => { status: number; body: unknown }) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const { status, body } = respond(url, init);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fn, calls };
}

const client = (fn: typeof fetch, retries = 0) => new Nessie({ baseUrl: "https://api.nessieisreal.com/", apiKey: KEY, fetchFn: fn, retries, retryDelayMs: 1 });

test("sends the key in the query string and unwraps objectCreated", async () => {
  const { fn, calls } = fakeFetch(() => ({
    status: 201,
    body: { code: 201, message: "Account created", objectCreated: { _id: "a1", type: "Checking", balance: 500 } },
  }));
  const acct = await client(fn).createAccount("c1", { type: "Checking", nickname: "larpcity:npc-maya:s:r1:checking", balance: 500 });
  assert.equal(acct._id, "a1");
  assert.equal(calls[0].url.pathname, "/customers/c1/accounts");
  assert.equal(calls[0].url.searchParams.get("key"), KEY);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { rewards: 0, type: "Checking", nickname: "larpcity:npc-maya:s:r1:checking", balance: 500 });
});

test("deposits and withdrawals default to the balance medium", async () => {
  const { fn, calls } = fakeFetch(() => ({ status: 201, body: { objectCreated: { _id: "d1" } } }));
  await client(fn).withdraw("a1", { transaction_date: "2026-09-30", status: "completed", amount: 1317, description: "larpcity|r1|2026-09:checking:rent|Rent" });
  assert.equal(calls[0].url.pathname, "/accounts/a1/withdrawals");
  assert.equal(JSON.parse(String(calls[0].init.body)).medium, "balance");
});

test("errors carry the status and never the key", async () => {
  const { fn } = fakeFetch((url) => ({ status: 400, body: `"bad request for ${url}"` }));
  await assert.rejects(client(fn).getAccount("a1"), (e: NessieError) => {
    assert.equal(e.status, 400);
    assert.ok(!e.message.includes(KEY), e.message);
    assert.ok(e.message.includes("***"));
    return true;
  });
});

test("empty transaction lists come back as [] instead of a 404", async () => {
  const { fn } = fakeFetch(() => ({ status: 404, body: '"No transfers found for this account"' }));
  assert.deepEqual(await client(fn).listTransfers("a1"), []);
  await assert.rejects(client(fn).getAccount("a1"), (e: NessieError) => e.status === 404);
});

test("DELETE with an empty body resolves", async () => {
  const { fn } = fakeFetch(() => ({ status: 200, body: "" }));
  assert.equal(await client(fn).deleteAccount("a1"), undefined);
});

test("a hung request times out instead of hanging forever, and maps to a 504", async () => {
  const hang = (async (input: string | URL | Request, init: RequestInit = {}) => {
    return new Promise<Response>((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  }) as typeof fetch;
  const c = new Nessie({ baseUrl: "https://api.nessieisreal.com/", apiKey: KEY, fetchFn: hang, retries: 0, timeoutMs: 10 });
  await assert.rejects(c.getAccount("a1"), (e: NessieError) => {
    assert.equal(e.status, 504);
    assert.ok(!e.message.includes(KEY), e.message);
    return true;
  });
});

test("reads retry server errors, but a POST that may have landed is never retried", async () => {
  let n = 0;
  const flaky = fakeFetch(() => (++n < 3 ? { status: 503, body: "busy" } : { status: 200, body: [] }));
  assert.deepEqual(await client(flaky.fn, 2).listCustomers(), []);
  assert.equal(flaky.calls.length, 3);

  const failing = fakeFetch(() => ({ status: 500, body: "oops" }));
  await assert.rejects(client(failing.fn, 2).deposit("a1", { transaction_date: "2026-09-30", status: "completed", amount: 5, description: "x" }));
  assert.equal(failing.calls.length, 1);

  let m = 0;
  const throttled = fakeFetch(() => (++m < 2 ? { status: 429, body: "slow down" } : { status: 201, body: { objectCreated: { _id: "d1" } } }));
  await client(throttled.fn, 2).deposit("a1", { transaction_date: "2026-09-30", status: "completed", amount: 5, description: "x" });
  assert.equal(throttled.calls.length, 2, "a 429 was refused, so it is safe to retry");
});
