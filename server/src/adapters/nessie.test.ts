// server/src/adapters/nessie.test.ts
import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getAccount } from "./nessie.js";

afterEach(() => {
  mock.reset();
});

test("getAccount unwraps a plain JSON response", async () => {
  mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ _id: "acc_1", balance: 500 }), { status: 200 }),
  );
  const result = await getAccount("acc_1");
  assert.deepEqual(result, { _id: "acc_1", balance: 500 });
});

test("getAccount throws on a non-ok response", async () => {
  mock.method(globalThis, "fetch", async () => new Response("not found", { status: 404 }));
  await assert.rejects(() => getAccount("missing"));
});
