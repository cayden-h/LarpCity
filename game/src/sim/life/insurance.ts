// The health-insurance tiers offered at onboarding (sim/life/intake.ts). Their own module so the
// life (player.ts) can read a plan's deductible without importing the intake, which imports the life.

/** A health-insurance tier offered at onboarding; its deductible is what an injury bill charges before coinsurance (sim/life/events.ts). */
export interface InsurancePlan {
  id: string;
  name: string;
  monthlyPremium: number;
  deductible: number;
}

/** Three static tiers, in the game's dollar scale (rent runs roughly $1,000-2,000/mo). */
export const INSURANCE_PLANS: InsurancePlan[] = [
  { id: "bronze", name: "Bronze", monthlyPremium: 180, deductible: 5_000 },
  { id: "silver", name: "Silver", monthlyPremium: 280, deductible: 2_000 },
  { id: "gold", name: "Gold", monthlyPremium: 420, deductible: 500 },
];

/** The tier a skipped or unset intake defaults to. */
export const DEFAULT_INSURANCE_PLAN_ID = INSURANCE_PLANS[1].id;
