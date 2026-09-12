// Data contracts for cards, loans, and moving money. See
// research/08-cards-loans-accounts.md for where each rule and number comes from.

import type { DebtKind } from "../debt/types.ts";

// ---------------------------------------------------------------------------
// Card catalog (generated into src/data/cards.ts from the CFPB TCCP survey
// and the credit-card-bonuses-api export; the same rows live in Tiger Data)
// ---------------------------------------------------------------------------

/** 0 no score, 1 = 619 or less, 2 = 620-719, 3 = 720+ (the CFPB survey's tiers). */
export type CreditTier = 0 | 1 | 2 | 3;

/** One plan from the CFPB Terms of Credit Card Plans survey. Rates are fractions. */
export interface CardProduct {
  id: string;
  institution: string;
  issuerKey: string | null;
  productName: string;
  secured: boolean;
  minTier: CreditTier | null;
  variableRate: boolean;
  aprNoScore: number | null;
  aprPoor: number | null;
  aprGood: number | null;
  aprGreat: number | null;
  aprMin: number | null;
  aprMax: number | null;
  introApr: number | null;
  introMonths: number | null;
  btApr: number | null;
  btMonths: number | null;
  btFeePct: number | null;
  btFeeMin: number | null;
  cashApr: number | null;
  cashFeePct: number | null;
  cashFeeMin: number | null;
  graceDays: number | null;
  annualFee: number;
  foreignFeePct: number;
  lateFee: number | null;
  rewards: string[];
}

/** A name-brand card's sign-up offer. */
export interface CardOffer {
  cardId: string;
  name: string;
  issuerKey: string;
  currency: string;
  annualFee: number;
  firstYearFeeWaived: boolean;
  /** Flat earn rate in percent on everything (1 = 1%). */
  baseEarnPct: number;
  bonusAmount: number | null;
  bonusValueUsd: number | null;
  bonusSpend: number | null;
  bonusDays: number | null;
  tccpProductId: string | null;
}

/** Earn rate categories used by the curated card data (issuer pages). */
export type EarnCategory =
  | "dining" | "groceries" | "gas" | "travel" | "travel_portal" | "streaming" | "transit"
  | "drugstores" | "entertainment" | "rotating" | "top_category" | "everything";

export interface EarnRate {
  category: EarnCategory;
  /** Percent back ("percent") or points per dollar ("x"). */
  rate: number;
  unit: "percent" | "x";
  /** Dollars of spending the rate applies to per year (caps normalized from the issuer's wording). */
  annualCap?: number;
  cap?: string;
  note?: string;
}

/**
 * A real card for the Card Shop: issuer-page details (earn rates, offer, perks)
 * joined to its CFPB survey terms and its official card art.
 */
export interface CuratedCard {
  slug: string;
  name: string;
  issuer: string;
  network: string;
  creditNeeded: "none" | "fair" | "good" | "excellent";
  secured: boolean;
  student: boolean;
  annualFee: number;
  firstYearFeeWaived: boolean;
  rewardsCurrency: string;
  /** Cash-out value of one point in cents (1 for cash back percent cards). */
  centsPerPoint: number;
  earn: EarnRate[];
  /** `cashbackMatch`: Discover matches all first-year cash back instead of a fixed bonus. */
  welcomeOffer: { text: string; valueUsd: number; spend: number; months: number; cashbackMatch?: boolean } | null;
  /** Set when the issuer has stopped taking applications (the reason, as published). */
  closed?: string;
  unverifiedFields?: string[];
  introApr: { purchases?: string; balanceTransfers?: string; btFee?: string } | null;
  regularApr: string;
  foreignFee: string;
  perks: string[];
  sourceUrl: string;
  checked: string;
  unverified?: boolean;
  /** Official card art under /cards/art/, or null for the drawn fallback. */
  art: { src: string; width: number; height: number; sourceUrl: string } | null;
  /** The CFPB survey plan, with APR range filled from the issuer page where the survey is blank. */
  terms: CardProduct;
  tccpId: string;
}

// ---------------------------------------------------------------------------
// Accounts and transfers
// ---------------------------------------------------------------------------

/** Cash and investment accounts. Credit cards and loans live in the debt engine's DebtBook. */
export type AccountKind = "checking" | "savings" | "emergency" | "brokerage" | "roth_ira" | "k401";

export interface Account {
  id: string;
  kind: AccountKind;
  name: string;
  balance: number;
  /** Annual yield as a fraction, paid monthly. */
  apy: number;
  /** Savings: withdrawals this calendar month, for banks that still enforce six. */
  withdrawalsThisMonth?: number;
  /** Savings: fee per withdrawal past six a month (0 or undefined = no limit, like most online banks). */
  excessWithdrawalFee?: number;
  /** Roth IRA: contributions can come out tax- and penalty-free; earnings can't before 59 1/2. */
  rothContributions?: number;
  /** Day the account was opened (new-account holds). */
  openedDay: number;
}

export type Rail = "internal" | "ach" | "same_day_ach" | "wire" | "instant" | "cash_advance" | "balance_transfer";

export interface TransferQuote {
  rail: Rail;
  amount: number;
  fee: number;
  /** Early-withdrawal penalty and estimated tax on retirement money. */
  penalty: number;
  tax: number;
  /** What actually lands in the destination. */
  received: number;
  /** Game day the money is available. */
  settlesDay: number;
  /** Plain-language warnings shown before the player confirms. */
  warnings: string[];
  ok: boolean;
  error?: string;
}

export interface Transfer extends TransferQuote {
  id: string;
  from: string;
  to: string;
  day: number;
  status: "pending" | "settled";
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export interface Applicant {
  age: number;
  /** Annual income the applicant can count (under 21: independent income only). */
  annualIncome: number;
  /** Monthly debt payments already owed, for debt-to-income. */
  monthlyDebtPayments: number;
  /** Monthly housing cost (rent or mortgage), counted in DTI. */
  monthlyHousing: number;
}

export type ApplicationKind = "card" | "secured_card" | "personal" | "auto" | "mortgage" | "pal";

/** One entry in the player's application history, used by issuer rules and rate shopping. */
export interface ApplicationRecord {
  day: number;
  kind: ApplicationKind;
  issuerKey?: string;
  productId?: string;
  approved: boolean;
  /** True when the application pulled credit and the inquiry counted against the score. */
  countedInquiry: boolean;
  /** Personal cards count toward Chase's 5/24. */
  personalCard?: boolean;
  /** Offer ids whose sign-up bonus the player has received, with the day. */
  bonusCardId?: string;
}

export type Decision = "approved" | "denied" | "pending";

export interface ApplicationResult {
  kind: ApplicationKind;
  decision: Decision;
  /** Plain-language reasons (the adverse action notice, in game form). */
  reasons: string[];
  /** Estimated approval chance in [0, 1] (shown by prequalification). */
  odds: number;
  apr: number;
  creditLimit?: number;
  amount?: number;
  /** Loans: origination fee withheld from the proceeds. */
  originationFee?: number;
  termMonths?: number;
  monthlyPayment?: number;
  dti: number;
  hardInquiry: boolean;
  /** Whether the sign-up bonus is available to this applicant (issuer bonus rules). */
  bonusEligible?: boolean;
  debtKind?: DebtKind;
}
