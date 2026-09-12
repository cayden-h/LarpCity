"""Build states-sample.json for Larp City from verified, cited source numbers.

Every raw number below was pulled on 2026-09-11 from the source named next to it.
The full 51-state build should replace the hand-entered dicts with fetches
(Census Reporter / Census API, FRED CSV, BLS API, Zillow CSV) - see
../02-states-cost-of-living.md for the pipeline.

Run: python3 build_states_sample.py  (writes states-sample.json next to this file
and prints take-home scenarios).
"""

import json
from pathlib import Path

# ---- National / federal constants (tax year 2026) ----
FEDERAL = {
    "year": 2026,
    # Tax Foundation, 2026 federal brackets (single): https://taxfoundation.org/data/all/federal/2026-tax-brackets/
    "brackets_single": [[0, 0.10], [12400, 0.12], [50400, 0.22], [105700, 0.24],
                        [201775, 0.32], [256225, 0.35], [640600, 0.37]],
    "standard_deduction_single": 16100,
    "standard_deduction_mfj": 32200,
    # SSA 2026 wage base: https://payroll.org/news-resources/news/news-detail/2025/10/24/social-security-wage-base-increases-to-$184-500-for-2026
    "social_security_rate": 0.062,
    "social_security_wage_base": 184500,
    "medicare_rate": 0.0145,
    "additional_medicare_rate": 0.009,
    "additional_medicare_threshold_single": 200000,
}

NATIONAL = {
    # USDA Thrifty Food Plan 2026, single adult ~ $295 (F) to $360 (M) per month:
    # https://www.fna.usda.gov/research/cnpp/usda-food-plans/cost-food-monthly-reports
    "groceries_weekly_single_thrifty": round((295 + 360) / 2 * 12 / 52),
    # Assumed driving: 12,000 mi/yr at 25 mpg (game assumption, not a source number).
    "gallons_per_week": round(12000 / 25 / 52, 2),
    # Median income / rent / home value, ACS 2024 1-year via Census Reporter.
    "acs_median_household_income": 81604,
    "acs_median_gross_rent": 1487,
    "acs_median_home_value": 360600,
    "zori_us_typical_rent": 1962,
    "eia_avg_electric_bill_2024": 142.26,
    "kff_benchmark_premium_40yo_2026": 625,
    "aaa_gas_regular": 4.295,
    # BLS OEWS May 2025 national annual mean wages.
    "oews_annual_mean": {"software_developer": 148100, "registered_nurse": 101420,
                         "elementary_teacher": 72650, "accountant": 94750,
                         "retail_salesperson": 37310, "fast_food_cook": 32150},
}

# ---- Per-state raw inputs ----
RAW = {
    "CA": dict(name="California", fips="06", rep_metro="Los Angeles, CA",
               rpp_all=110.720, rpp_goods=106.098, rpp_rents=154.346, rpp_other_services=102.591,
               acs_rent_median=2104, acs_rent_1br=1835, acs_rent_2br=2179,
               acs_home_value=759500, acs_income=100149, acs_re_taxes=5369,
               zhvi=773735, zori_metro=2944,
               sales_tax=dict(state=7.25, local_avg=1.78, combined=9.03),
               income_tax=dict(type="graduated", std_deduction=5540, personal_credit=153,
                               brackets=[[0, .01], [11079, .02], [26264, .04], [41452, .06],
                                         [57542, .08], [72724, .093], [371479, .103],
                                         [445771, .113], [742953, .123], [1000000, .133]]),
               electric_bill=160.86, gas=5.927, benchmark_premium=570,
               wages=dict(software_developer=186770, registered_nurse=150280, elementary_teacher=95670,
                          accountant=103760, retail_salesperson=42950, fast_food_cook=41680),
               notes=["CA also withholds State Disability Insurance (SDI) on all wages - not modeled here."]),
    "TX": dict(name="Texas", fips="48", rep_metro="Houston, TX",
               rpp_all=97.057, rpp_goods=98.083, rpp_rents=96.503, rpp_other_services=97.081,
               acs_rent_median=1475, acs_rent_1br=1307, acs_rent_2br=1475,
               acs_home_value=313200, acs_income=79721, acs_re_taxes=4108,
               zhvi=301806, zori_metro=1654,
               sales_tax=dict(state=6.25, local_avg=1.95, combined=8.20),
               income_tax=dict(type="none"),
               electric_bill=163.72, gas=3.847, benchmark_premium=661,
               wages=dict(software_developer=136450, registered_nurse=95380, elementary_teacher=61890,
                          accountant=90370, retail_salesperson=34050, fast_food_cook=27750),
               notes=["No income tax, but property tax is high (about 1.31% effective)."]),
    "NY": dict(name="New York", fips="36", rep_metro="New York, NY",
               rpp_all=107.921, rpp_goods=107.254, rpp_rents=122.168, rpp_other_services=104.067,
               acs_rent_median=1634, acs_rent_1br=1530, acs_rent_2br=1634,
               acs_home_value=449800, acs_income=85820, acs_re_taxes=6542,
               zhvi=527312, zori_metro=3627,
               sales_tax=dict(state=4.00, local_avg=4.54, combined=8.54),
               income_tax=dict(type="graduated", std_deduction=8000,
                               brackets=[[0, .039], [8500, .044], [11700, .0515], [13900, .054],
                                         [80650, .059], [215400, .0685], [1077550, .0965],
                                         [5000000, .103], [25000000, .109]]),
               electric_bill=139.53, gas=4.362, benchmark_premium=817,
               wages=dict(software_developer=163820, registered_nurse=113440, elementary_teacher=93400,
                          accountant=114070, retail_salesperson=42580, fast_food_cook=36920),
               notes=["State averages hide NYC: metro ZORI rent is ~$3,627 vs $1,634 state median.",
                      "NYC residents also pay NYC income tax (not modeled)."]),
    "FL": dict(name="Florida", fips="12", rep_metro="Miami, FL",
               rpp_all=103.414, rpp_goods=98.059, rpp_rents=122.107, rpp_other_services=101.324,
               acs_rent_median=1812, acs_rent_1br=1589, acs_rent_2br=1812,
               acs_home_value=396900, acs_income=77735, acs_re_taxes=2993,
               zhvi=378167, zori_metro=2677,
               sales_tax=dict(state=6.00, local_avg=0.98, combined=6.98),
               income_tax=dict(type="none"),
               electric_bill=156.09, gas=4.155, benchmark_premium=683,
               wages=dict(software_developer=137010, registered_nurse=90650, elementary_teacher=59530,
                          accountant=88210, retail_salesperson=36000, fast_food_cook=30940),
               notes=["No income tax, but rents are 22% above the national level (RPP rents 122.1)."]),
    "OH": dict(name="Ohio", fips="39", rep_metro="Columbus, OH",
               rpp_all=92.774, rpp_goods=93.670, rpp_rents=73.012, rpp_other_services=98.947,
               acs_rent_median=1090, acs_rent_1br=878, acs_rent_2br=1122,
               acs_home_value=239800, acs_income=72212, acs_re_taxes=2937,
               zhvi=249941, zori_metro=1519,
               sales_tax=dict(state=5.75, local_avg=1.54, combined=7.29),
               income_tax=dict(type="flat_above_threshold", personal_exemption=2400,
                               brackets=[[0, 0.0], [26050, .0275]]),
               electric_bill=135.16, gas=4.188, benchmark_premium=513,
               wages=dict(software_developer=119860, registered_nurse=87730, elementary_teacher=72740,
                          accountant=88280, retail_salesperson=34580, fast_food_cook=28900),
               notes=["Most Ohio cities levy a municipal income tax (~2-2.5%), not modeled here."]),
}


def bracket_tax(income, brackets):
    tax = 0.0
    for i, (floor, rate) in enumerate(brackets):
        ceil = brackets[i + 1][0] if i + 1 < len(brackets) else float("inf")
        if income > floor:
            tax += (min(income, ceil) - floor) * rate
    return tax


def federal_tax(gross):
    fed = bracket_tax(max(0, gross - FEDERAL["standard_deduction_single"]), FEDERAL["brackets_single"])
    fica = min(gross, FEDERAL["social_security_wage_base"]) * FEDERAL["social_security_rate"]
    fica += gross * FEDERAL["medicare_rate"]
    fica += max(0, gross - FEDERAL["additional_medicare_threshold_single"]) * FEDERAL["additional_medicare_rate"]
    return fed, fica


def state_tax(gross, it):
    if it["type"] == "none":
        return 0.0
    taxable = gross - it.get("std_deduction", 0) - it.get("personal_exemption", 0)
    tax = bracket_tax(max(0, taxable), it["brackets"]) - it.get("personal_credit", 0)
    return max(0.0, tax)


def take_home(gross, abbr):
    fed, fica = federal_tax(gross)
    st = state_tax(gross, STATES[abbr]["taxes"]["income_tax"])
    return dict(gross=gross, federal=round(fed), fica=round(fica), state=round(st),
                net=round(gross - fed - fica - st))


STATES = {}
for abbr, r in RAW.items():
    STATES[abbr] = {
        "abbr": abbr, "name": r["name"], "fips": r["fips"], "representative_metro": r["rep_metro"],
        "rpp": {"all_items": r["rpp_all"], "goods": r["rpp_goods"], "rents": r["rpp_rents"],
                "other_services": r["rpp_other_services"]},
        "housing": {
            "rent_median": r["acs_rent_median"], "rent_1br": r["acs_rent_1br"], "rent_2br": r["acs_rent_2br"],
            "rent_metro_typical": r["zori_metro"],
            "home_price_median": r["acs_home_value"], "home_value_typical_zhvi": r["zhvi"],
            "property_tax_effective_rate": round(r["acs_re_taxes"] / r["acs_home_value"], 4),
            "property_tax_median_annual": r["acs_re_taxes"],
        },
        "living": {
            "groceries_weekly": round(NATIONAL["groceries_weekly_single_thrifty"] * r["rpp_goods"] / 100),
            "fuel_weekly": round(NATIONAL["gallons_per_week"] * r["gas"]),
            "gas_price_per_gallon": r["gas"],
            "utilities_monthly_electric": r["electric_bill"],
            "healthcare_monthly_unsubsidized": r["benchmark_premium"],
        },
        "taxes": {"income_tax": r["income_tax"], "sales_tax_pct": r["sales_tax"]},
        "income": {"median_household": r["acs_income"], "annual_mean_wage": r["wages"]},
        "notes": r["notes"],
    }

DOC = {
    "version": "sample-2026-09-11",
    "units": "USD; rents/utilities/healthcare monthly, groceries/fuel weekly, wages annual",
    "federal": FEDERAL,
    "national": NATIONAL,
    "sources": {
        "rpp": "BEA Regional Price Parities 2024 (released 2026-02-19), via FRED series {ST}RPPALL/{ST}RPPGOOD/{ST}RPPSERVERENT/{ST}RPPSERVEOTH - https://www.bea.gov/data/prices-inflation/regional-price-parities-state-and-metro-area",
        "rent_median, rent_1br, rent_2br, home_price_median, median_household, property_tax": "Census ACS 2024 1-year, tables B25064, B25031, B25077, B19013, B25103, via https://api.censusreporter.org (property_tax_effective_rate = B25103 median taxes / B25077 median value)",
        "rent_metro_typical": "Zillow ZORI (all homes, smoothed), July 2026, representative metro - https://www.zillow.com/research/data/",
        "home_value_typical_zhvi": "Zillow ZHVI state, mid-tier, July 2026 - https://www.zillow.com/research/data/",
        "income_tax": "Tax Foundation 2026 state income tax rates and brackets (single) - https://taxfoundation.org/data/all/state/state-income-tax-rates-2026/",
        "sales_tax_pct": "Tax Foundation state and local sales tax rates, midyear (July 1) 2026 - https://taxfoundation.org/data/all/state/2026-sales-tax-rates-midyear/",
        "annual_mean_wage": "BLS OEWS May 2025, series OEUS{FIPS}00000000000{SOC}04 - https://www.bls.gov/oes/current/oessrcst.htm",
        "utilities_monthly_electric": "EIA 2024 average monthly residential bill, Table 5A - https://www.eia.gov/electricity/sales_revenue_price/pdf/table_5A.pdf",
        "gas_price_per_gallon": "AAA state averages, 2026-09-11 - https://gasprices.aaa.com/state-gas-price-averages/",
        "healthcare_monthly_unsubsidized": "KFF 2026 average benchmark (second-lowest silver) premium, age 40 - https://www.kff.org/affordable-care-act/state-indicator/marketplace-average-benchmark-premiums/",
        "groceries_weekly": "USDA Thrifty Food Plan 2026 single-adult average (~$327/mo) scaled by BEA goods RPP (derived)",
        "fuel_weekly": "Derived: 12,000 mi/yr at 25 mpg x AAA state gas price",
    },
    "states": STATES,
}

if __name__ == "__main__":
    out = Path(__file__).with_name("states-sample.json")
    out.write_text(json.dumps(DOC, indent=2) + "\n")
    print(f"wrote {out}")

    print("\n== Same $100k remote salary, single filer ==")
    for a in STATES:
        t = take_home(100000, a)
        rent = STATES[a]["housing"]["rent_1br"] * 12
        print(f"{a}: net {t['net']:>7} (fed {t['federal']}, fica {t['fica']}, state {t['state']})"
              f" | after 1br rent {t['net'] - rent:>7} | RPP-adjusted net {round(t['net'] / STATES[a]['rpp']['all_items'] * 100)}")

    print("\n== Local mean wage by occupation: net after tax and 1br rent, then RPP-adjusted ==")
    for occ in NATIONAL["oews_annual_mean"]:
        row = []
        for a in STATES:
            w = STATES[a]["income"]["annual_mean_wage"][occ]
            n = take_home(w, a)["net"] - STATES[a]["housing"]["rent_1br"] * 12
            row.append(f"{a} {w}->{n} (real {round(n / STATES[a]['rpp']['all_items'] * 100)})")
        print(occ, " | ".join(row))

    print("\n== Property tax on the median home ==")
    for a in STATES:
        h = STATES[a]["housing"]
        print(a, h["home_price_median"], h["property_tax_effective_rate"], round(h["home_price_median"] * h["property_tax_effective_rate"]))
