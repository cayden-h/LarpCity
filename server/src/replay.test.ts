// server/src/replay.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Account, Customer, MoneyTx, NessieLike, NewTx } from "./adapters/nessie.js";
import { fakeLocalNessie } from "./test/fake-local-nessie.js";
import { replayOnce } from "./replay.js";

const HOUSTON = { street_number: "6100", street_name: "Main Street", city: "Houston", state: "TX", zip: "77005" };

function fakeLive(opts: { up?: boolean } = {}): NessieLike & { up: boolean; calls: string[] } {
  let seq = 0;
  const id = () => `live-${++seq}`;
  const calls: string[] = [];
  const state = { up: opts.up ?? true };
  const guard = () => {
    if (!state.up) throw new Error("nessie is down");
  };
  return {
    get up() {
      return state.up;
    },
    set up(v: boolean) {
      state.up = v;
    },
    calls,
    async listCustomers() {
      return [];
    },
    async createCustomer(c: Omit<Customer, "_id">) {
      calls.push("createCustomer");
      guard();
      return { ...c, _id: id() };
    },
    async listAccounts() {
      return [];
    },
    async createAccount(customerId: string, a) {
      calls.push("createAccount");
      guard();
      return { ...a, rewards: a.rewards ?? 0, _id: id(), account_number: id(), customer_id: customerId } as Account;
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
      return [];
    },
    async listWithdrawals() {
      return [];
    },
  } as NessieLike & { up: boolean; calls: string[] };
}

test("replayOnce syncs an unsynced customer, then its account, then its transaction, in that order", async () => {
  const local = fakeLocalNessie();
  const c = await local.insertCustomer({ first_name: "Test", last_name: "replay-customer", address: HOUSTON });
  const a = await local.insertAccount(c._id, { type: "Checking", nickname: "t:checking", balance: 100 });
  await local.insertTransaction(a._id, "deposit", { transaction_date: "2026-09-12", status: "completed", amount: 50, description: "d1" });

  const live = fakeLive();
  await replayOnce(live, local);

  assert.ok((await local.getCustomer(c._id))?.nessieId, "customer synced");
  assert.ok((await local.getAccount(a._id))?.nessieId, "account synced");
  assert.deepEqual(await local.listUnsyncedTransactions(), [], "transaction synced");
  assert.deepEqual(live.calls, ["createCustomer", "createAccount", "deposit"], "replay follows parent-before-child order");
});

test("replayOnce stops at the first failure in a sweep and leaves the rest for next tick", async () => {
  const local = fakeLocalNessie();
  const c1 = await local.insertCustomer({ first_name: "Test", last_name: "replay-fail-1", address: HOUSTON });
  const c2 = await local.insertCustomer({ first_name: "Test", last_name: "replay-fail-2", address: HOUSTON });

  const live = fakeLive({ up: false });
  await replayOnce(live, local);

  assert.equal((await local.getCustomer(c1._id))?.nessieId, null);
  assert.equal((await local.getCustomer(c2._id))?.nessieId, null);
  assert.equal(live.calls.length, 1, "only the first attempt was made before the sweep gave up for this tick");
});

test("replayOnce syncs a queued account delete once its account is live", async () => {
  const local = fakeLocalNessie();
  const c = await local.insertCustomer({ first_name: "Test", last_name: "replay-delete", address: HOUSTON });
  const a = await local.insertAccount(c._id, { type: "Checking", nickname: "t:checking", balance: 0 });
  await local.markCustomerSynced(c._id, "real-c");
  await local.markAccountSynced(a._id, "real-a");
  await local.softDeleteAccount(a._id, false);

  const live = fakeLive();
  await replayOnce(live, local);

  assert.deepEqual(await local.listUnsyncedDeletes(), []);
  assert.ok(live.calls.includes("deleteAccount"));
});

test("a second replayOnce call after live recovers finishes what the first left pending", async () => {
  const local = fakeLocalNessie();
  const c = await local.insertCustomer({ first_name: "Test", last_name: "replay-recovers", address: HOUSTON });
  await local.insertAccount(c._id, { type: "Checking", nickname: "t:checking", balance: 10 });

  const live = fakeLive({ up: false });
  await replayOnce(live, local);
  assert.equal((await local.getCustomer(c._id))?.nessieId, null, "still down on the first tick");

  live.up = true;
  await replayOnce(live, local);
  assert.ok((await local.getCustomer(c._id))?.nessieId, "synced once live recovered");
  assert.ok((await local.listUnsyncedAccounts()).length === 0, "the account synced too, same tick, since its parent just synced");
});

test("replayOnce does not resurrect a soft-deleted, never-synced account into live Nessie", async () => {
  const local = fakeLocalNessie();
  const c = await local.insertCustomer({ first_name: "Test", last_name: "replay-deleted-account", address: HOUSTON });
  const a = await local.insertAccount(c._id, { type: "Checking", nickname: "t:checking", balance: 0 });
  await local.insertTransaction(a._id, "deposit", { transaction_date: "2026-09-12", status: "completed", amount: 25, description: "d1" });
  // Neither the account nor its transaction ever synced live before the account was deleted,
  // so nothing exists live to delete: delete_synced = true, same as FailoverNessie.deleteAccount does.
  await local.softDeleteAccount(a._id, true);

  const live = fakeLive();
  await replayOnce(live, local);

  assert.ok((await local.getCustomer(c._id))?.nessieId, "customer still syncs");
  assert.deepEqual(live.calls, ["createCustomer"], "the deleted account (and its transaction) must not be replayed live");
  assert.deepEqual(await local.listUnsyncedAccounts(), [], "the deleted account must not linger as pending work");
  assert.deepEqual(await local.listUnsyncedTransactions(), [], "the deleted account's transaction must not linger as pending work either");
});
