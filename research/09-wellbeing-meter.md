# 09 - Wellbeing Meter

Research for Larp City, HackRice 2026 (Sep 11-13), Finance track.
Compiled 2026-09-12.
Builds on the scoring decision in [../meeting-2026-09-11-game-design.md](../meeting-2026-09-11-game-design.md) ("Follow-up decisions (2026-09-12)" > "Scoring and win condition"): final score = retirement readiness (net worth, retirement savings, credit score, debt) + a wellbeing meter.
The team's starting wellbeing list was marital status and relationships, financial stability, salary and job, and closeness to retirement.
This doc fills in the rest of the factors and the weights from published data, and every number links to its source.

## TL;DR

- Nobody has to invent the meter from scratch.
  The CFPB Financial Well-Being Scale (10 questions, 0-100, US average 54) and the Fed's SHED survey already measure "financial stability" in ways the sim can compute directly: can you cover a $400 surprise, do you have 3 months of savings, are you behind on bills, are you on track for retirement.
- The biggest and longest-lasting effects in the panel data are **unemployment** (a large hit that does not fully go away even after re-employment) and **money stress** (no cash cushion, unmanageable debt).
  Cash on hand predicts life satisfaction better than income does.
- **Income matters on a log scale with no plateau** (Killingsworth 2021, confirmed by the 2023 Killingsworth-Kahneman-Mellers adversarial collaboration), so each doubling of real income adds the same amount, and a raise from $200k to $220k barely moves the meter.
- **Most life events fade.** Marriage gives a boost that mostly wears off in 2-3 years, divorce hurts most in the 2-3 years *before* it happens and then recovers to baseline, and a first child gives a 1-2 year lift that then returns to baseline or slightly below.
  So those events should be temporary pulses that decay, not permanent points.
- Proposed meter (0-100), nine factors: **Work 20, Cash cushion 18, Debt load 14, Real income 12, Relationships 10, Retirement on track 8, Health coverage 8, Commute 6, Home 4**, plus decaying event pulses.
  A cash cushion also softens negative pulses, because low income makes misfortunes hurt more (Kahneman-Deaton 2010).
- Final score = 0.6 x retirement readiness + 0.4 x lifetime wellbeing, where lifetime wellbeing averages the meter over the whole run with the value at retirement.
  In the worked examples, a $220k Californian with card debt, a layoff, and a divorce scores 59, while a $62k Ohioan with a 6-month emergency fund and a stable marriage scores 87.
- Skip scoring health status, death of a spouse, religion, and having or not having kids.
  Score things the player controls (insurance, savings, commute) instead of who they are.

## 1. Published wellbeing measures a game can copy

### 1.1 CFPB Financial Well-Being Scale (the best fit for "financial stability")

The CFPB defines financial well-being as four elements: control over day-to-day finances, capacity to absorb a financial shock, being on track to meet financial goals, and freedom to make choices that let you enjoy life ([CFPB technical report, 2017](https://www.consumerfinance.gov/data-research/research-reports/financial-well-being-technical-report/)).
The scale has 10 statements, each rated on a 5-point scale, and scored with item response theory to a 0-100 score ([technical report PDF](https://files.consumerfinance.gov/f/documents/201705_cfpb_financial-well-being-scale-technical-report.pdf)).
The 5-item short version (marked with a star below) correlates 0.94 with the full scale ([technical report PDF](https://files.consumerfinance.gov/f/documents/201705_cfpb_financial-well-being-scale-technical-report.pdf)).

| # | CFPB item | What the sim can use instead of asking |
| --- | --- | --- |
| 1 | I could handle a major unexpected expense | Liquid cash vs. $400 and vs. a month of bills |
| 2 | I am securing my financial future | Retirement savings vs. an age target |
| 3 | Because of my money situation, I feel like I will never have the things I want in life | Goals reached vs. goals set |
| 4 | I can enjoy life because of the way I'm managing my money (*) | Positive cash flow after bills |
| 5 | I am just getting by financially (*) | Months of cushion |
| 6 | I am concerned that the money I have or will save won't last | Retirement on-track ratio |
| 7 | Giving a gift for a wedding, birthday or other occasion would put a strain on my finances for the month | Cash after rent and minimums |
| 8 | I have money left over at the end of the month (*) | Monthly surplus |
| 9 | I am behind with my finances (*) | Any debt past due |
| 10 | My finances control my life (*) | Debt-to-income |

National distribution: the US adult average was 54 in 2017, with about a third at 50 or below, a third at 51-60, and a third at 61 or above ([CFPB national survey release](https://www.consumerfinance.gov/archive/newsroom/cfpbs-first-national-survey-financial-well-being-shows-more-40-percent-us-adults-struggle-make-ends-meet/)).
There was a 35-point spread between the top and bottom 10 percent ([same release](https://www.consumerfinance.gov/archive/newsroom/cfpbs-first-national-survey-financial-well-being-shows-more-40-percent-us-adults-struggle-make-ends-meet/)).
Scores of 50 or below go with a well-above-50% chance of struggling to make ends meet, and scores of 61 or above go with under 10% ([same release](https://www.consumerfinance.gov/archive/newsroom/cfpbs-first-national-survey-financial-well-being-shows-more-40-percent-us-adults-struggle-make-ends-meet/)).
The average rose from 54 to 55 between 2017 and 2020, and people with low scores were at least twice as likely to lack emergency savings, miss bills, or have medical debt ([CFPB data spotlight 2017-2020](https://www.consumerfinance.gov/data-research/research-reports/data-spotlight-financial-well-being-in-america-2017-2020/)).

Game use: the wellbeing meter should land an "average American" profile near 54-55 so the number means the same thing as the real scale, and the player can be told "Americans average 54 on the CFPB scale; you are at 72."

### 1.2 Fed SHED (Survey of Household Economics and Decisionmaking)

The 2025 survey (published May 2026) found:

- 73% of adults were doing okay or living comfortably, below the 78% high in 2021 ([Fed press release](https://www.federalreserve.gov/newsevents/pressreleases/other20260513a.htm)).
- 63% would cover a $400 emergency with cash or its equivalent, unchanged from 2024 ([Fed press release](https://www.federalreserve.gov/newsevents/pressreleases/other20260513a.htm)).
- 55% had rainy day savings covering 3 months of expenses, down from 59% in 2021 ([SHED Savings and Investments](https://www.federalreserve.gov/publications/2026-economic-well-being-of-us-households-in-2025-savings-investments.htm)).
- Only 35% of non-retirees thought their retirement savings were on track ([SHED Savings and Investments](https://www.federalreserve.gov/publications/2026-economic-well-being-of-us-households-in-2025-savings-investments.htm)).

Game use: the $400 test and the 3-month test become thresholds in the Cash cushion factor, and the on-track question becomes the Retirement on track factor.

### 1.3 Gallup's five elements of wellbeing

Gallup splits wellbeing into Career (liking what you do each day), Social (strong relationships and love), Financial (managing your economic life to reduce stress and increase security), Physical (health and energy), and Community (engagement with where you live) ([Gallup, The Five Essential Elements](https://www.gallup.com/workplace/237020/five-essential-elements.aspx)).
Only 7% of people thrive in all five, and 66% thrive in at least one ([Gallup](https://www.gallup.com/workplace/237020/five-essential-elements.aspx)).
In Gallup-Sharecare US data, financial wellbeing was the lowest-scoring element and social the highest ([Gallup News](https://news.gallup.com/poll/172109/americans-financial-lowest-social-highest.aspx)).

Game use: the proposed meter covers Career (Work, Commute), Social (Relationships), Financial (Cushion, Debt, Income, Retirement), Physical (Health coverage only, see section 5), and Community (Home, plus a stretch "city ties" idea in section 7).

### 1.4 OECD Better Life Index

The OECD uses 11 dimensions: Housing, Income, Jobs, Community, Education, Environment, Civic Engagement, Health, Life Satisfaction, Safety, and Work-Life Balance ([OECD Better Life Index](https://www.oecd.org/en/data/tools/oecd-better-life-index.html)).
Users choose their own weights, because the OECD deliberately does not impose one ([Wikipedia summary of the BLI](https://en.wikipedia.org/wiki/OECD_Better_Life_Index)).

Game use: Housing, Income, Jobs, Health, and Work-Life Balance map onto sim variables; Education, Environment, Civic Engagement, and Safety are state-level or out of scope for a solo-life sim.
The "let the player tilt the weights" idea is a stretch option, not the default (see open questions).

### 1.5 World Happiness Report

The WHR explains national life evaluations (0-10 Cantril ladder) with six variables: log GDP per capita, social support, healthy life expectancy, freedom to make life choices, generosity, and perceived corruption, which together explain more than three-quarters of the variation across countries and years ([WHR 2025, chapter 2](https://www.worldhappiness.report/ed/2025/caring-and-sharing-global-analysis-of-happiness-and-kindness/)).
The 2025 coefficients are 0.328 for log GDP, 2.686 for social support (a 0-1 share), 0.032 per year of healthy life expectancy, 1.518 for freedom (0-1), 0.382 for generosity, and -0.669 for corruption (0-1) ([WHR 2025](https://www.worldhappiness.report/ed/2025/caring-and-sharing-global-analysis-of-happiness-and-kindness/)).
In the WHR 2019 breakdown of the average country's score above the "Dystopia" benchmark, social support contributed the largest share (34%), then GDP per capita (26%), healthy life expectancy (21%), freedom (11%), generosity (5%), and corruption (3%) ([WHR 2019, "Changing World Happiness"](https://www.worldhappiness.report/ed/2019/changing-world-happiness/)).

Game use: these are country-level numbers, so they guide the *ranking* of factors, not exact weights for one person.
Two lessons carry over: social connection is the largest non-income driver, and "freedom to make life choices" (which Killingsworth finds is the main reason money helps, see 2.1) is worth rewarding directly through a cash cushion.

## 2. Effect sizes for things the game can simulate

Most panel numbers below are on a 0-10 life satisfaction scale from the German SOEP, where the average person reports about 7.0 (SD 1.55) ([Lucas et al. 2003](https://www.apa.org/pubs/journals/releases/psp-843527.pdf)).
The Luhmann meta-analysis reports standardized effect sizes (d) instead.

### 2.1 Income

- Kahneman and Deaton (2010), 450,000+ Gallup-Healthways responses: life evaluation rises steadily with log income, but day-to-day emotional wellbeing stopped improving above about $75,000 a year ([Kahneman & Deaton 2010, PNAS](https://pmc.ncbi.nlm.nih.gov/articles/PMC2944762/)).
  They also found low income magnifies the emotional pain of misfortunes like divorce, ill health, and loneliness ([same](https://pmc.ncbi.nlm.nih.gov/articles/PMC2944762/)).
- Killingsworth (2021), 1,725,994 experience-sampling reports from 33,391 employed US adults: both experienced wellbeing and life satisfaction rise linearly with log income with no plateau ([Killingsworth 2021, PNAS](https://pmc.ncbi.nlm.nih.gov/articles/PMC7848527/)).
  Feeling in control of one's life accounted for 74% of the link between income and experienced wellbeing ([same](https://pmc.ncbi.nlm.nih.gov/articles/PMC7848527/)).
- Killingsworth, Kahneman, and Mellers (2023), an adversarial collaboration reanalyzing both datasets: for most people happiness keeps rising with log income past $100,000, while an unhappiest minority plateaus around $100,000 (the old $75,000 in today's dollars) ([PNAS 2023, PubMed](https://pubmed.ncbi.nlm.nih.gov/36857342/); [Princeton summary](https://behavioralpolicy.princeton.edu/news/DK_wellbeing0323)).
- Stevenson and Wolfers find the wellbeing-income relationship is roughly log-linear, does not diminish as incomes rise, and has a similar gradient within and across countries ([Stevenson & Wolfers 2013, AER](https://www.aeaweb.org/articles?id=10.1257%2Faer.103.3.598)).

Design consequence: score income on a log scale with no cap below the top of the game's range, and adjust for state prices (BEA RPP) so the Ohio-vs-California lesson from [02](02-states-cost-of-living.md) shows up in wellbeing too.

### 2.2 Unemployment and layoff (the big one)

- SOEP, 15 years, 24,000+ people: people react strongly to unemployment and move back toward baseline, but do not fully return even after they are re-employed, and a past spell does not make the next one hurt less ([Lucas, Clark, Georgellis & Diener 2004](https://journals.sagepub.com/doi/abs/10.1111/j.0963-7214.2004.01501002.x)).
- Clark, Diener, Georgellis and Lucas (2008), SOEP: complete adaptation to divorce, widowhood, first child, and layoff, only partial adaptation to marriage, and **no adaptation to unemployment for men** ([Clark et al. 2008, IZA DP 2526](https://docs.iza.org/dp2526.pdf)).
  Women's contemporaneous unemployment effect was about -0.3 points on the 0-10 scale ([same](https://docs.iza.org/dp2526.pdf)).
  Layoff had a non-income psychological effect for men lasting about two years, even with household income held constant ([same](https://docs.iza.org/dp2526.pdf)).
- Stutzer and Frey cite a SOEP coefficient of -0.671 points for becoming unemployed, the benchmark they use to show how large commuting costs are ([Stutzer & Frey, IZA DP 1278](https://docs.iza.org/dp1278.pdf)).
- Luhmann et al. meta-analysis (188 publications, 313 samples, N = 65,911): unemployment's initial effect on life satisfaction is d = -0.43, and the pre-event level was only reached about three years later ([Luhmann et al. 2012](https://pmc.ncbi.nlm.nih.gov/articles/PMC3289759/)).

Design consequence: unemployment gets the heaviest weight and a "scar" that decays slowly after re-employment.
This also links to the market: layoffs are 3x more likely in bear markets ([03](03-stock-market-and-simulation.md)), so a player without a cushion loses on both meters at once.

### 2.3 Marriage, divorce, widowhood

- Lucas et al. (2003), SOEP: being married is associated with a long-run gain of just 0.115 points (0-10), after a 0.184 rise in the year before marriage, with large individual differences (SD 0.83) ([Lucas et al. 2003](https://www.apa.org/pubs/journals/releases/psp-843527.pdf)).
  Marital status explains about 8% of within-person variation in life satisfaction but only about 1% between people ([same](https://www.apa.org/pubs/journals/releases/psp-843527.pdf)).
- Clark et al. (2008): marriage's boost lasts a couple of years and people are back near baseline by year three, though a small long-run effect remains ([IZA DP 2526](https://docs.iza.org/dp2526.pdf)).
  Divorce shows the strongest lead effect: satisfaction is sharply below baseline in the 2-3 years *before* the divorce, and then quickly returns to baseline ([same](https://docs.iza.org/dp2526.pdf)).
- Luhmann et al.: marriage d = +0.26 at the event, then declining; divorce d = -0.07 at the event, then rising ([Luhmann et al. 2012](https://pmc.ncbi.nlm.nih.gov/articles/PMC3289759/)).
- Widowhood has a very large short-run effect (Luhmann d = -0.48) that largely fades over about three years in SOEP, though a substantial minority stay lower for much longer ([Luhmann et al. 2012](https://pmc.ncbi.nlm.nih.gov/articles/PMC3289759/); [Clark et al. 2008](https://docs.iza.org/dp2526.pdf); [Lucas et al. 2003](https://pubmed.ncbi.nlm.nih.gov/12635914/)).

Design consequence: partnered vs. single is a small permanent difference, marriage is a decaying positive pulse, and divorce is a "strain" period before the event followed by recovery.
The prenup option from the meeting only affects money, which is right: the wellbeing effect of divorce comes from the strain, not the split of assets.

### 2.4 Children

- Myrskylä and Margolis (2014), BHPS and SOEP with fixed effects: wellbeing rises in anticipation and in the first year after a birth, especially the first, then returns to pre-birth levels ([Myrskylä & Margolis 2014, PubMed](https://pubmed.ncbi.nlm.nih.gov/25143019/)).
  The effect is positive for older and more educated parents and negative for younger and less educated ones ([same](https://pubmed.ncbi.nlm.nih.gov/25143019/)).
- Clark et al. (2008): positive for one year (men) or two years (women), but negative for both by the time the child is 4-5 ([IZA DP 2526](https://docs.iza.org/dp2526.pdf)).
- Luhmann et al.: d = +0.50 at birth, then declining ([Luhmann et al. 2012](https://pmc.ncbi.nlm.nih.gov/articles/PMC3289759/)).

Design consequence: a short positive pulse with no permanent points either way.
The real game effect of kids is the added cost of living (the meeting's decision), which flows into Cash cushion and Debt load automatically.

### 2.5 Debt and money stress

- Richardson, Elliott and Roberts (2013), meta-analysis of 65 papers: unsecured debt is associated with depression (pooled OR 2.77) and mental disorder in general (OR 3.24), and more severe debt goes with worse health, though causality is hard to prove ([Richardson et al. 2013, PubMed](https://pubmed.ncbi.nlm.nih.gov/24121465/)).
- Ruberton, Gladstone and Lyubomirsky (2016), 585 UK bank customers with real account data: liquid wealth (checking plus savings) predicted life satisfaction more strongly than income, spending, investments, or indebtedness, through higher perceived financial wellbeing ([Ruberton et al. 2016](https://escholarship.org/uc/item/4k43h4c0)).

Design consequence: the cushion factor is weighted above income, and debt load is its own factor measured by payments relative to income plus delinquency, not by the raw balance (a mortgage is not the same stress as a maxed card).

### 2.6 Commute

- Stutzer and Frey, SOEP: the average commute was 23 minutes one way; one standard deviation (19 minutes) more commuting goes with 0.12 points lower life satisfaction ([Stutzer & Frey, IZA DP 1278](https://docs.iza.org/dp1278.pdf)).
  Full compensation for a one-hour one-way commute would take about 40% more income ([same](https://docs.iza.org/dp1278.pdf)).
  The US average commute in their comparison was 48.8 minutes a day ([same](https://docs.iza.org/dp1278.pdf)).

Design consequence: a small, permanent, non-adapting factor that makes the "cheap house far away" trade-off visible.

### 2.7 Homeownership, renting, and moving

- Clark and Diaz-Serrano (2022), SOEP, all housing transitions: some transitions move life satisfaction only a little, while all of them change housing satisfaction; renters who become owners and move get the largest housing satisfaction gain, and losing homeowner status is the only transition that lowers it (and it keeps getting worse) ([Clark & Diaz-Serrano, IZA DP 15268](https://docs.iza.org/dp15268.pdf)).
- Foye, Clapham and Gabrieli (2018), SOEP and BHPS: part of the benefit of owning is relative status, which depends on what people around you own ([Urban Studies](https://journals.sagepub.com/doi/abs/10.1177/0042098017695478)).
- Nowok et al. (2013), BHPS: internal migration at best restores wellbeing after a dip before the move, and housing satisfaction stays higher five years after moving ([summary via Nowok et al. 2018, Urban Studies](https://journals.sagepub.com/doi/pdf/10.1177/0042098016665972)).

Design consequence: owning a home is a finance goal (retirement readiness and net worth), not a big wellbeing bonus.
What does hurt is losing the home (foreclosure, eviction, the tent tier), so the Home factor scores stability, and moving states carries no wellbeing penalty.

### 2.8 Health insurance and medical debt

- Oregon Health Insurance Experiment (randomized lottery): Medicaid lowered the chance of screening positive for depression by 9.15 percentage points ([Baicker et al. 2013, NEJM](https://www.nejm.org/doi/full/10.1056/NEJMsa1212321)).
  It cut the chance of medical bills sent to collections by 6.4 points (23%) and nearly eliminated catastrophic out-of-pocket spending, from 5.5% to 1.0% ([Finkelstein et al., NBER w17190](https://www.nber.org/papers/w17190); [J-PAL summary](https://www.povertyactionlab.org/evaluation/oregon-health-insurance-experiment-united-states)).

Design consequence: insurance coverage is a respectful, controllable stand-in for health, and medical debt flows into the debt ladder.

### 2.9 Retirement

- Luhmann et al.: retirement's initial effect on life satisfaction is d = -0.29, with slow recovery ([Luhmann et al. 2012](https://pmc.ncbi.nlm.nih.gov/articles/PMC3289759/)).
- Whether retirement is voluntary matters most: voluntary retirees reported higher life satisfaction than those still working, and involuntary retirees (health or employer reasons) the lowest ([The Gerontologist](https://academic.oup.com/gerontologist/article-pdf/54/2/232/19444273/gnt006.pdf)).
  Voluntary retirement lowers satisfaction with income but raises satisfaction with free time ([ScienceDirect, Retirement and subjective well-being](https://www.sciencedirect.com/science/article/abs/pii/S0167268112001308)).

Design consequence: "closeness to retirement" should reward being *on track to retire when you choose*, not simply age.
Retiring on your own terms gives a positive pulse; being forced out (a layoff in your 60s with no savings) gives a negative one.

### 2.10 Adaptation summary

| Event or state | Size (0-10 scale or d) | Adapts? | Game model |
| --- | --- | --- | --- |
| Unemployment | -0.3 to -0.67 pts; d = -0.43 | Slowly, incomplete; men not at all | State score 0 while unemployed, scar with ~1-year half-life after re-employment |
| Layoff (beyond lost income) | Negative for ~2 years (men) | Yes | Pulse -5, half-life 1 year |
| Low cash cushion | Stronger than income | No evidence of adaptation | Permanent state factor |
| Debt stress | Depression OR 2.77 | No evidence of adaptation | Permanent state factor |
| Log real income | Linear in log, no plateau | Partly (aspirations) | Permanent state factor on a log scale |
| Marriage | +0.115 long run, +0.18 year before; d = +0.26 | Mostly within 2-3 years | Small partnered bonus plus a +6 pulse, half-life 1 year |
| Divorce | Big drop in the 2-3 years before, d = -0.07 at event | Yes, back to baseline | "Strain" state before, -6 pulse at event, half-life 1 year |
| First child | d = +0.50 at birth | Yes, returns to baseline or below in 1-2 years | +4 pulse, half-life 1 year; costs via cost of living |
| Commute | -0.12 per 19 min | No | Permanent state factor |
| Homeownership | Small on life satisfaction | n/a | Not scored; losing a home is scored |
| Moving states | Restores a pre-move dip at best | n/a | No wellbeing effect |
| Retirement | d = -0.29 on average; voluntary positive, involuntary negative | Slowly | +4 pulse if on track and chosen, -6 if forced, half-life 2 years |
| Widowhood | d = -0.48 | Mostly in ~3 years | Not modeled (section 5) |

## 3. The proposed wellbeing meter

### 3.1 How the weights were set

The rule is **weight what lasts**.
Factors with large effects and no adaptation (unemployment, cash cushion, debt stress) get the most permanent weight.
Factors with large but fading effects (marriage, kids, divorce, layoff) get small or zero permanent weight plus decaying pulses, so they matter in the year they happen and not for the rest of the run.
Where two effects are on the same SOEP 0-10 scale, their order follows the numbers (unemployment -0.67 > commute per hour about -0.38, from 0.12 x 60 / 19, > long-run marriage +0.115).
Where they are not comparable (liquid wealth, insurance, the retirement on-track feeling), the weight is a judgment call anchored by the direction and relative size reported in the source, flagged as such in the table.

### 3.2 The nine factors

Each factor produces a sub-score s from 0 to 1, and the meter is `W = sum(weight x s) + pulses`, clamped to 0-100.

| Factor | Weight | Sim variable (have or cheap to add) | Sub-score s (0-1) | Evidence behind the weight |
| --- | --- | --- | --- | --- |
| Work | 20 | `employed` (have); `monthsSinceReemployed` (add) | 1 if employed, 0 if unemployed; after re-employment `1 - 0.5 x 0.5^(years since re-employed)` | Largest and least-adapting effect (2.2) |
| Cash cushion | 18 | `cash()` (have); monthly essentials = `rent + living + minimums()` (have) | 0 if cash < $400; else `min(months of essentials / 6, 1)` | Liquid wealth beats income (2.5); SHED $400 and 3-month tests (1.2); CFPB items 1, 5, 7 |
| Debt load | 14 | `dti()`, debt statuses (have) | `clamp(1 - DTI / 0.4)`; x0.5 if anything past due; 0 in collections or within 2 years of bankruptcy | Debt and depression OR 2.77 (2.5); CFPB items 9, 10 |
| Real income | 12 | `monthlyTakeHome` (have), gross salary (add), `place.rpp.all` (have) | `clamp(ln(realIncome / 25,000) / ln(8))`, realIncome = gross x 100 / RPP, so $25k = 0 and $200k = 1 | Log-linear, no plateau (2.1); lower than cushion because much of income's effect works through cushion and debt |
| Relationships | 10 | `relationship: single / partnered / strain` (add) | Partnered 1.0, single 0.9, strain 0.4 | Small long-run marriage effect (+0.115) and big pre-divorce dip (2.3); WHR says social ties matter most (1.5), but the sim only sees marital status |
| Retirement on track | 8 | Retirement account balances (401(k)/IRA, planned in 03), `age` (have), gross salary | `clamp(retirement savings / (target multiple(age) x salary))`, targets 1x at 30, 3x at 40, 6x at 50, 8x at 60, 10x at 67 ([Fidelity](https://www.fidelity.com/viewpoints/retirement/retirement-guidelines)) | SHED on-track question (1.2); CFPB items 2, 6; the team's "closeness to retirement" |
| Health coverage | 8 | `insured` (add), medical debt (debt kind, add) | Insured 1.0, uninsured 0.4, medical debt in collections 0 | Oregon: depression -9.15 pts, catastrophic spending 5.5% to 1.0% (2.8) |
| Commute | 6 | `commuteMinutes` one way (add, from home vs. job tile) | `clamp(1 - minutes / 60)`; remote or unemployed = 1 | -0.12 per 19 min, no adaptation (2.6) |
| Home stability | 4 | `homeTier()` (have), eviction/foreclosure (add) | 1 if housed, 0 at tier 0 (tent) or within a year of eviction or foreclosure | Losing a home is the only housing transition with lasting harm (2.7) |

The weights sum to 100, so a player with every sub-score at 1 and no pulses sits at 100.

### 3.3 Event pulses and decay

Pulses sit on top of the factors and decay each game day by half-life: `pulse(t) = P0 x 0.5^(t / halfLife)`.

| Event | P0 | Half-life |
| --- | --- | --- |
| Marriage or partnership | +6 | 1 year |
| Birth or adoption of a first child | +4 | 1 year |
| Divorce (after the strain period) | -6 | 1 year |
| Layoff (on top of Work dropping to 0) | -5 | 1 year |
| Bankruptcy filed | -6 | 2 years |
| Retiring on track and by choice | +4 | 2 years |
| Forced retirement (layoff at 60+ and not on track) | -6 | 2 years |

**Cushion softens bad news.**
Kahneman and Deaton found low income makes misfortunes hurt more; for example, the share reporting sadness or worry on a headache day differed by about 31.6 vs. 19.5 points between the lowest and higher income groups ([Kahneman & Deaton 2010](https://pmc.ncbi.nlm.nih.gov/articles/PMC2944762/)).
That ratio is about 1.6, so negative pulses are multiplied by `m = 1.3 - 0.5 x cushion`, which runs from 1.3 (no cushion) to 0.8 (6 months saved), also a 1.6 ratio.
This is the one place the meter teaches "the emergency fund is not only about money."

**Divorce strain comes first.**
Because the data says the pain is before the divorce, the game should fire a "relationship strain" event 1-2 years before a divorce event, which sets Relationships to 0.4.
That gives the player warning and a decision (counseling costs money, a prenup already signed or not), and the divorce itself then starts the recovery.

**Income aspirations (optional).**
If the team wants to model income adaptation, use `realIncome` averaged over the last 3 years instead of the current value, so a raise feels good for a while and then becomes normal.
This is off by default because it adds state and the log scale already captures most of the diminishing returns.

### 3.4 Combining with retirement readiness

Wellbeing is experienced over the whole life, not just at the end, so:

- `Wlife = 0.5 x (average of W over every game day) + 0.5 x (W on retirement day)`.
- `Final = 0.6 x RR + 0.4 x Wlife`, both on 0-100.

The 60/40 split keeps retirement (the game's stated goal and the Finance track story) in charge, while making wellbeing big enough that a high earner cannot buy their way past a miserable life.
Since income carries only 12 of 100 wellbeing points, a modest earner can beat a high earner on wellbeing, which meets the "every income level can win" principle in [SUMMARY.md](SUMMARY.md).

Retirement readiness is the team's to define; for the worked examples below this doc uses a placeholder:
`RR = 50 x clamp(retirement savings / (10 x salary)) + 20 x (credit score - 300) / 550 + 15 x clamp(net worth / (10 x salary)) + 15 x (1 - clamp(debt / salary))`, with the 10x-by-67 target from [Fidelity](https://www.fidelity.com/viewpoints/retirement/retirement-guidelines).

Some factors (cushion, debt) appear in both parts.
That is intentional: RR measures the stock at the end, and wellbeing measures the stress of the path, which is how a real person experiences debt.

### 3.5 Worked examples

RPP values are from [data/states-sample.json](data/states-sample.json) (California 110.72, Ohio 92.77).

**Alex: high earner, California, card debt, a layoff, a divorce.**
Salary $220,000, commutes 55 minutes each way, carries card debt with minimums at 30% of take-home, keeps half a month of expenses in cash, got laid off at 45 for 8 months, marriage strain at 46-48 and divorce at 48, retirement savings 5x salary at 67, credit score 680.

At 67 (events have faded):

| Factor | s | Points |
| --- | --- | --- |
| Work | 1.0 | 20.0 |
| Cash cushion (0.5 of 6 months) | 0.08 | 1.5 |
| Debt load (DTI 0.30) | 0.25 | 3.5 |
| Real income ($198.7k real) | 1.00 | 12.0 |
| Relationships (single) | 0.9 | 9.0 |
| Retirement on track (5x of 10x) | 0.5 | 4.0 |
| Health coverage | 1.0 | 8.0 |
| Commute (55 min) | 0.08 | 0.5 |
| Home | 1.0 | 4.0 |
| **W at 67** | | **62.5** |

At 45, during the layoff: Work 0, cushion gone (below $400) 0, DTI on unemployment pay above 0.4 and past due 0, income on 40% benefits ($79.5k real) 6.7, relationship strain 4.0, retirement 2x of a 4.5x target 3.6, uninsured after losing the job 3.2, no commute 6.0, housed 4.0, and a layoff pulse of -5 x 1.3 = -6.5.
That totals **21.0**, the lowest point of the run, and exactly the moment the AI feedback trigger for a big swing should fire.
Averaged over the run (strong years around 60-65, a crash at 45, strain at 46-48), assume about 59.
`Wlife = 0.5 x 59 + 0.5 x 62.5 = 60.8`, placeholder `RR = 25 + 13.8 + 9 + 10.5 = 58.3`, so **Final = 0.6 x 58.3 + 0.4 x 60.8 = 59.3**.

**Sam: modest earner, Ohio, emergency fund, stable marriage.**
Salary $62,000, 20-minute commute, 6 months of expenses in an emergency fund, a car loan at 8% of take-home, married at 30, first child at 32, never unemployed, retirement savings 8x salary at 67 (index funds plus the 401(k) match), credit score 790.

| Factor | s | Points |
| --- | --- | --- |
| Work | 1.0 | 20.0 |
| Cash cushion (6 months) | 1.0 | 18.0 |
| Debt load (DTI 0.08) | 0.8 | 11.2 |
| Real income ($66.8k real) | 0.47 | 5.7 |
| Relationships (partnered) | 1.0 | 10.0 |
| Retirement on track (8x of 10x) | 0.8 | 6.4 |
| Health coverage | 1.0 | 8.0 |
| Commute (20 min) | 0.67 | 4.0 |
| Home | 1.0 | 4.0 |
| **W at 67** | | **87.3** |

Assume a run average of about 85 (lower in the early years before the fund was full, bumps from the marriage and child pulses).
`Wlife = 86.2`, placeholder `RR = 40 + 17.8 + 15 + 15 = 87.8`, so **Final = 0.6 x 87.8 + 0.4 x 86.2 = 87.2**.

**What the comparison teaches.**
Alex out-earns Sam 3.5x, but beats Sam by only 6.3 points on income.
Alex loses 16.5 points on cushion, 7.7 on debt, 3.5 on commute, and 2.4 on retirement, and bottoms out at 21 during the layoff because nothing was saved.
Compared with the CFPB benchmarks (1.1), Sam ends in the "rarely struggles" band (61+) and Alex in the middle band.

## 4. Implementation notes

- Compute `W` in `PlayerLife.onDay` and push it into `LifeSnapshot` (it already records cash, debt, net worth, and score), so the history chart, the calendar review, and the teleport all get it free.
- New fields on `PlayerLife`: `grossSalary`, `relationship`, `insured`, `commuteMinutes`, `reemployedDay`, and a `pulses: {p0, halfLifeDays, startDay}[]` list.
  Everything else (`cash()`, `dti()`, `minimums()`, `rent`, `living`, `place.rpp`, `homeTier()`, `employed`, `age`) already exists in `game/src/sim/life/player.ts`.
- `Place.rpp` currently has `all`, `goods`, and `housing`; the real-income sub-score uses `all`.
- Keep the meter deterministic and seeded like the rest of the sim, so ghost runs and "if you had held" comparisons also produce ghost wellbeing lines.
- Show the factor breakdown the same way the credit report shows FICO factors, so each point has a visible reason.

## 5. Sensitive factors and how to handle them

| Topic | Evidence says it matters | Recommendation |
| --- | --- | --- |
| Physical and mental health status | Yes (WHR healthy life expectancy, Gallup physical) | Do not score illness or disability; score insurance coverage and medical debt, which the player can act on |
| Death of a spouse or family member | Very large short-run effect | Do not generate it as a random event; if an NPC death happens (the ElevenLabs narration idea), treat it as narrative with no score change |
| Religion and faith | Correlates with wellbeing in surveys | Skip entirely |
| Having or not having children | Near zero long-run effect | Never reward or penalize choosing kids; only the costs apply |
| Being single, and partner gender | Small long-run effect (+0.115) | Single sits at 0.9, not 0; partners are gender-neutral; consider setting single to 1.0 if the team prefers (open question) |
| Divorce | Pre-divorce strain, then full recovery | Frame as recovery, never as failure; no permanent penalty |
| Unemployment due to disability | Shown in CFPB data as lower financial wellbeing | Out of scope; do not model |
| Real personal data from onboarding | The player enters real finances | Show the meter as "a model of research averages, not a judgment of you," next to the existing education-not-advice disclaimer |

## 6. How this lines up with the published measures

| Published dimension | Covered by |
| --- | --- |
| CFPB: control over day-to-day finances | Debt load, Cash cushion |
| CFPB: capacity to absorb a shock | Cash cushion (the $400 and 6-month tests) |
| CFPB: on track for goals | Retirement on track |
| CFPB: freedom to enjoy life | Real income, Cash cushion |
| Gallup Career / OECD Jobs and Work-Life Balance | Work, Commute |
| Gallup Social / WHR social support | Relationships (partial, see open questions) |
| Gallup Physical / OECD Health | Health coverage |
| Gallup Community / OECD Housing | Home stability |
| WHR freedom to make life choices | Cash cushion (Killingsworth's "control" mediator) |

## 7. Stretch ideas

- **City ties:** the WHR says social support is the single biggest driver, and the sim only sees marital status.
  A cheap stand-in is a "years lived in this state" or "friends in the city" stat that resets partly when the player moves, which would also give moving a real social cost.
- **Player-weighted view:** OECD-style sliders that let the player re-weight the meter after the run, as a reflection screen rather than the scored default.
- **CFPB quiz at the end:** ask the real 5-item CFPB questions about the player's real life on the "Your Real Plan" screen, which doubles as the impact measure in [04](04-impact-learning-and-judging.md).

## Sources

- CFPB: [Financial Well-Being Scale technical report](https://www.consumerfinance.gov/data-research/research-reports/financial-well-being-technical-report/), [report PDF](https://files.consumerfinance.gov/f/documents/201705_cfpb_financial-well-being-scale-technical-report.pdf), [first national survey release](https://www.consumerfinance.gov/archive/newsroom/cfpbs-first-national-survey-financial-well-being-shows-more-40-percent-us-adults-struggle-make-ends-meet/), [data spotlight 2017-2020](https://www.consumerfinance.gov/data-research/research-reports/data-spotlight-financial-well-being-in-america-2017-2020/)
- Federal Reserve SHED 2025 (May 2026): [press release](https://www.federalreserve.gov/newsevents/pressreleases/other20260513a.htm), [Savings and Investments](https://www.federalreserve.gov/publications/2026-economic-well-being-of-us-households-in-2025-savings-investments.htm)
- Gallup: [Five Essential Elements](https://www.gallup.com/workplace/237020/five-essential-elements.aspx), [Americans' financial wellbeing lowest, social highest](https://news.gallup.com/poll/172109/americans-financial-lowest-social-highest.aspx)
- OECD: [Better Life Index](https://www.oecd.org/en/data/tools/oecd-better-life-index.html), [Wikipedia summary](https://en.wikipedia.org/wiki/OECD_Better_Life_Index)
- World Happiness Report: [2025, chapter 2](https://www.worldhappiness.report/ed/2025/caring-and-sharing-global-analysis-of-happiness-and-kindness/), [2019, Changing World Happiness](https://www.worldhappiness.report/ed/2019/changing-world-happiness/)
- Income: [Kahneman & Deaton 2010](https://pmc.ncbi.nlm.nih.gov/articles/PMC2944762/), [Killingsworth 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC7848527/), [Killingsworth, Kahneman & Mellers 2023](https://pubmed.ncbi.nlm.nih.gov/36857342/), [Princeton summary](https://behavioralpolicy.princeton.edu/news/DK_wellbeing0323), [Stevenson & Wolfers 2013](https://www.aeaweb.org/articles?id=10.1257%2Faer.103.3.598)
- Life events and adaptation: [Luhmann, Hofmann, Eid & Lucas 2012](https://pmc.ncbi.nlm.nih.gov/articles/PMC3289759/), [Clark, Diener, Georgellis & Lucas 2008 (IZA DP 2526)](https://docs.iza.org/dp2526.pdf), [Lucas, Clark, Georgellis & Diener 2003](https://www.apa.org/pubs/journals/releases/psp-843527.pdf) ([PubMed](https://pubmed.ncbi.nlm.nih.gov/12635914/)), [Lucas et al. 2004, unemployment and the set point](https://journals.sagepub.com/doi/abs/10.1111/j.0963-7214.2004.01501002.x), [Myrskylä & Margolis 2014](https://pubmed.ncbi.nlm.nih.gov/25143019/)
- Debt and liquidity: [Richardson, Elliott & Roberts 2013](https://pubmed.ncbi.nlm.nih.gov/24121465/), [Ruberton, Gladstone & Lyubomirsky 2016](https://escholarship.org/uc/item/4k43h4c0)
- Commute: [Stutzer & Frey, "Stress That Doesn't Pay" (IZA DP 1278)](https://docs.iza.org/dp1278.pdf)
- Housing and moving: [Clark & Diaz-Serrano (IZA DP 15268)](https://docs.iza.org/dp15268.pdf), [Foye, Clapham & Gabrieli 2018](https://journals.sagepub.com/doi/abs/10.1177/0042098017695478), [Nowok et al. 2018 (reviews Nowok et al. 2013)](https://journals.sagepub.com/doi/pdf/10.1177/0042098016665972)
- Health insurance: [Oregon Experiment, NEJM 2013](https://www.nejm.org/doi/full/10.1056/NEJMsa1212321), [NBER w17190](https://www.nber.org/papers/w17190), [J-PAL summary](https://www.povertyactionlab.org/evaluation/oregon-health-insurance-experiment-united-states)
- Retirement: [The Gerontologist, retirement transitions](https://academic.oup.com/gerontologist/article-pdf/54/2/232/19444273/gnt006.pdf), [Retirement and subjective well-being (ScienceDirect)](https://www.sciencedirect.com/science/article/abs/pii/S0167268112001308), [Fidelity retirement guidelines](https://www.fidelity.com/viewpoints/retirement/retirement-guidelines)
- Game data: [data/states-sample.json](data/states-sample.json) (BEA RPP 2024)

## Open questions for the team

1. Is 60/40 (retirement readiness / wellbeing) the right split, or should wellbeing be a multiplier or a tiebreaker instead?
2. Should the lifetime average count as much as the value at retirement (0.5/0.5), or only the end state?
3. Single at 0.9 or 1.0: do we give partnered players any permanent edge at all, given the long-run effect is only +0.115 points?
4. Where do the new inputs come from: does onboarding ask for commute, insurance, and relationship status, or does the game infer commute from the home and job tiles?
5. Do we add the "relationship strain" warning event before divorce, and what decision does it offer?
6. Is health coverage its own purchase (employer plan vs. marketplace vs. none), or just a flag that turns off when the player is unemployed?
7. Who owns the retirement readiness formula? The placeholder in 3.4 needs a real spec before the worked examples are final.
8. Do we show the CFPB national average (54) next to the player's meter, which implies our meter is on the same scale when it is only calibrated to it?
9. Is "city ties" (section 7) worth building so moving has a social cost, given the WHR says social support is the biggest factor?
