// IRS Topic 653 (irs.gov/taxtopics/tc653), checked 2026-09-12: failure-to-file
// 5%/month capped at 25% (5 months); failure-to-pay 0.5%/month capped at 25%;
// when both apply in the same month, that month's failure-to-file rate drops
// to 4.5% so the combined monthly rate is never more than 5%. A minimum
// penalty (lesser of $525 or 100% of the tax owed) applies once a *return* is
// more than 60 days late — i.e. it's keyed on late filing, not late payment,
// so a return filed on time never triggers it even if payment drags on for
// years. Interest is a flat approximate annual rate, simple (not compounded)
// — a deliberate simplification for this game, not the IRS's actual
// daily-compounded formula.
export interface PenaltyResult {
  failureToFile: number;
  failureToPay: number;
  interest: number;
  total: number;
}

const FTF_MONTHLY = 0.05;
const FTP_MONTHLY = 0.005;
const FTF_CAP = 0.25;
const FTP_CAP = 0.25;
const FTF_CAP_MONTHS = 5; // failure-to-file stops accruing after 5 months (5% × 5 = 25%)
const MIN_PENALTY_AFTER_MONTHS = 2; // "more than 60 days" late filing
const MIN_PENALTY = 525;
/** Flat approximate annual rate (IRS underpayment rate runs close to this in recent years). */
const INTEREST_ANNUAL_RATE = 0.08;

/** The rates above, for Sammy's tax tour; the monthly ones are fractions of what's owed. */
export const PENALTY_RATES = { fileMonthly: FTF_MONTHLY, fileCap: FTF_CAP, payMonthly: FTP_MONTHLY, payCap: FTP_CAP, interestAnnual: INTEREST_ANNUAL_RATE } as const;

const round2 = (x: number) => Math.round(x * 100) / 100;

export function penaltyFor(o: { owed: number; monthsUnfiled: number; monthsUnpaid: number }): PenaltyResult {
  if (o.owed <= 0) return { failureToFile: 0, failureToPay: 0, interest: 0, total: 0 };
  const ftfMonths = Math.max(0, o.monthsUnfiled);
  const ftpMonths = Math.max(0, o.monthsUnpaid);

  // Both penalties can apply in the same month (the first ftfMonths, capped at 5
  // since failure-to-file alone caps at 25%); in those overlapping months the
  // failure-to-file rate is reduced by the failure-to-pay rate already applied.
  const overlapMonths = Math.min(ftfMonths, ftpMonths, FTF_CAP_MONTHS);
  const ftfOnlyMonths = Math.max(0, Math.min(ftfMonths, FTF_CAP_MONTHS) - overlapMonths);
  const failureToFile = round2(
    Math.min(o.owed * FTF_CAP, o.owed * (overlapMonths * (FTF_MONTHLY - FTP_MONTHLY) + ftfOnlyMonths * FTF_MONTHLY)),
  );
  const failureToPay = round2(Math.min(o.owed * FTP_CAP, o.owed * FTP_MONTHLY * ftpMonths));

  const interest = round2(o.owed * INTEREST_ANNUAL_RATE * (ftpMonths / 12));

  let total = round2(failureToFile + failureToPay + interest);
  // Minimum penalty is for late *filing*, not late payment: a return filed on
  // time (ftfMonths === 0) never hits it, no matter how long payment drags on.
  if (ftfMonths > MIN_PENALTY_AFTER_MONTHS) {
    const minimum = Math.min(MIN_PENALTY, o.owed);
    total = Math.max(total, minimum);
  }
  return { failureToFile, failureToPay, interest, total };
}
