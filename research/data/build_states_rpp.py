"""Build per-state cost-of-living tiers from BEA Regional Price Parities.

Input:  SARPP_STATE_2008_2024.csv from https://apps.bea.gov/regional/zip/SARPP.zip
        (keyless bulk download; FRED's per-series CSVs are the same numbers).
Output: research/data/states-rpp.json and game/src/data/states.ts.

Tier rule (from research/05): RPP all items < 95 is LCOL, 95-105 MCOL, > 105 HCOL.
Usage:  python3 build_states_rpp.py [path/to/SARPP_STATE_2008_2024.csv]
        The input defaults to research/data/raw/SARPP_STATE_2008_2024.csv (checked in);
        to refresh it, download the zip above and extract that one CSV into raw/.
"""

import csv
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
GAME = HERE.parent.parent / "game" / "src" / "data" / "states.ts"

# abbr, name, fips, the team's city (Notion "City for each state"), visuals id.
STATES = [
    ("AL", "Alabama", "01", "Montgomery", "southeast"),
    ("AK", "Alaska", "02", "Juneau", "pacific-coast"),
    ("AZ", "Arizona", "04", "Phoenix", "desert-southwest"),
    ("AR", "Arkansas", "05", "Little Rock", "southeast"),
    ("CA", "California", "06", "San Francisco", "san-francisco"),
    ("CO", "Colorado", "08", "Denver", "mountain-west"),
    ("CT", "Connecticut", "09", "Hartford", "northeast"),
    ("DE", "Delaware", "10", "Dover", "northeast"),
    ("DC", "District of Columbia", "11", "Washington", "northeast"),
    ("FL", "Florida", "12", "Miami", "miami"),
    ("GA", "Georgia", "13", "Atlanta", "southeast"),
    ("HI", "Hawaii", "15", "Honolulu", "island"),
    ("ID", "Idaho", "16", "Boise", "mountain-west"),
    ("IL", "Illinois", "17", "Springfield", "great-lakes"),
    ("IN", "Indiana", "18", "Indianapolis", "great-lakes"),
    ("IA", "Iowa", "19", "Des Moines", "great-lakes"),
    ("KS", "Kansas", "20", "Topeka", "great-plains"),
    ("KY", "Kentucky", "21", "Frankfort", "southeast"),
    ("LA", "Louisiana", "22", "Baton Rouge", "southeast"),
    ("ME", "Maine", "23", "Augusta", "northeast"),
    ("MD", "Maryland", "24", "Annapolis", "northeast"),
    ("MA", "Massachusetts", "25", "Boston", "northeast"),
    ("MI", "Michigan", "26", "Lansing", "great-lakes"),
    ("MN", "Minnesota", "27", "Saint Paul", "great-lakes"),
    ("MS", "Mississippi", "28", "Jackson", "southeast"),
    ("MO", "Missouri", "29", "Jefferson City", "great-lakes"),
    ("MT", "Montana", "30", "Helena", "mountain-west"),
    ("NE", "Nebraska", "31", "Lincoln", "great-plains"),
    ("NV", "Nevada", "32", "Las Vegas", "desert-southwest"),
    ("NH", "New Hampshire", "33", "Concord", "northeast"),
    ("NJ", "New Jersey", "34", "Trenton", "northeast"),
    ("NM", "New Mexico", "35", "Santa Fe", "desert-southwest"),
    ("NY", "New York", "36", "New York City", "new-york"),
    ("NC", "North Carolina", "37", "Raleigh", "southeast"),
    ("ND", "North Dakota", "38", "Bismarck", "great-plains"),
    ("OH", "Ohio", "39", "Columbus", "great-lakes"),
    ("OK", "Oklahoma", "40", "Oklahoma City", "great-plains"),
    ("OR", "Oregon", "41", "Salem", "pacific-coast"),
    ("PA", "Pennsylvania", "42", "Harrisburg", "northeast"),
    ("RI", "Rhode Island", "44", "Providence", "northeast"),
    ("SC", "South Carolina", "45", "Columbia", "southeast"),
    ("SD", "South Dakota", "46", "Pierre", "great-plains"),
    ("TN", "Tennessee", "47", "Nashville", "southeast"),
    ("TX", "Texas", "48", "Houston", "houston"),
    ("UT", "Utah", "49", "Salt Lake City", "desert-southwest"),
    ("VT", "Vermont", "50", "Montpelier", "northeast"),
    ("VA", "Virginia", "51", "Richmond", "southeast"),
    ("WA", "Washington", "53", "Olympia", "pacific-coast"),
    ("WV", "West Virginia", "54", "Charleston", "southeast"),
    ("WI", "Wisconsin", "55", "Madison", "great-lakes"),
    ("WY", "Wyoming", "56", "Cheyenne", "mountain-west"),
]

LINES = {"1": "all", "2": "goods", "3": "housing", "4": "utilities", "5": "other"}


def tier(all_items: float) -> str:
    return "LCOL" if all_items < 95 else "HCOL" if all_items > 105 else "MCOL"


def main() -> None:
    src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "raw" / "SARPP_STATE_2008_2024.csv"
    rpp: dict[str, dict[str, float]] = {}
    with src.open(encoding="latin-1") as fh:
        for row in csv.DictReader(fh):
            fips = (row.get("GeoFIPS") or "").strip().strip('"')[:2]
            line = (row.get("LineCode") or "").strip()
            if line in LINES and fips and fips != "00" and row.get("2024") not in (None, "", "(NA)"):
                rpp.setdefault(fips, {})[LINES[line]] = round(float(row["2024"]), 3)

    records = []
    for abbr, name, fips, city, city_id in STATES:
        r = rpp[fips]
        assert set(r) == set(LINES.values()), f"{abbr} missing lines: {r}"
        records.append({"abbr": abbr, "name": name, "fips": fips, "city": city, "cityId": city_id,
                        "rpp": r, "tier": tier(r["all"])})
    assert len(records) == 51

    (HERE / "states-rpp.json").write_text(json.dumps(
        {"source": "BEA Regional Price Parities by state, 2024 (SARPP, released 2026-02-19)",
         "tier_rule": "all items < 95 LCOL, 95-105 MCOL, > 105 HCOL", "states": records}, indent=1) + "\n")

    lines = [
        "// Generated by research/data/build_states_rpp.py from BEA Regional Price Parities (2024).",
        "// Do not edit by hand; rerun the script instead.",
        "",
        'import type { StateInfo } from "../engine/types";',
        "",
        "export const STATES: StateInfo[] = [",
    ]
    for r in records:
        p = r["rpp"]
        lines.append(
            f'  {{ abbr: "{r["abbr"]}", name: "{r["name"]}", fips: "{r["fips"]}", city: "{r["city"]}", cityId: "{r["cityId"]}", '
            f'rpp: {{ all: {p["all"]}, goods: {p["goods"]}, housing: {p["housing"]}, utilities: {p["utilities"]}, other: {p["other"]} }}, '
            f'tier: "{r["tier"]}" }},')
    lines += ["];", ""]
    GAME.parent.mkdir(parents=True, exist_ok=True)
    GAME.write_text("\n".join(lines))

    for t in ("LCOL", "MCOL", "HCOL"):
        members = [r["abbr"] for r in records if r["tier"] == t]
        print(t, len(members), " ".join(members))


if __name__ == "__main__":
    main()
