// server/src/adapters/failover-nessie.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Account, Customer, MoneyTx, NessieLike, NewTx } from "./nessie.js";
import { FailoverNessie } from "./failover-nessie.js";
import { fakeLocalNessie } from "../test/fake-local-nessie.js";

const HOUSTON = { street_number: "6100", street_name: "Main Street", city: "Houston", state: "TX", zip: "77005" };

/** A fake live Nessie that can be told to fail, and mints ids prefixed "live-" so they're easy to spot in assertions. */
function fakeLive(opts: { up?: boolean } = {}): NessieLike & { up: boolean; calls: string[] } {
  let up = opts.up ?? true;
  let seq = 0;
  const id = () => `live-${++seq}`;
  const guard = () => {
    if (!up) throw new Error("nessie is down");
  };
  const calls: string[] = [];
  return {
    calls,
    set up(v: boolean) {
      up = v;
    },
    async listCustomers() {
      calls.push("listCustomers");
      guard();
      return [];
    },
    async createCustomer(c: Omit<Customer, "_id">) {
      calls.push("createCustomer");
      guard();
      return { ...c, _id: id() };
    },
    async listAccounts() {
      calls.push("listAccounts");
      guard();
      return [];
    },
    async createAccount(customerId: string, a) {
      calls.push("createAccount");
      guard();
      // A single id() call: two calls here would silently consume an extra sequence number and
      // throw off the "live-N" assertions in the tests below, which assume one id per live call.
      const newId = id();
      return { ...a, rewards: a.rewards ?? 0, _id: newId, account_number: newId, customer_id: customerId } as Account;
    },
    async deleteAccount() {
      calls.push("deleteAccount");
      guard();
    },
    async deposit(_accountId: string, tx: NewTx) {
      calls.push("deposit");
      guard();
      return { ...tx, _id: id(), medium: "balance" } as MoneyTx;
    },
    async withdraw(_accountId: string, tx: NewTx) {
      calls.push("withdraw");
      guard();
      return { ...tx, _id: id(), medium: "balance" } as MoneyTx;
    },
    async listDeposits() {
      calls.push("listDeposits");
      guard();
      return [];
    },
    async listWithdrawals() {
      calls.push("listWithdrawals");
      guard();
      return [];
    },
  } as NessieLike & { up: boolean; calls: string[] };
}

test("when live Nessie is up, writes sync immediately and get a nessieId", async () => {
  const live = fakeLive();
  const local = fakeLocalNessie();
  const failover = new FailoverNessie(live, local);

  const customer = await failover.createCustomer({ first_name: "Test", last_name: "up-customer", address: HOUSTON });
  assert.equal(local.customers[0].nessieId, "live-1", "shadow-written to local with the live id recorded");

  const account = await failover.createAccount(customer._id, { type: "Checking", nickname: "t:checking", balance: 100 });
  assert.equal(local.accounts[0].nessieId, "live-2");

  const tx = await failover.deposit(account._id, { transaction_date: "2026-09-12", status: "completed", amount: 50, description: "d1" });
  assert.equal(local.txns[0].nessieId, "live-3");
  assert.equal(tx._id, local.txns[0]._id, "returns the local row");
});

test("when live Nessie is down, writes still succeed locally and stay unsynced", async () => {
  const live = fakeLive({ up: false });
  const local = fakeLocalNessie();
  const failover = new FailoverNessie(live, local);

  const customer = await failover.createCustomer({ first_name: "Test", last_name: "down-customer", address: HOUSTON });
  assert.ok(customer._id.startsWith("local-"));
  assert.equal(local.customers[0].nessieId, null);

  const account = await failover.createAccount(customer._id, { type: "Checking", nickname: "t:checking", balance: 100 });
  assert.equal(local.accounts[0].nessieId, null);

  await failover.deposit(account._id, { transaction_date: "2026-09-12", status: "completed", amount: 50, description: "d1" });
  assert.equal(local.txns[0].nessieId, null);

  const listed = await failover.listAccounts(customer._id);
  assert.equal(listed.length, 1, "reads come from local, so the fallback account is still visible");
});

test("an account creation is not even attempted against live until its parent customer has synced", async () => {
  const live = fakeLive({ up: false });
  const local = fakeLocalNessie();
  const failover = new FailoverNessie(live, local);

  const customer = await failover.createCustomer({ first_name: "Test", last_name: "unsynced-parent", address: HOUSTON });
  await failover.createAccount(customer._id, { type: "Checking", nickname: "t:checking", balance: 100 });

  assert.deepEqual(live.calls, ["createCustomer"], "createAccount never called live, since the customer never synced");
});

test("a deposit is not attempted against live until its account has synced", async () => {
  const live = fakeLive();
  const local = fakeLocalNessie();
  const failover = new FailoverNessie(live, local);
  const customer = await failover.createCustomer({ first_name: "Test", last_name: "deposit-parent-test", address: HOUSTON });
  const account = await failover.createAccount(customer._id, { type: "Checking", nickname: "t:checking", balance: 100 });
  assert.ok(local.accounts[0].nessieId, "account synced live in this test");

  live.up = false;
  await failover.deposit(account._id, { transaction_date: "2026-09-12", status: "completed", amount: 10, description: "d" });
  assert.equal(local.txns[0].nessieId, null, "the deposit attempt failed live and stayed local-only");
});

test("deleteAccount soft-deletes locally and, if the account was live, tries a live delete too", async () => {
  const live = fakeLive();
  const local = fakeLocalNessie();
  const failover = new FailoverNessie(live, local);
  const customer = await failover.createCustomer({ first_name: "Test", last_name: "delete-test", address: HOUSTON });
  const account = await failover.createAccount(customer._id, { type: "Checking", nickname: "t:checking", balance: 100 });

  await failover.deleteAccount(account._id);
  assert.deepEqual(await failover.listAccounts(customer._id), [], "deleted accounts drop out of listAccounts");
  assert.ok(live.calls.includes("deleteAccount"), "a live-synced account gets a live delete attempt");
});

test("listCustomers, listDeposits, and listWithdrawals never call live", async () => {
  const live = fakeLive();
  const local = fakeLocalNessie();
  const failover = new FailoverNessie(live, local);
  const customer = await failover.createCustomer({ first_name: "Test", last_name: "read-only-test", address: HOUSTON });
  const account = await failover.createAccount(customer._id, { type: "Checking", nickname: "t:checking", balance: 100 });
  await failover.deposit(account._id, { transaction_date: "2026-09-12", status: "completed", amount: 10, description: "d" });
  live.calls.length = 0;

  await failover.listCustomers();
  await failover.listDeposits(account._id);
  await failover.listWithdrawals(account._id);
  assert.deepEqual(live.calls, [], "all three reads were served from local");
});

test("a localOnly FailoverNessie never calls live.createCustomer, even when live would succeed", async () => {
  const live = fakeLive();
  const local = fakeLocalNessie();
  const failover = new FailoverNessie(live, local, { localOnly: true });

  await failover.createCustomer({ first_name: "Bg", last_name: "Npc", address: HOUSTON });
  assert.equal(live.calls.length, 0, "live.createCustomer was never called");
  assert.equal(local.customers[0].nessieId, null);
});
