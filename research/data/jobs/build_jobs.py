"""Build the job-category salary table from BLS OEWS (May 2025) via the keyless BLS API v1.

Output: research/data/jobs/jobs-oews.json

What it fetches (about 12 API requests, well under v1's 25 requests/day per IP):
  - National annual wage percentiles (10/25/50/75/90) and employment for the 22 civilian
    SOC major groups (the game's job categories).
  - The same percentiles for one or two anchor detailed occupations per category, used
    for tooltips ("a typical job in this category") and for sanity checks.
  - The all-occupations median for each state + DC, which gives a per-state wage index
    (state median / US median) to adjust the national percentiles.

Series ID layout (25 chars): OE U {N|S} area(7) industry(6) occupation(6) datatype(2)
  area: 0000000 for the nation, SS00000 for a state (SS = FIPS)
  datatype: 01 employment, 04 annual mean, 11/12/13/14/15 annual 10th/25th/median/75th/90th pct
  See https://www.bls.gov/help/hlpforma.htm#OE and https://download.bls.gov/pub/time.series/oe/

Usage: python3 build_jobs.py
Needs network access; stdlib only. Re-running costs ~12 of the 25 daily v1 requests.
"""

import json
import pathlib
import subprocess
import time

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "jobs-oews.json"
API = "https://api.bls.gov/publicAPI/v1/timeseries/data/"
YEAR = "2025"

# id, player-facing label, SOC major group, anchor occupations (SOC, title), JOLTS industry
# the category mostly maps to (for layoff rates), and a short set of example job titles.
CATEGORIES = [
    ("management", "Management and executive", "110000", [("111021", "General and operations managers")], "total_private", "Operations manager, director, store GM"),
    ("business_finance", "Business and finance", "130000", [("132011", "Accountants and auditors")], "financial_activities", "Accountant, analyst, HR specialist"),
    ("tech", "Software, IT, and data", "150000", [("151252", "Software developers")], "information", "Software developer, IT support, data scientist"),
    ("engineering", "Engineering and architecture", "170000", [("172141", "Mechanical engineers")], "professional_business", "Engineer, architect, drafter"),
    ("science", "Science and research", "190000", [("192031", "Chemists")], "professional_business", "Lab scientist, chemist, environmental tech"),
    ("social_services", "Community and social services", "210000", [("211021", "Child, family, and school social workers")], "government", "Social worker, counselor"),
    ("legal", "Legal", "230000", [("231011", "Lawyers")], "professional_business", "Lawyer, paralegal"),
    ("education", "Education and library", "250000", [("252021", "Elementary school teachers")], "government", "Teacher, professor, teaching assistant"),
    ("arts_media", "Arts, design, and media", "270000", [("271024", "Graphic designers")], "information", "Designer, writer, producer, athlete"),
    ("healthcare_pro", "Healthcare professional", "290000", [("291141", "Registered nurses")], "health_care", "Nurse, pharmacist, physician, technician"),
    ("healthcare_support", "Healthcare support", "310000", [("311131", "Nursing assistants")], "health_care", "Nursing assistant, medical assistant, home health aide"),
    ("protective", "Protective services", "330000", [("333051", "Police and sheriff's patrol officers")], "government", "Police officer, firefighter, security guard"),
    ("food_service", "Food service and hospitality", "350000", [("352014", "Cooks, restaurant")], "leisure_hospitality", "Cook, server, bartender, barista"),
    ("cleaning_grounds", "Cleaning and grounds", "370000", [("372011", "Janitors and cleaners")], "professional_business", "Janitor, housekeeper, landscaper"),
    ("personal_care", "Personal care and service", "390000", [("395012", "Hairdressers, hairstylists, and cosmetologists")], "leisure_hospitality", "Hairstylist, childcare worker, fitness trainer"),
    ("sales_retail", "Sales and retail", "410000", [("411011", "First-line supervisors of retail sales workers"), ("412031", "Retail salespersons")], "retail_trade", "Retail associate or manager, sales rep, real estate agent"),
    ("office_admin", "Office and administrative support", "430000", [("434051", "Customer service representatives")], "total_private", "Admin assistant, customer service, bookkeeper"),
    ("farming", "Farming, fishing, and forestry", "450000", [("452092", "Farmworkers and laborers, crop, nursery, and greenhouse")], "total_private", "Farmworker, fisher, logger"),
    ("construction", "Construction and extraction trades", "470000", [("472111", "Electricians")], "construction", "Electrician, carpenter, plumber, laborer"),
    ("repair", "Installation, maintenance, and repair", "490000", [("493023", "Automotive service technicians and mechanics")], "total_private", "Mechanic, HVAC tech, maintenance worker"),
    ("production", "Production and manufacturing", "510000", [("514121", "Welders, cutters, solderers, and brazers")], "manufacturing", "Assembler, machinist, welder, plant operator"),
    ("transport", "Transportation and logistics", "530000", [("533032", "Heavy and tractor-trailer truck drivers")], "transportation_warehousing", "Truck driver, warehouse worker, pilot"),
]

STATES = [
    ("AL", "01"), ("AK", "02"), ("AZ", "04"), ("AR", "05"), ("CA", "06"), ("CO", "08"), ("CT", "09"),
    ("DE", "10"), ("DC", "11"), ("FL", "12"), ("GA", "13"), ("HI", "15"), ("ID", "16"), ("IL", "17"),
    ("IN", "18"), ("IA", "19"), ("KS", "20"), ("KY", "21"), ("LA", "22"), ("ME", "23"), ("MD", "24"),
    ("MA", "25"), ("MI", "26"), ("MN", "27"), ("MS", "28"), ("MO", "29"), ("MT", "30"), ("NE", "31"),
    ("NV", "32"), ("NH", "33"), ("NJ", "34"), ("NM", "35"), ("NY", "36"), ("NC", "37"), ("ND", "38"),
    ("OH", "39"), ("OK", "40"), ("OR", "41"), ("PA", "42"), ("RI", "44"), ("SC", "45"), ("SD", "46"),
    ("TN", "47"), ("TX", "48"), ("UT", "49"), ("VT", "50"), ("VA", "51"), ("WA", "53"), ("WV", "54"),
    ("WI", "55"), ("WY", "56"),
]

PCT = {"11": "p10", "12": "p25", "13": "p50", "14": "p75", "15": "p90"}


def nat(occ: str, dt: str) -> str:
    return f"OEUN0000000000000{occ}{dt}"


def state(fips: str, occ: str, dt: str) -> str:
    return f"OEUS{fips}00000000000{occ}{dt}"


def fetch(ids: list[str]) -> dict[str, float | None]:
    out: dict[str, float | None] = {}
    for i in range(0, len(ids), 25):
        chunk = ids[i : i + 25]
        # curl instead of urllib: python.org builds on macOS often lack CA certificates.
        raw = subprocess.run(
            ["curl", "-sS", "-X", "POST", "-H", "Content-Type: application/json",
             "-d", json.dumps({"seriesid": chunk}), API],
            check=True, capture_output=True, text=True, timeout=90,
        ).stdout
        body = json.loads(raw)
        if body.get("status") != "REQUEST_SUCCEEDED":
            raise SystemExit(f"BLS API error: {body.get('message')}")
        for s in body["Results"]["series"]:
            pts = [p for p in s["data"] if p["year"] == YEAR]
            v = pts[0]["value"] if pts else None
            # "*" and "#" mark suppressed or top-coded values (#: at or above $239,200/yr).
            out[s["seriesID"]] = float(v) if v not in (None, "-", "*", "#") else None
            if pts and v == "#":
                out[s["seriesID"]] = 239200.0
        time.sleep(1)
    return out


def main() -> None:
    ids = []
    occs = ["000000"] + [c[2] for c in CATEGORIES] + [a[0] for c in CATEGORIES for a in c[3]]
    for occ in occs:
        ids += [nat(occ, dt) for dt in ["01", *PCT]]
    ids += [state(f, "000000", "13") for _, f in STATES]
    vals = fetch(ids)

    def pcts(occ: str) -> dict:
        d = {name: vals.get(nat(occ, dt)) for dt, name in PCT.items()}
        d["employment"] = vals.get(nat(occ, "01"))
        return d

    us = pcts("000000")
    cats = []
    for cid, label, soc, anchors, jolts, examples in CATEGORIES:
        cats.append(
            {
                "id": cid,
                "label": label,
                "soc": f"{soc[:2]}-{soc[2:]}",
                "examples": examples,
                "joltsIndustry": jolts,
                "wages": pcts(soc),
                "anchors": [{"soc": f"{a[:2]}-{a[2:]}", "title": t, "wages": pcts(a)} for a, t in anchors],
            }
        )
    states = {}
    for abbr, f in STATES:
        med = vals.get(state(f, "000000", "13"))
        states[abbr] = {"median": med, "wageIndex": round(med / us["p50"], 3) if med and us["p50"] else None}

    OUT.write_text(
        json.dumps(
            {
                "source": "BLS OEWS May 2025 national and state estimates, via BLS Public API v1 (keyless)",
                "released": "2026-05-15",
                "units": "annual wages in USD; employment in jobs",
                "topCode": "Cells BLS marks '#' (top-coded) would be stored as 239200; none are top-coded in this pull",
                "allOccupations": us,
                "categories": cats,
                "stateWageIndex": states,
            },
            indent=1,
        )
        + "\n"
    )
    missing = [k for k, v in vals.items() if v is None]
    print(f"wrote {OUT} ({len(vals)} series, {len(missing)} missing)")
    for m in missing:
        print("  missing", m)


if __name__ == "__main__":
    main()
