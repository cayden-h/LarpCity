# Larp City - Cards, Loans, and Moving Money

Research on applying for credit cards, card perks, taking out loans, and moving money between accounts, plus how we gather the real data online and store it in Tiger Data.
Written 2026-09-11 during HackRice 2026.
It builds on the debt engine ([06-debt-and-credit.md](06-debt-and-credit.md), [07-debt-system-design.md](07-debt-system-design.md)) and follows the 2026-09-11 game design meeting; where they conflict, the meeting wins.
Code: `game/src/sim/money/` (engine), `game/src/data/cards.ts` and `cards-curated.ts` (generated catalogs), `game/src/debt-demo/shop.ts` (the Card Shop), `game/tests/money.test.ts` and `shop.test.ts`, `game/db/` (Tiger Data schema and loader), `research/data/cards/` (downloads, build and upscale scripts, `requirements.txt`).
Mirrored to Notion on 2026-09-11 as the "🏦 Cards, Loans & Accounts" section and a research sub-page.

## TL;DR

- **The data is real and free.**
  The CFPB's Terms of Credit Card Plans survey gives 663 real card plans (APR by credit tier, fees, grace period, intro and balance transfer offers, secured flag), public domain.
  An open GitHub dataset adds sign-up bonuses and fees for 175 name-brand cards.
  FRED gives the live rates (prime, card APR, personal and auto loan APR, mortgage, delinquency).
  All of it downloads with `curl`, no API key.
- **It lives in Tiger Data.**
  `game/db/schema.sql` holds the full schema: reference tables for the card catalog and a `macro_rates` hypertable, plus run hypertables for applications, transfers, rewards, and daily debt.
  `game/db/load.py` loads everything in about 1.5 seconds and is safe to rerun.
  Loaded into the team's Tiger Data service (`larp-city`, TimescaleDB 2.30) on 2026-09-11 in 2.5 seconds, after testing against a local TimescaleDB.
- **Applications work like real lenders.**
  Hard rules first (CARD Act under 21, issuer rules like Chase 5/24, debt-to-income), then an approval chance from the score, then a seeded roll, so replays make the same decisions.
  Prequalification is the same math with a soft pull: odds but no inquiry.
- **Perks are measured against interest.**
  2% back on average US card spending is about $364 a year; carrying $3,000 at 23% costs $690 a year.
  The card shop shows both numbers, which is the whole lesson.
- **Moving money has real timing and costs.**
  ACH takes 2 business days (a Friday transfer lands Tuesday), instant costs 1.75%, a cash advance charges 5% and starts interest today, and early 401(k) money loses 10% plus tax.

## 1. Where the data comes from

| Source | What it gives us | Format and size | License | How we use it |
| --- | --- | --- | --- | --- |
| [CFPB Terms of Credit Card Plans (TCCP)](https://www.consumerfinance.gov/data-research/credit-card-data/terms-credit-card-plans-survey/), [2025-12-31 file](https://files.consumerfinance.gov/f/documents/cfpb_tccp-data_2025-12-31.xlsx) | 663 plans from 147 columns: purchase APR for no score / 619 or less / 620-719 / 720+, intro and balance transfer APR and length, BT, cash advance, foreign, and late fees, annual fee, grace period, secured flag, rewards type | XLSX, 516 KB, header on row 10; published twice a year | Public domain | `card_products` table and the game catalog |
| [andenacitelli/credit-card-bonuses-api](https://github.com/andenacitelli/credit-card-bonuses-api) ([data.json](https://raw.githubusercontent.com/andenacitelli/credit-card-bonuses-api/main/exports/data.json)) | 175 name-brand cards: issuer, currency, annual fee, first-year waiver, flat earn rate, sign-up bonus amount, spend, and days, business flag | JSON, 125 KB, synced daily | MIT plus Commons Clause (non-commercial is fine) | `card_offers` table, matched to TCCP plans by issuer and name |
| [FRED](https://fred.stlouisfed.org/) (`fredgraph.csv?id=<ID>`) | `DPRIME` prime rate, `DFF` fed funds, `TERMCBCCINTNS` and `TERMCBCCALLNS` card APR, `TERMCBPER24NS` 24-month personal loan, `RIFLPBCIANM60NM` 60-month auto, `MORTGAGE30US`, `DRCCLACBS` card delinquency | CSV, 2 columns, no key | Public domain (these series) | `macro_rates` hypertable since 2000 (18,383 rows) |
| [CFPB Credit Card Agreement Database](https://www.consumerfinance.gov/credit-cards/agreements/archive/) | Real card contracts | 1.49 GB quarterly ZIP of PDFs | Public domain | Not loaded; optional "read the fine print" flavor text |
| Issuer pages (Schumer box) | Penalty APR and exact fees for flagship cards | Chase links a static pricing page that is plain HTML; card pages render rates client-side | Terms of use generally forbid scraping (unverified per issuer) | Only hand-checked, if at all |
| Capital One Nessie | Mock customers, accounts (including `Credit Card`), transfers, loans, bills | REST; `https://api.nessieisreal.com` answers, the docs page returns 403 | Hackathon API | Optional mirror of the game's accounts (doc 06, section 8) |

Skipped: RewardsCC (paid, and its terms forbid caching or bulk export below the $199 a month plan), Kaggle (no US card product data), Bankrate (terms forbid scraping; FRED covers the same rates).

What the datasets don't have, so the game fills it in:

- **Per-category earn rates** (3% dining, 5% rotating): no free source has them, so `rewards.ts` uses six earn profiles built from real 2026 cards, picked per card from its flat rate and rewards type.
- **Penalty APR**: not a TCCP column; the engine keeps the 29.99% from doc 06.
- **Approval odds**: issuers don't publish them; the curve is calibrated to the NY Fed's Survey of Consumer Expectations (section 2).

### What the data already says (from Tiger, national plans)

| Tier (TCCP) | Big issuers, avg purchase APR | Credit unions and small banks | All national plans |
| --- | --- | --- | --- |
| 619 or less | 24.86% (141 plans) | 17.78% (53) | 22.92% |
| 620-719 | 28.25% (239) | 15.80% (66) | 25.56% |
| 720+ | 23.54% (239) | 12.83% (65) | 21.25% |
| Fed G.19, accounts assessed interest (May 2026) | | | 22.15% |

Two lessons fall straight out of the data:

- **Credit unions are about 10 points cheaper** at every tier, because federal credit unions cap APR at 18%.
  "Check a credit union" is a real, reachable win for every player.
- **Tier averages aren't in score order**, because each plan reports different tiers (subprime cards often skip the tiers they don't serve).
  The game therefore prices every card from its own tier column (`aprFor`), never from an average.
- Big issuers average a $69 annual fee, a 4.4% balance transfer fee, a 4.8% cash advance fee, and a $29 late fee; 149 plans offer an intro APR, for 10.4 months on average and up to 24.

## 2. Applying for credit cards

| Rule | Real-world value | Game rule (`applications.ts`) |
| --- | --- | --- |
| Hard vs soft pull | Prequalification is a soft pull; applying is a hard pull, about 5-10 points for 12 months, on the report 24 months ([myFICO](https://www.myfico.com/credit-education/credit-reports/manage-credit-inquiries)) | `applyForCard` with no `roll` prequalifies; with a roll, `recordApplication` adds the inquiry the score engine already counts |
| Approval odds | About 63% of applicants under 680 were rejected; 16.1% of all credit applications were rejected in June 2026 ([NY Fed SCE](https://www.newyorkfed.org/microeconomics/sce/credit-access#/)); 75-85% approval at 750+ (unverified blog data) | `scoreOdds` = 37% at 650 rising 0.39 points per score point, clamped 3-95%; a card targeting a higher tier quarters the odds; each inquiry past 2 in a year takes 5 points |
| Decision | Instant approval, pending review (7-10 days), or denial | The roll below the odds approves; within 5 points above, pending; else denied with plain-language reasons |
| Debt-to-income | Lenders want debt payments under about 36-50% of income | Over 50% denies |
| CARD Act, under 21 | Needs independent income; issuers rarely take cosigners ([CFPB 1026.51](https://www.consumerfinance.gov/rules-policy/regulations/1026/51/)) | Under 21 with no income is denied without a hard pull |
| Starting limit | First card $100-1,000; store cards $200-300; average new bank card about $5,000-6,000 ([CNBC](https://www.cnbc.com/select/average-credit-limits-for-first-credit-card/)) | A share of income by tier: 2% ($300-1,000) thin file, 4% ($300-2,000) fair, 10% ($1,000-10,000) good, 15% ($3,000-25,000) excellent |
| Secured cards | Deposit = limit; Discover reviews for graduation after 7-18 months ([WalletHub](https://wallethub.com/answers/cc/discover-secured-credit-card-graduate-2140658756/)) | Always approved; the deposit is the limit |
| Chase 5/24 | Denied with 5+ new personal cards from any bank in 24 months | Enforced from the application history |
| Capital One | About one new card per 6 months | Enforced |
| Discover | One new card per year | Enforced |
| Citi | 1 application per 8 days, 2 per 65 days; bonus once per 48 months | Enforced |
| Amex | Welcome bonus once per lifetime per card | `bonusEligible` returns false after the first bonus |
| Sources for issuer rules | [OMAAT](https://onemileatatime.com/guides/credit-card-application-rules/), [Thrifty Traveler 2026](https://thriftytraveler.com/guides/credit-card/credit-card-application-rules/), [Capital One](https://www.capitalone.com/learn-grow/money-management/how-many-capital-one-cards-can-you-have/) | |

Opening a card (`openCard`) creates a real `credit_card` debt in the debt book, with the survey's intro APR as a promo (`promoApr` until `promoUntil`), so the daily tick handles interest, statements, and the delinquency ladder with no new code.
A penalty APR (60 days late) cancels the promo, like real card agreements.

## 3. Perks and rewards

| Earn profile | Rule | Based on |
| --- | --- | --- |
| `flat_2` | 2% on everything | Flat 2% cash back cards |
| `flat_1_5` | 1.5% on everything | Flat 1.5% cards; default for TCCP "Cashback rewards" |
| `tiered` | 3% dining and groceries, 2% gas, 1% else | Tiered cash back cards |
| `rotating` | 5% on up to $1,500 a quarter in rotating categories, 3% dining, 1% else | Chase Freedom Flex; Q3 2026 was gas and EV charging, transit, and live entertainment ([Chase](https://media.chase.com/news/chase-freedom-2026-q3-categories)) |
| `travel` | 3x travel and dining, 1x else, at 1 cent a point | Mid-tier travel cards; default for points currencies |
| `none` | 0 | Cards with no rewards |

Point values for sign-up bonuses are near cash-out: 1 cent for Chase, Citi, Capital One, and bank points, 0.6 cents for Amex, 0.5-0.7 cents for most hotel points, 1.5 cents for Hyatt ([OMAAT](https://onemileatatime.com/guides/value-miles-points/), [Points Whale](https://www.pointswhale.com/news/points-valuations-2026)).
Bonuses count only when the spend requirement is met inside the window (`bonusStatus`).

Other perks and costs in the data:

| Item | Value | Source |
| --- | --- | --- |
| 0% intro APR | Up to 21 months on the long balance transfer cards; 24 max in TCCP | [Bankrate](https://www.bankrate.com/credit-cards/balance-transfer/best-balance-transfer-cards/), TCCP |
| Balance transfer fee | 3-5%, minimum about $5 | TCCP |
| Cash advance | 3-5% (min $10), about 24-29% APR, no grace period | TCCP, [WalletHub](https://wallethub.com/answers/cc/how-much-does-a-cash-advance-cost-2140660758/) |
| Foreign transaction fee | 0% on travel cards, up to 3% | TCCP |
| Premium annual fees | $795 (Sapphire Reserve), $895 (Amex Platinum) | [Upgraded Points](https://upgradedpoints.com/credit-cards/chase-sapphire-reserve-vs-amex-platinum-card/) |

Average spending, so the game can compute rewards for players who skip entering their own: the BLS Consumer Expenditure Survey 2024 (released Dec 2025) has $6,224 a year of groceries, $3,945 dining, $2,411 gas, $3,609 entertainment, and $2,001 apparel, $18,190 of card-payable spending ([BLS](https://www.bls.gov/news.release/cesan.nr0.htm)).

The signature number: `cardYearValue` on that spending gives $363.84 a year from a 2% card, and carrying a $3,000 balance at 23% costs $690, so the "rewards card" loses $326 a year.

## 4. Taking out loans

| Loan | Real terms (2026) | Game rule |
| --- | --- | --- |
| Personal | Bankrate average 12.21% at FICO 700 (Sep 2, 2026), range about 6-36%; origination fee 1-10% taken from the proceeds; funded in 1-7 days ([Bankrate](https://www.bankrate.com/loans/personal-loans/average-personal-loan-rates/), [SoFi](https://www.sofi.com/learn/content/personal-loan-origination-fee/)) | APR bands by score (760+ 8.5%, 720 12%, 680 17%, 640 24%, 600 30.5%, under 600 32%; unverified aggregator bands); fee from about 1% to 8% by score; DTI cap 50% |
| Auto | Experian Q2 2026: 4.41% super prime to 16.11% deep subprime new; FRED 60-month average 7.14% | `offeredApr` from the debt engine; DTI cap 50% |
| Mortgage | 6.76% (Freddie Mac, Sep 10 2026); DTI about 36% front and 43-45% back ([Heart Mortgage](https://blog.heartmortgage.com/post/2026-first-time-homebuyer-affordability-guidelines-dti-fha-conventional)) | `offeredApr`; DTI cap 43% including the new payment |
| Credit union PAL (NCUA PAL II) | Up to $2,000 for 1-12 months, 28% APR cap, application fee up to $20 ([NCUA](https://ncua.gov/newsroom/press-release/2019/payday-alternative-loan-rule-will-create-more-alternatives-borrowers)) | Clamped to those terms; no hard pull; the lesson beside the 390% payday loan |
| 401(k) loan | Lesser of 50% of vested balance or $50,000, 5 years; due quickly on leaving the job, else taxed plus 10% ([IRS](https://irs.gov/retirement-plans/plan-participant-employee/retirement-topics-loans)) | `k401LoanLimit`; the layoff event can call the loan due |
| Rate shopping | Auto, mortgage, and student inquiries within 45 days count once ([myFICO](https://www.myfico.com/credit-education/blog/rate-shop)) | `recordApplication` counts the first inquiry of each kind in a 45-day window only |

`openLoan` turns an approved application into an installment debt and returns the proceeds after the origination fee, so a $10,000 personal loan at a 700 score (17% APR, 3% fee) pays out $9,700 but is owed in full, at $356.53 a month for 3 years.

## 5. Moving money between accounts

| Move | Real timing and cost | Game rule (`accounts.ts`) |
| --- | --- | --- |
| Internal (same bank) | Instant, free | Settles today |
| Standard ACH | 1-3 business days, free | 2 business days, so money sent on a Friday lands Tuesday |
| Same-day ACH | Same business day; windows at 10:30, 2:45, and 4:45 ET ([Emburse](https://www.emburse.com/blog/what-does-same-day-ach-really-mean)) | Today on business days, else the next one |
| Wire | Same day, $15-50 out | $25 |
| Instant (Venmo-style) | 1.75%, min $0.25, max $25 ([Venmo fees](https://wealthvieu.com/banking/venmo/fees/)) | Same |
| Cash advance | 3-5% (min $10), interest from day 1 | The card's own fees when known, else 5% or $10; the card leaves its grace period |
| Balance transfer | 3-5% fee, days to weeks to post | The card's fee; the new card's promo APR applies |
| Savings withdrawals | Reg D's six-a-month limit was deleted in 2020, but many banks still charge $5-15 past six ([NerdWallet](https://www.nerdwallet.com/banking/learn/how-regulation-d-affects-your-savings-withdrawals)) | Optional per-account excess fee |
| Overdraft | $26.77 average in 2025 ([Bankrate](https://www.bankrate.com/banking/checking/checking-account-survey/)); a secondary source reports $32.75 in 2026 after the $5 cap was repealed; many online banks charge $0 | `OVERDRAFT_FEE` = $26.77 |
| HYSA | Top rates about 4.0-4.34%; FDIC national average savings 0.38% ([FDIC](https://www.fdic.gov/national-rates-and-rate-caps)) | Per-account APY, paid monthly |
| Retirement withdrawals | Before 59½: income tax plus 10% penalty; Roth contributions come out free ([IRS](https://www.irs.gov/taxtopics/tc557)) | 22% flat tax plus 10% penalty; Roth taxes only earnings |

The `Ledger` debits the source now and credits the destination on the settle day, so a slow ACH can leave checking short on a due date.
`ledger.wallet()` is the debt engine's shortfall waterfall (checking, then savings, then the emergency fund, never retirement), which connects the two systems with no glue code.

## 6. Traps worth teaching

| Trap | What the game shows |
| --- | --- |
| "Carrying a balance builds credit" | It doesn't; paying in full builds the same history at $0 interest |
| Rewards card on minimum payments | $364 of rewards vs $690 of interest a year |
| Closing your oldest card | The lost limit pushes utilization up (the score engine already models utilization) |
| Too many applications | 5-10 points per inquiry, a shorter average age, then issuer lockouts |
| Store card deferred interest | Interest charged back to the purchase date if not paid in time; the CFPB found about 1 in 5 deferred-interest balances got hit ([CFPB](https://www.consumerfinance.gov/data-research/research-reports/issue-spotlight-the-high-cost-of-retail-credit-cards/)) |
| Cash advance as an emergency fund | Fee plus immediate interest; the $500 emergency fund beats it |
| Balance transfer with no plan | 5% fee, then the regular APR when the promo ends |
| 401(k) loan, then quitting | The loan comes due; otherwise taxes plus 10% |
| Overdrafting instead of a free transfer | $26.77 per item |

## 7. Game design

New events, using doc 06's numbering and the meeting's decision rules:

| # | Event | Trigger | Decision |
| --- | --- | --- | --- |
| C1 | Card shop | Anytime from the bank building | Browse real plans filtered by the player's tier; prequalify (soft pull) shows odds, APR, limit, and the card's year value on the player's spending |
| C2 | Application result | After applying | Approved (card appears in the Debt District), pending (7 days), or denied with reasons |
| C3 | Sign-up bonus progress | Monthly while a bonus is open | None; a progress bar; missing the window is the lesson |
| C4 | Balance transfer offer | Replaces doc 06's D9 with a real survey plan | Move the balance for the fee, or keep it |
| C5 | Loan shop | The car, house, and emergency events | Compare personal, PAL, auto, and 401(k) loans side by side with APR, fee, payment, and DTI |
| C6 | Transfer screen | Anytime | Pick accounts and rail; the quote shows fee, penalty, tax, and landing day before confirming |
| C7 | Annual fee due | Card anniversary | Keep, downgrade to the no-fee version, or close (utilization warning) |

Time skips and goal fast-forwards: prequalification and the transfer quote are pure functions, so skips use the player's standing choices (no new applications; scheduled transfers keep running), and `cannot_cover` from the debt engine still stops for a decision.

### The Card Shop (built 2026-09-11)

C1 is playable: open `/debt.html` and press **Card Shop** in the top bar (the clock keeps running).
It is styled like the city game (Fredoka, blue HUD cards with white borders, yellow buttons), like the rest of the Credit Desk.

- **23 real cards**, from secured and student cards to the premium travel cards: 4 Chase, 4 Amex, 7 Capital One (including the 3 Discover it cards, since Capital One now owns Discover), 2 Citi, 2 Wells Fargo, and 1 Bank of America.
- **Real details from each issuer's page**, checked 2026-09-11 (`research/data/cards/curated-cards.json`): earn rates with their caps, the current welcome offer, intro APRs, fees, and top perks.
  Where the issuer page wouldn't load or offers are personalized (Amex), a named secondary source is recorded, and the drawer lists the fields not confirmed on the issuer page.
  Citi Custom Cash stopped taking applications on May 28, 2026; the shop shows it as closed, which is itself a real lesson.
- **Real terms from the CFPB survey**: every card links to its TCCP plan, so the drawer shows the purchase APR for each credit tier, balance transfer, cash advance, foreign, and late fees, and the grace period, and "Your APR" prices the card from the player's own score.
- **Official card art** from each issuer's site (`game/public/cards/art/manifest.json` records every source URL).
  Issuers publish most art at 250-480 px, too soft for a retina tile, so `research/data/cards/upscale_art.py` crops each image to the card and upscales it 4x with Real-ESRGAN (x4plus) to a 1200 px WebP; the originals stay in `art/original/` and the manifest marks every upscaled file.
  Card art and names belong to their issuers and appear for education only (said on the page).
- **Year 1 value on the player's spending**: sliders default to the BLS average household ($1,641 a month of card spending) and a "balance you carry" slider; each category earns its best rate up to its cap (`game/src/debt-demo/shop-value.ts`), points convert at cash-out value, Discover's Cashback Match doubles year-one rewards, and interest on the carried balance is subtracted.
- **Soft pull, then hard pull**: "Check odds" runs the application engine as a prequalification; "Apply" rolls a seeded number (the same run makes the same decision), records the inquiry, enforces issuer rules like 5/24, and an approval opens the card as a real debt in the player's book, so the Desk's liabilities, payoff chart, and credit report pick it up.
  Secured cards take the deposit out of checking.
- **All 335 plans** tab: every national CFPB plan, searchable, sorted by the APR the player's score would get.

Rebuild after refreshing any source: `python3 research/data/cards/build_cards.py` (writes `game/src/data/cards-curated.ts`).
Re-upscale the art: `pip install -r requirements.txt`, download the weights into the gitignored `research/data/cards/models/` (command in `upscale_art.py`), then `python3 research/data/cards/upscale_art.py` and rerun `build_cards.py`.
Tests: `game/tests/shop.test.ts`.

## 8. Tiger Data

Schema: `game/db/schema.sql` (canonical; SETUP.md's snippet is a subset).

| Table | Kind | Rows per run | Used for |
| --- | --- | --- | --- |
| `card_products` | Reference | 663 | Card shop, APR by tier |
| `card_offers` | Reference | 175 | Bonuses and fees; `tccp_product_id` links 104 to a survey plan |
| `macro_rates` | Hypertable, segmented by series | 18,383 | Real rate history; `macro_rates_monthly` continuous aggregate |
| `credit_applications` | Hypertable | One per application | Application history, the recap ("you applied for 6 cards in 2031") |
| `account_transfers` | Hypertable | One per move | Cash flow charts, fees paid |
| `rewards_ledger` | Hypertable | One per card per category per month | `rewards_yearly` aggregate: rewards vs fees vs interest |
| `debt_daily`, `credit_score_monthly` | Hypertables | One per debt per day; one per month | Doc 07's persistence plan; `debt_monthly` aggregate |
| `card_apr_by_tier` | View | | The table in section 1, next to the Fed's real rate |

Load it:

```sh
python3 research/data/cards/build_cards.py   # raw downloads -> CSVs + game/src/data/cards.ts
DATABASE_URL=postgres://... python3 game/db/load.py
```

Refresh the data: re-download the four sources (URLs in section 1) into `research/data/cards/raw/` and rerun both commands.
The next TCCP edition (June 30, 2026 data) should appear around November 2026.

For the judges: one database holds the real card market (relational), 26 years of real rates (hypertable plus continuous aggregate), and each player's life (hypertables), and the card shop joins all three in one query.

## 9. Open questions for the team

1. Do we show real issuer and card names (they are public survey data) or reskin them as fictional lenders like doc 06's guardrail suggests?
2. Should the card shop list all 335 national plans or a curated 20 across tiers?
3. Do players enter their own spending by category, or use the BLS averages scaled to their income?
4. Is the 5/24-style issuer rule set worth teaching, or too "churner"-specific for our audience?
5. Does Capital One's judge want Nessie accounts and transfers mirrored, given its docs are currently unreachable?

## 10. Guardrails

- Educational, not financial advice; approval odds are a game model, not a prediction for any real application.
- The catalog is a December 2025 snapshot; show its date in the card shop.
- Never collect real card numbers or credentials; the game only asks for balances, rates, and limits.
