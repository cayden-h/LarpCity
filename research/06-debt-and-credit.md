# Larp City - Debt and Credit Deep Dive

Research on how debt works in the US in 2026 and how to build it into Larp City as a first-class system next to the stock market.
Written 2026-09-11 during HackRice 2026.
It follows the 2026-09-11 game design meeting ([../meeting-2026-09-11-game-design.md](../meeting-2026-09-11-game-design.md)): daily ticks, one player life, retirement as the goal, skips and fast-forwarding to goals (the age teleport was removed on 2026-09-12), and AI feedback only at goals, bankruptcy, and big swings.
Where this doc conflicts with the meeting, the meeting wins.
Mirrored to the team Notion page on 2026-09-11: a "💳 Debt & Credit" toggle section after Stock Market & Simulation, a "💳 Research: Debt & Credit" sub-page under Research & Docs, a "Debt & credit" group under Open Questions (each with a 💡 Suggested answer), and a debt section in the ChatGPT Brief.

## TL;DR

- Debt is the other half of the game.
  The market teaches "stay invested"; debt teaches "interest works against you too", and it is the behavior financial education is worst at changing, so it is where a simulation adds the most value [04-impact, Kaiser & Menkhoff].
- Model six kinds of debt with real 2026 terms: credit card, federal student loan, auto loan, mortgage, buy now pay later (BNPL), and payday loan.
  Personal loans and medical bills are cheap extras.
- Credit cards compound daily, which fits our daily tick exactly.
- Add a simplified FICO-style credit score (300-850) built from the real five factors, because the score is what makes debt decisions cascade: it sets the APR on the next car loan and mortgage.
- Missed payments walk down a visible ladder: late fee, 30/60/90 days late, default, collections, wage garnishment, bankruptcy.
  This gives the existing "bankruptcy stops the skip" rule a concrete, explainable path.
- Interest rates come from the market's `cashRateAnnual`, so the Rate Shock (2022) template makes card APRs and mortgage rates jump, and the Housing Crunch (2008) tightens credit.
  Debt and market become one connected system.
- Signature lessons, with our own computed numbers:
  - $5,000 on a 23.96% card at the minimum payment takes 19.5 years and $8,871 of interest; $200 a month takes 35 months and $1,995.
  - A $400 payday loan at $15 per $100 every two weeks is a 390% APR.
  - The same $35,000 car costs $6,484 of interest at a prime 6.9% over 60 months and $19,816 at a subprime 16.11% over 72 months.
  - Debt snowball costs $92 more than avalanche in our sample household but pays off the first debt at month 5 instead of month 21, and research says that early win is what keeps people going.
  - On minimums alone, the same household takes 22 years and $22,425 of interest; $300 a month extra makes it 4 years and about $7,200.
- Visual hook for the LEGO-style map: each debt is a building in a "Debt District" that shrinks as you pay it and gets demolished, with confetti, when it hits zero; missed payments set it on fire, like the LEGO game's fires.

## 1. Why debt belongs in Larp City

| Stat | Value | Source |
| --- | --- | --- |
| Total US household debt | $18.77 trillion (Q2 2026) | [NY Fed, Aug 2026](https://www.newyorkfed.org/newsevents/news/research/2026/20260811) |
| Mortgage | $13.12T | same |
| Auto loans | $1.71T | same |
| Student loans | $1.65T | same |
| Credit cards | $1.26T, up $54B in a year | same |
| HELOC / other | $0.46T / $0.57T | same |
| Share of debt in some stage of delinquency | 4.7% | [NY Fed Q2 2026 report](https://www.newyorkfed.org/medialibrary/interactives/householdcredit/data/pdf/HHDC_2026Q2) |
| Flow into serious (90+ day) delinquency | Student 7.83%, credit card 6.97%, other 5.19%, auto 3.00%, mortgage 1.52% | [NY Fed, Aug 2026](https://www.newyorkfed.org/newsevents/news/research/2026/20260811), [Fox Business](https://www.foxbusiness.com/economy/new-york-fed-finds-credit-card-auto-loan-delinquencies-remain-elevated) |
| Federal student loan borrowers | 42.6 million, average about $39,500 each (median about $24,100) | [EducationData](https://educationdata.org/average-student-loan-debt), [SoFi](https://www.sofi.com/learn/content/student-loan-debt-statistics/) |
| Defaulted student loan borrowers noticed for wage garnishment | About 5.3 million; garnishment of up to 15% of disposable pay resumed in January 2026 | [ACA International](https://www.acainternational.org/news/federal-student-loan-wage-garnishment-resumes-january-2026/), [CBS News](https://www.cbsnews.com/news/student-loan-borrowers-default-wages-garnished-2026/) |

Why this matters for the pitch:

- Student loans and credit cards have the worst delinquency rates of any debt, and both hit young adults, our core players, hardest.
- Our impact research already found that debt behavior is the hardest thing to change with classes, and that just-in-time decisions work better (see [04-impact-learning-and-judging.md](04-impact-learning-and-judging.md), principle 7: "Target the hard behaviors").
- The Finance track and Capital One both reward a real-money takeaway; "your payoff plan and your debt-free date" is one of the most concrete takeaways we can give.

## 2. The debt types to model (2026 terms)

All numbers are 2026 averages; the game should pick each player's actual rate from their credit score (Section 3).

| Debt | Real 2026 terms | How it works in the sim | Main lesson |
| --- | --- | --- | --- |
| **Credit card** (revolving) | Average APR about 19-25% depending on source (Curinos 19.25%, WalletHub 23.82%, Forbes 24.96%), range 7.9% to 34.5% ([WalletHub](https://wallethub.com/edu/cc/average-credit-card-interest-rate/50841), [Forbes](https://www.forbes.com/advisor/credit-cards/average-credit-card-interest-rate/)) | Interest accrues daily at APR/365 on the balance. Paying the statement in full by the due date means zero interest (grace period). Minimum payment is the greater of $25 or 1% of balance plus that month's interest ([WalletHub calculator](https://wallethub.com/credit-card-minimum-payment-calculator)). A late payment adds a fee (about $30-41; the CFPB's $8 cap was vacated in 2025) and, after 60 days, a penalty APR up to about 29.99%. | The minimum payment trap; utilization hurts your score. |
| **Federal student loan** | New loans from July 1, 2026 get only the Standard plan (10-25 years by balance) or the new Repayment Assistance Plan (RAP). SAVE ended July 1, 2026. Grad PLUS is gone; grad loans are capped at $20,500 a year / $100,000 total ($50,000 / $200,000 for professional degrees) ([TICAS](https://ticas.org/affordability-2/upcoming-changes-to-income-driven-repayment-plans/), [Saving for College](https://www.savingforcollege.com/article/student-loan-repayment-assistance-plan-rap)) | RAP payment: 1% of AGI for $10,001-20,000, rising 1 point per $10,000 bracket to 10% above $100,000, minimum $10 a month, minus $50 per dependent. Unpaid interest is waived each month, and up to $50 of principal is matched so the balance always shrinks. Anything left after 30 years is forgiven. Default after about 270 days late leads to wage garnishment of up to 15% of pay. | Income-driven plans are a safety net; default is far worse than a small payment. |
| **Auto loan** (installment, secured) | New-car APR 6.90% (60 months, Bankrate, Sep 9 2026); super prime 4.41% vs deep subprime 16.11%; average payment $770 new, $531 used; average down payment $5,815 new, $4,016 used ([Bankrate](https://www.bankrate.com/loans/auto-loans/rates/), [U.S. News](https://cars.usnews.com/cars-trucks/advice/average-auto-loan-interest-rates), [Bankrate payments](https://www.bankrate.com/loans/auto-loans/average-monthly-car-payment/)) | Fixed monthly payment from the amortization formula. Missing about 3 payments triggers repossession: the car is gone, the loan balance minus auction value is still owed, and the commute event gets worse. | Credit score sets the price of the same car; long terms feel cheaper and cost more. |
| **Mortgage** (installment, secured) | 30-year fixed averaged 6.76% on Sep 10 2026, up from 6.35% a year earlier ([Freddie Mac PMMS](https://www.freddiemac.com/pmms), [GlobeNewswire](https://www.globenewswire.com/news-release/2026/09/10/3359803/0/en/mortgage-rates-average-6-76.html)) | Taken out through the "buy a house" goal. Down payment under 20% adds PMI (about 0.5-1% of the loan a year) until 20% equity. Property tax comes from the state data in [02-states-cost-of-living.md](02-states-cost-of-living.md). A refinance event appears when rates fall at least 1 point below the player's rate. Foreclosure after long delinquency. | Rate and down payment matter more than house price; a home is both an asset and a debt. |
| **Buy now, pay later** | Usually "pay in 4" at 0% interest, with late fees; longer BNPL plans charge interest. The CFPB withdrew its 2024 BNPL rule in May 2025, so regulation is light ([Federal Reserve note, Jun 2026](https://www.federalreserve.gov/econres/notes/feds-notes/buy-now-pay-later-beyond-pay-in-4-a-comprehensive-product-overview-20260605.html), [NCLC](https://library.nclc.org/article/rule-bounced-payday-and-high-cost-loan-payments-now-effect)) | Offered at checkout on big purchases. Four payments every 2 weeks. Harmless alone; the risk is stacking several at once so that due dates collide. | "Free" credit still has to fit the budget. |
| **Payday loan** | About 391% APR on average, over 600% in states without caps; banned or capped at 36% in many states ([CreditNinja](https://www.creditninja.com/blog/what-is-the-average-payday-loan-interest-rate/), [CFPB payday rule](https://www.consumerfinance.gov/compliance/compliance-resources/consumer-lending-resources/payday-lending-rule/payday-lending-rule-faqs/)) | A storefront in the city offers one when checking is about to go negative. $15 per $100 for 2 weeks, due in full; rolling it over charges the fee again. Availability depends on the player's state (a nice use of the states data). | A $500 emergency fund beats a 390% loan; this is the win that is reachable at any income. |
| Personal / consolidation loan (extra) | Fixed rate, 2-5 years, priced by credit score | Used to consolidate card debt at a lower rate. | Consolidation helps only if the cards stay paid off. |
| Medical bill (extra) | Bureaus don't report medical collections under $500; the broader CFPB medical debt rule was vacated in July 2025, so larger medical debt can still appear ([Avant](https://www.avant.com/blog/credit-scores/your-2026-credit-score-playbook/)) | The existing Medical bill event (#6 in doc 03) can become a debt: ask for a payment plan, or ignore it and it goes to collections after about 180 days if it's $500 or more. | Ask for a payment plan; don't ignore bills. |

## 3. Credit score model

A real FICO score comes from five weighted factors ([myFICO](https://www.myfico.com/credit-education/credit-scores/payment-history), [Experian](https://www.experian.com/blogs/ask-experian/credit-education/score-basics/what-affects-your-credit-scores/)).
We keep the same five factors and weights so everything the player learns carries over to real life, but use our own simple formula (FICO's is proprietary).

| Factor | Weight | Game input | Simple scoring rule |
| --- | --- | --- | --- |
| Payment history | 35% | Late marks (30/60/90+), defaults, collections, bankruptcy | Start at 1.0. A 30-day late mark costs 0.15, a 60-day 0.25, a 90-day 0.35, a default or collection 0.5. Each mark fades linearly to 0 over 7 years (the real reporting window). Bankruptcy caps this factor at 0.2 for 10 years (Chapter 7) or 7 years (Chapter 13) ([CFPB](https://www.consumerfinance.gov/ask-cfpb/how-long-does-a-bankruptcy-appear-on-credit-reports-en-325/)). |
| Amounts owed (utilization) | 30% | Total card balances / total card limits | 1.0 under 10%, 0.85 at 30%, 0.5 at 50%, 0.2 at 90%+ (piecewise linear). |
| Length of history | 15% | Average age of open accounts | Linear from 0 at 0 years to 1.0 at 15 years. Closing an old card lowers it (a nice trap). |
| New credit | 10% | Hard inquiries in the last 12 months | 1.0 with none, minus 0.2 per inquiry, floor 0. |
| Credit mix | 10% | Has revolving and installment accounts | 1.0 with both, 0.6 with one type, 0.3 with none. |

`score = round(300 + 550 * weightedSum)`.
Players with no history start "thin file" at about 600-650, which is realistic for a new graduate.

What the score does in the game:

- **Price:** APR on every new loan comes from a score band.
  For auto loans, interpolate between super prime 4.41% and deep subprime 16.11%; for cards, between about 20% and 30%; for mortgages, add 0 to about 1.5 points to the market mortgage rate.
- **Access:** Below about 580 some offers are declined (a real "no" is a lesson); a secured card is always available.
- **Rent:** Landlords check credit when the player moves states; a low score means a bigger deposit.
- **Insurance and jobs** are real effects too, but skip them for the MVP.

## 4. The delinquency ladder (how "going broke" really happens)

The doc 03 shortfall waterfall ends at "credit card, then broke/homeless".
Real distress goes through clear steps, and each step is a chance to teach and to recover.

| Day late | What happens | In the game |
| --- | --- | --- |
| 0 | Missed due date | Late fee; toast "Payment missed" |
| 30 | Reported to bureaus | Score drops (often 60-110 points for a good score); newspaper-style notice |
| 60 | Penalty APR on cards | APR jumps to 29.99%; the building catches fire on the map |
| 90 | Serious delinquency | Big score hit; ElevenLabs collector voicemail; the player must choose: hardship plan, balance transfer, credit counseling, or keep ignoring |
| 120-180 | Charge-off and collections | Debt sold to a collector; auto loans repossess, mortgages start foreclosure |
| 270 (federal student loan) | Default | Wage garnishment of up to 15% of pay, tax refunds taken |
| Anytime after unmanageable debt | Bankruptcy option | Chapter 7 or Chapter 13 decision (below) |

Recovery options should be real and visible at every step, so the ladder teaches "call your lender early":

- Hardship program (lower APR or skipped payments for 3-6 months).
- Nonprofit credit counseling debt management plan (the same programs Gal and McShane studied).
- 0% balance transfer card for 15-21 months, with a 3-5% fee, if the score allows it.
- Switching a student loan to RAP (the payment can drop to $10).
- Consolidation loan.

### Bankruptcy as a real mechanic, not just a game over

The meeting's rule is that bankruptcy stops a skip and explains why.
This gives it a definition and a real choice:

- **Trigger:** unsecured debt is 90+ days late and minimum payments exceed about 50% of take-home pay, or the shortfall waterfall is fully exhausted.
  The skip or teleport stops here.
- **Choice:**
  - **Chapter 7:** most unsecured debt is wiped in about 4 months.
    Costs about $338 in court fees plus $1,000-3,500 for an attorney.
    Only allowed if income is below the state median (the means test), which we can check against our per-state data.
    Nonexempt assets are sold; it stays on the credit report for 10 years.
  - **Chapter 13:** a 3-5 year repayment plan; you keep your house and car.
    Costs $313 plus $2,500-6,000 for an attorney, paid through the plan; it stays for 7 years.
  - **Not dischargeable either way:** most student loans, recent taxes, and child support.
    This is a surprising real rule and a good lesson.
  - Sources: [Nolo means test](https://www.nolo.com/legal-encyclopedia/chapter-7-bankruptcy-means-test-eligibility-29907.html), [Experian Chapter 7 vs 13](https://www.experian.com/blogs/ask-experian/bankruptcy-chapter-7-vs-chapter-13/), [Nolo filing fees](https://www.nolo.com/legal-encyclopedia/bankruptcy-filing-fees-costs.html), [Upsolve](https://upsolve.org/learn/how-much-does-bankruptcy-cost/).
- **After:** the game continues, with a score around 500-550 that slowly rebuilds.
  This matches the impact research ("frame bankruptcy as a lesson screen, not a game-over punishment" and "there is always a path to recover").
  The AI bankruptcy feedback (a meeting-approved trigger) reads the ledger and explains which step on the ladder was the turning point.

## 5. The learning science to build on

- **Minimum payments anchor people.**
  The minimum shown on a statement acts as an anchor that pulls payments down; the CARD Act added a "how long at the minimum" box to statements because of this.
  In game: show the payoff-date line live on the payment slider, so dragging from the minimum to $200 visibly moves "debt-free" from 2046 to 2029.
- **Snowball vs avalanche.**
  Avalanche (highest APR first) is mathematically cheapest.
  Snowball (smallest balance first) costs more but produces early wins.
  Gal and McShane's study of a national debt-management program found that the share of accounts closed, not dollars paid, best predicted who got fully debt-free ([Kellogg](https://www.kellogg.northwestern.edu/news_articles/2012/snowball-approach.aspx), [Brown, CFPB symposium paper](https://files.consumerfinance.gov/f/documents/P2d_-_Brown_-_Small_Victories.pdf)).
  Later work puts a price on that behavior ([Hamilton 2023, Southern Economic Journal](https://onlinelibrary.wiley.com/doi/full/10.1002/soej.12612)).
  In game: let the player pick the strategy, and show the ghost line of the other one; neither is "wrong".
- **Present bias and "exponential growth bias".**
  People underestimate how fast compound interest grows.
  The daily tick makes interest visible: a small red "+$4.12 interest today" floater over the card building.
- **Mental accounting.**
  People keep cash in savings earning about 4% while carrying a 24% card balance.
  In game: the AI swing feedback can flag it, and the counterfactual shows the cost.

### Our sample household (computed by the game engine)

Four debts: a $1,500 furniture loan at 11%, a $7,000 credit card at 23.96%, a $14,000 car loan at 6.9%, and $22,000 of student loans at 6.39%, with $300 a month extra to put toward debt.

| Strategy | Debt-free | Total interest | First debt paid off |
| --- | --- | --- | --- |
| Minimum payments only | Month 268 (22.3 years) | $22,425 | Month 29 (furniture) |
| Snowball (smallest first) + $300 | Month 48 | $7,280 | Month 5 (furniture) |
| Avalanche (highest APR first) + $300 | Month 48 | $7,188 | Month 21 (credit card) |

These come from `project()` in `game/src/sim/debt/strategy.ts`, which uses the real card minimum (the greater of $25 or 1% plus interest), so under "minimums only" the card payment shrinks as the balance falls and the tail runs for decades.
An earlier hand calculation used a fixed card payment and gave 64 / 43 / 43 months; the engine numbers replace it.
The chart is `diagrams/debt/05-payoff-strategies.png` (regenerate with `npm run debt:charts` in `game/`).

Takeaway for the player: the extra $300 matters far more than the order (it saves about $15,000 and 18 years), and snowball's early win costs only $92.

Other computed teaching numbers:

- $5,000 at 23.96%: minimum payments take 234 months (19.5 years) and $8,871 of interest; $200 a month takes 35 months and $1,995.
- $35,000 car at 6.9%: $691/month and $6,484 of interest over 60 months, or $595/month and $7,843 over 72 months.
  The same car at a subprime 16.11% over 72 months is $761/month and $19,816 of interest.
- $320,000 mortgage over 30 years: $2,078/month at 6.76% vs $1,919 at 6.0%, a $57,000 difference in total interest from 0.76 points.
- RAP: $50,000 AGI with no dependents pays $166.67 a month; with two dependents, $66.67; $30,000 AGI pays $50.
- Payday: $60 fee on a $400 two-week loan is a 390% APR.

## 6. Game design: how debt plays

### LEGO mapping additions

| LEGO City | Larp City debt version |
| --- | --- |
| Buildings on the map | A **Debt District**: each debt is a building whose height is its balance. Paying shrinks it floor by floor; at $0 it is demolished with confetti and the lot becomes a park (the "small victory" moment). |
| Fires | Missed payments: smoke at 30 days, flames at 60, blaze at 90. Paying catches it up and the fire truck (your emergency fund) puts it out. |
| Crimes | Predatory offers: the payday storefront and "too good to be true" offers appear as a sketchy character near your home. |
| Alert badges top-left | A red due-date badge when a payment is due within 3 days and checking can't cover it. |
| Coins HUD | Add **credit score gauge** and **total debt** next to net worth; tap for a debt-to-income ratio and a debt-free date. |

This fits the art direction in [05-city-visuals-and-art-pipeline.md](05-city-visuals-and-art-pipeline.md): buildings are procedural bricks, so a building whose floors track a balance is just a parameter.

### Onboarding

The voice interview (and the manual form) already asks about debt.
Collect for each debt: type, balance, APR (or "don't know", which uses the average for their score band), and monthly payment.
Ask for an estimated credit score band (Excellent / Good / Fair / Poor / Don't know).
The made-up scenario option should include presets like "new grad with $30k of student loans" and "two maxed cards and a car loan" (from the impact doc's advice to offer profiles across incomes).

### The calendar

- Each debt has a due day of the month shown on the calendar.
- Card interest accrues every daily tick; installment payments post on their due day.
- Statement close is 21-25 days before the due date; paying the statement balance in full avoids interest, which the player sees happen.

### New and changed events

Probabilities are design choices tuned for drama, converted with `dailyProb = 1 - (1 - annualProb) ** (1/365)` as in the meeting doc.

| # | Event | Trigger | Decision |
| --- | --- | --- | --- |
| D1 | Payment due, can't cover it | Conditional: due within 3 days and checking below the payment | Major: pay from savings or emergency fund / pay the minimum on a card / skip and take the late mark / call for a hardship plan |
| D2 | Pre-approved card offer | 8%/yr, more with a good score | Notable: accept (new limit, hard inquiry) / decline |
| D3 | Credit limit increase | 10%/yr with on-time history | Minor: accept (utilization drops) |
| D4 | BNPL at checkout | Attached to purchase events (new laptop, furniture, holiday) | Notable: pay now / pay in 4 / put it on the card |
| D5 | Payday storefront | Conditional: checking projected negative within 7 days, and the state allows payday loans | Major: take $400 / ask family / sell something / use the emergency fund |
| D6 | Buy a car | Conditional on the Car breakdown event (#7 in doc 03) reaching "not worth fixing", or a job move | Major: used vs new, 36/60/72 months, down payment; the APR comes from the score |
| D7 | Buy a house | The "buy a house" goal | Major: down payment %, 15 vs 30 years, PMI shown |
| D8 | Refinance window | Conditional: market mortgage rate 1+ point below the player's rate | Notable: refinance (closing costs about 2-5%) / keep |
| D9 | Balance transfer offer | 6%/yr with score 670+ and card debt | Notable: move the balance to 0% for 18 months with a 3% fee |
| D10 | Collector voicemail | Any debt at 90 days late | Major: see the delinquency ladder options; ElevenLabs voice |
| D11 | Wage garnishment | Federal student loan in default | None; shown on every paycheck until the player enrolls in RAP or rehabilitation |
| D12 | Friend asks you to co-sign | 3%/yr | Notable: co-sign (their late payments hit your score) / decline |
| D13 | Debt paid off | Conditional: any balance hits $0 | Celebration; counts as a goal if the player set one |
| D14 | Bankruptcy decision | See Section 4 | Major: Chapter 7 / Chapter 13 / keep trying |
| D15 | Student loan plan choice | Scheduled at onboarding and at each yearly income recertification | Notable: Standard / RAP |

Changes to existing events in doc 03:

- Layoff (#5): the "credit card" option now creates a real balance that accrues daily interest.
- Medical bill (#6): add "ask for a payment plan" (0% for 12 months) and "ignore it" (collections after 180 days if $500 or more).
- Annual raise (#9): "lifestyle upgrade" can now mean a bigger car loan.
- Rent hike (#8) and moves between states: the landlord checks credit, and a low score means a bigger deposit.

### Connecting debt to the market

Rates come from the market path, which is seeded and decision-independent, so debt stays compatible with rewind and shadow twins.

- `primeRate = cashRateAnnual + 3.0` (the real prime rate is the Fed funds rate plus 3).
- Variable card APR = prime + a margin from the score band (about 10-20 points), reset monthly.
  Fixed installment loans lock their rate when taken out.
- `mortgageRate = cashRateAnnual + about 2.5`, plus noise; this puts it near 6.8% when cash is about 4.3%.
- **Rate Shock (2022) template:** cash rate rises to about 5%, so card APRs climb on existing balances, new mortgages cost more, and a refinance window closes.
  Great lesson: variable-rate debt is a market risk.
- **Housing Crunch (2008) template:** already "credit tightens"; make that mean card limits are cut by 20-40% (utilization jumps and the score drops with no action by the player), approvals need a score 40 points higher, and home values fall, so some players owe more than the house is worth.
- **Pandemic Plunge (2020):** a relief event offers forbearance on student loans for a period, like real 2020.

### Skips and goal fast-forwards

This answers part of the meeting's open question on events during skips.
The age teleport was removed on 2026-09-12; what was designed for it here now applies to fast-forwarding until a goal.

- **Skip to next event** also stops when D1 fires (a payment you can't cover), because that is a real decision.
- **Goal fast-forward inputs** add a debt strategy: minimums only, avalanche, or snowball, plus an extra monthly amount.
  During the fast-forward, debt decisions auto-resolve by that strategy; D5 (payday) is auto-declined and D1 is auto-resolved down the waterfall.
- **Bankruptcy** stops the fast-forward at the trigger in Section 4, and the recap shows the ladder step by step.
- **"Become debt-free"** is offered as a goal, so "skip until a goal is met" works for it, and the meeting-approved goal feedback covers it ("you could have been debt-free 21 months sooner with an extra $150 a month").
  This keeps AI feedback to the three meeting triggers instead of adding a fourth.
- **Counterfactual twins:** add a "Minimums only" ghost and an "Avalanche + $X" ghost next to doc 03's "Held" and "Autopilot" twins, so the recap can say what the player's debt choices cost or saved.

### Newspaper

Debt news follows the meeting's "what, where, what it affects you" rule:

- "Fed raises rates again; card APRs expected to climb" (affects your variable-rate card).
- "Texas lawmakers debate payday loan cap" (affects you if you live in Texas).
- "Student loan payments restart for millions" (affects your loans).
- Personal lines in the digest after a skip: "You paid $1,240 in interest this year; your score rose 38 points."

### NPCs (if they stay as a backdrop)

Archetypes decide their own debt strategies: "spender" runs cards up and pays the minimum, "steady" uses avalanche, "panicky" takes the payday loan.
Their buildings catching fire or getting demolished makes the city show the lesson even when the player is doing fine.

## 7. Data model and engine

These types extend doc 03's `Player` (which currently has a three-field `debts` array).

```ts
type DebtKind = "credit_card" | "student_federal" | "auto" | "mortgage" | "bnpl" | "payday" | "personal" | "medical";
type RateType = "fixed" | { variable: { margin: number } }; // variable = prime + margin

interface Debt {
  id: string;
  kind: DebtKind;
  lender: string;
  balance: number;
  aprAnnual: number;                 // current rate; variable debts recompute monthly
  rate: RateType;
  openedDay: number;
  dueDayOfMonth: number;
  // revolving only
  creditLimit?: number;
  statementBalance?: number;         // paid in full by due date = no interest
  penaltyApr?: boolean;
  // installment only
  termMonths?: number;
  scheduledPayment?: number;
  // student only
  plan?: "standard" | "rap";
  // status
  daysPastDue: number;               // drives the delinquency ladder
  status: "current" | "late" | "delinquent" | "default" | "collections" | "charged_off" | "paid" | "discharged";
  securedBy?: "car" | "home";        // repossession / foreclosure target
}

interface CreditProfile {
  lateMarks: { day: number; severity: 30 | 60 | 90 | 120 }[];
  inquiries: number[];               // day of each hard inquiry
  bankruptcy?: { day: number; chapter: 7 | 13 };
  score: number;                     // recomputed monthly from the five factors
}
```

Engine hooks in the daily `tick`:

1. `accrueInterest(debt, day)`: cards add `balance * apr / 365`; installment loans accrue for the monthly payment's interest split; RAP waives interest the payment doesn't cover.
2. On each debt's due day: pay according to the player's standing instructions (autopay minimum, autopay statement, fixed amount, or strategy extra).
   If checking can't cover it, run the shortfall waterfall; if that fails, fire D1.
3. `advanceDelinquency(debt)`: increment `daysPastDue`, apply fees and the ladder at 30/60/90/120/180/270 days.
4. Monthly: recompute `CreditProfile.score`, reset variable APRs from the market's prime rate.
5. Payoff and amortization helpers are shared by the tick, the payment slider preview, the teleport, and the ghost twins, so every number the player sees comes from the same code.

Amortization, used everywhere:

```ts
const monthlyPayment = (P: number, apr: number, n: number) =>
  apr === 0 ? P / n : (P * (apr / 12)) / (1 - (1 + apr / 12) ** -n);
```

The RNG stream for debt events is `npc:<id>` keyed by day and event id, as in doc 03, so taking a loan never changes whether the car breaks down later.

## 8. Sponsor tie-ins

- **Capital One Nessie:** From our memory of the API (the docs host did not respond when this was written; verify in hour 1), Nessie supports a `Credit Card` account type next to Checking and Savings, loans on an account (types like home, auto, and small business, with amount, monthly payment, credit score, and status), and scheduled bills.
  That maps directly: the player's card is a Nessie `Credit Card` account, the car loan and mortgage are Nessie loans, and due dates are Nessie bills.
  It is our strongest Capital One story: "we used Nessie's loans and bills, not just transfers".
  Keep it behind an adapter with a mock, like the LoanCircle design does.
- **ElevenLabs:** the collector voicemail at 90 days (firm but respectful, no fake threats), the celebratory "debt-free" moment, and the bankruptcy explanation.
- **Gemini:** the bankruptcy post-mortem and goal tips from the ledger; the "Your Real Plan" end screen gets a real payoff plan with the player's own debts and a debt-free date.
- **Tiger Data:** a `debt_daily` hypertable (balance, APR, interest paid, days past due per debt) and `credit_score_monthly`, so the end-of-game chart of debt vs net worth is one query.
- **Backboard:** remembers the player's real debts and strategy between sessions so the "Your Real Plan" advice stays consistent.
- **Link to LoanCircle:** our other idea (friends chip in to pay off your loan) could live in Larp City as a D12-style event where friends offer to help pay down a loan; worth one line in the pitch if we build Larp City.

## 9. MVP scope

Status (2026-09-11): all six must-haves exist in the engine and the Credit Desk (`game/debt.html`); see [07-debt-system-design.md](07-debt-system-design.md).
Not yet wired into the city scene: the HUD score, the Debt District on the real map, the skip and teleport stops, and "become debt-free" as a goal.

Must have (small, high impact):

1. Credit card with daily interest, minimum payment, and a payment slider that shows the debt-free date live.
2. Student loan (Standard vs RAP) and auto loan with amortization.
3. Credit score from the five factors, shown on the HUD, setting new APRs.
4. D1 (can't cover a payment) and the delinquency ladder up to 90 days, with the fire visual.
5. Bankruptcy as a defined stop for skips and the teleport, with the Chapter 7 / 13 choice.
6. "Become debt-free" as a goal, and the snowball vs avalanche choice with a ghost line.

Stretch:

- Mortgage and the house goal with PMI and refinancing.
- Payday storefront, BNPL, and balance transfer events.
- Debt District buildings that shrink and get demolished.
- Market-linked variable rates and the credit-tightening Housing Crunch.
- Nessie loans and bills integration.
- The ElevenLabs collector voicemail.

## 10. Guardrails

- Educational, not financial advice (same disclaimer as the market).
- Use fictional lenders ("Brickstone Bank", "QuickCash") rather than real brand names, except Capital One for the Nessie integration.
- Collector voices and bankruptcy screens stay respectful and point to real free help: the [CFPB](https://www.consumerfinance.gov/), nonprofit credit counseling (NFCC), and [studentaid.gov](https://studentaid.gov/) for RAP.
- Don't present bankruptcy as easy or as the end; show both its costs and the recovery.

## Open questions for the team

1. Should the credit score be visible from day one, or unlocked once the player has their first account (a nice "thin file" lesson)?
2. Is the Debt District a separate area of the map or debts shown on the player's own home (chains, a lien sign)?
3. Do we let players go into payday loans at all, or only offer them as a decline-only lesson?
4. How much student loan detail: just Standard vs RAP, or also the older plans existing borrowers keep until 2028?
5. Do we model the Chapter 7 means test with real state medians, or simplify to "income below $X"?
6. Does the Capital One judge care more about Nessie loans and bills, or about the lesson? (Ask at the booth on Saturday.)

## Sources

- [NY Fed Household Debt and Credit, Q2 2026 press release](https://www.newyorkfed.org/newsevents/news/research/2026/20260811) and [report PDF](https://www.newyorkfed.org/medialibrary/interactives/householdcredit/data/pdf/HHDC_2026Q2)
- [Fox Business on NY Fed delinquencies](https://www.foxbusiness.com/economy/new-york-fed-finds-credit-card-auto-loan-delinquencies-remain-elevated)
- [WalletHub average credit card APR, Sep 2026](https://wallethub.com/edu/cc/average-credit-card-interest-rate/50841), [Forbes Advisor](https://www.forbes.com/advisor/credit-cards/average-credit-card-interest-rate/), [WalletHub minimum payment calculator](https://wallethub.com/credit-card-minimum-payment-calculator)
- [TICAS on July 2026 repayment changes](https://ticas.org/affordability-2/upcoming-changes-to-income-driven-repayment-plans/), [Saving for College on RAP](https://www.savingforcollege.com/article/student-loan-repayment-assistance-plan-rap), [Student Loan Borrower Assistance on SAVE ending](https://studentloanborrowerassistance.org/the-save-plan-is-ending-what-borrowers-in-save-need-to-know/)
- [ACA International on wage garnishment](https://www.acainternational.org/news/federal-student-loan-wage-garnishment-resumes-january-2026/), [CBS News](https://www.cbsnews.com/news/student-loan-borrowers-default-wages-garnished-2026/), [EducationData average student debt](https://educationdata.org/average-student-loan-debt)
- [Bankrate auto loan rates](https://www.bankrate.com/loans/auto-loans/rates/), [Bankrate average car payments](https://www.bankrate.com/loans/auto-loans/average-monthly-car-payment/), [U.S. News auto rates by credit](https://cars.usnews.com/cars-trucks/advice/average-auto-loan-interest-rates)
- [Freddie Mac PMMS](https://www.freddiemac.com/pmms), [Sep 10 2026 release](https://www.globenewswire.com/news-release/2026/09/10/3359803/0/en/mortgage-rates-average-6-76.html)
- [Federal Reserve note on BNPL, Jun 2026](https://www.federalreserve.gov/econres/notes/feds-notes/buy-now-pay-later-beyond-pay-in-4-a-comprehensive-product-overview-20260605.html), [NCLC on the payday payments rule](https://library.nclc.org/article/rule-bounced-payday-and-high-cost-loan-payments-now-effect), [CFPB payday rule FAQs](https://www.consumerfinance.gov/compliance/compliance-resources/consumer-lending-resources/payday-lending-rule/payday-lending-rule-faqs/), [CreditNinja payday APR](https://www.creditninja.com/blog/what-is-the-average-payday-loan-interest-rate/)
- [myFICO payment history](https://www.myfico.com/credit-education/credit-scores/payment-history), [Experian score factors](https://www.experian.com/blogs/ask-experian/credit-education/score-basics/what-affects-your-credit-scores/), [Avant 2026 credit score playbook](https://www.avant.com/blog/credit-scores/your-2026-credit-score-playbook/)
- [Nolo means test](https://www.nolo.com/legal-encyclopedia/chapter-7-bankruptcy-means-test-eligibility-29907.html), [Nolo filing fees](https://www.nolo.com/legal-encyclopedia/bankruptcy-filing-fees-costs.html), [Experian Chapter 7 vs 13](https://www.experian.com/blogs/ask-experian/bankruptcy-chapter-7-vs-chapter-13/), [CFPB on bankruptcy reporting](https://www.consumerfinance.gov/ask-cfpb/how-long-does-a-bankruptcy-appear-on-credit-reports-en-325/), [Upsolve on cost](https://upsolve.org/learn/how-much-does-bankruptcy-cost/)
- [Kellogg on Gal and McShane's snowball study](https://www.kellogg.northwestern.edu/news_articles/2012/snowball-approach.aspx), [Brown, "Small Victories" (CFPB symposium)](https://files.consumerfinance.gov/f/documents/P2d_-_Brown_-_Small_Victories.pdf), [Hamilton 2023](https://onlinelibrary.wiley.com/doi/full/10.1002/soej.12612)
- [Nessie API](http://api.nessieisreal.com/) (docs unreachable at writing; schema from memory, verify)
