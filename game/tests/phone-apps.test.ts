// The phone's Mail, News, and Bank views are plain markup from data, so they test without a browser.

import { test } from "node:test";
import assert from "node:assert/strict";
import { bankHtml, mailHtml, newsHtml } from "../src/ui/phone-apps.ts";
import type { MailItem } from "../src/sim/mail/inbox.ts";

const letter = (o: Partial<MailItem> = {}): MailItem => ({ id: "m1", day: 3, from: "Credit bureau", subject: "Score up to 720", body: "Moved <b>up</b>.", tone: "good", decision: false, read: false, ...o });
const dateOf = (day: number) => new Date(2026, 8, 11 + day);

test("mail lists letters, marks unread, escapes text, and opens one", () => {
  const html = mailHtml([letter(), letter({ id: "m2", read: true, subject: "Old news" })], "m1", dateOf);
  assert.match(html, /data-mail-id="m1"/);
  assert.match(html, /mail-unread/);
  assert.match(html, /&#60;b&#62;up/);
  assert.match(html, /Moved/);
  assert.match(html, /Sep 14/);
  assert.equal(html.match(/mail-unread/g)?.length, 1);
  assert.match(mailHtml([], null, dateOf), /No mail yet/);
  assert.match(mailHtml([letter({ decision: true })], "m1", dateOf), /data-desk/);
  assert.doesNotMatch(mailHtml([letter({ decision: true })], null, dateOf), /data-desk/);
});

test("news shows stories, a loading line, and an off message with a retry", () => {
  assert.match(newsHtml({ status: "loading" }), /Printing/);
  assert.match(newsHtml({ status: "off" }), /newsroom is closed/i);
  assert.match(newsHtml({ status: "off" }), /data-news-retry/);
  const html = newsHtml({ status: "ready", label: "September 2026", stories: [{ title: "Card paid off", where: "Your finances", blurb: "It's gone.", impact: "More room." }] });
  assert.match(html, /Card paid off/);
  assert.match(html, /September 2026/);
  assert.match(html, /It&#39;s gone/);
  assert.match(newsHtml({ status: "ready", label: "May 2027", stories: [] }), /quiet month/);
});

test("the bank shows each mirrored account and its latest transactions", () => {
  const html = bankHtml({
    entity: "player",
    name: "Player",
    run: "r",
    accounts: [{ account: "checking", nessieId: "n1", accountNumber: "123456789", opening: 100, balance: 250, transactions: [{ date: "2026-09-30", amount: 150, memo: "Paycheck", key: "k" }] }],
  });
  assert.match(html, /Checking/);
  assert.match(html, /\$250/);
  assert.match(html, /Paycheck/);
  assert.match(html, /6789/);
  assert.match(bankHtml("off"), /isn't connected/);
  assert.match(bankHtml({ entity: "player", name: "P", run: "r", accounts: [] }), /isn't connected/);
});

test("the bank lists only the newest transactions, newest first, with signed amounts", () => {
  const transactions = Array.from({ length: 8 }, (_, i) => ({ date: `2026-10-0${i + 1}`, amount: i % 2 ? -10 * i : 10 * i, memo: `T${i}`, key: `k${i}` }));
  const html = bankHtml({ entity: "player", name: "P", run: "r", accounts: [{ account: "savings", nessieId: "n", accountNumber: "1", opening: 0, balance: -5, transactions }] });
  assert.doesNotMatch(html, /T2</);
  assert.ok(html.indexOf("T7") < html.indexOf("T3"));
  assert.match(html, /−\$70/);
  assert.match(html, /\+\$60/);
  assert.match(html, /−\$5</);
});
