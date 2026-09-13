// The year-1 tax tutorial (meeting 2026-09-13): the first return the player
// files walks them through it and ends on one question, the bottom line. Answer
// it right and every later return files itself on tax day; answer it wrong and
// next year's return asks again.

import type { TaxReturn } from "./types.ts";

export interface TutorialState {
  /** The player has been through the tutorial at least once. */
  done: boolean;
  /** They got the bottom line right, so later returns file themselves. */
  passed: boolean;
}

export const TUTORIAL_START: TutorialState = { done: false, passed: false };

export interface TutorialOption {
  label: string;
  /** Positive is a refund, negative is owed. */
  amount: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const usd = (n: number) => `$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

/** The return's bottom line: withheld plus credits minus tax, federal and state together. */
export function bottomLine(ret: TaxReturn): number {
  return round2(ret.federalRefundOrOwed + ret.stateRefundOrOwed);
}

const describe = (amount: number) => (amount >= 0 ? `A ${usd(amount)} refund` : `You owe ${usd(amount)}`);

/**
 * Three answers for "what's your bottom line?": the right one, the common
 * mistake of reading the tax itself as what you owe, and the mistake of
 * forgetting what your paychecks already withheld. Ordered by the year so the
 * right answer isn't always in the same place.
 */
export function tutorialOptions(ret: TaxReturn): TutorialOption[] {
  const right = bottomLine(ret);
  const totalTax = round2(ret.federalTax + ret.stateTax);
  const totalWithheld = round2(ret.federalWithheld + ret.stateWithheld);
  const candidates = [right, -totalTax, round2(totalWithheld + ret.eic)];
  const unique: number[] = [];
  for (const c of candidates) if (!unique.some((u) => Math.abs(u - c) < 1)) unique.push(c);
  // A return with no tax and no withholding has one answer; pad it so there's still a choice.
  while (unique.length < 3) unique.push(round2(unique[unique.length - 1] - 250));
  const shift = ret.year % 3;
  const ordered = [...unique.slice(shift), ...unique.slice(0, shift)];
  return ordered.map((amount) => ({ label: describe(amount), amount }));
}

export function isCorrect(ret: TaxReturn, amount: number): boolean {
  return Math.abs(bottomLine(ret) - amount) < 1;
}

/** Whether a return that just became ready files itself (the tutorial was passed) or waits for the player. */
export function filesItself(t: TutorialState): boolean {
  return t.passed;
}

/** After the player files: the tutorial is done, and passed if they got the bottom line right. */
export function afterFiling(t: TutorialState, correct: boolean): TutorialState {
  return { done: true, passed: t.passed || correct };
}

/**
 * Which mistake an answer made, for Sammy's reaction: the right one, reading the
 * tax itself as what's owed (forgetting withholding), counting what was paid
 * but forgetting the tax, or one of the padding answers.
 */
export function answerKind(ret: TaxReturn, amount: number): "right" | "forgot-withholding" | "forgot-tax" | "other" {
  if (isCorrect(ret, amount)) return "right";
  if (Math.abs(amount + ret.federalTax + ret.stateTax) < 1) return "forgot-withholding";
  if (Math.abs(amount - (ret.federalWithheld + ret.stateWithheld + ret.eic)) < 1) return "forgot-tax";
  return "other";
}
