// server/src/store/local-nessie.db.test.ts
// The local Nessie mirror against a real TimescaleDB: same throwaway-database
// pattern as ../runs.db.test.ts. Skipped unless TEST_DATABASE_URL points at a
// server where we may create a database (server/README.md).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { splitSql } from "../sql.js";
import { LocalNessie } from "./local-nessie.js";

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : "set TEST_DATABASE_URL to a TimescaleDB to run (server/README.md)";
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const HOUSTON = { street_number: "6100", street_name: "Main Street", city: "Houston", state: "TX", zip: "77005" };

let admin: pg.Pool;
let db: pg.Pool;
let dbName: string;
let local: LocalNessie;

before(async () => {
  if (!url) return;
  admin = new pg.Pool({ connectionString: url });
  dbName = `larp_test_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const u = new URL(url);
  u.pathname = `/${dbName}`;
  db = new pg.Pool({ connectionString: u.toString() });
  for (const s of splitSql(read("../../../game/db/schema.sql"))) await db.query(s);
  for (const s of splitSql(read("../migrations.sql"))) await db.query(s);
  local = new LocalNessie(db);
});

after(async () => {
  if (!url) return;
  await db.end();
  await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
  await admin.end();
});

test("a customer is created with no nessie id, and can be marked synced", { skip }, async () => {
  const c = await local.insertCustomer({ first_name: "Test", last_name: "fallback-test-customer", address: HOUSTON });
  assert.ok(c._id.startsWith("local-"));
  assert.equal(c.nessieId, null);
  const listed = await local.listCustomers();
  assert.ok(listed.some((x) => x._id === c._id));

  await local.markCustomerSynced(c._id, "real-nessie-id-1");
  const fetched = await local.getCustomer(c._id);
  assert.equal(fetched?.nessieId, "real-nessie-id-1");
  assert.deepEqual(await local.listUnsyncedCustomers(), [], "a synced customer drops out of the unsynced list");
});

test("an account's balance is truncated and a negative balance is rejected", { skip }, async () => {
  const c = await local.insertCustomer({ first_name: "Test", last_name: "fallback-test-customer-2", address: HOUSTON });
  const a = await local.insertAccount(c._id, { type: "Checking", nickname: "t:checking", balance: 500.9 });
  assert.equal(a.balance, 500, "cents are truncated, matching live Nessie");
  assert.equal(a.nessieId, null);
  await assert.rejects(() => local.insertAccount(c._id, { type: "Savings", nickname: "t:savings", balance: -1 }));
});

test("an account only appears as unsynced once its parent customer has synced", { skip }, async () => {
  const c = await local.insertCustomer({ first_name: "Test", last_name: "fallback-test-customer-3", address: HOUSTON });
  const a = await local.insertAccount(c._id, { type: "Checking", nickname: "t:checking", balance: 100 });
  assert.deepEqual(await local.listUnsyncedAccounts(), [], "parent customer isn't synced yet");
  await local.markCustomerSynced(c._id, "real-cust-3");
  const pending = await local.listUnsyncedAccounts();
  assert.ok(pending.some((x) => x._id === a._id));
  await local.markAccountSynced(a._id, "real-acct-3");
  assert.ok(!(await local.listUnsyncedAccounts()).some((x) => x._id === a._id));
});

test("soft-deleting an account hides it from listAccounts and, if it was live, queues a live delete", { skip }, async () => {
  const c = await local.insertCustomer({ first_name: "Test", last_name: "fallback-test-customer-4", address: HOUSTON });
  const a = await local.insertAccount(c._id, { type: "Checking", nickname: "t:checking", balance: 0 });
  await local.markCustomerSynced(c._id, "real-cust-4");
  await local.markAccountSynced(a._id, "real-acct-4");
  await local.softDeleteAccount(a._id, false);
  assert.deepEqual(await local.listAccounts(c._id), []);
  const pendingDeletes = await local.listUnsyncedDeletes();
  assert.ok(pendingDeletes.some((x) => x._id === a._id));
  await local.markAccountDeleteSynced(a._id);
  assert.ok(!(await local.listUnsyncedDeletes()).some((x) => x._id === a._id));
});

test("deposits and withdrawals are stored per account and kind, and only queued for replay once the account is synced", { skip }, async () => {
  const c = await local.insertCustomer({ first_name: "Test", last_name: "fallback-test-customer-5", address: HOUSTON });
  const a = await local.insertAccount(c._id, { type: "Checking", nickname: "t:checking", balance: 0 });
  const tx = await local.insertTransaction(a._id, "deposit", { transaction_date: "2026-09-12", status: "completed", amount: 100.4, description: "larpcity|r1|k1|Paycheck" });
  assert.equal(tx.amount, 100, "cents truncated");
  assert.deepEqual(await local.listUnsyncedTransactions(), [], "account isn't synced yet");
  assert.deepEqual((await local.listTransactions(a._id, "deposit")).map((t) => t._id), [tx._id]);
  assert.deepEqual(await local.listTransactions(a._id, "withdrawal"), []);

  await local.markCustomerSynced(c._id, "real-cust-5");
  await local.markAccountSynced(a._id, "real-acct-5");
  assert.ok((await local.listUnsyncedTransactions()).some((t) => t._id === tx._id));
  await local.markTransactionSynced(tx._id, "real-tx-5");
  assert.ok(!(await local.listUnsyncedTransactions()).some((t) => t._id === tx._id));
});
