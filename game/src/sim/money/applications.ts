// Applying for cards and loans.
//
// Every application runs the same steps a real lender does: hard rules first
// (age and income, issuer rules, debt-to-income), then an approval chance from
// the credit score, then a roll. The roll comes from the caller's seeded RNG,
// so a replayed run makes the same decisions. Prequalification runs the same
// math with a soft pull: odds but no inquiry and no roll.
// Numbers: research/08-cards-loans-accounts.md, sections 1 and 3.

import { monthlyPayment } from "../debt/math.ts";
import { APPROVAL_FLOOR, offeredApr, scoreQuality } from "../debt/rates.ts";
import { creditCard, installment } from "../debt/factory.ts";
import type { Debt, DebtBook } from "../debt/types.ts";
import type { Applicant, ApplicationKind, ApplicationRecord, ApplicationResult, CardOffer, CardProduct, CreditTier } from "./types.ts";

const DAY = 1;
const MONTH = 30;
const YEAR = 365;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Card applications DTI ceiling; installment ceilings are per loan kind. */
export const DTI_LIMIT: Record<Exclude<ApplicationKind, "secured_card">, number> = {
  card: 0.5,
  personal: 0.5,
  auto: 0.5,
  mortgage: 0.43,
  pal: 0.6,
};
/** Auto, mortgage, and student inquiries inside this window count once (FICO's newer 45-day window). */
export const RATE_SHOPPING_DAYS = 45;
/** NCUA PAL II: up to $2,000 for 1-12 months, APR capped at 28%, application fee up to $20. */
export const PAL = { min: 200, max: 2_000, maxMonths: 12, apr: 0.28, fee: 20 };

/** CFPB survey tier for a score. A thin file (no history) is tier 0. */
export function tierOf(score: number, thinFile = false): CreditTier {
  if (thinFile) return 0;
  if (score < 620) return 1;
  if (score < 720) return 2;
  return 3;
}

/** Monthly debt-to-income, including a proposed new payment. */
export function dti(a: Applicant, newMonthlyPayment = 0): number {
  const income = a.annualIncome / 12;
  if (income <= 0) return Infinity;
  return (a.monthlyDebtPayments + a.monthlyHousing + newMonthlyPayment) / income;
}

/**
 * Base approval chance from the score, calibrated to the NY Fed SCE (about 63% of
 * applicants under 680 rejected) and 75-85% approval at 750+ (UNVERIFIED blog data).
 */
export function scoreOdds(score: number): number {
  return clamp(0.37 + (score - 650) * 0.0039, 0.03, 0.95);
}

/** The purchase APR this product would give this score, from the survey's tier columns. */
export function aprFor(p: CardProduct, score: number, thinFile = false, cashRate = 0.0363): number {
  const tier = tierOf(score, thinFile);
  const byTier = [p.aprNoScore, p.aprPoor, p.aprGood, p.aprGreat][tier];
  if (byTier != null) return byTier;
  if (p.aprMin != null && p.aprMax != null) return round2((p.aprMax - (p.aprMax - p.aprMin) * scoreQuality(score)) * 10_000) / 10_000;
  return p.aprMin ?? p.aprMax ?? offeredApr("credit_card", score, cashRate);
}

/** Issuer application rules. Returns a denial reason, or null. */
export function issuerRule(issuerKey: string | null | undefined, history: ApplicationRecord[], day: number): string | null {
  const within = (days: number, f: (r: ApplicationRecord) => boolean) => history.filter((r) => day - r.day < days && f(r)).length;
  switch (issuerKey) {
    case "CHASE":
      if (within(2 * YEAR, (r) => r.approved && !!r.personalCard) >= 5) return "Chase's 5/24 rule: 5 or more new personal cards in the last 24 months.";
      return null;
    case "CAPITAL_ONE":
      if (within(6 * MONTH, (r) => r.approved && r.issuerKey === "CAPITAL_ONE" && r.kind === "card")) return "Capital One approves about one new card every 6 months.";
      return null;
    case "DISCOVER":
      if (within(YEAR, (r) => r.approved && r.issuerKey === "DISCOVER" && r.kind === "card")) return "Discover approves one new card a year.";
      return null;
    case "CITI":
      if (within(8 * DAY, (r) => r.issuerKey === "CITI" && r.kind === "card") >= 1) return "Citi allows one card application every 8 days.";
      if (within(65 * DAY, (r) => r.issuerKey === "CITI" && r.kind === "card") >= 2) return "Citi allows two card applications every 65 days.";
      return null;
    default:
      return null;
  }
}

/** Whether the sign-up bonus is available: Amex once per lifetime per card, Citi once per 48 months. */
export function bonusEligible(offer: CardOffer, history: ApplicationRecord[], day: number): boolean {
  const got = history.filter((r) => r.bonusCardId === offer.cardId);
  if (!got.length) return true;
  if (offer.issuerKey === "AMERICAN_EXPRESS") return false;
  const last = Math.max(...got.map((r) => r.day));
  const wait = offer.issuerKey === "CITI" || offer.issuerKey === "CAPITAL_ONE" ? 48 * MONTH : 24 * MONTH;
  return day - last >= wait;
}

/** Starting limit: a share of income by tier, clamped to the real first-card and average ranges. */
export function startingLimit(income: number, tier: CreditTier): number {
  const [share, lo, hi] = [[0.02, 300, 1_000], [0.04, 300, 2_000], [0.1, 1_000, 10_000], [0.15, 3_000, 25_000]][tier];
  return Math.round(clamp(income * share, lo, hi) / 100) * 100;
}

function recentInquiries(book: DebtBook, day: number): number {
  return book.profile.inquiries.filter((d) => day - d < YEAR).length;
}

export interface CardApplication {
  product: CardProduct;
  offer?: CardOffer;
  applicant: Applicant;
  book: DebtBook;
  history: ApplicationRecord[];
  day: number;
  /** Uniform [0, 1) from the run's seeded RNG. Omit for prequalification. */
  roll?: number;
  /** Secured cards: the deposit, which becomes the limit. */
  deposit?: number;
  thinFile?: boolean;
}

/** Apply (hard pull) or prequalify (soft pull, when `roll` is omitted). */
export function applyForCard(o: CardApplication): ApplicationResult {
  const { product, applicant, book, day } = o;
  const score = book.profile.score;
  const tier = tierOf(score, o.thinFile);
  const prequal = o.roll === undefined;
  const reasons: string[] = [];
  const kind: ApplicationKind = product.secured ? "secured_card" : "card";
  const apr = aprFor(product, score, o.thinFile);
  const ratio = dti(applicant);
  const result = (decision: ApplicationResult["decision"], odds: number, extra: Partial<ApplicationResult> = {}): ApplicationResult => ({
    kind, decision, reasons, odds: round2(odds), apr, dti: round2(ratio), hardInquiry: !prequal, debtKind: "credit_card", ...extra,
  });

  // CARD Act: under 21 needs independent income (issuers rarely allow cosigners now).
  if (applicant.age < 21 && applicant.annualIncome <= 0) {
    reasons.push("Under 21, the CARD Act requires your own income to qualify.");
    return result("denied", 0, { hardInquiry: false });
  }
  if (product.secured) {
    const deposit = o.deposit ?? 200;
    reasons.push(`Secured card: your $${deposit} deposit is your limit. Pay on time for 7-18 months and it can graduate and refund the deposit.`);
    return result("approved", 1, { creditLimit: deposit, hardInquiry: !prequal });
  }
  const rule = issuerRule(product.issuerKey, o.history, day);
  if (rule) {
    reasons.push(rule);
    return result("denied", 0, { hardInquiry: false });
  }
  if (ratio > DTI_LIMIT.card) reasons.push(`Your debt payments are ${Math.round(ratio * 100)}% of income; lenders want under ${Math.round(DTI_LIMIT.card * 100)}%.`);

  let odds = scoreOdds(score);
  if (product.minTier != null && tier < product.minTier) {
    odds *= 0.25;
    reasons.push(`This card targets ${["no-score", "fair", "good", "excellent"][product.minTier]} credit; your score is ${score}.`);
  }
  const inq = recentInquiries(book, day);
  if (inq > 2) {
    odds -= 0.05 * (inq - 2);
    reasons.push(`${inq} hard inquiries in the last year makes lenders cautious.`);
  }
  if (ratio > DTI_LIMIT.card) odds = 0;
  odds = clamp(odds, 0, 0.97);
  const bonus = o.offer ? bonusEligible(o.offer, o.history, day) : undefined;
  if (o.offer && bonus === false) reasons.push("You already received this card's sign-up bonus, so this application wouldn't earn it again.");
  const limit = startingLimit(applicant.annualIncome, tier);

  if (prequal) return result(odds >= 0.5 ? "approved" : "denied", odds, { creditLimit: limit, bonusEligible: bonus, hardInquiry: false });
  if (o.roll! < odds) return result("approved", odds, { creditLimit: limit, bonusEligible: bonus });
  if (o.roll! < odds + 0.05) {
    reasons.push("Your application needs a manual review (7-10 days).");
    return result("pending", odds, { bonusEligible: bonus });
  }
  if (!reasons.length) reasons.push(`Not approved this time. At a ${score} score, about ${Math.round(odds * 100)}% of applicants for this card get in.`);
  return result("denied", odds, { bonusEligible: bonus });
}

/** Records an application: the hard inquiry (with rate shopping) and the history row. */
export function recordApplication(book: DebtBook, history: ApplicationRecord[], r: ApplicationResult, day: number, meta: { issuerKey?: string | null; productId?: string; bonusCardId?: string }): ApplicationRecord {
  let counted = r.hardInquiry;
  if (counted && (r.kind === "auto" || r.kind === "mortgage")) {
    // Rate shopping: a same-kind inquiry in the last 45 days means this one doesn't count again.
    counted = !history.some((h) => h.kind === r.kind && h.countedInquiry && day - h.day < RATE_SHOPPING_DAYS);
  }
  if (counted) book.profile.inquiries.push(day);
  const rec: ApplicationRecord = {
    day,
    kind: r.kind,
    issuerKey: meta.issuerKey ?? undefined,
    productId: meta.productId,
    approved: r.decision === "approved",
    countedInquiry: counted,
    personalCard: r.kind === "card" || r.kind === "secured_card",
    bonusCardId: r.decision === "approved" && r.bonusEligible ? meta.bonusCardId : undefined,
  };
  history.push(rec);
  return rec;
}

/** Opens an approved card in the debt book, with its intro APR as a promo. */
export function openCard(book: DebtBook, product: CardProduct, r: ApplicationResult, day: number, id = `card-${product.id}-${day}`): Debt {
  if (r.decision !== "approved") throw new Error("Only approved applications open a card.");
  const d = creditCard({ id, name: product.productName, balance: 0, limit: r.creditLimit ?? 500, apr: r.apr, day, dueDayOfMonth: 1 + (day % 28) });
  if (product.introApr != null && product.introMonths) {
    d.promoApr = product.introApr;
    d.promoUntil = day + Math.round(product.introMonths * 30.4);
  }
  book.debts.push(d);
  return d;
}

// ---------------------------------------------------------------------------
// Loans
// ---------------------------------------------------------------------------

/** Personal loan APR bands by score (aggregator data, UNVERIFIED); Bankrate's 700-score average was 12.21% in Sep 2026. */
export function personalLoanApr(score: number): number {
  if (score >= 760) return 0.085;
  if (score >= 720) return 0.12;
  if (score >= 680) return 0.17;
  if (score >= 640) return 0.24;
  if (score >= 600) return 0.305;
  return 0.32;
}

/** Origination fee withheld from personal loan proceeds: about 1% for great credit, up to 8% for poor. */
export function originationRate(score: number): number {
  return Math.round((0.08 - 0.07 * scoreQuality(score)) * 1000) / 1000;
}

export interface LoanApplication {
  kind: "personal" | "auto" | "mortgage" | "pal";
  amount: number;
  termMonths: number;
  applicant: Applicant;
  book: DebtBook;
  day: number;
  cashRateAnnual: number;
  roll?: number;
}

export function applyForLoan(o: LoanApplication): ApplicationResult {
  const { kind, applicant, book } = o;
  const score = book.profile.score;
  const prequal = o.roll === undefined;
  const reasons: string[] = [];
  let amount = o.amount;
  let months = o.termMonths;
  if (kind === "pal") {
    amount = clamp(amount, PAL.min, PAL.max);
    months = clamp(months, 1, PAL.maxMonths);
  }
  const apr = kind === "personal" ? personalLoanApr(score) : kind === "pal" ? PAL.apr : offeredApr(kind, score, o.cashRateAnnual);
  const payment = monthlyPayment(amount, apr, months);
  const fee = kind === "personal" ? round2(amount * originationRate(score)) : kind === "pal" ? PAL.fee : 0;
  const ratio = dti(applicant, payment);
  const floor = kind === "pal" ? 0 : APPROVAL_FLOOR[kind];
  const base = { kind, reasons, apr, amount, termMonths: months, monthlyPayment: round2(payment), originationFee: fee, dti: round2(ratio), hardInquiry: !prequal && kind !== "pal", debtKind: kind === "pal" ? ("personal" as const) : kind };

  let odds = kind === "pal" ? 0.9 : clamp(0.5 + (score - floor) / 300, 0.03, 0.95);
  if (score < floor) {
    odds = 0.03;
    reasons.push(`Most lenders want a score of ${floor}+ for a ${kind} loan; yours is ${score}.`);
  }
  if (ratio > DTI_LIMIT[kind]) {
    odds = 0;
    reasons.push(`This payment would put your debt-to-income at ${Math.round(ratio * 100)}%; the limit is ${Math.round(DTI_LIMIT[kind] * 100)}%.`);
  }
  if (kind === "personal" && fee > 0) reasons.push(`A ${Math.round((fee / amount) * 1000) / 10}% origination fee ($${fee.toFixed(0)}) comes out of the money you receive.`);
  if (kind === "pal") reasons.push("Credit union payday alternative: APR capped at 28%, versus about 390% for a payday loan.");

  const decision = prequal ? (odds >= 0.5 ? "approved" : "denied") : o.roll! < odds ? "approved" : "denied";
  return { ...base, decision, odds: round2(odds) };
}

/** Opens an approved loan as an installment debt. Returns the debt and the cash the player receives. */
export function openLoan(book: DebtBook, r: ApplicationResult, day: number, name?: string): { debt: Debt; proceeds: number } {
  if (r.decision !== "approved" || !r.amount || !r.termMonths) throw new Error("Only approved loans open.");
  const kind = r.kind === "auto" || r.kind === "mortgage" ? r.kind : "personal";
  const label = name ?? (r.kind === "pal" ? "Credit union PAL" : `${kind[0].toUpperCase()}${kind.slice(1)} loan`);
  const debt = installment({ id: `${r.kind}-${day}`, kind, name: label, balance: r.amount, apr: r.apr, months: r.termMonths, day, dueDayOfMonth: 1 + (day % 28) });
  book.debts.push(debt);
  return { debt, proceeds: round2(r.amount - (r.originationFee ?? 0)) };
}

/** A 401(k) loan: the lesser of half the vested balance or $50,000, repaid over 5 years. No credit check. */
export function k401LoanLimit(vestedBalance: number): number {
  return Math.min(0.5 * vestedBalance, 50_000);
}
