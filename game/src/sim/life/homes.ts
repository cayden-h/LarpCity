// The housing contract and price table shared by the simulation and home picker.
// Purchase cash uses checking/savings plus the current home's net sale proceeds.
// Selling investments remains an explicit player decision.
import { isOpen, owed } from '../debt/engine.ts';
import { cardMinimum } from '../debt/math.ts';
import type { Debt, DebtBook } from '../debt/types.ts';
import { applyForLoan } from '../money/applications.ts';
import type { ApplicationResult } from '../money/types.ts';
import { homePrice, houseMath, PMI_RATE, TAX_AND_INSURANCE, viewOf } from '../skip/goals.ts';
import type { PlayerLife, Place } from './player.ts';

/** ACS 2024 national median gross rent. */
export const US_MEDIAN_RENT = 1487;

export type HomeTier = 0 | 1 | 2 | 3 | 4 | 5;
export type HomeTenure = 'none' | 'rent' | 'own';
export type HomeDownPayment = 0.035 | 0.1 | 0.2;
export interface HomeChoiceOptions { downPct?: HomeDownPayment }
export const HOME_OPTIONS = [
  { tier: 0, name: 'Tent', tenure: 'none', multiplier: 0 },
  { tier: 1, name: 'Studio apartment', tenure: 'rent', multiplier: 0.6 },
  { tier: 2, name: 'Small house', tenure: 'own', multiplier: 0.7 },
  { tier: 3, name: 'Townhouse', tenure: 'own', multiplier: 1.3 },
  { tier: 4, name: 'Large house', tenure: 'own', multiplier: 1.8 },
  { tier: 5, name: 'Retirement villa', tenure: 'own', multiplier: 4 },
] as const;
export const HOME_SELLING_SHARE = 0.06;
export const FORECLOSURE_DAYS = 120;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface HomeState {
  tier: HomeTier;
  tenure: HomeTenure;
  /** Flat purchase value, zero for rentals and the tent. */
  value: number;
  mortgageId: string | null;
  downPct: HomeDownPayment;
  /** Consecutive calendar months where the rent bill was paid short. */
  missedRentMonths: number;
  lastRentMonth: number | null;
  /** A filed bankruptcy forces a move once, allowing subsequent recovery. */
  bankruptcyDay: number | null;
}
export interface HomeEvent {
  type: 'home';
  day: number;
  from: HomeTier;
  to: HomeTier;
  tenure: HomeTenure;
  reason: 'choice' | 'move' | 'eviction' | 'foreclosure' | 'bankruptcy';
  value: number;
  rent: number;
  saleProceeds: number;
  cashSpent: number;
  mortgageId: string | null;
}
export interface HomeQuote {
  ok: boolean;
  tier: number;
  name: string;
  tenure: HomeTenure;
  reasons: string[];
  downPct: HomeDownPayment;
  price: number;
  rent: number;
  down: number;
  closing: number;
  moving: number;
  cashNeeded: number;
  cashAvailable: number;
  saleProceeds: number;
  mortgagePayment: number;
  taxAndInsurance: number;
  pmi: number;
  /** All-in monthly housing payment, including principal and interest. */
  monthlyPayment: number;
  application: ApplicationResult | null;
}
export type HomeChoiceResult = { ok: true; quote: HomeQuote; event: HomeEvent } | { ok: false; quote: HomeQuote; error: string };

export const medianRent = (place: Place) => Math.round(US_MEDIAN_RENT * place.rpp.housing / 100);
export const studioRent = (place: Place) => Math.round(US_MEDIAN_RENT * place.rpp.housing / 100 * HOME_OPTIONS[1].multiplier);
export function rentalHome(tier: 1 | 3 = 1, bankruptcyDay: number | null = null): HomeState {
  return { tier, tenure: 'rent', value: 0, mortgageId: null, downPct: 0.2, missedRentMonths: 0, lastRentMonth: null, bankruptcyDay };
}
export function homeMortgage(home: HomeState, book: DebtBook): Debt | undefined {
  return home.mortgageId === null ? undefined : book.debts.find(d => d.id === home.mortgageId);
}
export function housingBills(home: HomeState, book: DebtBook): { taxAndInsurance: number; pmi: number } {
  if (home.tenure !== 'own') return { taxAndInsurance: 0, pmi: 0 };
  const mortgage = homeMortgage(home, book);
  return {
    taxAndInsurance: round2(home.value * TAX_AND_INSURANCE / 12),
    pmi: home.downPct < 0.2 && mortgage && isOpen(mortgage) && mortgage.balance > home.value * 0.8
      ? round2(mortgage.balance * PMI_RATE / 12) : 0,
  };
}
export function homeSaleProceeds(home: HomeState, book: DebtBook): number {
  if (home.tenure !== 'own') return 0;
  const mortgage = homeMortgage(home, book);
  return round2(home.value * (1 - HOME_SELLING_SHARE) - (mortgage && isOpen(mortgage) ? owed(mortgage) : 0));
}
/** New card balances may not yet have a statement, but still count in underwriting. */
function debtPayment(d: Debt): number {
  return d.kind === 'credit_card' ? Math.max(d.minimumDue ?? 0, cardMinimum(d.balance, d.accrued)) : d.scheduledPayment ?? 0;
}
export function quoteHome(life: PlayerLife, tier: number, day: number, options: HomeChoiceOptions, cashRateAnnual: number): HomeQuote {
  const home = life.home;
  const target = HOME_OPTIONS.find(h => h.tier === tier);
  const downPct = options.downPct ?? 0.2;
  const saleProceeds = homeSaleProceeds(home, life.book);
  const wallet = life.ledger.wallet([...life.ledger.accounts.values()].filter(a => a.kind === 'checking' || a.kind === 'savings').map(a => a.id));
  const q: HomeQuote = {
    ok: false, tier, name: target?.name ?? 'Unknown home', tenure: target?.tenure ?? 'none', reasons: [], downPct,
    price: 0, rent: 0, down: 0, closing: 0, moving: 0, cashNeeded: 0,
    cashAvailable: round2(wallet.available() + saleProceeds), saleProceeds,
    mortgagePayment: 0, taxAndInsurance: 0, pmi: 0, monthlyPayment: 0, application: null,
  };
  if (!target || tier === 0) q.reasons.push('Choose an available home. The tent is only used after a loss of housing.');
  if (!Number.isSafeInteger(day) || day !== life.today) q.reasons.push('Choose a home on the current game day.');
  if (![0.035, 0.1, 0.2].includes(downPct)) q.reasons.push('Choose a down payment of 3.5%, 10%, or 20%.');
  if (![life.grossAnnual, life.age, life.book.profile.score, cashRateAnnual, q.cashAvailable, saleProceeds, life.place.rpp.housing].every(Number.isFinite)
    || life.place.rpp.housing <= 0 || life.grossAnnual < 0 || cashRateAnnual < 0) q.reasons.push('Housing requires valid cash, income, credit, and state costs.');
  if (!life.ledger.accounts.has('checking')) q.reasons.push('A checking account is required to settle a home transaction.');
  if (q.reasons.length || !target) return q;
  if (tier === home.tier && target.tenure === home.tenure && (home.tenure === 'own' || life.rent === studioRent(life.place))) {
    q.reasons.push('You already live in this home.');
  }
  if (target.tenure === 'rent') {
    q.rent = studioRent(life.place);
    q.monthlyPayment = q.rent;
  } else {
    const openDebts = life.book.debts.filter(isOpen);
    if (openDebts.some(d => !Number.isFinite(debtPayment(d)) || debtPayment(d) < 0)) {
      q.reasons.push('Existing debt payments must be finite, nonnegative amounts before applying for a mortgage.');
      return q;
    }
    const monthlyDebtPayments = openDebts.filter(d => d.id !== home.mortgageId).reduce((sum, d) => sum + debtPayment(d), 0);
    if (!Number.isFinite(monthlyDebtPayments)) {
      q.reasons.push('Total existing debt payments could not be calculated.');
      return q;
    }
    const view = viewOf(life);
    const math = houseMath({ ...view, homePrice: round2(homePrice(life.place) * target.multiplier) }, downPct);
    q.price = math.price;
    q.down = round2(math.down);
    q.closing = round2(math.closing);
    q.moving = math.moving;
    q.cashNeeded = round2(q.down + q.closing + q.moving);
    const principal = round2(q.price - q.down);
    q.taxAndInsurance = round2(q.price * TAX_AND_INSURANCE / 12);
    q.pmi = downPct < 0.2 ? round2(principal * PMI_RATE / 12) : 0;
    q.application = applyForLoan({
      kind: 'mortgage', amount: principal, termMonths: 360, book: life.book, day, cashRateAnnual,
      applicant: {
        age: life.age, annualIncome: life.grossAnnual * (life.employed ? 1 : 0.4),
        monthlyDebtPayments,
        monthlyHousing: q.taxAndInsurance + q.pmi,
      },
    });
    if (!Number.isFinite(q.application.dti)) q.reasons.push('The mortgage debt-to-income ratio must be finite.');
    q.mortgagePayment = q.application.monthlyPayment!;
    q.monthlyPayment = round2(q.mortgagePayment + q.taxAndInsurance + q.pmi);
    if (q.application.decision !== 'approved') q.reasons.push(...(q.application.reasons.length ? q.application.reasons : ['The mortgage was not approved.']));
    if (![q.price, q.down, q.closing, q.cashNeeded, q.mortgagePayment, q.monthlyPayment].every(Number.isFinite)) q.reasons.push('The mortgage could not be priced.');
  }
  if (q.cashAvailable + 0.005 < q.cashNeeded) q.reasons.push(`This home needs $${q.cashNeeded.toFixed(2)} in cash; checking, savings, and net sale proceeds provide $${q.cashAvailable.toFixed(2)}.`);
  q.ok = q.reasons.length === 0;
  return q;
}

/** Refuse corrupt new housing state rather than silently discarding a purchased asset. */
export function validateHome(home: HomeState, book: DebtBook): void {
  if (!home || !HOME_OPTIONS.some(h => h.tier === home.tier) || !['none', 'rent', 'own'].includes(home.tenure)
    || !Number.isFinite(home.value) || home.value < 0 || ![0.035, 0.1, 0.2].includes(home.downPct)
    || !Number.isInteger(home.missedRentMonths) || home.missedRentMonths < 0 || home.missedRentMonths > 1
    || (home.lastRentMonth !== null && !Number.isSafeInteger(home.lastRentMonth))
    || (home.bankruptcyDay !== null && !Number.isSafeInteger(home.bankruptcyDay))) throw new Error('Invalid housing state.');
  if (home.tenure === 'own') {
    const mortgage = homeMortgage(home, book);
    if (home.tier < 2 || home.value <= 0 || !mortgage || mortgage.kind !== 'mortgage' || mortgage.secured !== 'home'
      || book.debts.filter(d => d.id === home.mortgageId).length !== 1) throw new Error('Invalid home mortgage.');
  } else if (home.value !== 0 || home.mortgageId !== null
    || (home.tenure === 'none' ? home.tier !== 0 : home.tier !== 1 && home.tier !== 3)) throw new Error('Invalid rental or tent.');
}
