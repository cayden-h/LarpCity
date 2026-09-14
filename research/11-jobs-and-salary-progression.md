# 11 - Jobs and Salary Progression

Research for Larp City, HackRice 2026 (Sep 11-13), Finance track.
Compiled 2026-09-12.
Builds on the onboarding decision made on 2026-09-12: the player enters gross salary, current age, job category, marital status, and location (state and city).
From salary and category the game infers a job level from real salary ranges, then projects a realistic career (raises, promotions, plateaus, layoffs) without preset jobs, which the meeting rejected ([../docs/meetings/2026-09-11-game-design.md](../docs/meetings/2026-09-11-game-design.md), "Game overview").
Every number links to its source; numbers the model derives or assumes are marked as such.

## TL;DR

- **Categories:** use the 22 civilian SOC major groups with friendlier names (for example "Software, IT, and data" for SOC 15-0000), plus 2-3 example job titles on each tile.
  They cover every US job, BLS publishes percentile wages for each one every year, and each maps to a JOLTS industry for layoff rates.
- **Salary ranges:** BLS OEWS May 2025 national 10th/25th/50th/75th/90th percentile wages for each group, pulled keyless from the BLS API by [data/jobs/build_jobs.py](data/jobs/build_jobs.py) into [data/jobs/jobs-oews.json](data/jobs/jobs-oews.json) (17 KB, all 22 groups, 23 anchor occupations, 51 state medians, zero missing cells).
- **State adjustment:** divide the player's salary by an OEWS state wage index (state median wage / US median wage, for example Texas 0.954, Ohio 0.969, Florida 0.939, California 1.142), not by BEA RPP.
  Wages do not track prices one for one: Florida's prices are 3% above the US average, but its wages are 6% below it.
- **Level inference:** the national-equivalent salary gives a percentile within the category; bands are Entry (under p25), Mid (p25-p50), Senior (p50-p75), Lead (p75-p90), Top (p90+), plus an "ahead of / behind for your age" line from CPS earnings by age.
- **Progression model (seeded, yearly):** merit raise (budget 3.3% nominal, scaled by a performance draw: top performers 5.6%, middle 3.3%), a promotion hazard of about 10% a year worth 6-15%, an age-dependent voluntary job switch, a category "career ladder" growth term, a late-career drift, and a ceiling at the category's 90th percentile.
  It is calibrated so the median worker's real pay grows about 1.4-1.7x from 25 to 45 depending on category, then flattens, which matches Guvenen et al.'s +60% from 25 to 55 and the CPS earnings-by-age peak at 35-54.
- **Layoffs:** about 1.5% of jobs a year end in displacement (Displaced Worker Survey), scaled by the category's JOLTS industry layoff rate (government 0.29x, construction 1.66x) and by a bear-market multiplier of about 3x (2.6x to 4.0x by industry), which backs up the existing x3 from research 03.
  A spell lasts a lognormal draw with an 11.4-week median (25 in a bear), and the new job pays a bit less on average.
  That reproduces Davis and von Wachter's cost of a layoff: 1.1 years of pay lost in normal times (they find 1.4) and 2.8 in a recession (they find 2.8).
- **Marriage:** the sim needs a spouse income; ask for it (optional) and otherwise draw it from the local wage distribution, 66% dual-earner for couples with kids.
- **Worked examples (real 2026 dollars, 2,000 seeds each):** a $95k software developer, 24, in Texas starts at Mid, peaks around 50, and ends at a median $153k real at 64 (p10 $100k, p90 $189k).
  An $88k nurse, 35, in Ohio starts at Senior and ends at a median $94k at 66.
  A $58k retail store manager, 45, in Florida starts at Lead and drifts down to a median $56k at 66.
- **Hackathon version:** ship the JSON, the level inference, and a yearly raise + promotion + layoff draw with the bear multiplier.
  Job switching as a player choice, spouse careers, and the full event text come later.

## 1. Job categories

### 1.1 Options considered

| Option | Size | Pros | Cons |
| --- | --- | --- | --- |
| SOC major groups ([BLS SOC 2018](https://www.bls.gov/soc/2018/major_groups.htm)) | 23 (22 civilian + military) | Covers every job; OEWS publishes percentile wages for each group nationally and by state every year; stable codes | Some names are clunky ("Building and Grounds Cleaning and Maintenance"); a few groups are wide (Healthcare Practitioners spans techs to surgeons) |
| SOC minor groups | ~98 | Tighter wage ranges | Too many tiles for onboarding |
| Detailed occupations (OEWS) | ~830 | Exact job titles | Needs search UI; the meeting rejected preset jobs, and a job list feels like one |
| Industry (NAICS sectors) | ~20 | Matches JOLTS layoff data directly | Industry is not job: a nurse and a janitor in the same hospital have very different pay |

### 1.2 Recommendation: the 22 civilian SOC major groups, relabeled

Use the major groups as categories because they are exhaustive, they are what OEWS reports percentiles for, and 22 tiles fit on one onboarding screen with a search box.
Rename them in plain language and show example titles so a player can find themselves.
Each category also gets one anchor detailed occupation (used for the career ladder in section 3 and for tooltips like "typical job: Registered nurse, median $97,550") and a JOLTS industry for layoff risk (section 4).

| id | Label on the tile | SOC | Jobs (M) | Example titles | Anchor occupation | JOLTS industry |
| --- | --- | --- | --- | --- | --- | --- |
| management | Management and executive | 11-0000 | 11.1 | Operations manager, director, store GM | General and operations managers | Total private |
| business_finance | Business and finance | 13-0000 | 10.5 | Accountant, analyst, HR specialist | Accountants and auditors | Financial activities |
| tech | Software, IT, and data | 15-0000 | 5.3 | Software developer, IT support, data scientist | Software developers | Information |
| engineering | Engineering and architecture | 17-0000 | 2.6 | Engineer, architect, drafter | Mechanical engineers | Professional and business services |
| science | Science and research | 19-0000 | 1.5 | Lab scientist, chemist | Chemists | Professional and business services |
| social_services | Community and social services | 21-0000 | 2.7 | Social worker, counselor | Child, family, and school social workers | Government |
| legal | Legal | 23-0000 | 1.3 | Lawyer, paralegal | Lawyers | Professional and business services |
| education | Education and library | 25-0000 | 9.1 | Teacher, professor, teaching assistant | Elementary school teachers | Government |
| arts_media | Arts, design, and media | 27-0000 | 2.0 | Designer, writer, producer | Graphic designers | Information |
| healthcare_pro | Healthcare professional | 29-0000 | 9.8 | Nurse, pharmacist, physician, technician | Registered nurses | Health care |
| healthcare_support | Healthcare support | 31-0000 | 7.9 | Nursing assistant, medical assistant | Nursing assistants | Health care |
| protective | Protective services | 33-0000 | 3.8 | Police officer, firefighter, security guard | Police and sheriff's patrol officers | Government |
| food_service | Food service and hospitality | 35-0000 | 13.7 | Cook, server, bartender | Cooks, restaurant | Leisure and hospitality |
| cleaning_grounds | Cleaning and grounds | 37-0000 | 4.5 | Janitor, housekeeper, landscaper | Janitors and cleaners | Professional and business services |
| personal_care | Personal care and service | 39-0000 | 3.3 | Hairstylist, childcare worker, trainer | Hairdressers and cosmetologists | Leisure and hospitality |
| sales_retail | Sales and retail | 41-0000 | 13.4 | Retail associate or manager, sales rep | First-line supervisors of retail sales workers | Retail trade |
| office_admin | Office and administrative support | 43-0000 | 17.8 | Admin assistant, customer service | Customer service representatives | Total private |
| farming | Farming, fishing, and forestry | 45-0000 | 0.4 | Farmworker, fisher, logger | Crop farmworkers and laborers | Total private |
| construction | Construction and extraction trades | 47-0000 | 6.4 | Electrician, carpenter, plumber | Electricians | Construction |
| repair | Installation, maintenance, and repair | 49-0000 | 6.1 | Mechanic, HVAC tech | Automotive service technicians | Total private |
| production | Production and manufacturing | 51-0000 | 8.6 | Assembler, machinist, welder | Welders and cutters | Manufacturing |
| transport | Transportation and logistics | 53-0000 | 13.7 | Truck driver, warehouse worker, pilot | Heavy and tractor-trailer truck drivers | Transportation and warehousing |

Employment is from OEWS May 2025 (in [data/jobs/jobs-oews.json](data/jobs/jobs-oews.json)).
The industry mapping is our judgment: a category's workers are spread across many industries, so we pick the one where most of them work or, where no industry dominates, total private.

Two groups need a tooltip:

- **Management** mixes a store manager at $60k with a CEO; the percentile inference handles this because a lower salary lands at a lower level.
- **Sales and retail** holds both retail associates and retail managers (a retail store manager is SOC 41-1011, inside Sales, not Management), so "retail manager" players should pick Sales and retail.
  A search box that maps common titles to categories ("store manager" -> Sales and retail, "nurse" -> Healthcare professional) fixes most mis-picks.

## 2. Salary ranges by category and level

### 2.1 Data

BLS [Occupational Employment and Wage Statistics](https://www.bls.gov/oes/) (OEWS) May 2025 estimates, [released 2026-05-15](https://www.bls.gov/news.release/ocwage.htm), give annual wages at the 10th, 25th, 50th, 75th, and 90th percentiles for every occupation and group, nationally, by state, and by metro.

- **Access:** the [BLS Public API v1](https://www.bls.gov/developers/) needs no key (25 series per request, 25 requests per day per IP).
  Series IDs are `OEUN` + area (7) + industry (6) + occupation (6) + datatype (2), for example `OEUN000000000000015000013` is the national median for SOC 15-0000; datatypes `11`-`15` are the annual 10th-90th percentiles and `01` is employment ([BLS series ID format](https://www.bls.gov/help/hlpforma.htm#OE)).
  bls.gov's own Excel downloads ([OEWS tables](https://www.bls.gov/oes/tables.htm)) block scripted downloads, as research 02 found, so the builder uses the API.
- **Builder:** [data/jobs/build_jobs.py](data/jobs/build_jobs.py) (stdlib Python + curl) makes 14 API requests and writes [data/jobs/jobs-oews.json](data/jobs/jobs-oews.json): 327 series, none missing.
- **License:** US government work, public domain.

### 2.2 National percentiles (OEWS May 2025, annual, USD)

| Category | p10 | p25 | p50 | p75 | p90 | Anchor p25 | Anchor p50 | Anchor p75 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All occupations | 31,200 | 37,590 | 50,980 | 80,520 | 128,560 | | | |
| Management | 60,130 | 82,970 | 126,520 | 176,280 | 257,310 | 72,320 | 105,770 | 167,280 |
| Business and finance | 48,820 | 62,940 | 82,660 | 114,820 | 153,990 | 67,020 | 83,680 | 109,810 |
| Software, IT, and data | 58,200 | 78,820 | 109,280 | 155,830 | 191,450 | 105,210 | 135,980 | 171,980 |
| Engineering and architecture | 58,670 | 76,560 | 99,520 | 130,240 | 166,490 | 84,130 | 104,110 | 132,590 |
| Science and research | 48,420 | 62,380 | 82,530 | 114,460 | 155,830 | 69,460 | 91,240 | 125,550 |
| Community and social services | 37,970 | 46,370 | 58,300 | 75,910 | 97,630 | 48,270 | 59,550 | 76,070 |
| Legal | 49,400 | 64,800 | 102,500 | 174,620 | 287,070 | 102,990 | 159,670 | 221,370 |
| Education and library | 32,990 | 43,900 | 60,570 | 79,470 | 105,240 | 57,710 | 63,970 | 81,450 |
| Arts, design, and media | 34,700 | 44,720 | 62,750 | 94,530 | 134,900 | 49,040 | 62,960 | 81,830 |
| Healthcare professional | 46,270 | 63,860 | 86,530 | 123,540 | 171,790 | 80,330 | 97,550 | 112,350 |
| Healthcare support | 28,980 | 34,320 | 38,340 | 45,930 | 54,230 | 37,260 | 42,260 | 47,220 |
| Protective services | 32,850 | 37,350 | 50,080 | 75,990 | 102,470 | 59,290 | 76,210 | 97,600 |
| Food service and hospitality | 23,120 | 28,760 | 35,050 | 41,860 | 51,340 | 34,010 | 37,390 | 44,620 |
| Cleaning and grounds | 29,010 | 33,930 | 37,680 | 46,170 | 57,420 | 32,240 | 36,840 | 44,060 |
| Personal care and service | 26,430 | 30,820 | 36,410 | 46,060 | 61,020 | 30,120 | 35,790 | 48,830 |
| Sales and retail | 28,080 | 32,440 | 38,530 | 61,100 | 99,850 | 38,590 | 48,520 | 62,130 |
| Office and administrative support | 33,530 | 38,540 | 47,450 | 60,060 | 76,170 | 36,870 | 44,770 | 51,780 |
| Farming, fishing, and forestry | 31,760 | 34,540 | 36,630 | 44,990 | 58,220 | 34,320 | 35,660 | 38,840 |
| Construction and extraction | 38,100 | 46,880 | 59,540 | 77,970 | 101,650 | 49,430 | 63,190 | 83,940 |
| Installation, maintenance, and repair | 37,000 | 46,110 | 59,620 | 76,670 | 96,540 | 38,900 | 50,620 | 70,430 |
| Production and manufacturing | 34,240 | 38,130 | 46,990 | 59,920 | 76,990 | 46,790 | 53,750 | 63,010 |
| Transportation and logistics | 31,060 | 36,290 | 44,350 | 55,990 | 72,440 | 47,960 | 58,640 | 69,120 |

The anchor columns are the category's anchor occupation from 1.2.
The national software developer median of $135,980 differs from the $148,100 in research 02 because 02 used the mean, not the median.

### 2.3 From percentile to level

Inside a group, the wage percentile reflects both which occupation you are in and how senior you are.
That is fine for a game, because both are what "level" means to a player: a $60k management worker is a junior manager whichever occupation they are in.

| Level | Category percentile | What the game calls it | Promotion allowed |
| --- | --- | --- | --- |
| Entry | under 25 | Entry level | Yes |
| Mid | 25-50 | Mid level | Yes |
| Senior | 50-75 | Senior | Yes |
| Lead | 75-90 | Lead / manager | Yes |
| Top | 90+ | Principal / executive (ladder top) | No; raises only |

The percentile is a log-linear interpolation between the five published points, with tails extrapolated from the nearest segment and clamped to 1-99.5 (implemented in `percentile()` in [data/jobs/simulate_careers.py](data/jobs/simulate_careers.py)).

**Age context.**
CPS median weekly earnings for full-time workers in Q2 2026 were $831 at 20-24, $1,160 at 25-34, $1,436 at 35-44, $1,421 at 45-54, $1,367 at 55-64, and $1,233 at 65+ ([BLS Usual Weekly Earnings, table 3](https://www.bls.gov/news.release/wkyeng.t03.htm)).
The game turns this into an expected percentile for age (about 22 at 24, 38 at 30, 55 at 40, 58 at 50, then down; this mapping is our derivation).
If the player's percentile is well above that, onboarding says "ahead of the curve for your age", and well below says "early in your career" rather than "underpaid".

### 2.4 State adjustment: use the OEWS state wage index, not RPP

To compare a state salary with national percentiles, divide it by the state wage index = state all-occupations median wage / US median ($50,980), from the same OEWS pull.

| State | OEWS median wage | Wage index | BEA RPP all items / 100 ([states-rpp.json](data/states-rpp.json)) |
| --- | --- | --- | --- |
| California | 58,240 | 1.142 | 1.107 |
| New York | 59,670 | 1.170 | 1.079 |
| Massachusetts | 63,590 | 1.247 | 1.058 |
| Washington | 62,990 | 1.236 | 1.070 |
| Texas | 48,620 | 0.954 | 0.971 |
| Ohio | 49,380 | 0.969 | 0.928 |
| Florida | 47,880 | 0.939 | 1.034 |
| Mississippi | 40,120 | 0.787 | 0.870 |

The wage index is the right tool for "where does this salary rank among workers in my field", because it measures local pay rather than local prices.
RPP stays the tool for purchasing power, as in research 02 and the wellbeing meter's real income factor.
The gap between the two columns is itself a lesson: Florida pays below the US average but costs above it, and Ohio pays close to average but costs 7% less.
Caveats: DC's index is 1.796 because many high earners who work in DC live elsewhere, so clamp it to about 1.3.
A single all-occupations index ignores that some jobs vary more by state than others (research 02 found California nurses earn 66% more than Florida nurses); the later version can fetch per-state category medians (51 states x 22 groups = 1,122 series, which needs the free v2 key).

## 3. Career progression: what the data say

### 3.1 How much pay grows over a career

- **Panel data (Social Security records):** for the median man by lifetime earnings, average earnings rise about 60% from age 25 to 55, while they rise 4.8-fold at the 95th percentile and 27.8-fold for the top 1% ([Guvenen, Karahan, Ozkan & Song 2021, Econometrica](https://doi.org/10.3982/ECTA14603), [PDF](https://static1.squarespace.com/static/6246570e617f1d3daf55e1c1/t/628e6309b2e01e636b2ee9b3/1653498634356/guvenen-karahan-ozkan-song-econometrica-2021.pdf), p. 2305).
  Earnings decline from 45 to 55 for 80% of the population, and people below the 20th percentile see a decline from 25 to 55 (same, p. 2322 and footnote 21).
- **Cross-section (CPS 2026):** median weekly pay rises 24% from 25-34 to 35-44, is flat through 45-54, and is 5% lower at 55-64 ([BLS table 3](https://www.bls.gov/news.release/wkyeng.t03.htm)).
  So the peak is 35-54, and the model should put most growth before 45.
- **By field (New York Fed, ages 22-27 vs 35-45, bachelor's degree holders):** computer science $80k to $115k (1.44x), computer engineering $80k to $122k, mechanical engineering $75k to $115k (1.53x), finance $70k to $110k (1.57x), accounting $60k to $88k (1.47x), nursing $65k to $84k (1.29x) ([NY Fed, The Labor Market for Recent College Graduates](https://www.newyorkfed.org/research/college-labor-market), figures as compiled by [Sallie](https://www.sallie.com/colleges/majors/highest-paying)).
  Nursing is flat and business and engineering are steep, which is the category difference the model needs.
- **A data proxy for every category:** the anchor occupation's p75/p25 wage ratio (OEWS) is close to the NY Fed early-to-mid-career ratio where both exist.
  Software developers are 1.63 (NY Fed CS 1.44), mechanical engineers 1.58 (1.53), accountants 1.64 (1.47), and registered nurses 1.40 (1.29).
  It runs a little high because the spread also includes region and employer, but it ranks fields the same way, and it exists for all 22 categories, including trades and service jobs that the NY Fed does not cover.
  We use it as the category's "career ladder": the real growth a median worker gets from about 25 to about 45.

### 3.2 Annual raises

- **Merit budgets:** US salary increase budgets for 2026 are 3.4-3.5% total at WTW ([WorldatWork on WTW](https://worldatwork.org/publications/workspan-daily/wtw-poll-reflects-2026-salary-budget-stability-3-4-increases-planned)), 3.5% total with 3.3% for merit at Mercer ([WorldatWork on Mercer](https://worldatwork.org/publications/workspan-daily/mercer-forecasts-3-5-total-salary-increase-budgets-for-2026), [Mercer](https://www.mercer.com/en-us/about/newsroom/most-us-employers-plan-to-keep-2026-salary-increases-flat/)), and 3.5% at Payscale ([WorldatWork on Payscale](https://worldatwork.org/publications/workspan-daily/payscale-u-s-employers-forecast-3-5-pay-increases-for-2026)).
- **By performance:** in 2025, employers with five-tier ratings gave top performers 5.6% and middle performers 3.3%; the average merit increase was 3.2% ([HR Dive on Mercer QuickPulse](https://www.hrdive.com/news/2025-raises-lower-than-expected/747142/)).
- **What people actually get (Atlanta Fed Wage Growth Tracker, median 12-month hourly wage growth, CPS):** job stayers averaged 3.3% and switchers 4.0% in 1998-2019; in August 2026 stayers were at 3.6% and switchers 4.4% ([Atlanta Fed](https://www.atlantafed.org/chcs/wage-growth-tracker); FRED [stayers](https://fred.stlouisfed.org/series/FRBATLWGT12MMUMHWGJST), [switchers](https://fred.stlouisfed.org/series/FRBATLWGT12MMUMHWGJSW)).
- **By age (same tracker, 1998-2019 averages):** 6.7% at 16-24, 3.7% at 25-54, and 2.4% at 55+ ([FRED 16-24](https://fred.stlouisfed.org/series/FRBATLWGT12MMUMHWGA1644Y), [25-54](https://fred.stlouisfed.org/series/FRBATLWGT12MMUMHWGA2554Y), [55+](https://fred.stlouisfed.org/series/FRBATLWGT12MMUMHWG55O)).
  The young get the fast raises, which is where the model's promotions and switches cluster.
- **In a downturn:** stayer wage growth fell to 1.7% in October 2010, about half its long-run average ([FRED stayers](https://fred.stlouisfed.org/series/FRBATLWGT12MMUMHWGJST)), so the model halves merit budgets in bear years.

### 3.3 Promotions and job switches

- **Promotions:** employers expected to promote about 10% of their workforce in 2025 (up from 8%), with an average promotion raise of 8.5% ([HR Dive on Mercer](https://www.hrdive.com/news/2025-raises-lower-than-expected/747142/)).
  Industry guides put the typical range at 8-20% ([Ravio](https://ravio.com/blog/average-promotion-rate)).
- **How often people switch:** median tenure with the current employer was 3.9 years in January 2024, 2.7 years at ages 25-34, and 9.6 years at 55-64 ([BLS Employee Tenure 2024](https://www.bls.gov/news.release/archives/tenure_09262024.htm)).
- **The switcher premium is smaller than folklore says:** the Atlanta Fed switcher-minus-stayer gap averaged 0.6 percentage points in 1998-2019, peaked at 2.2 points in November 2022, and was negative (-0.6) in February 2010 (our calculation from the FRED series above).
  In bad times, switchers can do worse than stayers, and the model's switch bump is modest and noisy (mean +3%, standard deviation 8%) so some switches are pay cuts.

### 3.4 Earnings shocks are not bell-shaped

- 31% of annual earnings changes are under 5%, versus 8% under a normal distribution, and the distribution is left-skewed: workers aged 45-55 earning about $100,000 have a lower tail 2.5 times longer than the upper tail ([Guvenen et al. 2021](https://doi.org/10.3982/ECTA14603), pp. 2304-2305).
  Most years are quiet, and the big moves are rare and mostly down later in a career, which is exactly "merit raise most years, layoff sometimes".
- Nonemployment risk is concentrated at the bottom: the estimated chance of a full-year nonemployment spell is 18.2% a year for the bottom 10% of earners, 5.8% for the median, and 0.8% for the top 10% (same, p. 2328).
  The model's layoff hazard is higher at Entry and lower at Top.

## 4. Risk: layoffs, unemployment, and the cost of job loss

### 4.1 How often layoffs happen

- **Displacement (the event the game calls "laid off"):** 7.4 million workers were displaced from jobs in 2023-2025, 3.3 million of them long-tenured, mostly because a position or shift was abolished (44.4%), a plant or company closed or moved (32.6%), or there was not enough work (22.9%) ([BLS Displaced Worker Survey, January 2026](https://www.bls.gov/news.release/disp.nr0.htm)).
  Against roughly 155-161 million jobs (OEWS counts 155.5 million), that is about 1.5-1.6% of jobs a year (our calculation), the model's base hazard.
- **By industry (JOLTS layoffs and discharges, annual average monthly rate, 2025):** total private 1.2%, construction 2.1%, professional and business services 2.0%, transportation, warehousing, and utilities 1.6%, leisure and hospitality 1.5%, information 1.3%, retail 1.1%, manufacturing 0.9%, health care and social assistance 0.7%, financial activities 0.6%, government 0.4% ([BLS JOLTS table 24](https://www.bls.gov/news.release/jolts.t24.htm)).
  JOLTS counts every layoff and firing including seasonal ones, so we use it only for the ratio to total private, not the level.
- **In recessions:** 15.4 million workers were displaced in 2007-09, up from 8.3 million in 2005-07 ([BLS DWS, August 2010](https://www.bls.gov/news.release/archives/disp_08262010.pdf)).
  If about half of that 3-year window was recession, the recession months ran at about 2.7x the normal rate (our calculation: (18x + 18) / 36 = 1.86 gives x = 2.7), which supports research 03's "layoffs x3 in a bear market".
- **Which industries are most cyclical (JOLTS 2009 vs 2007 annual averages, from FRED):** construction 1.64x, manufacturing 1.63x, transportation 1.56x, information 1.36x, financial activities 1.24x, total private 1.22x, health care 1.20x, government 1.15x, professional and business services 1.11x, retail 1.05x, leisure and hospitality 1.05x (FRED [JTU2300LDR](https://fred.stlouisfed.org/series/JTU2300LDR), [JTU3000LDR](https://fred.stlouisfed.org/series/JTU3000LDR), [JTU480099LDR](https://fred.stlouisfed.org/series/JTU480099LDR), [JTU5100LDR](https://fred.stlouisfed.org/series/JTU5100LDR), [JTU510099LDR](https://fred.stlouisfed.org/series/JTU510099LDR), [JTU1000LDR](https://fred.stlouisfed.org/series/JTU1000LDR), [JTU6200LDR](https://fred.stlouisfed.org/series/JTU6200LDR), [JTU9000LDR](https://fred.stlouisfed.org/series/JTU9000LDR), [JTU540099LDR](https://fred.stlouisfed.org/series/JTU540099LDR), [JTU4400LDR](https://fred.stlouisfed.org/series/JTU4400LDR), [JTU7000LDR](https://fred.stlouisfed.org/series/JTU7000LDR); annual means are our calculation).
  2020 was different: leisure and hospitality jumped from 1.8% to 6.8%, so a "Pandemic Plunge" template should hit food service and personal care hardest, not construction.

### 4.2 Layoff multipliers the model uses

Base multiplier = industry rate / total private rate (2025).
Bear multiplier = 3.0 x (industry's 2009/2007 ratio / total private's 1.22), clamped to 1.5-4.5, so the average stays at research 03's x3 while cyclical industries get more.

| JOLTS industry | Base (normal years) | Bear regime | Categories |
| --- | --- | --- | --- |
| Construction | 1.66 | 4.02 | construction |
| Professional and business services | 1.63 | 2.72 | engineering, science, legal, cleaning_grounds |
| Transportation and warehousing | 1.30 | 3.82 | transport |
| Leisure and hospitality | 1.22 | 2.57 | food_service, personal_care |
| Information | 1.05 | 3.33 | tech, arts_media |
| Total private | 1.00 | 3.00 | management, office_admin, farming, repair |
| Retail trade | 0.84 | 2.57 | sales_retail |
| Manufacturing | 0.72 | 4.00 | production |
| Health care | 0.56 | 2.94 | healthcare_pro, healthcare_support |
| Financial activities | 0.50 | 3.04 | business_finance |
| Government | 0.29 | 2.83 | education, protective, social_services |

The hazard also scales with level (Entry 1.5x, Mid 1.1x, Senior 0.9x, Lead 0.75x, Top 0.6x), a softened version of the Guvenen gradient in 3.4.
The AI Bubble Pop can add a template-specific bump for tech on top of the bear multiplier; that is a design choice, not something the data give us.

### 4.3 How long unemployment lasts

- In August 2026 the median spell was 11.4 weeks and the mean 26.3 weeks; in June 2010 they were 25.2 and 34.5 ([FRED UEMPMED](https://fred.stlouisfed.org/series/UEMPMED), [FRED UEMPMEAN](https://fred.stlouisfed.org/series/UEMPMEAN)).
  A lognormal with median 11.4 weeks and sigma 1.29 matches both the median and the 26-week mean (our fit); the bear version uses a 25.2-week median.
- Older workers take longer to land: in January 2026, 72.9% of long-tenured displaced workers aged 25-54 were re-employed, against 57.3% at 55-64 and 38.6% at 65+ ([BLS DWS 2026](https://www.bls.gov/news.release/disp.nr0.htm)).
  A later version can stretch spells after 55.
- The game already pays about 40% of take-home while unemployed (`UNEMPLOYMENT_SHARE` in `game/src/sim/life/player.ts`, from research 03); state UI maximums and a 26-week limit are a later refinement.

### 4.4 The cost of losing a job

- Men displaced in mass layoffs lose 1.4 years of pre-layoff earnings (present value over 20 years at 5%) when the unemployment rate is under 6%, and 2.8 years when it is above 8% ([Davis & von Wachter 2011, Brookings Papers](https://www.brookings.edu/bpea-articles/recessions-and-the-costs-of-job-loss), [NBER w17638](https://www.nber.org/papers/w17638)).
- About 49% of re-employed full-time displaced workers earned as much or more on the new job in January 2026, down from 62% in January 2024 ([BLS DWS 2026](https://www.bls.gov/news.release/disp.nr0.htm)).
- For high earners, drops are more persistent than gains (Guvenen et al.'s "butterfly pattern", p. 2321), so the model's re-employment pay cut is permanent, and promotions are 30% less likely for 3 years afterwards.

Model: the new job pays `exp(N(-0.05, 0.25))` times the old pay in normal times and `exp(N(-0.15, 0.25))` in a bear.
With the spell lengths above, the present-value loss is about 1.1 years of pay normally and 2.8 years in a bear (the check in `simulate_careers.py`), close to Davis and von Wachter.
About 42% of normal-time draws come out at or above the old pay, a bit under the DWS 49%, which is a fair trade for matching the bigger long-run loss.

## 5. Marital status

### 5.1 What the sim needs

Marriage changes household cash flow, not the player's own career.
The sim needs: whether there is a spouse, the spouse's gross pay and employment, and whether the spouse has their own layoff risk.
Taxes need it too: married filing jointly has a $32,200 standard deduction in 2026 and different brackets (research 02).

### 5.2 Data for a default spouse

- Both spouses were employed in 49.1% of all married-couple families in 2025, a figure that includes retirees ([BLS Employment Characteristics of Families 2025](https://www.bls.gov/news.release/famee.nr0.htm)).
  Among married couples with children, both parents worked in 66.3%, only the father in 26.4%, only the mother in 4.8%, and neither in 2.6% ([BLS TED, 2026](https://www.bls.gov/opub/ted/2026/among-married-couple-families-with-children-97-4-percent-had-at-least-one-employed-parent-in-2025.htm)).
- In 2022, 29% of opposite-sex marriages were egalitarian (each spouse earning 40-60% of the couple's pay), 55% had the husband as primary or sole earner, and 16% the wife ([Pew Research Center 2023](https://www.pewresearch.org/social-trends/2023/04/13/in-a-growing-share-of-u-s-marriages-husbands-and-wives-earn-about-the-same/)).
- Spouses' earnings have become more correlated over time, which widens household inequality ([Schwartz 2010, American Journal of Sociology](https://www.journals.uchicago.edu/doi/10.1086/651373)); we did not find a single current correlation figure we trust, so the model's 0.3 below is an assumption.

### 5.3 Recommendation

- Onboarding asks "Is your spouse working?" and, if yes, "About how much do they make?" (optional), with a category picker hidden behind "more detail".
- If the player skips it, draw a default: employed with probability 0.66 (couples of working age, the with-children figure), category "all occupations", and a percentile in the state's all-occupations distribution that is correlated 0.3 with the player's own (assumption).
- The spouse runs the same yearly career model with their own seed stream, so a two-income household shows its real benefit: one layoff does not zero the income.
- A marriage event mid-game creates a spouse the same way; divorce removes them and splits assets by the prenup choice (meeting decision).

## 6. Proposed model

### 6.1 Data to ship

One JSON file generated from [data/jobs/jobs-oews.json](data/jobs/jobs-oews.json) plus the parameters in [data/jobs/simulate_careers.py](data/jobs/simulate_careers.py), imported statically like `states.ts`:

```json
{
  "source": "BLS OEWS May 2025; JOLTS 2007/2009/2025; DWS 2026; see research/11",
  "allOccupations": { "p10": 31200, "p25": 37590, "p50": 50980, "p75": 80520, "p90": 128560 },
  "categories": [
    {
      "id": "tech",
      "label": "Software, IT, and data",
      "soc": "15-0000",
      "examples": "Software developer, IT support, data scientist",
      "keywords": ["developer", "engineer", "it", "data", "programmer"],
      "wages": { "p10": 58200, "p25": 78820, "p50": 109280, "p75": 155830, "p90": 191450 },
      "anchor": { "title": "Software developers", "p50": 135980 },
      "ladder": 0.490,
      "layoff": { "base": 1.05, "bear": 3.33 }
    }
  ],
  "stateWageIndex": { "TX": 0.954, "OH": 0.969, "FL": 0.939, "CA": 1.142 },
  "params": {
    "inflation": 0.025, "meritReal": 0.008,
    "perf": [[0.20, 1.7], [0.60, 1.0], [0.15, 0.5], [0.05, 0.0]],
    "promoHazard": 0.10, "promoRaise": [0.06, 0.15],
    "promoAgeMult": [[30, 1.5], [40, 1.0], [50, 0.6], [200, 0.3]],
    "switchHazard": [[30, 0.18], [40, 0.12], [55, 0.07], [200, 0.04]],
    "switchBump": [0.03, 0.08],
    "ageDrift": [[30, 0.0], [40, -0.002], [50, -0.008], [60, -0.012], [200, -0.015]],
    "careerWeights": [[35, 1.0], [45, 0.5], [200, 0.0]],
    "ceilingPct": 90,
    "layoffBase": 0.0153,
    "layoffLevelMult": { "entry": 1.5, "mid": 1.1, "senior": 0.9, "lead": 0.75, "top": 0.6 },
    "spellMedianWeeks": { "bull": 11.4, "bear": 25.2 }, "spellSigma": 1.29,
    "reemployLog": { "bull": [-0.05, 0.25], "bear": [-0.15, 0.25] },
    "bearMarketRaiseCut": 0.5
  }
}
```

`ladder` is `ln(p75 / p25)` of the anchor occupation.
Estimated size: under 15 KB.

### 6.2 Level inference at onboarding

```
nationalSalary = grossSalary / stateWageIndex[state]           // DC clamped to 1.3
pct            = interpolate(category.wages, nationalSalary)   // log-linear, 1..99.5
level          = band(pct)                                     // entry, mid, senior, lead, top
ageNote        = pct - expectedPctForAge(age)                  // > +15 "ahead", < -15 "early in career"
```

What the player sees:

```
You earn more than about 43% of US software, IT, and data workers (after adjusting for Texas pay).
Level: Mid.
For 24, that's ahead of the curve.
```

Let the player bump the level one step either way if it feels wrong, which only moves the starting percentile to the middle of the chosen band's range; their salary stays what they entered.

### 6.3 Yearly progression (seeded)

Once a year on the player's review date (the hire anniversary, or January 1 if unknown), in real terms, with nominal pay = real x the game's price index:

1. **Layoff check** (runs daily in the game as `dailyProb = 1 - (1 - annual)^(1/365)`, per the meeting's conversion rule): `annual = layoffBase x category.layoff.base x levelMult x (bear ? category.layoff.bear : 1)`.
   On a layoff: draw the spell in weeks, pay unemployment benefits, then re-employ at `exp(N(mu, 0.25))` times the old pay and set a 3-year promotion scar.
2. **Merit raise:** draw a performance tier; `raise = (inflation + meritReal) x tierMult`, halved in a bear year.
3. **Promotion:** with probability `promoHazard x promoAgeMult(age)` (halved in a bear, x0.7 while scarred, zero at the Top level), add a raise of `U(6%, 15%)`.
4. **Otherwise a voluntary switch:** with probability `switchHazard(age)` (x0.4 in a bear), add `N(3%, 8%)`.
   In the full game this is an offer the player accepts or declines, not an automatic switch (section 6.6).
5. **Drift:** `ageDrift(age)` plus, below the ceiling, the career term `(ladder - 0.336) / 15 x careerWeight(age)`, where 0.336 is the median log growth the events above already deliver from 25 to 45 and 15 is the sum of the age weights over 25-44 (both computed in the script).
   At the ceiling (p90), subtract 0.5 points a year instead: the plateau.
6. Recompute percentile and level, recompute take-home with the tax function, and emit events.

All draws are keyed by `(seed, "career", year, kind)` (spell and re-employment draws by the layoff date), so a rewind that changes a spending decision replays the same raises and layoffs (the meeting's rewind rule).
A move to another state changes pay by the ratio of wage indexes for a new local job, or not at all for a remote one, as in research 02.

### 6.4 Calibration (from `simulate_careers.py`, 1,000-3,000 seeds per row)

| Check | Target | Model |
| --- | --- | --- |
| Median real growth, office/admin worker, 25 to 55 | +60% (Guvenen, all men) | +47% |
| Median real growth 25 to 45, each category vs its ladder | Anchor p75/p25 | Within 0.03x for all 22 (software 1.63 target, 1.66 model; nursing 1.40 vs 1.42; food service 1.31 vs 1.32; management 2.31 vs 2.31) |
| Real growth 45 to 65 | CPS: about -4% from 45-54 to 55-64 | -5% to +5% by category |
| Spread at 55 (software, starting at p25) | Guvenen: wide and left-skewed | p10 1.25x, median 1.69x, p90 1.99x |
| Present-value cost of a layoff | DvW: 1.4 years (unemployment under 6%), 2.8 (over 8%) | 1.1 normal, 2.8 bear |
| Bear-market layoff multiplier, average | Research 03: x3; DWS 2007-09: about 2.7x | 3.0 (2.57-4.02 by industry) |

The model's late-career line is flatter than the Guvenen within-person decline, because the cross-section and the budgets both point to a flat 45-65; tune `ageDrift` after 50 if playtesting says late careers feel too comfortable.

### 6.5 Worked examples (40 years or until 67, real 2026 dollars)

Bear-regime years in these runs: year 3 (standing in for the AI Bubble Pop) and years 17-18 (a generic bear).
Outcome ranges are over 2,000 seeds; the "one life" rows are seed 7, in [data/jobs/worked-examples.json](data/jobs/worked-examples.json).
Nominal pay is about 2.7 times the real figure after 40 years at 2.5% inflation.

**1. Software developer, 24, Texas, $95,000.**

- Onboarding: national equivalent $99,581 (Texas index 0.954), 43rd percentile of software, IT, and data workers, level Mid; a typical 24-year-old sits near the 22nd, so "ahead of the curve".
- Outcomes at 64: median $152,693 real (p10 $100,395, p90 $189,043); median peak age 50; 49.5% are laid off at least once.
- One life (seed 7): promoted at 26 (+12%) and reaches Senior by 29; switches jobs at 29, 31, and 34 for small pay changes (-4% to -1%, the "switching is not magic" lesson); promoted at 33 (+14%) and 36 (+11%); Lead by 39 at $166,067; plateaus at $166-172k through his 40s and 50s; laid off at 57 in a normal year, re-employed after 2 weeks at 20% less ($136,874), and ends at $133,213 at 64.
- Lesson the game can draw: the big raises come before 40, and a late-career layoff with no cushion right before retirement is the most expensive kind.

**2. Registered nurse, 35, Ohio, $88,000.**

- Onboarding: national equivalent $90,815 (Ohio 0.969), 53rd percentile of healthcare professionals, level Senior; about average for 35.
- Outcomes at 66: median $94,212 real (p10 $73,973, p90 $125,677); median peak age 50; 25.6% laid off at least once (health care's layoff rate is 0.56x the private average).
- One life (seed 7): flat pay for five years (merit only just beats inflation), a job switch at 41 (+13%), promotions at 47 (+11%) and 48 (+10%) to Lead at $120,247 by 50, then a gentle drift to $114,967 at 65.
- Lesson: nursing is a flat ladder with very steady employment; wealth comes from savings rate, not raises.

**3. Retail store manager, 45, Florida, $58,000.**

- Onboarding: national equivalent $61,768 (Florida 0.939), 75th percentile of sales and retail workers, level Lead; above typical for 45.
- Outcomes at 66: median $55,817 real (p10 $45,095, p90 $68,323); median peak age 52; 24.3% laid off at least once.
- One life (seed 7): no promotions or switches, merit raises roughly equal to inflation, and a slow real decline: $55,203 at 50, $52,374 at 60, $48,810 at 65.
- Lesson: after 45 the paycheck stops growing in real terms for most people, so a late start on retirement saving cannot count on raises to catch up.

### 6.6 How it plugs into PlayerLife

Today `PlayerLife` (`game/src/sim/life/player.ts`) holds `monthlyTakeHome`, a fixed `age`, `employed`, and `setEmployed()`, and pays 40% while unemployed.
Research 10 already lists gross salary and a birth date as missing.
Additions:

```ts
interface CareerState {
  categoryId: string;
  grossAnnual: number;          // nominal, drives taxes, 401(k) match, 28/36, wellbeing real income
  pct: number;                  // category percentile, national-equivalent
  level: "entry" | "mid" | "senior" | "lead" | "top";
  reviewMonthDay: [number, number];   // raise date; a scheduled blue circle on the calendar
  hiredDay: number;
  scarYearsLeft: number;
  unemployedUntilDay?: number;  // set by a layoff; re-employment happens on this day
  remote: boolean;              // moving keeps pay if true (research 02)
}

interface Spouse { career: CareerState | null; employed: boolean }

// LifeOptions gains: birthDate, grossAnnual, categoryId, maritalStatus, spouse?
// LifeEvent gains:
//   { type: "raise"; day; pct; newGross; tier }
//   { type: "promotion"; day; bump; level }
//   { type: "job_offer"; day; bump }          // player decides; auto-accepted during skips by research 10's rule
//   { type: "layoff"; day; weeks }            // reuses setEmployed(false)
//   { type: "reemployed"; day; change }       // setEmployed(true), new grossAnnual
```

- `age` becomes a getter from `birthDate` and the game date.
- `onDay` checks the layoff hazard daily (with the market regime from research 03), and on the review date runs steps 2-6.
- `monthlyTakeHome` is recomputed from `grossAnnual` with research 02's tax function whenever pay changes, including married-filing-jointly when there is a spouse; the debt book's take-home stays in sync as it does now.
- The review date is scheduled, so it is circled on the calendar and is a valid "skip to next event" stop; layoffs stay hidden until they happen (meeting rule).
- Research 10's skip rules already cover these events: raises feed "share of each raise saved", a better offer is taken if it pays more in the same state, and a layoff interrupts at the default "Big life moments" level.
- The wellbeing meter (research 09) gets its missing inputs: gross salary for real income, and months since re-employment for the Work factor.

### 6.7 Hackathon version vs later

Minimal (a few hours):

- Ship the 22-category JSON with p10-p90, the state wage index, and the layoff multipliers.
- Onboarding: category tiles with example titles, the percentile sentence, and the level badge.
- A yearly tick: merit raise (single 3.3% budget, three performance tiers), a 10% promotion coin flip with +10%, and the daily layoff hazard with the bear multiplier; a fixed 12-week spell and a -5% re-employment cut.
- Age follows the calendar; take-home is recomputed on raise.
- Spouse: a fixed income the player enters, no career of its own.

Later:

- The career ladder drift, the plateau at p90, and late-career drift (the full calibrated model in the script).
- Job offers as decisions (accept, decline, negotiate), and a "switching is not magic" coach tip.
- Per-state category medians (free BLS v2 key) and metro wages for the city.
- Education level as an input, and a career change option (retrain into another category with a pay cut and a new ladder).
- Spouse careers, a marriage and divorce flow tied to the prenup, and unemployment insurance by state.
- Part-time, gig, and self-employed income, which OEWS does not cover.

## Sources

- Occupations and wages: [BLS OEWS](https://www.bls.gov/oes/), [OEWS May 2025 release](https://www.bls.gov/news.release/ocwage.htm), [OEWS tables](https://www.bls.gov/oes/tables.htm), [BLS Public API](https://www.bls.gov/developers/), [BLS series ID formats](https://www.bls.gov/help/hlpforma.htm#OE), [SOC 2018 major groups](https://www.bls.gov/soc/2018/major_groups.htm)
- Earnings by age: [BLS Usual Weekly Earnings, table 3, Q2 2026](https://www.bls.gov/news.release/wkyeng.t03.htm)
- Life-cycle earnings: [Guvenen, Karahan, Ozkan & Song 2021, Econometrica](https://doi.org/10.3982/ECTA14603) ([PDF](https://static1.squarespace.com/static/6246570e617f1d3daf55e1c1/t/628e6309b2e01e636b2ee9b3/1653498634356/guvenen-karahan-ozkan-song-econometrica-2021.pdf))
- Early vs mid-career pay by major: [NY Fed, The Labor Market for Recent College Graduates](https://www.newyorkfed.org/research/college-labor-market), [Sallie compilation of the NY Fed figures](https://www.sallie.com/colleges/majors/highest-paying)
- Raises: [WorldatWork on WTW 2026](https://worldatwork.org/publications/workspan-daily/wtw-poll-reflects-2026-salary-budget-stability-3-4-increases-planned), [WorldatWork on Mercer 2026](https://worldatwork.org/publications/workspan-daily/mercer-forecasts-3-5-total-salary-increase-budgets-for-2026), [Mercer newsroom](https://www.mercer.com/en-us/about/newsroom/most-us-employers-plan-to-keep-2026-salary-increases-flat/), [WorldatWork on Payscale 2026](https://worldatwork.org/publications/workspan-daily/payscale-u-s-employers-forecast-3-5-pay-increases-for-2026), [HR Dive on Mercer 2025 (performance tiers, promotions)](https://www.hrdive.com/news/2025-raises-lower-than-expected/747142/), [Ravio on promotion raises](https://ravio.com/blog/average-promotion-rate)
- Wage growth: [Atlanta Fed Wage Growth Tracker](https://www.atlantafed.org/chcs/wage-growth-tracker), FRED [stayers](https://fred.stlouisfed.org/series/FRBATLWGT12MMUMHWGJST), [switchers](https://fred.stlouisfed.org/series/FRBATLWGT12MMUMHWGJSW), [16-24](https://fred.stlouisfed.org/series/FRBATLWGT12MMUMHWGA1644Y), [25-54](https://fred.stlouisfed.org/series/FRBATLWGT12MMUMHWGA2554Y), [55+](https://fred.stlouisfed.org/series/FRBATLWGT12MMUMHWG55O)
- Tenure: [BLS Employee Tenure, January 2024](https://www.bls.gov/news.release/archives/tenure_09262024.htm)
- Layoffs: [BLS JOLTS table 24](https://www.bls.gov/news.release/jolts.t24.htm), FRED JOLTS series linked in 4.1, [BLS Displaced Worker Survey 2026](https://www.bls.gov/news.release/disp.nr0.htm), [BLS DWS 2010](https://www.bls.gov/news.release/archives/disp_08262010.pdf)
- Unemployment duration: [FRED UEMPMED](https://fred.stlouisfed.org/series/UEMPMED), [FRED UEMPMEAN](https://fred.stlouisfed.org/series/UEMPMEAN)
- Cost of job loss: [Davis & von Wachter 2011, Brookings](https://www.brookings.edu/bpea-articles/recessions-and-the-costs-of-job-loss), [NBER w17638](https://www.nber.org/papers/w17638)
- Couples: [BLS Employment Characteristics of Families 2025](https://www.bls.gov/news.release/famee.nr0.htm), [BLS TED on married couples with children](https://www.bls.gov/opub/ted/2026/among-married-couple-families-with-children-97-4-percent-had-at-least-one-employed-parent-in-2025.htm), [Pew 2023](https://www.pewresearch.org/social-trends/2023/04/13/in-a-growing-share-of-u-s-marriages-husbands-and-wives-earn-about-the-same/), [Schwartz 2010, AJS](https://www.journals.uchicago.edu/doi/10.1086/651373)
- Game data: [data/jobs/build_jobs.py](data/jobs/build_jobs.py), [data/jobs/jobs-oews.json](data/jobs/jobs-oews.json), [data/jobs/simulate_careers.py](data/jobs/simulate_careers.py), [data/jobs/worked-examples.json](data/jobs/worked-examples.json), [data/states-rpp.json](data/states-rpp.json) (BEA RPP 2024)

## Open questions for the team

1. Are 22 category tiles too many for onboarding, or do we show 8-10 common ones plus search?
2. Should onboarding also ask for education level (it strongly shapes the ladder in the NY Fed and Guvenen data), or keep to the five inputs already decided?
3. Can the player override the inferred level, and does that change anything beyond the label and starting percentile?
4. Are job offers a decision for the player (accept, decline, negotiate) or automatic, outside of skips where research 10's rule applies?
5. Does the AI Bubble Pop hit tech harder than the generic bear multiplier (3.33x), and by how much?
6. For a married player, do we ask the spouse's income, draw it, or let the player choose "single-income household" as a scenario?
7. Is retirement always at 67, or does onboarding ask for a target age (which also changes how long the career model runs)?
8. Do we want the per-state category wages now (needs a free BLS v2 key for about 1,100 series), or is the single state wage index good enough for the demo?
9. Do we show pay in today's dollars or nominal dollars in the HUD, given 40 years of 2.5% inflation almost triples the nominal numbers?
10. Is the flat late-career curve right for the game's tone, or should late careers carry more risk (older workers are re-employed far less often: 57% at 55-64 vs 73% at 25-54)?
