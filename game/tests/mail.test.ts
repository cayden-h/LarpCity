// Mail inbox tests: which life events become mail, unread counts, and the cap.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Inbox, MAX_MAIL, mailFor } from "../src/sim/mail/inbox.ts";
import type { LifeEvent } from "../src/sim/life/index.ts";

const names = (id: string) => (id === "card" ? { name: "Credit card", kind: "credit_card" as const } : { name: "Personal loan", kind: "personal" as const });
const pay = (day: number, takeHome = 2000, o: { garnished?: number; unemployed?: boolean } = {}): LifeEvent => ({
  type: "paycheck",
  day,
  takeHome,
  garnished: o.garnished ?? 0,
  unemployed: o.unemployed ?? false,
});
const job = (day: number, employed: boolean): LifeEvent => ({ type: "job", day, employed });

test("routine days send no mail, money trouble and wins do", () => {
  assert.equal(mailFor({ type: "payment", day: 3, debtId: "card", amount: 50, interest: 4 }, names), null);
  assert.equal(mailFor({ type: "bill", day: 1, name: "Rent", amount: 1200, paid: 1200 }, names), null);
  const short = mailFor({ type: "bill", day: 1, name: "Rent", amount: 1200, paid: 900 }, names);
  assert.equal(short?.tone, "bad");
  assert.match(short!.subject, /Rent/);
  const late = mailFor({ type: "late_mark", day: 40, debtId: "card", severity: 30, scoreBefore: 700, scoreAfter: 640 }, names);
  assert.match(late!.body, /Credit card/);
  assert.match(late!.body, /640/);
  assert.equal(mailFor({ type: "paid_off", day: 90, debtId: "loan", name: "Personal loan" }, names)?.tone, "good");
  assert.equal(mailFor({ type: "cannot_cover", day: 9, debtId: "card", due: 80, available: 10 }, names)?.decision, true);
  assert.equal(mailFor({ type: "score_change", day: 9, from: 700, to: 704 }, names), null);
  assert.ok(mailFor({ type: "score_change", day: 9, from: 700, to: 720 }, names));
});

test("mailFor stamps the letter with the event kind it came from", () => {
  const l = mailFor({ type: "bill", day: 1, name: "Rent", amount: 1200, paid: 900 }, names);
  assert.equal(l?.kind, "bill");
  const job = mailFor({ type: "job", day: 2, employed: false }, names);
  assert.equal(job?.kind, "job");
});

test("the inbox counts unread mail, marks it read, and keeps the newest", () => {
  const inbox = new Inbox();
  const events: LifeEvent[] = [
    { type: "paycheck", day: 1, takeHome: 2000, garnished: 0, unemployed: false },
    { type: "job", day: 2, employed: false },
  ];
  inbox.add(events, names);
  assert.equal(inbox.unread(), 2);
  assert.equal(inbox.items[0].day, 2, "newest first");
  inbox.markRead(inbox.items[0].id);
  assert.equal(inbox.unread(), 1);
  for (let d = 3; d < 3 + MAX_MAIL + 10; d++) inbox.add([{ type: "job", day: d, employed: d % 2 === 0 }], names);
  assert.equal(inbox.items.length, MAX_MAIL);
});

test("the inbox round-trips through JSON", () => {
  const inbox = new Inbox();
  inbox.add([{ type: "job", day: 2, employed: false }], names);
  const back = new Inbox(JSON.parse(JSON.stringify(inbox.toSave())));
  assert.deepEqual(back.toSave(), inbox.toSave());
  back.add([{ type: "job", day: 3, employed: true }], names);
  assert.notEqual(back.items[0].id, back.items[1].id);
});

test("a paid-off card keeps its line open; a paid-off loan rolls its payment on", () => {
  const card = mailFor({ type: "paid_off", day: 90, debtId: "card", name: "Credit card" }, names)!;
  assert.doesNotMatch(card.body, /next debt/);
  assert.match(card.body, /pay it in full/);
  const loan = mailFor({ type: "paid_off", day: 90, debtId: "loan", name: "Personal loan" }, names)!;
  assert.match(loan.body, /next debt/);
});

test("can't-cover mail names the planned payment, so it agrees with the missed letter", () => {
  const l = mailFor({ type: "cannot_cover", day: 9, debtId: "card", due: 120, available: 10 }, names)!;
  assert.match(l.body, /planned \$120 payment/);
  assert.match(l.body, /only \$10 is available/);
});

test("negative amounts print the sign before the dollar sign", () => {
  const l = mailFor({ type: "market_recovered", day: 9, you: -5, held: 1000, autopilot: 1200 }, names)!;
  assert.match(l.body, /−\$5\b/);
  assert.doesNotMatch(l.body, /\$-/);
});

test("a rewind drops the letters after the day and keeps that day's, read state intact", () => {
  const inbox = new Inbox();
  for (let d = 1; d <= 10; d++) inbox.add([job(d, d % 2 === 0)], names);
  const five = inbox.items.find((m) => m.day === 5)!;
  inbox.markRead(five.id);
  inbox.rewind(5);
  assert.deepEqual(inbox.items.map((m) => m.day), [5, 4, 3, 2, 1]);
  assert.equal(inbox.items[0].read, true);
  assert.equal(inbox.unread(), 4);
  // Numbering carries on, so a new letter never reuses a dropped letter's id.
  const [again] = inbox.add([job(6, true)], names);
  assert.ok(!inbox.items.slice(1).some((m) => m.id === again.id));
});

test("a pay stub arrives only when pay changes", () => {
  const inbox = new Inbox();
  const stubs = (events: LifeEvent[]) => inbox.add(events, names).filter((m) => m.from === "Payroll").length;
  assert.equal(stubs([pay(1)]), 1, "the first paycheck");
  assert.equal(stubs([pay(15), pay(32, 2000.4)]), 0, "the same pay, give or take rounding");
  assert.equal(stubs([pay(46, 2100)]), 1, "a raise");
  assert.equal(stubs([pay(60, 1785, { garnished: 315 })]), 1, "garnishment starts");
  assert.equal(stubs([pay(74, 1785, { garnished: 315 })]), 0);
  assert.equal(stubs([pay(88, 2100)]), 1, "garnishment stops");
  assert.equal(stubs([pay(102, 840, { unemployed: true })]), 1, "unemployment starts");
  assert.equal(stubs([pay(116, 840, { unemployed: true })]), 0);
  assert.equal(stubs([pay(130, 2100)]), 1, "back at work");
});

test("the last pay stub survives a save, and a rewind writes the next one again", () => {
  const inbox = new Inbox();
  inbox.add([pay(1), pay(15)], names);
  const back = new Inbox(JSON.parse(JSON.stringify(inbox.toSave())));
  assert.equal(back.add([pay(32)], names).length, 0, "restored: same pay, no stub");
  back.rewind(20);
  assert.equal(back.add([pay(32)], names).length, 1, "after a rewind the next paycheck writes a stub");
});

test("over the cap, read routine mail goes first and decisions go last", () => {
  const inbox = new Inbox();
  const decision: LifeEvent = { type: "cannot_cover", day: 1, debtId: "card", due: 80, available: 10 };
  inbox.add([decision, { type: "moved", day: 1, from: "TX", to: "CA", rent: 2000, living: 1500 }, job(1, false)], names);
  const [dec, moved, laidOff] = [...inbox.items].reverse();
  inbox.markRead(moved.id);
  inbox.markRead(laidOff.id);
  // 3 letters on day 1, then one a day: the day-(MAX_MAIL - 1) letter makes MAX_MAIL + 1 and evicts one.
  for (let d = 2; d < MAX_MAIL; d++) inbox.add([{ type: "moved", day: d, from: "TX", to: "CA", rent: 2000, living: 1500 }], names);
  assert.equal(inbox.items.length, MAX_MAIL);
  const has = (id: string) => inbox.items.some((m) => m.id === id);
  assert.ok(!has(moved.id), "the read info letter went first");
  assert.ok(has(laidOff.id) && has(dec.id));
  inbox.add([{ type: "moved", day: 300, from: "CA", to: "TX", rent: 1200, living: 1000 }], names);
  assert.ok(!has(laidOff.id), "then the read bad-news letter");
  inbox.add([{ type: "moved", day: 301, from: "TX", to: "CA", rent: 2000, living: 1500 }], names);
  assert.ok(has(dec.id), "unread info goes before a decision");
  assert.ok(!inbox.items.some((m) => m.day === 2), "the oldest unread info letter went");
  assert.equal(inbox.items.at(-1)!.id, dec.id, "the decision is now the oldest letter");
  assert.equal(inbox.items.length, MAX_MAIL);
});

test("letters from one day list the day's last event first", () => {
  const inbox = new Inbox();
  inbox.add([job(4, false), { type: "moved", day: 4, from: "TX", to: "CA", rent: 2000, living: 1500 }], names);
  assert.deepEqual(inbox.items.map((m) => m.from), ["Your new landlord", "HR"]);
});

test("an inbox saved without its counter numbers on past the highest id", () => {
  const inbox = new Inbox();
  inbox.add([job(1, false), job(2, true), job(3, false)], names);
  const { items } = inbox.toSave();
  const back = new Inbox({ items } as unknown as ConstructorParameters<typeof Inbox>[0]);
  const [next] = back.add([job(4, true)], names);
  assert.equal(next.id, "m4");
});
