// The named NPCs (option B of the Nessie plan, SETUP.md): the city's residents
// whose money is real enough to have a Nessie bank account. Each profile turns
// into a PlayerLife in sim/npcs; the server also reads this file, because the
// roster is the allow-list of Nessie customers (customers can't be deleted, so
// nothing outside this list ever gets one). Names are fictional; Nessie data is
// readable by every team.
//
// Every profile lives in the player's city and pays that state's rent and
// living costs, so the numbers below are monthly take-home pay against about
// $2,240 of Texas rent and living costs. Each tells one lesson.

export type JobCategoryId =
  | "management" | "business_finance" | "tech" | "engineering" | "science"
  | "social_services" | "legal" | "education" | "arts_media" | "healthcare_pro"
  | "healthcare_support" | "protective" | "food_service" | "cleaning_grounds"
  | "personal_care" | "sales_retail" | "office_admin" | "farming" | "construction"
  | "repair" | "production" | "transport";

export type JobLevel = "entry" | "mid" | "senior" | "lead" | "top";

export type NpcDebtKind = "card" | "student" | "auto" | "personal";

export interface NpcDebtSpec {
  kind: NpcDebtKind;
  name: string;
  balance: number;
  /** Annual rate as a fraction. */
  apr?: number;
  /** Cards: the credit limit. */
  limit?: number;
  /** Installment and student loans: the monthly payment. */
  payment?: number;
  /** Installment loans: months left. */
  months?: number;
}

export interface NpcProfile {
  /** Stable id, also the Nessie customer's tag: `npc-<first name>`. */
  id: string;
  first: string;
  last: string;
  age: number;
  job: string;
  categoryId: JobCategoryId;
  level: JobLevel;
  monthlyTakeHome: number;
  accounts: { checking: number; savings: number; emergency: number };
  debts: NpcDebtSpec[];
  strategy: "minimums" | "avalanche" | "snowball";
  extraMonthly: number;
  /** One line for the NPC card: the lesson this life shows. */
  story: string;
}

export const NPCS: NpcProfile[] = [
  {
    id: "npc-maya",
    first: "Maya",
    last: "Nguyen",
    age: 31,
    job: "nurse",
    categoryId: "healthcare_pro",
    level: "senior",
    monthlyTakeHome: 4_900,
    accounts: { checking: 2_400, savings: 6_000, emergency: 9_000 },
    debts: [{ kind: "card", name: "Everyday Visa", balance: 1_200, limit: 8_000, apr: 0.219 }],
    strategy: "avalanche",
    extraMonthly: 200,
    story: "Four months of expenses saved, so surprises don't turn into debt.",
  },
  {
    id: "npc-jordan",
    first: "Jordan",
    last: "Garcia",
    age: 24,
    job: "barista",
    categoryId: "food_service",
    level: "entry",
    monthlyTakeHome: 2_550,
    accounts: { checking: 350, savings: 0, emergency: 0 },
    debts: [{ kind: "card", name: "Store card", balance: 3_100, limit: 3_500, apr: 0.2499 }],
    strategy: "minimums",
    extraMonthly: 0,
    story: "Paycheck to paycheck with a maxed-out card: one surprise away from trouble.",
  },
  {
    id: "npc-priya",
    first: "Priya",
    last: "Patel",
    age: 28,
    job: "software developer",
    categoryId: "tech",
    level: "senior",
    monthlyTakeHome: 7_600,
    accounts: { checking: 5_200, savings: 18_000, emergency: 20_000 },
    debts: [{ kind: "card", name: "Travel rewards card", balance: 9_400, limit: 20_000, apr: 0.2249 }],
    strategy: "minimums",
    extraMonthly: 0,
    story: "A big salary and a big card balance: savings earn 4% while the card charges 22%.",
  },
  {
    id: "npc-marcus",
    first: "Marcus",
    last: "Johnson",
    age: 35,
    job: "teacher",
    categoryId: "education",
    level: "senior",
    monthlyTakeHome: 3_700,
    accounts: { checking: 900, savings: 2_500, emergency: 1_500 },
    debts: [
      { kind: "student", name: "Student loans", balance: 38_000, apr: 0.0639, payment: 390 },
      { kind: "card", name: "Cash back card", balance: 2_000, limit: 5_000, apr: 0.2299 },
    ],
    strategy: "snowball",
    extraMonthly: 100,
    story: "Snowballing the small card first, then the student loans.",
  },
  {
    id: "npc-sofia",
    first: "Sofia",
    last: "Martinez",
    age: 42,
    job: "small business owner",
    categoryId: "sales_retail",
    level: "lead",
    monthlyTakeHome: 6_200,
    accounts: { checking: 8_000, savings: 12_000, emergency: 5_000 },
    debts: [
      { kind: "personal", name: "Business equipment loan", balance: 18_000, apr: 0.115, months: 60 },
      { kind: "card", name: "Business card", balance: 4_500, limit: 15_000, apr: 0.2149 },
    ],
    strategy: "avalanche",
    extraMonthly: 250,
    story: "Borrowed to grow the shop and pays the most expensive debt first.",
  },
  {
    id: "npc-kenji",
    first: "Kenji",
    last: "Tanaka",
    age: 26,
    job: "delivery driver",
    categoryId: "transport",
    level: "mid",
    monthlyTakeHome: 2_900,
    accounts: { checking: 600, savings: 0, emergency: 0 },
    debts: [
      { kind: "auto", name: "Car loan", balance: 16_500, apr: 0.139, months: 72 },
      { kind: "card", name: "Starter card", balance: 1_800, limit: 2_000, apr: 0.2799 },
    ],
    strategy: "minimums",
    extraMonthly: 0,
    story: "A subprime car loan he needs for work: 13.9% for six years.",
  },
  {
    id: "npc-amara",
    first: "Amara",
    last: "Okafor",
    age: 38,
    job: "pharmacist",
    categoryId: "healthcare_pro",
    level: "senior",
    monthlyTakeHome: 8_900,
    accounts: { checking: 6_500, savings: 40_000, emergency: 25_000 },
    debts: [{ kind: "auto", name: "Car loan", balance: 22_000, apr: 0.059, months: 60 }],
    strategy: "avalanche",
    extraMonthly: 500,
    story: "Pays extra on a cheap car loan and keeps a deep cushion.",
  },
  {
    id: "npc-diego",
    first: "Diego",
    last: "Hernandez",
    age: 29,
    job: "electrician",
    categoryId: "construction",
    level: "senior",
    monthlyTakeHome: 5_100,
    accounts: { checking: 1_900, savings: 4_000, emergency: 2_000 },
    debts: [
      { kind: "auto", name: "Truck loan", balance: 9_000, apr: 0.069, months: 48 },
      { kind: "card", name: "Everyday card", balance: 600, limit: 6_000, apr: 0.1999 },
    ],
    strategy: "avalanche",
    extraMonthly: 150,
    story: "A steady trade job, building his emergency fund month by month.",
  },
  {
    id: "npc-hannah",
    first: "Hannah",
    last: "Brooks",
    age: 23,
    job: "retail associate",
    categoryId: "sales_retail",
    level: "entry",
    monthlyTakeHome: 2_300,
    accounts: { checking: 400, savings: 100, emergency: 0 },
    debts: [{ kind: "card", name: "First card", balance: 900, limit: 1_000, apr: 0.2699 }],
    strategy: "minimums",
    extraMonthly: 0,
    story: "A year into her first card, close to the limit and only paying the minimum.",
  },
  {
    id: "npc-oscar",
    first: "Oscar",
    last: "Ruiz",
    age: 33,
    job: "rideshare driver",
    categoryId: "transport",
    level: "entry",
    monthlyTakeHome: 3_300,
    accounts: { checking: 250, savings: 0, emergency: 0 },
    debts: [{ kind: "personal", name: "Emergency repair loan", balance: 2_400, apr: 0.329, months: 18 }],
    strategy: "minimums",
    extraMonthly: 0,
    story: "Gig income doesn't qualify for a bank loan, so a car repair became 32.9% for 18 months.",
  },
  {
    id: "npc-grace",
    first: "Grace",
    last: "Kim",
    age: 61,
    job: "retiree",
    categoryId: "management",
    level: "top",
    monthlyTakeHome: 3_100,
    accounts: { checking: 4_200, savings: 65_000, emergency: 30_000 },
    debts: [],
    strategy: "avalanche",
    extraMonthly: 0,
    story: "Mortgage paid off years ago; most of what she lives on now comes from the market, not a paycheck.",
  },
  {
    id: "npc-tariq",
    first: "Tariq",
    last: "Ahmed",
    age: 27,
    job: "accountant",
    categoryId: "business_finance",
    level: "mid",
    monthlyTakeHome: 4_400,
    accounts: { checking: 3_100, savings: 9_000, emergency: 6_000 },
    debts: [{ kind: "student", name: "Student loans", balance: 14_000, apr: 0.045, payment: 145 }],
    strategy: "minimums",
    extraMonthly: 0,
    story: "His loan's rate is under 5%, so every spare dollar goes to his Roth IRA instead of paying it off early.",
  },
];

/** The subset of the roster that ever gets a real, live Nessie customer (server/src/mirror.ts's MAX_NPC_CUSTOMERS = 12). Everything else in the roster (game/src/data/background-npcs.ts) is fallback-only. */
export const PRIMARY_NPC_IDS: readonly string[] = NPCS.map((n) => n.id);

/** Everyone the bank mirror may give a Nessie customer: the player plus the roster. */
export const MIRROR_ENTITIES: { id: string; name: string }[] = [
  { id: "player", name: "Player" },
  ...NPCS.map((n) => ({ id: n.id, name: n.first })),
];
