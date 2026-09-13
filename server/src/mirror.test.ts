// server/src/mirror.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Nessie } from "./adapters/nessie.js";
import { entriesBody, MAX_NPC_CUSTOMERS, MirrorError, MirrorService, openBody, type MirrorEntry } from "./mirror.js";
import { fakeNessie } from "./test/fake-nessie.js";

const SESSION_A = "11111111-aaaa-4aaa-8aaa-111111111111";
const SESSION_B = "22222222-bbbb-4bbb-8bbb-222222222222";
const OPENING = { checking: 1200, savings: 2500, credit: 7000 };

function setup() {
  const fake = fakeNessie();
  const nessie = new Nessie({ baseUrl: "https://nessie.test", apiKey: "k", fetchFn: fake.fetchFn, retries: 0 });
  return { fake, nessie, mirror: new MirrorService(nessie, "larpcity") };
}

const entry = (key: string, account: MirrorEntry["account"], kind: MirrorEntry["kind"], amount: number, memo = key): MirrorEntry => ({
  key,
  account,
  kind,
  amount,
  date: "2026-09-30",
  memo,
});

test("open makes one customer and three accounts, and reopening the same run reuses them", async () => {
  const { fake, mirror } = setup();
  const first = await mirror.open(SESSION_A, "player", { run: "r1", opening: OPENING });
  assert.deepEqual(first, { run: "r1", reused: 0, balances: OPENING });
  assert.equal(fake.customers.length, 1);
  assert.equal(fake.customers[0].last_name, "larpcity-player-11111111aaaa");
  assert.deepEqual(fake.accounts.map((a) => a.type), ["Checking", "Savings", "Credit Card"]);

  const again = await mirror.open(SESSION_A, "player", { run: "r1", opening: { checking: 1, savings: 1, credit: 1 } });
  assert.equal(again.reused, 3);
  assert.deepEqual(again.balances, OPENING, "a reopen reports what Nessie holds, not the new opening");
  assert.equal(fake.accounts.length, 3);
});

test("entries post once per key and the statement adds them to the opening balance", async () => {
  const { fake, mirror } = setup();
  await mirror.open(SESSION_A, "npc-maya", { run: "r1", name: "Maya", opening: OPENING });
  const batch = [
    entry("2026-09:checking:paycheck", "checking", "deposit", 2450, "Paycheck"),
    entry("2026-09:checking:rent", "checking", "withdrawal", 1317, "Rent"),
    entry("2026-09:credit:payment", "credit", "withdrawal", 300, "Payment"),
  ];
  assert.deepEqual(await mirror.post(SESSION_A, "npc-maya", { run: "r1", entries: batch }), {
    posted: 3,
    skipped: 0,
    balances: { checking: 1200 + 2450 - 1317, savings: 2500, credit: 6700 },
  });
  const retried = await mirror.post(SESSION_A, "npc-maya", { run: "r1", entries: batch });
  assert.equal(retried.posted, 0);
  assert.equal(retried.skipped, 3);
  assert.equal(fake.txns.length, 3);

  const s = await mirror.statement(SESSION_A, "npc-maya");
  assert.equal(s.name, "Maya");
  const checking = s.accounts.find((a) => a.account === "checking")!;
  assert.equal(checking.opening, 1200);
  assert.equal(checking.balance, 2333);
  assert.deepEqual(checking.transactions.map((t) => [t.memo, t.amount]), [["Paycheck", 2450], ["Rent", -1317]]);
  assert.equal(s.accounts.find((a) => a.account === "credit")!.balance, 6700);
});

test("a new run replaces only this session's accounts; NPC customers are shared", async () => {
  const { fake, mirror } = setup();
  await mirror.open(SESSION_A, "npc-maya", { run: "r1", opening: OPENING });
  await mirror.open(SESSION_B, "npc-maya", { run: "r9", opening: OPENING });
  assert.equal(fake.customers.length, 1, "one Maya customer for every session");
  assert.equal(fake.accounts.length, 6);

  await mirror.open(SESSION_A, "npc-maya", { run: "r2", opening: OPENING });
  const nicknames = fake.accounts.map((a) => a.nickname).sort();
  assert.equal(fake.accounts.length, 6);
  assert.ok(nicknames.every((n) => !n.includes(":r1:")), "session A's old run is gone");
  assert.equal(nicknames.filter((n) => n.includes(":r9:")).length, 3, "session B's run is untouched");
});

test("posting needs an open run, and a restarted server reads back what it already posted", async () => {
  const { nessie, mirror } = setup();
  await assert.rejects(mirror.post(SESSION_A, "player", { run: "r1", entries: [] }), (e: MirrorError) => e.status === 409);

  await mirror.open(SESSION_A, "player", { run: "r1", opening: OPENING });
  const batch = [entry("2026-09:checking:paycheck", "checking", "deposit", 2000)];
  await mirror.post(SESSION_A, "player", { run: "r1", entries: batch });

  const restarted = new MirrorService(nessie, "larpcity");
  assert.equal((await restarted.statement(SESSION_A, "player")).accounts[0].balance, 3200, "found by nickname after a restart");
  const reopened = await restarted.open(SESSION_A, "player", { run: "r1", opening: OPENING });
  assert.equal(reopened.balances.checking, 3200);
  assert.equal((await restarted.post(SESSION_A, "player", { run: "r1", entries: batch })).skipped, 1);
});

test("no more than the cap of NPC customers is ever created", async () => {
  const { fake, mirror } = setup();
  for (let i = 0; i < MAX_NPC_CUSTOMERS; i++) {
    await mirror.open(SESSION_A, `npc-${"abcdefghijklmnop"[i]}x`, { run: "r1", opening: OPENING });
  }
  await assert.rejects(mirror.open(SESSION_A, "npc-extra", { run: "r1", opening: OPENING }), (e: MirrorError) => e.status === 429);
  assert.equal(fake.customers.length, MAX_NPC_CUSTOMERS);
  await mirror.open(SESSION_B, "player", { run: "r1", opening: OPENING });
  assert.equal(fake.customers.length, MAX_NPC_CUSTOMERS + 1, "players don't count toward the NPC cap");
});

test("two sessions' statements for the same shared NPC customer never mix", async () => {
  const { mirror } = setup();
  await mirror.open(SESSION_A, "npc-maya", { run: "r1", name: "Maya", opening: OPENING });
  await mirror.post(SESSION_A, "npc-maya", { run: "r1", entries: [entry("a1", "checking", "deposit", 50)] });

  await mirror.open(SESSION_B, "npc-maya", { run: "r1", name: "Maya", opening: OPENING });
  await mirror.post(SESSION_B, "npc-maya", { run: "r1", entries: [entry("b1", "checking", "deposit", 999)] });

  const a = await mirror.statement(SESSION_A, "npc-maya");
  const b = await mirror.statement(SESSION_B, "npc-maya");

  const checkingA = a.accounts.find((x) => x.account === "checking")!;
  const checkingB = b.accounts.find((x) => x.account === "checking")!;
  assert.equal(checkingA.balance, OPENING.checking + 50, "session A sees only its own +50");
  assert.equal(checkingB.balance, OPENING.checking + 999, "session B sees only its own +999");
  assert.ok(!checkingA.transactions.some((t) => t.memo === "b1"), "session A must never see session B's transaction");
  assert.ok(!checkingB.transactions.some((t) => t.memo === "a1"), "session B must never see session A's transaction");
});

test("statement for an entity that was never opened is a 404", async () => {
  const { mirror } = setup();
  await assert.rejects(mirror.statement(SESSION_A, "npc-maya"), (e: MirrorError) => e.status === 404);
});

test("concurrent first opens for different entities share one customer load and don't clobber each other", async () => {
  const { fake, mirror } = setup();
  await Promise.all([
    mirror.open(SESSION_A, "player", { run: "r1", opening: OPENING }),
    mirror.open(SESSION_A, "npc-maya", { run: "r1", opening: OPENING }),
    mirror.open(SESSION_A, "npc-leo", { run: "r1", opening: OPENING }),
  ]);
  assert.equal(fake.customers.length, 3, "each entity got its own customer on the first open");

  // A same-process reopen must find all three by name, not recreate any of them.
  await Promise.all([
    mirror.open(SESSION_A, "player", { run: "r2", opening: OPENING }),
    mirror.open(SESSION_A, "npc-maya", { run: "r2", opening: OPENING }),
    mirror.open(SESSION_A, "npc-leo", { run: "r2", opening: OPENING }),
  ]);
  assert.equal(fake.customers.length, 3, "reopening the same entities never creates duplicate customers");
});

test("two sessions opening the same NPC for the first time at once still create only one customer", async () => {
  const { fake, mirror } = setup();
  await Promise.all([
    mirror.open(SESSION_A, "npc-maya", { run: "r1", opening: OPENING }),
    mirror.open(SESSION_B, "npc-maya", { run: "r1", opening: OPENING }),
  ]);
  assert.equal(fake.customers.length, 1, "one Maya customer, not two");
});

test("concurrent first opens of different NPCs can't pass the cap together", async () => {
  const { fake, mirror } = setup();
  for (let i = 0; i < MAX_NPC_CUSTOMERS - 1; i++) {
    await mirror.open(SESSION_A, `npc-${"abcdefghijklmnop"[i]}x`, { run: "r1", opening: OPENING });
  }
  const results = await Promise.allSettled(["npc-ya", "npc-yb", "npc-yc"].map((e) => mirror.open(SESSION_A, e, { run: "r1", opening: OPENING })));
  assert.equal(fake.customers.length, MAX_NPC_CUSTOMERS);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  for (const r of results) if (r.status === "rejected") assert.equal((r.reason as MirrorError).status, 429);
});

/** A mirror whose Nessie fails the first `times` requests that match. */
function failing(match: (method: string, path: string) => boolean, times = 1) {
  const fake = fakeNessie();
  let left = times;
  const fetchFn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    if (left > 0 && match(init.method ?? "GET", new URL(String(input)).pathname)) {
      left--;
      return new Response('"down"', { status: 500 });
    }
    return fake.fetchFn(input, init);
  }) as typeof fetch;
  const nessie = new Nessie({ baseUrl: "https://nessie.test", apiKey: "k", fetchFn, retries: 0 });
  return { fake, mirror: new MirrorService(nessie, "larpcity") };
}

test("a failed load of the customer list is asked for again next time", async () => {
  const { fake, mirror } = failing((m, p) => m === "GET" && p === "/customers");
  await assert.rejects(mirror.open(SESSION_A, "npc-maya", { run: "r1", opening: OPENING }));
  await mirror.open(SESSION_A, "npc-maya", { run: "r1", opening: OPENING });
  assert.equal(fake.customers.length, 1);
});

test("a rejected customer create lets the next open create it", async () => {
  const { fake, mirror } = failing((m, p) => m === "POST" && p === "/customers");
  await assert.rejects(mirror.open(SESSION_A, "npc-maya", { run: "r1", opening: OPENING }));
  assert.equal(fake.customers.length, 0);
  await mirror.open(SESSION_A, "npc-maya", { run: "r1", opening: OPENING });
  await mirror.open(SESSION_A, "npc-leo", { run: "r1", opening: OPENING });
  assert.equal(fake.customers.length, 2, "the failed create didn't block the NPC lock either");
});

test("a MirrorService constructed with a higher cap allows more NPC customers than the module default", async () => {
  const fake = fakeNessie();
  const nessie = new Nessie({ baseUrl: "https://nessie.test", apiKey: "k", fetchFn: fake.fetchFn, retries: 0 });
  const mirror = new MirrorService(nessie, "bgtest", 60);
  for (let i = 0; i < 20; i++) {
    await mirror.open(SESSION_A, `npc-bg${i}`, { run: "r1", name: `Bg${i}`, opening: { checking: 0, savings: 0, credit: 0 } });
  }
  // 20 > the module's MAX_NPC_CUSTOMERS (12) but under this instance's own cap of 60.
  assert.equal(fake.customers.length, 20);
});

test("the default cap (no third argument) is unchanged at MAX_NPC_CUSTOMERS", async () => {
  const fake = fakeNessie();
  const nessie = new Nessie({ baseUrl: "https://nessie.test", apiKey: "k", fetchFn: fake.fetchFn, retries: 0 });
  const mirror = new MirrorService(nessie, "captest");
  for (let i = 0; i < MAX_NPC_CUSTOMERS; i++) {
    await mirror.open(SESSION_A, `npc-x${i}`, { run: "r1", name: `X${i}`, opening: { checking: 0, savings: 0, credit: 0 } });
  }
  await assert.rejects(
    () => mirror.open(SESSION_A, "npc-over", { run: "r1", name: "Over", opening: { checking: 0, savings: 0, credit: 0 } }),
    /At most \d+ NPC customers/,
  );
});

test("request bodies are validated before anything reaches Nessie", () => {
  assert.ok(openBody.safeParse({ run: "20260912-abc", name: "Maya", opening: OPENING }).success);
  assert.ok(!openBody.safeParse({ run: "has space", opening: OPENING }).success);
  assert.ok(!openBody.safeParse({ run: "r1", opening: { ...OPENING, credit: -5 } }).success, "Nessie can't open below zero");
  assert.ok(!openBody.safeParse({ run: "r1", opening: { ...OPENING, checking: 10.5 } }).success, "Nessie truncates cents");
  assert.ok(!entriesBody.safeParse({ run: "r1", entries: [{ ...entry("k", "checking", "deposit", 5), amount: 0 }] }).success);
  assert.ok(!entriesBody.safeParse({ run: "r1", entries: [{ ...entry("k", "checking", "deposit", 5), key: "bad key|x" }] }).success);
  assert.ok(!entriesBody.safeParse({ run: "r1", entries: Array.from({ length: 201 }, (_, i) => entry(`k${i}`, "checking", "deposit", 1)) }).success);
});
