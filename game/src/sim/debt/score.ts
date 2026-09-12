// A simplified FICO-style score: the real five factors and weights, our own
// formula (FICO's is proprietary). 300-850.

import type { CreditProfile, Debt } from "./types.ts";

const YEAR = 365;
export const WEIGHTS = { payment: 0.35, amounts: 0.3, length: 0.15, newCredit: 0.1, mix: 0.1 } as const;
const MARK_COST = { 30: 0.15, 60: 0.25, 90: 0.35, 120: 0.5 } as const;

export interface ScoreBreakdown {
  score: number;
  payment: number;
  amounts: number;
  length: number;
  newCredit: number;
  mix: number;
  utilization: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Piecewise linear utilization factor: 1.0 under 10%, 0.85 at 30%, 0.5 at 50%, 0.2 at 90%+. */
export function utilizationFactor(u: number): number {
  const pts: [number, number][] = [[0, 1], [0.1, 1], [0.3, 0.85], [0.5, 0.5], [0.9, 0.2], [1, 0.2]];
  if (u >= 1) return 0.2;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if (u <= x1) return lerp(y0, y1, (u - x0) / (x1 - x0));
  }
  return 0.2;
}

export function scoreBreakdown(profile: CreditProfile, debts: Debt[], day: number, historyStartDay: number): ScoreBreakdown {
  // Payment history: marks fade linearly over 7 years (the reporting window).
  let payment = 1;
  for (const m of profile.lateMarks) {
    const age = day - m.day;
    if (age < 7 * YEAR) payment -= MARK_COST[m.severity] * (1 - age / (7 * YEAR));
  }
  for (const c of profile.collections) {
    const age = day - c.day;
    if (age < 7 * YEAR) payment -= 0.5 * (1 - age / (7 * YEAR));
  }
  payment = Math.max(0, payment);
  if (profile.bankruptcy) {
    const years = profile.bankruptcy.chapter === 7 ? 10 : 7;
    if (day - profile.bankruptcy.day < years * YEAR) payment = Math.min(payment, 0.2);
  }

  const open = debts.filter((d) => d.status !== "paid" && d.status !== "discharged");
  const cards = open.filter((d) => d.kind === "credit_card" && d.creditLimit);
  const limit = cards.reduce((s, d) => s + (d.creditLimit ?? 0), 0);
  const used = cards.reduce((s, d) => s + d.balance + d.accrued, 0);
  const utilization = limit > 0 ? used / limit : 0;
  const amounts = cards.length ? utilizationFactor(utilization) : 0.7;

  const ages = open.map((d) => day - d.openedDay);
  const avgAgeYears = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length / YEAR : (day - historyStartDay) / YEAR;
  const length = Math.min(1, Math.max(0, avgAgeYears / 15));

  const recent = profile.inquiries.filter((d) => day - d < YEAR).length;
  const newCredit = Math.max(0, 1 - 0.2 * recent);

  const revolving = open.some((d) => d.kind === "credit_card");
  const installment = open.some((d) => d.kind !== "credit_card" && d.kind !== "medical" && d.kind !== "payday");
  const mix = revolving && installment ? 1 : revolving || installment ? 0.6 : 0.3;

  const sum =
    WEIGHTS.payment * payment +
    WEIGHTS.amounts * amounts +
    WEIGHTS.length * length +
    WEIGHTS.newCredit * newCredit +
    WEIGHTS.mix * mix;
  return { score: Math.round(300 + 550 * sum), payment, amounts, length, newCredit, mix, utilization };
}

export function scoreBand(score: number): "Excellent" | "Very good" | "Good" | "Fair" | "Poor" {
  if (score >= 800) return "Excellent";
  if (score >= 740) return "Very good";
  if (score >= 670) return "Good";
  if (score >= 580) return "Fair";
  return "Poor";
}
