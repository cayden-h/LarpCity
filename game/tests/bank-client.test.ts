import { test } from "node:test";
import assert from "node:assert/strict";
import { BankClient } from "../src/api/bank.ts";
import type { BankView } from "../src/sim/mirror/types.ts";

function fakeView(entity: string): BankView {
  return { entity, name: entity, run: "r1", accounts: [] };
}

test("caches a statement for the TTL instead of refetching", async () => {
  let calls = 0;
  const fetchFn = (async () => {
    calls++;
    return { ok: true, json: async () => fakeView("npc-maya") } as Response;
  }) as typeof fetch;
  const client = new BankClient("/api/bank", fetchFn);

  await client.statement("npc-maya");
  await client.statement("npc-maya");
  assert.equal(calls, 1, "second call within the TTL should hit the cache");
});

test("de-dupes concurrent in-flight requests for the same entity", async () => {
  let calls = 0;
  let resolveFetch!: (r: Response) => void;
  const fetchFn = (async () => {
    calls++;
    return new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
  }) as typeof fetch;
  const client = new BankClient("/api/bank", fetchFn);

  const a = client.statement("npc-maya");
  const b = client.statement("npc-maya");
  resolveFetch({ ok: true, json: async () => fakeView("npc-maya") } as Response);
  await Promise.all([a, b]);
  assert.equal(calls, 1, "two concurrent clicks should share one request");
});

test("force bypasses the cache", async () => {
  let calls = 0;
  const fetchFn = (async () => {
    calls++;
    return { ok: true, json: async () => fakeView("npc-maya") } as Response;
  }) as typeof fetch;
  const client = new BankClient("/api/bank", fetchFn);
  await client.statement("npc-maya");
  await client.statement("npc-maya", { force: true });
  assert.equal(calls, 2);
});

test("a non-ok response rejects and does not poison the cache", async () => {
  const fetchFn = (async () => ({ ok: false, status: 502 }) as Response) as typeof fetch;
  const client = new BankClient("/api/bank", fetchFn);
  await assert.rejects(() => client.statement("npc-maya"));
});
