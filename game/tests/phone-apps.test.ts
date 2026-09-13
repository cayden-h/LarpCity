// The phone's Mail, News, and Bank views are plain markup from data, so they test without a browser.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BankApp, bankHtml, ledgerRange, mailHtml, NewsApp, newsHtml, type BankStatement, type Story } from "../src/ui/phone-apps.ts";
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

test("mail escapes the id and tone a save brings back", () => {
  const html = mailHtml([letter({ id: 'm1"><img src=x>', tone: 'good" onclick="x' as never })], null, dateOf);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /onclick="x/);
  assert.match(html, /data-mail-id="m1&#34;&#62;&#60;img/);
});

test("the credit card shows what's owed: a charge is red and a payment is green", () => {
  const card = (balance: number, transactions: BankStatement["accounts"][number]["transactions"]): BankStatement => ({
    entity: "player",
    name: "P",
    run: "r",
    accounts: [{ account: "credit", nessieId: "n", accountNumber: "4242", opening: 1000, balance, transactions }],
  });
  const html = bankHtml(
    card(1200, [
      { date: "2026-10-02", amount: 250, memo: "Groceries", key: "a" },
      { date: "2026-10-03", amount: -50, memo: "Payment", key: "b" },
    ]),
  );
  assert.match(html, /<strong class="down">\$1,200 owed<\/strong>/);
  assert.match(html, /Groceries[^]*?<span class="bank-amt down">−\$250</);
  assert.match(html, /Payment[^]*?<span class="bank-amt up">\+\$50</);
  assert.match(bankHtml(card(0, [])), /\$0 owed/);
  assert.match(bankHtml(card(-40, [])), /<strong class="up">\$40 credit/);
});

test("the Ledger covers the days played so far in the game's first month", () => {
  // The game starts on September 11, 2026 (day 0); day 5 is September 16.
  assert.deepEqual(ledgerRange(5, new Date(2026, 8, 16)), { from: 0, to: 5, label: "September 2026, so far" });
});

test("the Ledger's first whole month starts on day 0, partway through it", () => {
  // October 10 is day 29; October 1 is day 20, so September is days 0 to 19.
  assert.deepEqual(ledgerRange(29, new Date(2026, 9, 10)), { from: 0, to: 19, label: "September 2026" });
});

test("the Ledger in January covers December of the year before", () => {
  // January 5, 2027 is day 116; January 1 is day 112 and December 1 is day 81.
  assert.deepEqual(ledgerRange(116, new Date(2027, 0, 5)), { from: 81, to: 111, label: "December 2026" });
});

const story = (title: string): Story => ({ title, where: "Downtown", blurb: "b", impact: "i" });
const tick = () => new Promise<void>((r) => setImmediate(r));

function newsRig() {
  const target = { innerHTML: "" };
  const calls: { runId: string; from: number; to: number }[] = [];
  const answers: ((r: { stories: Story[] }) => void)[] = [];
  const recorder = { runId: "r1" as string | null, idle: async () => undefined, tick: async () => undefined };
  const news = new NewsApp({
    target,
    day: () => 5,
    date: () => new Date(2026, 8, 16),
    recorder,
    fetchNews: (b) => {
      calls.push(b);
      return new Promise((r) => answers.push(r));
    },
  });
  return { target, calls, answers, recorder, news };
}

test("a Ledger answer from before a rewind is neither drawn nor cached", async () => {
  const { target, calls, answers, recorder, news } = newsRig();
  const first = news.load();
  await tick();
  news.rewound();
  recorder.runId = "r2";
  answers[0]({ stories: [story("Old timeline")] });
  await first;
  assert.doesNotMatch(target.innerHTML, /Old timeline/);
  const second = news.load();
  await tick();
  assert.equal(calls.length, 2, "the rewound Ledger asks again");
  assert.equal(calls[1].runId, "r2");
  answers[1]({ stories: [story("New timeline")] });
  await second;
  assert.match(target.innerHTML, /New timeline/);
});

test("opening News twice while it prints sends one request, and reopening uses the cache", async () => {
  const { target, calls, answers, news } = newsRig();
  const a = news.load();
  const b = news.load();
  await tick();
  assert.equal(calls.length, 1);
  answers[0]({ stories: [story("Card paid off")] });
  await Promise.all([a, b]);
  assert.match(target.innerHTML, /Card paid off/);
  target.innerHTML = "";
  await news.load();
  assert.equal(calls.length, 1);
  assert.match(target.innerHTML, /Card paid off/);
});

test("a Ledger answer that arrives after the player left News isn't drawn, but is kept", async () => {
  const { target, calls, answers, news } = newsRig();
  const p = news.load();
  await tick();
  news.leave();
  answers[0]({ stories: [story("Late edition")] });
  await p;
  assert.doesNotMatch(target.innerHTML, /Late edition/);
  await news.load();
  assert.equal(calls.length, 1);
  assert.match(target.innerHTML, /Late edition/);
});

test("a bank statement that arrives after the player left Bank isn't drawn", async () => {
  const target = { innerHTML: "" };
  let answer: (s: BankStatement) => void = () => undefined;
  const bank = new BankApp({ target, fetchStatement: () => new Promise((r) => (answer = r)) });
  const p = bank.load();
  bank.leave();
  answer({ entity: "player", name: "P", run: "r", accounts: [{ account: "checking", nessieId: "n", accountNumber: "1", opening: 0, balance: 99, transactions: [] }] });
  await p;
  assert.match(target.innerHTML, /Calling the bank/);
});
