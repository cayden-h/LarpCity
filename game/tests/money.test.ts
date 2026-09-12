// Money system tests: transfers, card and loan applications, rewards, and the
// generated card catalog. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { creditCard, newBook, sampleHousehold, tickDay, type DebtBook, type Wallet } from "../src/sim/debt/index.ts";
import {
  BLS_MONTHLY_SPEND,
  EARN_PROFILES,
  Ledger,
  addBusinessDays,
  applyForCard,
  applyForLoan,
  bonusEligible,
  bonusStatus,
  cardYearValue,
  earnForMonth,
  issuerRule,
  k401LoanLimit,
  openCard,
  openLoan,
  railFee,
  recordApplication,
  tierOf,
  type Account,
  type Applicant,
  type ApplicationRecord,
  type CardOffer,
  type CardProduct,
} from "../src/sim/money/index.ts";
import { CARD_OFFERS, CARD_PRODUCTS, LATEST_RATES } from "../src/data/cards.ts";

const FRIDAY = new Date(2026, 8, 11); // 2026-09-11 is a Friday
const ctx = (day = 0, age = 30) => ({ day, date: FRIDAY, age });

const accounts = (): Account[] => [
  { id: "checking", kind: "checking", name: "Checking", balance: 2_000, apy: 0, openedDay: -900 },
  { id: "savings", kind: "savings", name: "Savings", balance: 5_000, apy: 0.04, openedDay: -900, excessWithdrawalFee: 10 },
  { id: "k401", kind: "k401", name: "401(k)", balance: 20_000, apy: 0, openedDay: -900 },
  { id: "roth", kind: "roth_ira", name: "Roth IRA", balance: 10_000, apy: 0, openedDay: -900, rothContributions: 6_000 },
];

const product = (o: Partial<CardProduct> = {}): CardProduct => ({
  id: "test-card", institution: "Brickstone Bank", issuerKey: null, productName: "Brickstone Cash", secured: false, minTier: 2, variableRate: true,
  aprNoScore: null, aprPoor: null, aprGood: 0.2499, aprGreat: 0.1999, aprMin: 0.1999, aprMax: 0.2999, introApr: 0, introMonths: 15,
  btApr: 0, btMonths: 15, btFeePct: 0.05, btFeeMin: 5, cashApr: 0.2999, cashFeePct: 0.05, cashFeeMin: 10, graceDays: 25,
  annualFee: 0, foreignFeePct: 0.03, lateFee: 29, rewards: ["Cashback rewards"], ...o,
});

const applicant: Applicant = { age: 28, annualIncome: 60_000, monthlyDebtPayments: 300, monthlyHousing: 1_400 };
const bookWithScore = (score: number): DebtBook => {
  const b = newBook({ debts: [], agi: 60_000, monthlyTakeHome: 4_000, day: 0 });
  b.profile.score = score;
  return b;
};

test("ACH lands two business days later, skipping the weekend", () => {
  assert.equal(addBusinessDays(0, FRIDAY, 2), 4); // Friday -> Tuesday
  const l = new Ledger(accounts());
  const t = l.transfer("savings", "checking", 500, "ach", ctx());
  assert.equal(t.settlesDay, 4);
  assert.equal(l.get("savings").balance, 4_500);
  assert.equal(l.get("checking").balance, 2_000, "not landed yet");
  l.settle(3);
  assert.equal(l.get("checking").balance, 2_000);
  l.settle(4);
  assert.equal(l.get("checking").balance, 2_500);
});

test("internal moves are instant and free; instant payouts cost 1.75% capped at $25", () => {
  const l = new Ledger(accounts());
  l.transfer("savings", "checking", 100, "internal", ctx());
  assert.equal(l.get("checking").balance, 2_100);
  assert.equal(railFee("instant", 100), 1.75);
  assert.equal(railFee("instant", 5_000), 25);
  assert.equal(railFee("instant", 5), 0.25);
});

test("a seventh savings withdrawal costs the bank's excess fee", () => {
  const l = new Ledger(accounts());
  for (let i = 0; i < 6; i++) l.transfer("savings", "checking", 10, "internal", ctx());
  const q = l.quote("savings", "checking", 10, "internal", ctx());
  assert.equal(q.fee, 10);
  l.newMonth();
  assert.equal(l.quote("savings", "checking", 10, "internal", ctx()).fee, 0);
});

test("early 401(k) withdrawals lose 10% plus tax; Roth contributions come out free", () => {
  const l = new Ledger(accounts());
  const k = l.quote("k401", "checking", 10_000, "internal", ctx(0, 35));
  assert.equal(k.penalty, 1_000);
  assert.equal(k.tax, 2_200);
  assert.equal(k.received, 6_800);
  const roth = l.quote("roth", "checking", 6_000, "internal", ctx(0, 35));
  assert.equal(roth.penalty + roth.tax, 0);
  const rothEarnings = l.quote("roth", "checking", 8_000, "internal", ctx(0, 35));
  assert.equal(rothEarnings.penalty, 200); // 10% of the $2,000 of earnings
  assert.equal(l.quote("k401", "checking", 10_000, "internal", ctx(0, 60)).penalty, 0);
});

test("the ledger's wallet drains checking, then savings, never retirement", () => {
  const l = new Ledger(accounts());
  const w = l.wallet();
  assert.equal(w.available(), 7_000);
  assert.equal(w.withdraw(2_500, "rent"), 2_500);
  assert.equal(l.get("checking").balance, 0);
  assert.equal(l.get("savings").balance, 4_500);
  assert.equal(l.get("k401").balance, 20_000);
});

test("cash advance: fee up front and no grace period", () => {
  const l = new Ledger(accounts());
  const card = creditCard({ id: "c", name: "Card", balance: 0, limit: 2_000, apr: 0.25, day: 0 });
  assert.equal(card.inGrace, true);
  const t = l.cashAdvance(card, "checking", 300, 0);
  assert.equal(t.fee, 15);
  assert.equal(card.balance, 315);
  assert.equal(card.inGrace, false);
  assert.equal(l.get("checking").balance, 2_300);
  assert.throws(() => l.cashAdvance(card, "checking", 5_000, 0));
});

test("balance transfer moves debt to a 0% promo that accrues nothing until it ends", () => {
  const l = new Ledger(accounts());
  const oldCard = creditCard({ id: "old", name: "Old card", balance: 4_000, limit: 5_000, apr: 0.2499, day: 0 });
  const promo = creditCard({ id: "new", name: "Promo card", balance: 0, limit: 6_000, apr: 0.2299, day: 0 });
  promo.promoApr = 0;
  promo.promoUntil = 100;
  l.balanceTransfer(oldCard, promo, 4_000, 0);
  assert.equal(oldCard.balance, 0);
  assert.equal(promo.balance, 4_200); // 5% fee
  const book = newBook({ debts: [promo], agi: 60_000, monthlyTakeHome: 4_000, day: 0 });
  const wallet: Wallet = { available: () => 1e9, withdraw: (a) => a };
  const date = (d: number) => new Date(2026, 8, 11 + d);
  for (let d = 1; d <= 20; d++) tickDay(book, { day: d, date: date(d), env: { cashRateAnnual: 0.0363 }, wallet });
  assert.equal(promo.accrued, 0, "no interest during the promo");
  promo.promoUntil = 21;
  tickDay(book, { day: 21, date: date(21), env: { cashRateAnnual: 0.0363 }, wallet });
  assert.ok(promo.accrued > 0, "regular APR after the promo");
});

test("tiers follow the CFPB survey's score bands", () => {
  assert.deepEqual([tierOf(580), tierOf(650), tierOf(760), tierOf(700, true)], [1, 2, 3, 0]);
});

test("prequalification is a soft pull; applying is a hard pull recorded once", () => {
  const book = bookWithScore(740);
  const history: ApplicationRecord[] = [];
  const pre = applyForCard({ product: product(), applicant, book, history, day: 10 });
  assert.equal(pre.hardInquiry, false);
  assert.equal(pre.decision, "approved");
  assert.equal(book.profile.inquiries.length, 0);
  const r = applyForCard({ product: product(), applicant, book, history, day: 10, roll: 0.1 });
  assert.equal(r.decision, "approved");
  assert.equal(r.apr, 0.1999, "great-tier APR from the survey");
  assert.equal(r.creditLimit, 9_000);
  recordApplication(book, history, r, 10, { productId: "test-card" });
  assert.deepEqual(book.profile.inquiries, [10]);
  const card = openCard(book, product(), r, 10);
  assert.equal(card.promoApr, 0);
  assert.equal(card.promoUntil, 10 + Math.round(15 * 30.4));
});

test("the same roll gives the same decision (replayable runs)", () => {
  const a = applyForCard({ product: product(), applicant, book: bookWithScore(660), history: [], day: 0, roll: 0.42 });
  const b = applyForCard({ product: product(), applicant, book: bookWithScore(660), history: [], day: 0, roll: 0.42 });
  assert.deepEqual(a, b);
});

test("a low score reaching for an excellent-credit card is mostly denied", () => {
  const r = applyForCard({ product: product({ minTier: 3 }), applicant, book: bookWithScore(600), history: [], day: 0, roll: 0.2 });
  assert.equal(r.decision, "denied");
  assert.ok(r.odds < 0.1);
  assert.ok(r.reasons.some((s) => s.includes("excellent")));
});

test("secured cards always approve with the deposit as the limit", () => {
  const r = applyForCard({ product: product({ secured: true, minTier: 0 }), applicant, book: bookWithScore(520), history: [], day: 0, roll: 0.99, deposit: 300 });
  assert.equal(r.decision, "approved");
  assert.equal(r.creditLimit, 300);
});

test("under 21 with no income is denied by the CARD Act without a hard pull", () => {
  const r = applyForCard({ product: product(), applicant: { ...applicant, age: 19, annualIncome: 0 }, book: bookWithScore(700), history: [], day: 0, roll: 0 });
  assert.equal(r.decision, "denied");
  assert.equal(r.hardInquiry, false);
});

test("issuer rules: Chase 5/24, Capital One one per 6 months, Citi 8/65", () => {
  const five: ApplicationRecord[] = [0, 100, 200, 300, 400].map((day) => ({ day, kind: "card", approved: true, countedInquiry: true, personalCard: true }));
  assert.match(issuerRule("CHASE", five, 500)!, /5\/24/);
  assert.equal(issuerRule("CHASE", five, 800), null, "the first card aged out of 24 months");
  const c1: ApplicationRecord[] = [{ day: 0, kind: "card", issuerKey: "CAPITAL_ONE", approved: true, countedInquiry: true }];
  assert.ok(issuerRule("CAPITAL_ONE", c1, 100));
  assert.equal(issuerRule("CAPITAL_ONE", c1, 200), null);
  const citi: ApplicationRecord[] = [{ day: 0, kind: "card", issuerKey: "CITI", approved: false, countedInquiry: true }];
  assert.ok(issuerRule("CITI", citi, 5));
  assert.equal(issuerRule("CITI", citi, 9), null);
});

test("sign-up bonus rules: Amex once per lifetime, others after a wait", () => {
  const offer = (issuerKey: string): CardOffer => ({ cardId: "x", name: "X", issuerKey, currency: "USD", annualFee: 0, firstYearFeeWaived: false, baseEarnPct: 1, bonusAmount: 200, bonusValueUsd: 200, bonusSpend: 500, bonusDays: 90, tccpProductId: null });
  const got: ApplicationRecord[] = [{ day: 0, kind: "card", approved: true, countedInquiry: true, bonusCardId: "x" }];
  assert.equal(bonusEligible(offer("AMERICAN_EXPRESS"), got, 5_000), false);
  assert.equal(bonusEligible(offer("CITI"), got, 1_000), false);
  assert.equal(bonusEligible(offer("CITI"), got, 1_500), true);
  assert.deepEqual(bonusStatus(offer("CHASE"), 600, 30), { earned: true, expired: false, remainingSpend: 0, daysLeft: 60 });
  assert.equal(bonusStatus(offer("CHASE"), 100, 120).expired, true);
});

test("rate shopping: two auto loan applications within 45 days are one inquiry", () => {
  const book = sampleHousehold();
  const history: ApplicationRecord[] = [];
  for (const day of [0, 20]) {
    const r = applyForLoan({ kind: "auto", amount: 25_000, termMonths: 60, applicant, book, day, cashRateAnnual: 0.0363, roll: 0.99 });
    recordApplication(book, history, r, day, {});
  }
  assert.equal(book.profile.inquiries.length, 1);
  const r3 = applyForLoan({ kind: "auto", amount: 25_000, termMonths: 60, applicant, book, day: 90, cashRateAnnual: 0.0363, roll: 0.99 });
  recordApplication(book, history, r3, 90, {});
  assert.equal(book.profile.inquiries.length, 2);
});

test("personal loans withhold the origination fee; DTI over the cap denies", () => {
  const book = bookWithScore(700);
  const r = applyForLoan({ kind: "personal", amount: 10_000, termMonths: 36, applicant, book, day: 0, cashRateAnnual: 0.0363, roll: 0 });
  assert.equal(r.decision, "approved");
  assert.equal(r.apr, 0.17);
  const { proceeds, debt } = openLoan(book, r, 0);
  assert.equal(debt.balance, 10_000);
  assert.equal(proceeds, 10_000 - r.originationFee!);
  const mortgage = applyForLoan({ kind: "mortgage", amount: 500_000, termMonths: 360, applicant, book, day: 0, cashRateAnnual: 0.0363, roll: 0 });
  assert.equal(mortgage.decision, "denied");
  assert.ok(mortgage.reasons.some((s) => s.includes("debt-to-income")));
});

test("credit union PAL caps at $2,000, 28% APR, no hard pull", () => {
  const r = applyForLoan({ kind: "pal", amount: 5_000, termMonths: 24, applicant, book: bookWithScore(540), day: 0, cashRateAnnual: 0.0363, roll: 0.5 });
  assert.equal(r.amount, 2_000);
  assert.equal(r.termMonths, 12);
  assert.equal(r.apr, 0.28);
  assert.equal(r.hardInquiry, false);
  assert.equal(k401LoanLimit(30_000), 15_000);
  assert.equal(k401LoanLimit(300_000), 50_000);
});

test("rewards: 2% on average spending beats nothing, until you carry a balance", () => {
  const flat = cardYearValue({ profile: EARN_PROFILES.flat_2, annualFee: 0 });
  // 2% of the BLS card-payable $18,190 is $363.80; statements post whole cents each month (12 x $30.32).
  assert.equal(flat.rewards, 363.84);
  const carrying = cardYearValue({ profile: EARN_PROFILES.flat_2, annualFee: 0, carriedBalance: 3_000, apr: 0.23 });
  assert.equal(carrying.interest, 690);
  assert.ok(carrying.net < 0);
});

test("rotating 5% stops at the quarterly cap", () => {
  const month = earnForMonth(EARN_PROFILES.rotating, { gas: 1_000 }, 1_000);
  assert.equal(month.earned, 500 * 0.05 + 500 * 0.01);
  assert.equal(month.rotatingUsed, 1_500);
  assert.ok(BLS_MONTHLY_SPEND.groceries > 500);
});

test("the generated catalog holds real survey plans and offers", () => {
  assert.ok(CARD_PRODUCTS.length > 300);
  assert.ok(CARD_OFFERS.length > 100);
  for (const p of CARD_PRODUCTS) {
    for (const r of [p.aprGreat, p.aprGood, p.aprPoor, p.aprMin, p.aprMax]) if (r != null) assert.ok(r > 0 && r < 0.45, `${p.id} rate ${r}`);
  }
  assert.ok(CARD_PRODUCTS.some((p) => p.secured));
  assert.equal(LATEST_RATES.DPRIME[1] > 0, true);
});
