"""Seeded yearly career model for Larp City (research/11), with worked examples and calibration checks.

Reads:  jobs-oews.json (from build_jobs.py) and ../states-rpp.json is not needed; the state
        adjustment uses the OEWS state wage index stored in jobs-oews.json.
Writes: worked-examples.json (three players, 40 years, a few seeds each) and prints a
        calibration table (median path vs Guvenen et al. 2021 and Davis-von Wachter 2011).

All parameters live in PARAMS so the game can ship the same numbers as JSON.
Usage: python3 simulate_careers.py
"""

import json
import math
import pathlib
import random
import statistics

HERE = pathlib.Path(__file__).resolve().parent
DATA = json.loads((HERE / "jobs-oews.json").read_text())
CATS = {c["id"]: c for c in DATA["categories"]}
PKEYS = [(10, "p10"), (25, "p25"), (50, "p50"), (75, "p75"), (90, "p90")]

PARAMS = {
    # Long-run price inflation assumption; the game should use its own CPI path when it has one.
    "inflation": 0.025,
    # Merit budget over inflation in a normal year (2025-26 merit 3.2-3.3% nominal, Mercer).
    "meritReal": 0.008,
    # Performance tiers: share of workers, multiplier on the merit budget (Mercer: top 5.6% vs middle 3.3%).
    "perf": [(0.20, 1.7), (0.60, 1.0), (0.15, 0.5), (0.05, 0.0)],
    # Promotion: base yearly hazard (Mercer: ~10% promoted in 2025) and raise (avg 8.5%).
    "promoHazard": 0.10,
    "promoRaise": (0.06, 0.15),
    "promoAgeMult": [(30, 1.5), (40, 1.0), (50, 0.6), (200, 0.3)],
    # Voluntary job switch hazard by age (BLS median tenure 2.7 yrs at 25-34, 9.6 at 55-64).
    "switchHazard": [(30, 0.18), (40, 0.12), (55, 0.07), (200, 0.04)],
    # Extra raise for a switch, on top of the year's merit; Atlanta Fed switcher-stayer gap is
    # ~0.6 pp at the median, so the mean bump is small and noisy.
    "switchBump": (0.03, 0.08),
    # Real drift by age (log/yr): flat early, then a gentle late-career decline. CPS medians fall
    # ~4% from 45-54 to 55-64 (cross-section); Guvenen et al. find declines 45-55 for 80% of men.
    "ageDrift": [(30, 0.0), (40, -0.002), (50, -0.008), (60, -0.012), (200, -0.015)],
    # Career (experience) growth: the category's anchor-occupation p75/p25 ratio is the real
    # growth a median worker gets from ~25 to ~45, spread with these age weights. The events
    # above already deliver some of it; the rest is a smooth drift (see careerDrift()).
    "careerWeights": [(35, 1.0), (45, 0.5), (200, 0.0)],
    # Ladder top: above the category's 90th percentile, promotions stop and drift -0.5 pp.
    "ceilingPct": 90,
    # Involuntary displacement: DWS 2023-25, 7.4M displaced over 3 years out of ~161M jobs.
    "layoffBase": 0.0153,
    "layoffLevelMult": {"entry": 1.5, "mid": 1.1, "senior": 0.9, "lead": 0.75, "top": 0.6},
    # Unemployment spell, lognormal weeks: median 11.4, mean 26.3 (FRED UEMPMED/UEMPMEAN Aug 2026).
    "spellMedianWeeks": {"bull": 11.4, "bear": 25.2},
    "spellSigma": 1.29,
    # Re-employment pay change, log: DWS 2026 ~49% of re-employed full-time earn as much or more.
    "reemployLog": {"bull": (-0.05, 0.25), "bear": (-0.15, 0.25)},
    "bearMarketRaiseCut": 0.5,  # merit budgets roughly halve in a bear year (Atlanta Fed stayers 2010)
}

# Layoff multiplier vs total private, from JOLTS 2025 annual averages (FRED JTU*LDR), and the
# bear-regime multiplier scaled by each industry's 2009/2007 layoff ratio around the game's x3.
JOLTS = {  # industry: (2025 rate, 2007 rate, 2009 rate)
    "total_private": (1.25, 1.61, 1.97),
    "construction": (2.08, 3.26, 5.35),
    "manufacturing": (0.90, 1.22, 1.99),
    "retail_trade": (1.05, 1.65, 1.73),
    "transportation_warehousing": (1.63, 1.18, 1.84),
    "information": (1.31, 1.01, 1.37),
    "financial_activities": (0.63, 1.08, 1.34),
    "professional_business": (2.04, 2.32, 2.57),
    "health_care": (0.70, 0.75, 0.90),
    "leisure_hospitality": (1.53, 2.15, 2.25),
    "government": (0.36, 0.52, 0.60),
}


def industry_mults(ind: str) -> tuple[float, float]:
    r25, r07, r09 = JOLTS[ind]
    base = r25 / JOLTS["total_private"][0]
    cyc = (r09 / r07) / (JOLTS["total_private"][2] / JOLTS["total_private"][1])
    return round(base, 2), round(min(4.5, max(1.5, 3.0 * cyc)), 2)


def step(table, age):
    for bound, v in table:
        if age < bound:
            return v
    return table[-1][1]


def percentile(cat: dict, national_salary: float) -> float:
    """Log-linear interpolation of the category percentiles, with tails extrapolated."""
    w = cat["wages"]
    pts = [(p, math.log(w[k])) for p, k in PKEYS]
    x = math.log(national_salary)
    if x <= pts[0][1]:
        slope = (pts[1][0] - pts[0][0]) / (pts[1][1] - pts[0][1])
        return max(1.0, pts[0][0] + (x - pts[0][1]) * slope)
    if x >= pts[-1][1]:
        slope = (pts[-1][0] - pts[-2][0]) / (pts[-1][1] - pts[-2][1])
        return min(99.5, pts[-1][0] + (x - pts[-1][1]) * slope * 0.5)
    for (p0, x0), (p1, x1) in zip(pts, pts[1:]):
        if x <= x1:
            return p0 + (x - x0) / (x1 - x0) * (p1 - p0)
    return 50.0


def level(pct: float) -> str:
    return "entry" if pct < 25 else "mid" if pct < 50 else "senior" if pct < 75 else "lead" if pct < 90 else "top"


def expected_pct_for_age(age: float) -> float:
    """Where a typical worker of this age sits in their occupation's distribution.

    From CPS median weekly earnings by age, Q2 2026 (BLS wkyeng table 3), relative to the
    all-ages median ($1,242 for all full-time workers 16+ is not used; we use the 25-64 ladder):
    20-24 $831, 25-34 $1,160, 35-44 $1,436, 45-54 $1,421, 55-64 $1,367.
    """
    table = [(20, 12), (24, 22), (30, 38), (40, 55), (50, 58), (60, 55), (70, 52)]
    for (a0, p0), (a1, p1) in zip(table, table[1:]):
        if age <= a1:
            return p0 + (max(age, a0) - a0) / (a1 - a0) * (p1 - p0)
    return 52.0


def ladder_target(cat_id: str) -> float:
    """Log real growth a median worker in this category gets from 25 to 45: ln(p75/p25) of the anchor."""
    w = CATS[cat_id]["anchors"][0]["wages"]
    return math.log(w["p75"] / w["p25"])


_MECH: dict[str, float] = {}


def mechanics_growth() -> float:
    """Median log growth 25->45 from events alone (merit, promotions, switches, layoffs, drift)."""
    if "m" not in _MECH:
        g = [math.log(simulate(40000, 25, "office_admin", "OH", years=21, seed=s, career=False)[20]["salaryReal"] / 40000) for s in range(3000)]
        _MECH["m"] = statistics.median(g)
    return _MECH["m"]


def career_drift(cat_id: str, age: float) -> float:
    total_weight = sum(step(PARAMS["careerWeights"], a) for a in range(25, 45))
    return (ladder_target(cat_id) - mechanics_growth()) / total_weight * step(PARAMS["careerWeights"], age)


def simulate(salary, age, cat_id, state, years=40, seed=1, bear_years=frozenset(), retire_age=67, career=True):
    rng = random.Random(f"{seed}:{cat_id}:{state}:{salary}:{age}")
    P = PARAMS
    cat = CATS[cat_id]
    widx = DATA["stateWageIndex"][state]["wageIndex"]
    base_mult, bear_mult = industry_mults(cat["joltsIndustry"])
    real = salary  # track in today's dollars; nominal = real * (1+inflation)^t
    rows = []
    scar = 0
    for t in range(years + 1):
        a = age + t
        if a >= retire_age:
            break
        pct = percentile(cat, real / widx)
        lvl = level(pct)
        rows.append({"year": t, "age": a, "salaryReal": round(real), "salaryNominal": round(real * (1 + P["inflation"]) ** t), "pct": round(pct, 1), "level": lvl, "events": []})
        bear = t in bear_years
        ev = rows[-1]["events"]
        # 1. Layoff.
        hz = P["layoffBase"] * base_mult * P["layoffLevelMult"][lvl] * (bear_mult if bear else 1.0)
        if rng.random() < hz:
            regime = "bear" if bear else "bull"
            weeks = math.exp(math.log(P["spellMedianWeeks"][regime]) + P["spellSigma"] * rng.gauss(0, 1))
            weeks = min(weeks, 99)
            mu, sd = P["reemployLog"][regime]
            change = math.exp(rng.gauss(mu, sd))
            ev.append(f"laid off ({regime}), {weeks:.0f} weeks out, new job pays {change - 1:+.0%}")
            rows[-1]["weeksUnemployed"] = round(weeks)
            real *= change
            scar = 3
            continue
        # 2. Merit raise (real part only; inflation is added in the nominal column).
        r = rng.random()
        acc = 0.0
        mult = 1.0
        for share, m in P["perf"]:
            acc += share
            if r < acc:
                mult = m
                break
        budget = (P["inflation"] + P["meritReal"]) * (P["bearMarketRaiseCut"] if bear else 1.0)
        g = (1 + budget * mult) / (1 + P["inflation"]) - 1
        # 3. Promotion.
        promo_h = 0.0 if pct >= P["ceilingPct"] else P["promoHazard"] * step(P["promoAgeMult"], a) * (0.7 if scar else 1.0)
        if bear:
            promo_h *= 0.5
        if rng.random() < promo_h:
            bump = rng.uniform(*P["promoRaise"])
            g = (1 + g) * (1 + bump) - 1
            ev.append(f"promoted {bump:+.0%}")
        # 4. Voluntary switch (rarer in bear markets).
        elif rng.random() < step(P["switchHazard"], a) * (0.4 if bear else 1.0):
            bump = rng.gauss(*P["switchBump"])
            g = (1 + g) * (1 + bump) - 1
            ev.append(f"switched jobs {bump:+.0%}")
        drift = step(P["ageDrift"], a) - (0.005 if pct >= P["ceilingPct"] else 0.0)
        if career and pct < P["ceilingPct"]:
            drift += career_drift(cat_id, a)
        real *= (1 + g) * math.exp(drift)
        scar = max(0, scar - 1)
    return rows


def calibration():
    """Median real growth 25->55 and DvW present-value loss of a layoff."""
    growth = []
    for s in range(3000):
        rows = simulate(46000, 25, "office_admin", "OH", years=31, seed=s)
        growth.append(rows[30]["salaryReal"] / rows[0]["salaryReal"])
    print(f"events-only median log growth 25->45: {mechanics_growth():.3f}")
    print(f"median real growth 25->55, office/admin worker: {statistics.median(growth):.2f}x (Guvenen median LE: 1.60x)")
    for cid in CATS:
        start = CATS[cid]["anchors"][0]["wages"]["p25"]
        paths = [simulate(start, 25, cid, "OH", years=41, seed=s) for s in range(1000)]
        g45 = statistics.median(p[20]["salaryReal"] for p in paths) / start
        g55 = [p[30]["salaryReal"] / start for p in paths]
        g65 = statistics.median(p[40]["salaryReal"] for p in paths) / statistics.median(p[20]["salaryReal"] for p in paths)
        q = statistics.quantiles(g55, n=10)
        print(f"  {cid:18s} target 25->45 {math.exp(ladder_target(cid)):.2f}x | sim 25->45 {g45:.2f}x, 25->55 median {statistics.median(g55):.2f}x (p10 {q[0]:.2f}, p90 {q[-1]:.2f}), 45->65 {g65:.2f}x")
    # Davis-von Wachter: PV of lost earnings over 20 years at 5%, in years of pre-layoff pay.
    for regime, mu in [("bull", PARAMS["reemployLog"]["bull"][0]), ("bear", PARAMS["reemployLog"]["bear"][0])]:
        med = PARAMS["spellMedianWeeks"][regime]
        mean_weeks = med * math.exp(PARAMS["spellSigma"] ** 2 / 2)
        pv = sum((1 - math.exp(mu)) / 1.05 ** k for k in range(1, 21)) + min(mean_weeks, 99) / 52
        print(f"  layoff PV loss ({regime}): ~{pv:.1f} years of pay (DvW: 1.4 below 6% unemployment, 2.8 above 8%)")
    for ind in JOLTS:
        print("  mults", ind, industry_mults(ind))


def main():
    calibration()
    players = [
        {"name": "Software developer, 24, Texas", "salary": 95000, "age": 24, "cat": "tech", "state": "TX"},
        {"name": "Registered nurse, 35, Ohio", "salary": 88000, "age": 35, "cat": "healthcare_pro", "state": "OH"},
        {"name": "Retail store manager, 45, Florida", "salary": 58000, "age": 45, "cat": "sales_retail", "state": "FL"},
    ]
    # Bear-regime years for the demo path: the AI Bubble Pop plus one generic bear later on.
    bears = frozenset({3, 17, 18})
    out = []
    for p in players:
        cat = CATS[p["cat"]]
        widx = DATA["stateWageIndex"][p["state"]]["wageIndex"]
        pct = percentile(cat, p["salary"] / widx)
        paths = [simulate(p["salary"], p["age"], p["cat"], p["state"], seed=s, bear_years=bears) for s in range(2000)]
        horizon = min(len(x) for x in paths) - 1
        finals = sorted(x[horizon]["salaryReal"] for x in paths)
        peak_ages = [max(x, key=lambda r: r["salaryReal"])["age"] for x in paths]
        laid = sum(any("laid off" in e for r in x for e in r["events"]) for x in paths) / len(paths)
        demo = paths[7]
        summary = {
            "player": p,
            "stateWageIndex": widx,
            "nationalEquivalent": round(p["salary"] / widx),
            "percentile": round(pct, 1),
            "level": level(pct),
            "expectedPctForAge": round(expected_pct_for_age(p["age"]), 1),
            "horizonYears": horizon,
            "finalRealSalary": {"p10": finals[len(finals) // 10], "p50": finals[len(finals) // 2], "p90": finals[len(finals) * 9 // 10]},
            "medianPeakAge": statistics.median(peak_ages),
            "shareEverLaidOff": round(laid, 3),
            "demoPathSeed7": [r for r in demo if r["year"] % 5 == 0 or r["events"]],
        }
        out.append(summary)
        print(json.dumps({k: v for k, v in summary.items() if k != "demoPathSeed7"}))
        for r in summary["demoPathSeed7"]:
            print("   ", r["age"], r["salaryReal"], r["level"], r["pct"], "; ".join(r["events"]))
    (HERE / "worked-examples.json").write_text(json.dumps({"params": PARAMS, "bearYears": sorted(bears), "players": out}, indent=1) + "\n")


if __name__ == "__main__":
    main()
