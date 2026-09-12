// Debt system tests. Run with `npm test` (Node's built-in runner; Node 23+
// strips the TypeScript types natively, so there are no test dependencies).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cardMinimum,
  cardPayoff,
  compareStrategies,
  creditCard,
  enrollHardship,
  fileBankruptcy,
  installment,
  monthlyPayment,
  newBook,
  passesMeansTest,
  payNow,
  rapMonthlyPayment,
  sampleHousehold,
  scoreBreakdown,
  studentLoan,
  switchToRap,
  tickDay,
  utilizationFactor,
  type DebtBook,
  type DebtEvent,
  type Wallet,
} from "../src/sim/debt/index.ts";

const START = new Date(2026, 8, 11);
const dateOf = (day: number) => {
  const d = new Date(START);
  d.setDate(d.getDate() + day);
  return d;
};

function wallet(cash: number): Wallet & { cash: number } {
  return {
    cash,
    available() {
      return this.cash;
    },
    withdraw(amount) {
      const take = Math.min(amount, this.cash);
      this.cash -= take;
      return take;
    },
  };
}

/** Runs the daily engine for `days`, optionally depositing a paycheck on the 1st and 15th. */
function run(book: DebtBook, days: number, w: Wallet & { cash: number }, paycheck = 0, from = 0): DebtEvent[] {
  const events: DebtEvent[] = [];
  for (let day = from + 1; day <= from + days; day++) {
    const date = dateOf(day);
    if (paycheck && (date.getDate() === 1 || date.getDate() === 15)) w.cash += paycheck;
    events.push(...tickDay(book, { day, date, env: { cashRateAnnual: 0.043 }, wallet: w }));
  }
  return events;
}

test("amortized payments match the research numbers", () => {
  assert.equal(Math.round(monthlyPayment(35_000, 0.069, 60)), 691);
  assert.equal(Math.round(monthlyPayment(35_000, 0.1611, 72)), 761);
  assert.equal(Math.round(monthlyPayment(320_000, 0.0676, 360)), 2078);
  assert.equal(monthlyPayment(1_200, 0, 12), 100);
});

test("card minimum is the greater of $25 or 1% plus interest", () => {
  assert.equal(cardMinimum(1_000, 20), 30);
  assert.equal(cardMinimum(500, 5), 25);
  assert.equal(cardMinimum(10, 0.2), 10.2);
});

test("minimum payments on $5,000 at 23.96% take 19.5 years", () => {
  const min = cardPayoff(5_000, 0.2396, "minimum");
  assert.equal(min.months, 234);
  assert.equal(Math.round(min.interest), 8871);
  const fixed = cardPayoff(5_000, 0.2396, 200);
  assert.equal(fixed.months, 35);
  assert.equal(Math.round(fixed.interest), 1995);
});

test("RAP payments follow the July 2026 brackets", () => {
  assert.equal(rapMonthlyPayment(8_000), 10);
  assert.equal(Math.round(rapMonthlyPayment(50_000) * 100) / 100, 166.67);
  assert.equal(Math.round(rapMonthlyPayment(50_000, 2) * 100) / 100, 66.67);
  assert.equal(rapMonthlyPayment(30_000), 50);
  assert.equal(rapMonthlyPayment(250_000), 250_000 * 0.1 / 12);
});

test("utilization factor is piecewise and bounded", () => {
  assert.equal(utilizationFactor(0.05), 1);
  assert.equal(utilizationFactor(0.3), 0.85);
  assert.equal(utilizationFactor(0.5), 0.5);
  assert.equal(utilizationFactor(1.4), 0.2);
});

test("scores stay in 300-850 and a clean thin file lands in the 600s", () => {
  const book = newBook({ debts: [], agi: 40_000, monthlyTakeHome: 2_800, day: 0, historyYears: 0 });
  assert.ok(book.profile.score >= 300 && book.profile.score <= 850);
  const thin = scoreBreakdown(book.profile, [], 0, 0).score;
  assert.ok(thin >= 600 && thin < 700, `thin file score ${thin}`);
});

test("paying the statement in full keeps the card in grace with no interest", () => {
  const card = creditCard({ id: "c", name: "Card", balance: 0, limit: 5_000, apr: 0.24, day: 0, dueDayOfMonth: 12 });
  card.autopay = "statement";
  const book = newBook({ debts: [card], agi: 60_000, monthlyTakeHome: 4_000, day: 0 });
  card.balance = 1_000; // purchases this cycle
  run(book, 120, wallet(10_000));
  assert.equal(book.interestPaid, 0);
});

test("payments before the due date count toward the statement, and the count resets each statement", () => {
  const card = creditCard({ id: "c", name: "Card", balance: 2_000, limit: 5_000, apr: 0.24, day: 0, dueDayOfMonth: 12 });
  card.autopay = "none";
  const book = newBook({ debts: [card], agi: 60_000, monthlyTakeHome: 4_000, day: 0 });
  const w = wallet(10_000);
  // Live until the first statement closes.
  let day = 0;
  while (!run(book, 1, w, 0, day++).some((e) => e.type === "statement")) assert.ok(day < 45, "a statement should close within a cycle");
  const stmt = card.statementBalance!;
  assert.equal(card.statementPaid, 0);

  // Two extra payments before the due date add up to the whole statement.
  const ctx = () => ({ day, date: dateOf(day), env: { cashRateAnnual: 0.043 }, wallet: w });
  payNow(book, "c", stmt - 500, ctx());
  assert.ok(Math.abs(card.statementPaid! - (stmt - 500)) < 0.01);
  payNow(book, "c", 500, ctx());
  // New purchases keep the card open (a card paid down to $0 counts as paid off).
  card.balance += 250;
  const before = w.cash;
  run(book, card.statementDueDay! - day, w, 0, day);
  assert.equal(w.cash, before, "nothing more is due: the early payments covered the minimum");
  day = card.statementDueDay!;
  assert.equal(card.inGrace, true, "paid in full before the due date");
  assert.equal(card.pastDue, 0);

  // The next statement starts the count over.
  while (!run(book, 1, w, 0, day++).some((e) => e.type === "statement")) assert.ok(day < 120);
  assert.equal(card.statementPaid, 0);
});

test("missing card payments walks the ladder: late marks, penalty APR, collections", () => {
  const card = creditCard({ id: "c", name: "Card", balance: 3_000, limit: 5_000, apr: 0.22, day: 0, dueDayOfMonth: 12 });
  const book = newBook({ debts: [card], agi: 40_000, monthlyTakeHome: 2_800, day: 0 });
  const startScore = book.profile.score;
  const events = run(book, 260, wallet(0));
  const marks = events.filter((e) => e.type === "late_mark").map((e) => (e.type === "late_mark" ? e.severity : 0));
  assert.deepEqual(marks, [30, 60, 90, 120]);
  assert.ok(events.some((e) => e.type === "penalty_apr"));
  assert.ok(events.some((e) => e.type === "collections"));
  assert.equal(card.status, "collections");
  assert.ok(book.profile.score < startScore - 100, `score fell from ${startScore} to ${book.profile.score}`);
  assert.ok(book.feesPaid >= 32);
});

test("a hardship program re-ages a late account so no more marks are reported", () => {
  const card = creditCard({ id: "c", name: "Card", balance: 3_000, limit: 5_000, apr: 0.22, day: 0, dueDayOfMonth: 12 });
  const book = newBook({ debts: [card], agi: 40_000, monthlyTakeHome: 2_800, day: 0 });
  const w = wallet(0);
  run(book, 70, w);
  assert.ok(book.profile.lateMarks.length >= 1);
  const marksBefore = book.profile.lateMarks.length;
  enrollHardship(book, "c", 70);
  w.cash = 5_000;
  run(book, 120, w, 0, 70);
  assert.equal(book.profile.lateMarks.length, marksBefore);
  assert.equal(card.status, "current");
});

test("a repossessed car leaves a deficiency balance in collections", () => {
  const car = installment({ id: "car", kind: "auto", name: "Car", balance: 20_000, apr: 0.07, months: 60, day: 0 });
  const book = newBook({ debts: [car], agi: 40_000, monthlyTakeHome: 2_800, day: 0 });
  const events = run(book, 150, wallet(0));
  const repo = events.find((e) => e.type === "repossessed");
  assert.ok(repo && repo.type === "repossessed");
  assert.ok(repo.deficiency > 6_000 && repo.deficiency < 8_000);
  assert.equal(car.status, "collections");
});

test("RAP never lets a student balance grow, even when the payment is below the interest", () => {
  const loan = studentLoan({ id: "s", name: "Student", balance: 60_000, apr: 0.0652, plan: "rap", agi: 25_000, day: 0 });
  const book = newBook({ debts: [loan], agi: 25_000, monthlyTakeHome: 1_900, day: 0 });
  assert.equal(loan.scheduledPayment, rapMonthlyPayment(25_000));
  run(book, 400, wallet(10_000));
  assert.ok(loan.balance < 60_000, `balance ${loan.balance}`);
});

test("a defaulted student loan triggers garnishment and RAP cures it", async () => {
  const { garnishmentRate } = await import("../src/sim/debt/index.ts");
  const loan = studentLoan({ id: "s", name: "Student", balance: 20_000, plan: "standard", agi: 30_000, day: 0 });
  const book = newBook({ debts: [loan], agi: 30_000, monthlyTakeHome: 2_100, day: 0 });
  run(book, 320, wallet(0));
  assert.equal(loan.status, "default");
  assert.equal(garnishmentRate(book), 0.15);
  switchToRap(book, "s");
  assert.equal(garnishmentRate(book), 0);
  assert.equal(loan.scheduledPayment, 50);
});

test("snowball pays a debt off first; avalanche pays less interest; extra money beats order", () => {
  const book = sampleHousehold(0);
  const cmp = compareStrategies(book.debts, 300);
  assert.ok(cmp.snowball.payoffs[0].month < cmp.avalanche.payoffs[0].month);
  assert.equal(cmp.snowball.payoffs[0].name, "Furniture loan");
  assert.ok(cmp.avalanche.interest <= cmp.snowball.interest);
  assert.ok(cmp.minimums.interest - cmp.avalanche.interest > cmp.snowball.interest - cmp.avalanche.interest);
  assert.ok(cmp.minimums.months > cmp.avalanche.months);
});

test("the daily engine is deterministic", () => {
  const a = sampleHousehold(0, "avalanche", 300);
  const b = sampleHousehold(0, "avalanche", 300);
  const ea = run(a, 400, wallet(0), 1_825);
  const eb = run(b, 400, wallet(0), 1_825);
  assert.deepEqual(ea, eb);
  assert.deepEqual(a, b);
});

test("the daily engine pays the sample household down faster under avalanche than minimums", () => {
  const owedTotal = (b: DebtBook) => b.debts.reduce((s, d) => s + d.balance + d.accrued, 0);
  const avalanche = sampleHousehold(0, "avalanche", 300);
  const minimums = sampleHousehold(0, "minimums", 300);
  const start = owedTotal(avalanche);
  run(avalanche, 365, wallet(0), 1_825);
  run(minimums, 365, wallet(0), 1_825);
  // Minimums (about $815/month) plus $300 extra, minus about $3,300 of interest.
  assert.ok(owedTotal(avalanche) < start - 9_000, `avalanche end ${owedTotal(avalanche)}`);
  assert.ok(owedTotal(avalanche) < owedTotal(minimums) - 3_000);
  assert.ok(avalanche.interestPaid < minimums.interestPaid);
  assert.equal(avalanche.profile.lateMarks.length, 0);
});

test("bankruptcy: Chapter 7 wipes the card but not student loans; Chapter 13 creates a plan", () => {
  const b7 = sampleHousehold(0);
  const r7 = fileBankruptcy(b7, 7, 100);
  assert.ok(r7.kept.includes("Student loans"));
  assert.equal(b7.debts.find((d) => d.id === "card")?.status, "discharged");
  assert.equal(b7.debts.find((d) => d.id === "student")?.status, "current");

  const b13 = sampleHousehold(0);
  const r13 = fileBankruptcy(b13, 13, 100);
  assert.ok(r13.planPayment && r13.planPayment > 0);
  assert.ok(b13.debts.some((d) => d.name === "Chapter 13 plan"));

  assert.equal(passesMeansTest(60_000, 100), true);
  assert.equal(passesMeansTest(120_000, 110.72), false);
});
