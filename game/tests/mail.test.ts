// Mail inbox tests: which life events become mail, unread counts, and the cap.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Inbox, MAX_MAIL, mailFor } from "../src/sim/mail/inbox.ts";
import type { LifeEvent } from "../src/sim/life/index.ts";

const names = (id: string) => (id === "card" ? "Credit card" : "Personal loan");

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
