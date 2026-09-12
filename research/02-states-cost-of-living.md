# 02 - Multi-State Map and Cost of Living

Research for Larp City's state map, where players move between US states and each move changes rent, taxes, prices, and pay.
Researched 2026-09-11.
All numbers below were checked against the live source on that date unless marked as derived or assumed.

## TL;DR

- Use **BEA Regional Price Parities (RPP)** as the single "how expensive is this state" index, and back it with a few concrete line items (rent, home price, groceries, fuel, electricity, health premium, taxes).
- Every field for all 50 states + DC can be filled from **free, public, keyless or free-key sources**: BEA/FRED, Census ACS, BLS OEWS, Zillow Research CSVs, Tax Foundation tables, EIA, KFF, and AAA.
- **Do not call APIs at runtime.**
  Precompute one static `states.json` (about 50 KB) at build time, commit it, and import it into the Vite bundle.
- Write our own ~60-line tax function (federal brackets + FICA + state brackets) instead of pulling in a tax library.
  The sample build script already does this: [data/build_states_sample.py](data/build_states_sample.py).
- A working 5-state sample with real numbers is in [data/states-sample.json](data/states-sample.json) (CA, TX, NY, FL, OH).
- The headline lesson the data supports: a higher salary does not always mean more money.
  On the same $100k remote salary, Ohio leaves you about $14,600 more per year after taxes and rent than California.

## 1. Data sources

| Source | What it gives | Granularity | Cadence | Format / access | Key? | License |
| --- | --- | --- | --- | --- | --- | --- |
| [BEA Regional Price Parities](https://www.bea.gov/data/prices-inflation/regional-price-parities-state-and-metro-area) | Price level index (US = 100) for all items, goods, rents, other services | State, metro (MSA), nonmetro portion | Annual, ~14 month lag (2024 data released [2026-02-19](https://bea.gov/news/2026/real-personal-consumption-expenditures-state-and-real-personal-income-state-2024)) | BEA API (free key) or [FRED](https://fred.stlouisfed.org/release/tables?eid=233639&rid=403) CSV with no key (`fredgraph.csv?id=CARPPALL`) | FRED CSV: no | US government, public domain |
| [Census ACS](https://www.census.gov/data/developers/data-sets/acs-1year.html) | Median gross rent (B25064), rent by bedrooms (B25031), median home value (B25077), median household income (B19013), median real estate taxes (B25103) | State, county, metro, place | Annual (2024 1-year is latest) | Census API needs a free key as of now (keyless requests return `X-DataWebAPI-KeyError`); [Census Reporter API](https://api.censusreporter.org/1.0/data/show/latest?table_ids=B25064&geo_ids=04000US06) works with no key | Census: yes (free); Census Reporter: no | Public domain |
| [HUD Fair Market Rents API](https://www.huduser.gov/portal/dataset/fmr-api.html) | FMR for 0-4 bedroom units (40th percentile of recent-mover rents) | County, metro, ZIP (SAFMR); state listing | Annual (FY2026 current) | REST JSON, `Authorization: Bearer` token, 60 req/min | Yes (free) | Public domain |
| [Zillow Research](https://www.zillow.com/research/data/) ZORI / ZHVI | Typical market rent (ZORI) and typical home value (ZHVI), monthly | Nation, state (ZHVI), metro, county, city, ZIP | Monthly (July 2026 data is live) | Direct CSV downloads, no API | No | Free for public use [with attribution to Zillow](https://www.zillow.com/research/data/) |
| [BLS OEWS](https://www.bls.gov/oes/current/oessrcst.htm) | Employment and mean / percentile wages for ~830 occupations | Nation, state, ~530 metro/nonmetro areas | Annual (May 2025 estimates released [2026-05-15](https://www.bls.gov/news.release/ocwage.htm)) | [BLS Public API](https://www.bls.gov/developers/) v1 (no key, 25 series/request, 25 requests/day) or v2 (free key, 500/day); bls.gov HTML blocks scripted downloads | v1: no | Public domain |
| [BLS CPI](https://www.bls.gov/cpi/regional-resources.htm) | Inflation by region and ~23 large metros | 4 Census regions, large metros | Monthly | BLS API | No (v1) | Public domain; useful for a yearly "prices rise" tick, not for state levels |
| [MIT Living Wage Calculator](https://livingwage.mit.edu/) | Living wage and a full budget (food, child care, medical, housing, transport) by family type | County, metro, state | Annual (updated 2026-02-15) | Web only | n/a | [No scraping above 10 locations](https://livingwage.mit.edu/pages/faqs); 51 states needs a license request. Good for spot-checking, not for our dataset |
| [EPI Family Budget Calculator](https://www.epi.org/resources/budget/) | Monthly budget for 10 family types, all 3,142 counties and 611 metros | County, metro | Annual (2025 update) | Web + downloadable data | No | Citable; [methodology](https://www.epi.org/publication/family-budget-calculator-documentation/) is a good template for our own category list |
| [C2ER Cost of Living Index](https://www.coli.org/) | Price comparisons of ~300 urban areas, item-level | Urban area | Quarterly | Paid: [$180-$300/year](https://www.coli.org/) | n/a | Paid and restrictive; skip |
| [USDA Food Plans](https://www.fna.usda.gov/research/cnpp/usda-food-plans/cost-food-monthly-reports) | Monthly grocery cost by age/sex, Thrifty to Liberal plans | National only (plus AK/HI) | Monthly | PDF | No | Public domain; scale by BEA goods RPP for per-state groceries |
| [KFF State Health Facts](https://www.kff.org/affordable-care-act/state-indicator/marketplace-average-benchmark-premiums/) | 2026 ACA benchmark (second-lowest silver) premium, age 40 | State | Annual | Web table, CSV download | No | Citable with attribution |
| [EIA electricity Table 5A](https://www.eia.gov/electricity/sales_revenue_price/pdf/table_5A.pdf) | Average monthly residential bill, kWh, price | State | Annual (2024) | PDF/XLS, or [EIA API](https://www.eia.gov/opendata/) (free key) | PDF: no | Public domain |
| [AAA gas prices](https://gasprices.aaa.com/state-gas-price-averages/) | Regular/mid/premium/diesel by state | State, some metros | Daily | Web page | No | Fine to cite; snapshot once. [EIA weekly](https://www.eia.gov/petroleum/gasdiesel/) is public domain but only covers 9 states |
| [Tax Foundation](https://taxfoundation.org/data/all/state/state-income-tax-rates-2026/) | 2026 state income tax brackets, sales tax, property tax | State (+ county for property) | Annual / midyear | Web tables | No | Citable with attribution |

Recommendation: the minimal source set is **FRED (RPP) + Census Reporter (ACS) + Zillow CSV + BLS API v1 + Tax Foundation + KFF + EIA + AAA**.
Every one of these was fetched successfully with no key while writing this doc.

## 2. Taxes

### Federal (2026, single filer)

- Brackets from [Tax Foundation](https://taxfoundation.org/data/all/federal/2026-tax-brackets/): 10% to $12,400, 12% to $50,400, 22% to $105,700, 24% to $201,775, 32% to $256,225, 35% to $640,600, 37% above.
- Standard deduction: $16,100 single, $32,200 married filing jointly.
- FICA: 6.2% Social Security up to the [2026 wage base of $184,500](https://payroll.org/news-resources/news/news-detail/2025/10/24/social-security-wage-base-increases-to-$184-500-for-2026), plus 1.45% Medicare on everything and an extra 0.9% above $200,000.

### State income tax

- Per [Tax Foundation 2026](https://taxfoundation.org/data/all/state/state-income-tax-rates-2026/), 41 states tax wages: 15 flat and 26 graduated plus DC.
- **Nine states have no wage income tax**: Alaska, Florida, Nevada, New Hampshire, South Dakota, Tennessee, Texas, Washington (taxes capital gains only), and Wyoming.
- Rates run from Hawaii's 1.4% bottom bracket to California's 13.3% top bracket.
- 2026 changes worth knowing: Ohio became a flat 2.75% tax on income above $26,050, and eight states cut rates on Jan 1 ([Tax Foundation](https://taxfoundation.org/research/all/state/2026-state-tax-changes/)).
- Local income taxes (NYC, most Ohio cities, Pennsylvania municipalities, some Maryland counties) are real but can be skipped in the MVP and mentioned in a tooltip.

### Sales tax

- Use the combined state + average local rate from [Tax Foundation midyear 2026](https://taxfoundation.org/data/all/state/2026-sales-tax-rates-midyear/).
- The national population-weighted average is 7.53%.
- Louisiana (10.13%) is the highest, and Alaska, Delaware, Montana, New Hampshire, and Oregon have no statewide sales tax.
- In-game, apply it as a multiplier on "goods" spending (groceries are exempt in many states, so either skip groceries or flag the exemption per state).

### Property tax

- Tax Foundation's [2026 table](https://taxfoundation.org/data/all/state/property-taxes-by-state-county/) is built from ACS 2024: median real estate taxes paid divided by median home value.
- We can reproduce it directly from ACS B25103 / B25077, which is what the sample does.
- Extremes: New Jersey and Illinois at 1.88%, Hawaii at 0.29%.

### Tax libraries

- [PolicyEngine US](https://github.com/PolicyEngine) (Python, open source) models federal and all 51 state income taxes plus benefits and is the most accurate option.
  It is heavy (a microsimulation engine), so use it offline to validate our numbers, not in the browser.
- [PSLmodels Tax-Calculator](https://github.com/PSLmodels/Tax-Calculator) is federal only.
- [aws-samples/sample-tax-return-calculator](https://github.com/aws-samples/sample-tax-return-calculator) is a TypeScript federal + state estimator, but it is a sample repo, so check its coverage before relying on it.
- **Recommendation:** implement brackets ourselves.
  Brackets + standard deduction + FICA is ~60 lines and handles 95% of what the game needs.
  Store brackets in the JSON so the same code handles every state, and optionally spot-check a few incomes against PolicyEngine's [web calculator](https://www.policyengine.org/us).

## 3. Wages by state

BLS OEWS May 2025 annual mean wages, fetched from the BLS API (series `OEUS{FIPS}00000000000{SOC}04`):

| Occupation (SOC) | US | CA | TX | NY | FL | OH |
| --- | --- | --- | --- | --- | --- | --- |
| Software developer (15-1252) | 148,100 | 186,770 | 136,450 | 163,820 | 137,010 | 119,860 |
| Registered nurse (29-1141) | 101,420 | 150,280 | 95,380 | 113,440 | 90,650 | 87,730 |
| Elementary teacher (25-2021) | 72,650 | 95,670 | 61,890 | 93,400 | 59,530 | 72,740 |
| Accountant (13-2011) | 94,750 | 103,760 | 90,370 | 114,070 | 88,210 | 88,280 |
| Retail salesperson (41-2031) | 37,310 | 42,950 | 34,050 | 42,580 | 36,000 | 34,580 |
| Fast food cook (35-3023) | 32,150 | 41,680 | 27,750 | 36,920 | 30,940 | 28,900 |

How the game should model jobs when moving:

- **Local job**: the salary is set by the destination state.
  `new_salary = oews[state][occupation]`, optionally scaled by the player's percentile within the occupation (OEWS also publishes 10th/25th/median/75th/90th percentiles).
  Moving means quitting and job hunting: 2-8 weeks of no paycheck, with a probability per week of landing the offer.
- **Transfer within the same employer**: salary is re-banded by location, as big employers really do.
  Model it as `salary * (dest_band / origin_band)`, where the band is the OEWS ratio for that occupation between the two states, not RPP.
- **Remote job**: salary stays fixed when you move (or gets a small location-based cut, which is a fun event: "Your employer is adjusting pay for your new location, -10%").
  This is the "geo-arbitrage" lesson: keep a coastal salary and take on inland costs.
- **Minimum wage jobs** should use each state's minimum wage (a small extra table from the [DOL](https://www.dol.gov/agencies/whd/minimum-wage/state)) so low-wage NPCs feel the state difference too.

## 4. Moving costs and friction

Teleporting must cost money and time, or players will state-hop for free.

- **Movers**: the typical interstate move is about [$4,300-$4,500](https://www.retirementliving.com/how-much-do-long-distance-movers-cost), with a range of $2,000 to $15,000 by distance and home size.
  Game rule: $1,500 for a studio or 1BR DIY truck, $4,500 for a 2-3BR full-service move, and +$1,000 for coast to coast.
- **Housing turnover**: the first month's rent plus a security deposit (usually one month) at the destination, paid up front.
  Breaking a lease at the origin usually costs 1-2 months of rent; the deposit comes back a few weeks later, minus damage.
- **Buying and selling a home**: selling costs about 6-8% of the price (agent commission + closing), and buying needs a down payment + 2-5% closing costs.
  This makes homeowners much less mobile than renters, which is a good lesson.
- **Time off**: 1 week unpaid for the move itself, plus a job search gap if the job is not remote or a transfer.
- **Car and paperwork**: new driver's license, registration, and title fees (about $100-$400 depending on state) and a car insurance re-quote.
- **Taxes**: in the year you move you file part-year returns in both states, which the game can simplify by prorating each state's tax by weeks lived there.
- **Social cost**: optionally a temporary "homesick" morale dip or losing a local side gig.

Suggested in-game formula:

```
move_cost = movers(home_size, distance) + dest_rent_1mo + dest_deposit
          + origin_lease_break + dmv_fees + unpaid_weeks * weekly_pay
```

Show the player this breakdown before they confirm the teleport.
The confirmation screen itself is a teaching moment.

## 5. Game data model

### Shape of each state record

This is what [data/states-sample.json](data/states-sample.json) contains per state:

```json
{
  "abbr": "TX", "name": "Texas", "fips": "48", "representative_metro": "Houston, TX",
  "rpp": { "all_items": 97.057, "goods": 98.083, "rents": 96.503, "other_services": 97.081 },
  "housing": {
    "rent_median": 1475, "rent_1br": 1307, "rent_2br": 1475, "rent_metro_typical": 1654,
    "home_price_median": 313200, "home_value_typical_zhvi": 301806,
    "property_tax_effective_rate": 0.0131, "property_tax_median_annual": 4108
  },
  "living": {
    "groceries_weekly": 75, "fuel_weekly": 36, "gas_price_per_gallon": 3.847,
    "utilities_monthly_electric": 163.72, "healthcare_monthly_unsubsidized": 661
  },
  "taxes": {
    "income_tax": { "type": "none" },
    "sales_tax_pct": { "state": 6.25, "local_avg": 1.95, "combined": 8.2 }
  },
  "income": {
    "median_household": 79721,
    "annual_mean_wage": { "software_developer": 136450, "registered_nurse": 95380, "...": 0 }
  },
  "notes": ["No income tax, but property tax is high (about 1.31% effective)."]
}
```

The file also has a top-level `federal` block (2026 brackets, standard deduction, FICA), a `national` block (US baselines), and a `sources` map that names the source for each field, which the UI can show as a "where does this number come from" tooltip.

### Field-to-source mapping

| Field | Source | Notes |
| --- | --- | --- |
| `rpp.*` | BEA RPP 2024 via FRED `{ST}RPPALL`, `{ST}RPPGOOD`, `{ST}RPPSERVERENT`, `{ST}RPPSERVEOTH` | The fallback multiplier for any cost we do not model explicitly |
| `rent_median`, `rent_1br`, `rent_2br` | ACS 2024 B25064, B25031 | These are what current renters pay, including long-time tenants, so they run below market asking rents |
| `rent_metro_typical` | Zillow ZORI, metro | Closer to what a new mover pays. Use this for "you just moved here" rent, and ACS for long-time NPCs |
| `home_price_median`, `home_value_typical_zhvi` | ACS B25077 / Zillow ZHVI state | ZHVI is monthly and current; ACS is a year old but official |
| `property_tax_effective_rate` | ACS B25103 / B25077 | Same method as Tax Foundation |
| `groceries_weekly` | USDA Thrifty plan single adult (~$327/mo) x goods RPP | Derived |
| `fuel_weekly` | 12,000 mi/yr at 25 mpg x AAA state price | Derived; the mileage is a game assumption |
| `utilities_monthly_electric` | EIA 2024 Table 5A | Add a flat internet/phone line item (~$120) nationally |
| `healthcare_monthly_unsubsidized` | KFF 2026 benchmark silver premium, age 40 | Full sticker price for someone without employer coverage. NPCs with employer coverage should pay a much smaller employee share instead |
| `income_tax` | Tax Foundation 2026 | Brackets as `[floor, rate]` pairs; types `none`, `flat_above_threshold`, `graduated` |
| `sales_tax_pct` | Tax Foundation midyear 2026 | |
| `annual_mean_wage` | BLS OEWS May 2025 | 6 occupations in the sample; 10-15 is plenty for the full game |
| `median_household` | ACS B19013 | Used for context ("you earn 1.4x the local median") |

### Build-time precompute

1. A script (`scripts/build-states.ts` or the existing Python [build_states_sample.py](data/build_states_sample.py) generalized) loops over the 51 FIPS codes.
2. It fetches FRED CSVs (204 small requests), one Census Reporter call per batch of states, the Zillow state/metro CSVs (two downloads), and two BLS API v1 calls per ~25 series.
   For 51 states x 10 occupations = 510 series, use the free BLS v2 key (50 series/request) to stay under the daily limit.
3. Tax Foundation, KFF, EIA, and AAA tables are small: paste each into a checked-in CSV once (`taxes-2026.csv`, `premiums-2026.csv`, and so on) instead of scraping.
4. The script joins everything, computes derived fields, validates (no nulls, rents within sane bounds, brackets ascending), and writes `src/data/states.json`.
5. Commit the output.
   The game imports it statically, so the demo works offline and never hits a rate limit on stage.
6. Pick one `representative_metro` per state (largest metro) for the ZORI rent and, as a stretch, add a `metros` array for states where the city differs a lot from the state (NYC vs upstate New York).

## 6. Sample results (from the real numbers)

All figures come from running [build_states_sample.py](data/build_states_sample.py) on the sample data: single filer, 2026 federal + state tax, before any local income tax, CA SDI, or retirement contributions.

### Same $100k remote salary, different states

| State | Federal | FICA | State | Take-home | After 12 months of 1BR rent (ACS) | Take-home in "US-average dollars" (/ RPP) |
| --- | --- | --- | --- | --- | --- | --- |
| CA | 13,170 | 7,650 | 5,070 | 74,110 | 52,090 | 66,935 |
| NY | 13,170 | 7,650 | 4,860 | 74,320 | 55,960 | 68,865 |
| FL | 13,170 | 7,650 | 0 | 79,180 | 60,112 | 76,566 |
| TX | 13,170 | 7,650 | 0 | 79,180 | 63,496 | 81,581 |
| OH | 13,170 | 7,650 | 1,968 | 77,212 | 66,676 | 83,226 |

### Local job, local wage: left over after tax and 1BR rent

| Occupation | CA | TX | NY | FL | OH |
| --- | --- | --- | --- | --- | --- |
| Software developer | 103,904 | 88,846 | 96,252 | 85,844 | 80,102 |
| Registered nurse | 82,216 | 60,246 | 64,622 | 53,534 | 58,382 |
| Elementary teacher | 49,446 | 36,225 | 51,707 | 30,944 | 48,249 |
| Retail salesperson | 13,963 | 13,855 | 16,331 | 12,038 | 19,260 |

### Property tax on the median home

| State | Median home value (ACS 2024) | Effective rate | Annual property tax |
| --- | --- | --- | --- |
| CA | 759,500 | 0.71% | ~5,390 |
| NY | 449,800 | 1.45% | ~6,520 |
| TX | 313,200 | 1.31% | ~4,100 |
| FL | 396,900 | 0.75% | ~2,980 |
| OH | 239,800 | 1.22% | ~2,930 |

## 7. Teaching angle

Lessons the state map teaches naturally:

- **Nominal vs real income**: salary is not purchasing power; RPP is the "exchange rate" between states.
- **Taxes are more than income tax**: no-income-tax states make it up with sales and property taxes.
- **Housing is the biggest lever**: rent RPP ranges from 73 in Ohio to 154 in California, a much bigger spread than goods (94 to 107).
- **Mobility has a price**: moving costs a month or two of savings, and owning a home makes you far less mobile.
- **Local wages move with local costs**: often, but not always, and not equally across jobs.

### Scenario 1: "The Bay Area offer" (CA vs TX, software developer)

An NPC software developer in Houston gets an offer in California at the state mean: $186,770 vs $136,450, a 37% raise.
After tax and rent, the gap shrinks to about $15,000, and after adjusting for California's 14% higher overall price level it is nearly a wash ($93.8k vs $91.5k real).
Add the ~$4,500 move and a month of deposit, and the first year is roughly break-even.
Lesson: compare offers after tax and after cost of living, not on the headline number.

### Scenario 2: "Remote worker geo-arbitrage" (same $100k, CA to OH)

A remote NPC earning $100k moves from California to Ohio.
Take-home rises by about $3,100 (state tax drops from $5,070 to $1,968), and 1BR rent drops by about $11,500 per year, so they keep about $14,600 more.
Show a bar chart of the move: it pays for itself in about four months.
Then fire the twist event: "Your company announces location-based pay, -10%", which cuts $10,000 of gross pay and eats most of the gain.
Lesson: geo-arbitrage works, but only while your employer allows it.

### Scenario 3: "No income tax is not no tax" (TX homeowner vs FL homeowner)

Texas and Florida both have zero income tax, but a Texas homeowner pays about 1.31% of home value per year in property tax vs 0.75% in Florida.
On a $400k house that is about $5,240 vs $3,000 per year, and the gap grows as the house appreciates.
Meanwhile Florida renters pay more: Florida's rent RPP is 122 vs 97 in Texas.
Lesson: a tax-free label hides where the state collects money, and the answer depends on whether you rent or own.

### Scenario 4: "The nurse who moved for the pay" (FL to CA)

A Florida nurse earns $90,650; in California the mean RN wage is $150,280, one of the biggest state wage gaps in the data.
Even after California's higher taxes and 154 rent index, she keeps about $28,700 more after rent, and still about $22,500 more in real terms.
Lesson: for some occupations, high-cost states genuinely pay more than their costs.
Check the numbers for your own job, not just the state's reputation.

### Scenario 5: "Low wage, high rent" (retail worker, any state)

A retail salesperson has only $12k-$19k per year left after tax and a 1BR rent in every sample state, before food, transport, health insurance, or utilities.
Subtract groceries ($71-82/week), fuel ($36-55/week), electricity ($135-164/month), and an unsubsidized health premium ($513-817/month), and the budget goes negative in every sample state except Ohio, which has about $5,800 left for the whole year.
Lesson: at low wages the choice is roommates, a cheaper state, or upskilling, which sets up the career and education mechanics.

## 8. Caveats and open points

- State averages hide huge within-state gaps (NYC ZORI is $3,627 vs $1,634 for the New York state ACS median rent).
  If time allows, model 1-2 metros per big state.
- ACS rents are what all renters pay; new movers pay closer to ZORI.
  Use ZORI (or HUD FMR) for the player's move-in rent.
- Not modeled in the sample: NYC and Ohio municipal income taxes, California SDI payroll tax, state standard deductions for married filers, dependents, and credits.
  Ohio's $2,400 personal exemption is applied; NY's $1,000 exemption is for dependents only and is not applied.
- Health insurance: the KFF figure is the unsubsidized sticker price for a 40-year-old.
  ACA subsidies and employer plans lower what most people actually pay; a flat employee-share assumption is fine for NPCs with employer coverage.
- Gas prices are a single-day snapshot (2026-09-11) and the RPPs are for 2024.
  Label the dataset "prices as of 2024-2026" in the UI.
