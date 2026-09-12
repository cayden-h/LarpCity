#!/usr/bin/env python3
"""Normalize the raw card and rate downloads into Tiger Data seed CSVs and
the game's generated card catalog.

Inputs (research/data/cards/raw/, see research/08-cards-loans-accounts.md for URLs):
  cfpb_tccp-data_2025-12-31.xlsx  CFPB Terms of Credit Card Plans survey (public domain)
  card-bonuses.json               andenacitelli/credit-card-bonuses-api export (MIT + Commons Clause)
  fred-<SERIES>.csv               FRED series (public domain)

Outputs:
  research/data/cards/card_products.csv   one row per TCCP plan  -> table card_products
  research/data/cards/card_offers.csv     one row per bonus card -> table card_offers
  research/data/cards/macro_rates.csv     FRED since 2000        -> hypertable macro_rates
  game/src/data/cards.ts                  national plans + current offers for the browser engine

Run: python3 research/data/cards/build_cards.py
"""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

import openpyxl

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
GAME_DATA = HERE.parents[2] / "game" / "src" / "data" / "cards.ts"

TCCP_FILE = RAW / "cfpb_tccp-data_2025-12-31.xlsx"
TCCP_HEADER_ROW = 10  # rows 1-9 are a title block
FRED_SERIES = {
    "TERMCBCCALLNS": "Credit card APR, all accounts (Fed G.19)",
    "TERMCBCCINTNS": "Credit card APR, accounts assessed interest (Fed G.19)",
    "TERMCBPER24NS": "24-month personal loan APR (Fed G.19)",
    "RIFLPBCIANM60NM": "60-month new auto loan APR (Fed G.19)",
    "DPRIME": "Bank prime loan rate",
    "DFF": "Federal funds effective rate",
    "MORTGAGE30US": "30-year fixed mortgage average (Freddie Mac PMMS)",
    "DRCCLACBS": "Credit card delinquency rate, all banks",
}
FRED_SINCE = "2000-01-01"

# TCCP institution names -> the issuer keys used by the bonuses dataset.
ISSUER_KEYS = [
    ("jpmorgan chase", "CHASE"),
    ("capital one", "CAPITAL_ONE"),
    ("citibank", "CITI"),
    ("american express", "AMERICAN_EXPRESS"),
    ("bank of america", "BANK_OF_AMERICA"),
    ("wells fargo", "WELLS_FARGO"),
    ("barclays", "BARCLAYS"),
    ("u.s. bancorp", "US_BANK"),
    ("first national bank of omaha", "FNBO"),
    ("synchrony", "SYNCHRONY"),
    ("comenity", "COMENITY"),
    ("pentagon federal", "PENFED"),
    ("pnc bank", "PNC"),
    ("discover", "DISCOVER"),
    ("goldman sachs", "GOLDMAN_SACHS"),
]

# Game valuation of one point or mile in cents, near cash-out value (research doc 08, section 2).
# USD offers are already in dollars. Unknown currencies default to 1 cent.
POINT_CENTS = {
    "USD": 100.0,
    "CAPITAL_ONE": 1.0,
    "CHASE": 1.0,
    "CITI": 1.0,
    "AMERICAN_EXPRESS": 0.6,
    "BANK_OF_AMERICA": 1.0,
    "WELLS_FARGO": 1.0,
    "US_BANK": 1.0,
    "PENFED": 0.85,
    "MARRIOTT": 0.7,
    "HILTON": 0.5,
    "IHG": 0.5,
    "WYNDHAM": 0.9,
    "CHOICE": 0.6,
    "HYATT": 1.5,
    "BEST_WESTERN": 0.6,
}

TIER_PATTERNS = [
    ("no credit score", 0),
    ("619 or less", 1),
    ("620 to 719", 2),
    ("720 or greater", 3),
]


def blank(v):
    return v is None or (isinstance(v, str) and v.strip() in ("", "None"))


def num(v):
    if blank(v):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def rate(v):
    """TCCP stores rates as fractions; a few rows use percents (9.99). Returns a fraction."""
    x = num(v)
    if x is None:
        return None
    if x > 1:
        x /= 100
    return round(x, 4)


def text(v):
    return None if blank(v) else str(v).strip()


def split_list(v):
    t = text(v)
    return [s.strip() for s in t.split(";") if s.strip()] if t else []


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def issuer_key(institution: str) -> str | None:
    low = institution.lower()
    for needle, key in ISSUER_KEYS:
        if needle in low:
            return key
    return None


def tiers(v) -> list[int]:
    low = (text(v) or "").lower()
    return sorted({t for pat, t in TIER_PATTERNS if pat in low})


def pg_array(items) -> str:
    """Postgres array literal for COPY/CSV."""
    esc = ['"' + str(i).replace("\\", "\\\\").replace('"', '\\"') + '"' for i in items]
    return "{" + ",".join(esc) + "}"


def load_tccp() -> list[dict]:
    wb = openpyxl.load_workbook(TCCP_FILE, read_only=True)
    rows = list(wb.active.iter_rows(values_only=True))
    header = rows[TCCP_HEADER_ROW - 1]
    col = {h: i for i, h in enumerate(header) if h}
    seen: dict[str, int] = {}
    out = []
    for r in rows[TCCP_HEADER_ROW:]:
        if not any(r):
            continue
        g = lambda name: r[col[name]]  # noqa: E731
        inst = text(g("Institution Name"))
        name = text(g("Product Name"))
        if not inst or not name:
            continue
        base = slug(f"{inst.split(',')[0]} {name}")[:80]
        seen[base] = seen.get(base, 0) + 1
        pid = base if seen[base] == 1 else f"{base}-{seen[base]}"
        t = tiers(g("Targeted Credit Tiers"))
        annual = num(g("Annual Fee"))
        out.append({
            "id": pid,
            "institution": inst,
            "issuer_key": issuer_key(inst),
            "product_name": name,
            "top25_issuer": str(g("Issued by Top 25 Institution")) == "True",
            "availability": text(g("Availability of Credit Card Plan")),
            "state": text(g("State")),
            "requires_membership": text(g("Requirements for Opening")) == "Yes",
            "secured": text(g("Secured Card")) == "Yes",
            "credit_tiers": t,
            "min_tier": min(t) if t else None,
            "variable_rate": text(g("Purchase APR Index")) == "Yes",
            "apr_no_score": rate(g("Purchase APR no score")),
            "apr_poor": rate(g("Purchase APR poor")),
            "apr_good": rate(g("Purchase APR good")),
            "apr_great": rate(g("Purchase APR great")),
            "apr_min": rate(g("Purchase APR min")),
            "apr_median": rate(g("Purchase APR median")),
            "apr_max": rate(g("Purchase APR max")),
            "intro_apr": rate(g("Intro APR median")),
            "intro_months": num(g("Median Length of Introductory APR")),
            "bt_apr": rate(g("Transfer APR median")),
            "bt_months": num(g("Median Length of Balance Transfer APR")),
            "bt_fee_pct": rate(g("Balance Transfer Fee (%)")),
            "bt_fee_min": num(g("Minimum Balance Transfer Fee Amount")),
            "cash_apr": rate(g("Advance APR median")),
            "cash_fee_pct": rate(g("Cash Advance Fee (%)")),
            "cash_fee_min": num(g("Minimum Cash Advance Fee Amount")),
            "grace_days": num(g("Grace Period")),
            "annual_fee": annual or 0.0,
            "monthly_fee": num(g("Monthly Fee")) or 0.0,
            "foreign_fee_pct": rate(g("Foreign Transaction Fee (%)")) or 0.0,
            "late_fee": num(g("Late Fee ($)")),
            "rewards": split_list(g("Rewards")),
            "other_rewards": text(g("Other Rewards")),
            "features": split_list(g("Card Features")),
            "website": text(g("Website for Consumer")),
            "report_date": "2025-12-31",
        })
    return out


STOP = {"card", "credit", "visa", "mastercard", "signature", "world", "elite", "the", "from", "by", "rewards", "and", "r", "american", "express", "amex", "chase", "citi", "capital", "one", "bank", "of", "america", "wells", "fargo", "us", "u", "s", "barclays"}


def tokens(name: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", name.lower()) if t not in STOP}


def load_offers(products: list[dict]) -> list[dict]:
    raw = json.loads((RAW / "card-bonuses.json").read_text())
    by_issuer: dict[str, list[dict]] = {}
    for p in products:
        if p["issuer_key"]:
            by_issuer.setdefault(p["issuer_key"], []).append(p)
    out = []
    for c in raw:
        offer = c["offers"][0] if c.get("offers") else None
        bonus = offer["amount"][0]["amount"] if offer and offer.get("amount") else None
        cents = POINT_CENTS.get(c["currency"], 1.0)
        # Best TCCP match within the same issuer by name tokens (Jaccard >= 0.5).
        # TCCP only surveys consumer plans, so business cards never match.
        match, best = None, 0.0
        want = tokens(c["name"])
        for p in [] if c["isBusiness"] else by_issuer.get(c["issuer"], []):
            have = tokens(p["product_name"])
            if want and have:
                j = len(want & have) / len(want | have)
                if j > best:
                    match, best = p["id"], j
        out.append({
            "card_id": c["cardId"],
            "name": c["name"],
            "issuer_key": c["issuer"],
            "network": c["network"],
            "currency": c["currency"],
            "is_business": bool(c["isBusiness"]),
            "annual_fee": float(c["annualFee"] or 0),
            "first_year_fee_waived": bool(c["isAnnualFeeWaived"]),
            "base_earn_pct": float(c.get("universalCashbackPercent") or 0),
            "bonus_amount": bonus,
            "bonus_value_usd": round(bonus * cents / 100, 2) if bonus is not None else None,
            "bonus_spend": offer.get("spend") if offer else None,
            "bonus_days": offer.get("days") if offer else None,
            # Chase's 5/24 counts personal cards from any issuer; most business cards don't report.
            "counts_toward_524": not c["isBusiness"],
            "point_value_cents": cents if c["currency"] != "USD" else None,
            "url": c.get("url"),
            "discontinued": bool(c.get("discontinued")),
            "tccp_product_id": match if best >= 0.5 else None,
        })
    return out


def load_fred() -> list[tuple[str, str, float]]:
    rows = []
    for sid in FRED_SERIES:
        with open(RAW / f"fred-{sid}.csv", newline="") as f:
            for rec in csv.DictReader(f):
                v = rec[sid]
                if v in ("", ".") or rec["observation_date"] < FRED_SINCE:
                    continue
                rows.append((sid, rec["observation_date"], float(v)))
    return rows


def write_csv(path: Path, rows: list[dict]):
    cols = list(rows[0].keys())
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for r in rows:
            w.writerow([
                pg_array(v) if isinstance(v, list)
                else "" if v is None
                else ("true" if v else "false") if isinstance(v, bool)
                else v
                for v in (r[c] for c in cols)
            ])


def ts_value(v):
    return json.dumps(v, ensure_ascii=False)


def write_game_catalog(products: list[dict], offers: list[dict], fred: list[tuple[str, str, float]]):
    """National, open-to-anyone plans plus current personal-card offers, as a typed TS module."""
    keep = [p for p in products if p["availability"] == "National" and not p["requires_membership"]]
    pfields = ["id", "institution", "issuer_key", "product_name", "secured", "min_tier", "variable_rate",
               "apr_no_score", "apr_poor", "apr_good", "apr_great", "apr_min", "apr_max",
               "intro_apr", "intro_months", "bt_apr", "bt_months", "bt_fee_pct", "bt_fee_min",
               "cash_apr", "cash_fee_pct", "cash_fee_min", "grace_days", "annual_fee",
               "foreign_fee_pct", "late_fee", "rewards"]
    live = [o for o in offers if not o["discontinued"] and not o["is_business"]]
    ofields = ["card_id", "name", "issuer_key", "currency", "annual_fee", "first_year_fee_waived",
               "base_earn_pct", "bonus_amount", "bonus_value_usd", "bonus_spend", "bonus_days", "tccp_product_id"]
    latest = {}
    for sid, d, v in fred:
        if sid not in latest or d > latest[sid][0]:
            latest[sid] = (d, v)

    camel = lambda s: re.sub(r"_([a-z0-9])", lambda m: m.group(1).upper(), s)  # noqa: E731
    lines = [
        "// Generated by research/data/cards/build_cards.py from the CFPB TCCP survey (2025-12-31),",
        "// the credit-card-bonuses-api export, and FRED. Do not edit by hand; rerun the script.",
        "",
        'import type { CardOffer, CardProduct } from "../sim/money/types.ts";',
        "",
        f"/** {len(keep)} national plans from the CFPB Terms of Credit Card Plans survey. Rates are fractions. */",
        "export const CARD_PRODUCTS: CardProduct[] = [",
    ]
    for p in keep:
        lines.append("  { " + ", ".join(f"{camel(k)}: {ts_value(p[k])}" for k in pfields) + " },")
    lines += ["];", "", f"/** {len(live)} current personal-card sign-up offers. */", "export const CARD_OFFERS: CardOffer[] = ["]
    for o in live:
        lines.append("  { " + ", ".join(f"{camel(k)}: {ts_value(o[k])}" for k in ofields) + " },")
    lines += ["];", "", "/** Latest FRED observation per series, as percents: [date, value]. */", "export const LATEST_RATES = {"]
    for sid, (d, v) in sorted(latest.items()):
        lines.append(f"  {sid}: [{ts_value(d)}, {v}],")
    lines += ["} as const;", ""]
    GAME_DATA.write_text("\n".join(lines))
    return len(keep), len(live)


# Card Shop: each curated card's CFPB survey plan (research/08, section 1).
CURATED_TCCP = {
    "chase-sapphire-preferred": "jpmorgan-chase-bank-sapphire-preferred",
    "chase-sapphire-reserve": "jpmorgan-chase-bank-sapphire-reserve",
    "chase-freedom-unlimited": "jpmorgan-chase-bank-freedom-unlimited",
    "chase-freedom-flex": "jpmorgan-chase-bank-freedom-flex",
    "amex-platinum": "american-express-national-bank-the-platinum-card",
    "amex-gold": "american-express-national-bank-american-express-gold-card",
    "amex-blue-cash-everyday": "american-express-national-bank-blue-cash-everyday-card",
    "amex-blue-cash-preferred": "american-express-national-bank-blue-cash-preferred-card",
    "capital-one-venture-x": "capital-one-venture-x-rewards",
    "capital-one-venture": "capital-one-venture-rewards",
    "capital-one-savor": "capital-one-savor-rewards",
    "capital-one-quicksilver": "capital-one-quicksilver-rewards-ranged-apr-offering",
    "capital-one-platinum": "capital-one-platinum-mastercard",
    "capital-one-platinum-secured": "capital-one-platinum-secured",
    "capital-one-savor-student": "capital-one-savor-rewards-for-students",
    "discover-it-cash-back": "capital-one-discover-it-cash-back-credit-card",
    "discover-it-student": "capital-one-discover-it-student-cash-back",
    "discover-it-secured": "capital-one-discover-it-secured-credit-card",
    "citi-double-cash": "citibank-citi-double-cash-card",
    "citi-custom-cash": "citibank-citi-custom-cash",
    "wells-fargo-active-cash": "wells-fargo-bank-wells-fargo-active-cash-card",
    "wells-fargo-reflect": "wells-fargo-bank-wells-fargo-reflect-card",
    "bofa-customized-cash": "bank-of-america-bank-of-america-customized-cash-rewards",
}
CURATED_JSON = HERE / "curated-cards.json"
ART_MANIFEST = HERE.parents[2] / "game" / "public" / "cards" / "art" / "manifest.json"
CURATED_TS = HERE.parents[2] / "game" / "src" / "data" / "cards-curated.ts"
PRODUCT_FIELDS = ["id", "institution", "issuer_key", "product_name", "secured", "min_tier", "variable_rate",
                  "apr_no_score", "apr_poor", "apr_good", "apr_great", "apr_min", "apr_max",
                  "intro_apr", "intro_months", "bt_apr", "bt_months", "bt_fee_pct", "bt_fee_min",
                  "cash_apr", "cash_fee_pct", "cash_fee_min", "grace_days", "annual_fee",
                  "foreign_fee_pct", "late_fee", "rewards"]


def camel(s: str) -> str:
    return re.sub(r"_([a-z0-9])", lambda m: m.group(1).upper(), s)


def annual_cap(cap: str | None) -> float | None:
    """'$1,500 combined per quarter' -> 6000; '$500 per billing cycle' -> 6000; '$6,000/yr' -> 6000."""
    if not cap:
        return None
    m = re.search(r"\$([\d,]+)", cap)
    if not m:
        # Discover's pages say "up to the quarterly maximum", which Discover publishes as $1,500.
        return 6000.0 if "quarterly maximum" in cap.lower() else None
    amount = float(m.group(1).replace(",", ""))
    low = cap.lower()
    if "quarter" in low:
        return amount * 4
    if "billing cycle" in low or "month" in low:
        return amount * 12
    return amount


def offer_usd(value: str, cents: float) -> tuple[float, bool]:
    """'75,000 points' at 1 cent -> 750; '$200' -> 200; a first-year cashback match -> (0, True)."""
    low = value.lower()
    if "match" in low:
        return 0.0, True
    m = re.search(r"([\d,]+)", value)
    n = float(m.group(1).replace(",", "")) if m else 0.0
    return (n if "$" in value else round(n * cents / 100, 2)), False


def apr_range(text: str) -> tuple[float | None, float | None]:
    nums = [round(float(x) / 100, 4) for x in re.findall(r"(\d+(?:\.\d+)?)%", text or "")]
    return (min(nums), max(nums)) if nums else (None, None)


def write_curated(products: list[dict]):
    """The Card Shop's real cards: issuer-page details + CFPB terms + official art."""
    if not CURATED_JSON.exists():
        return 0
    cards = json.loads(CURATED_JSON.read_text())
    by_id = {p["id"]: p for p in products}
    art = {a["slug"]: a for a in json.loads(ART_MANIFEST.read_text())} if ART_MANIFEST.exists() else {}
    out = []
    for c in cards:
        slug = c["slug"]
        p = dict(by_id[CURATED_TCCP[slug]])
        lo, hi = apr_range(c.get("regularApr", ""))
        # The issuer page is newer than the survey, so its current range bounds the APR.
        if lo is not None:
            p["apr_min"], p["apr_max"] = lo, hi
        cents = c.get("centsPerPointCashOut") or 1.0
        offer = None
        if c.get("welcomeOffer"):
            w = c["welcomeOffer"]
            usd_value, match = offer_usd(str(w.get("value") or ""), cents)
            offer = {"text": w["text"], "valueUsd": usd_value, "spend": w.get("spend") or 0, "months": w.get("months") or 3}
            if match:
                offer["cashbackMatch"] = True
        earn = []
        for e in c["earn"]:
            r = {"category": e["category"], "rate": e["rate"], "unit": e["unit"]}
            if e.get("cap"):
                r["cap"] = e["cap"]
                cap = annual_cap(e["cap"])
                if cap is not None:
                    r["annualCap"] = cap
            if e.get("note"):
                r["note"] = e["note"]
            earn.append(r)
        a = art.get(slug)
        entry = {
            "slug": slug,
            "name": c["name"],
            "issuer": c["issuer"],
            "network": c["network"],
            "creditNeeded": c["creditNeeded"],
            "secured": "secured" in slug,
            "student": "student" in slug,
            "annualFee": c["annualFee"],
            "firstYearFeeWaived": bool(c.get("firstYearFeeWaived")),
            "rewardsCurrency": c.get("rewardsCurrency") or "cash",
            "centsPerPoint": cents,
            "earn": earn,
            "welcomeOffer": offer,
            "introApr": c.get("introApr"),
            "regularApr": c.get("regularApr") or "",
            "foreignFee": c.get("foreignTransactionFee") or "",
            "perks": c.get("topPerks") or [],
            "sourceUrl": c["sourceUrl"],
            "checked": c.get("checked", "2026-09-11"),
            "art": {"src": f"/cards/art/{a['file']}", "width": a["width"], "height": a["height"], "sourceUrl": a["sourceUrl"]} if a else None,
            "terms": {camel(k): p[k] for k in PRODUCT_FIELDS},
            "tccpId": p["id"],
        }
        if c.get("unverified"):
            entry["unverified"] = True
            entry["unverifiedFields"] = c.get("unverifiedFields") or []
        if c.get("status"):
            entry["closed"] = c["status"]
        out.append(entry)
    lines = [
        "// Generated by research/data/cards/build_cards.py from research/data/cards/curated-cards.json",
        "// (issuer pages, checked 2026-09-11), the CFPB TCCP survey, and game/public/cards/art/manifest.json.",
        "// Do not edit by hand; rerun the script.",
        "",
        'import type { CuratedCard } from "../sim/money/types.ts";',
        "",
        'export const CURATED_AS_OF = "Sep 11, 2026";',
        'export const TCCP_AS_OF = "Dec 31, 2025";',
        "",
        f"/** {len(out)} real cards for the Card Shop. */",
        "export const CURATED: CuratedCard[] = " + json.dumps(out, indent=2, ensure_ascii=False) + ";",
        "",
    ]
    CURATED_TS.write_text("\n".join(lines))
    return len(out)


def main():
    products = load_tccp()
    offers = load_offers(products)
    fred = load_fred()
    n_curated = write_curated(products)
    print(f"curated:       {n_curated} Card Shop cards -> {CURATED_TS.name}")
    write_csv(HERE / "card_products.csv", products)
    write_csv(HERE / "card_offers.csv", offers)
    with open(HERE / "macro_rates.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["series", "date", "value"])
        w.writerows(fred)
    n_keep, n_live = write_game_catalog(products, offers, fred)
    matched = sum(1 for o in offers if o["tccp_product_id"])
    print(f"card_products: {len(products)} rows ({n_keep} national in the game catalog)")
    print(f"card_offers:   {len(offers)} rows ({n_live} live personal offers, {matched} matched to a TCCP plan)")
    print(f"macro_rates:   {len(fred)} rows across {len(FRED_SERIES)} FRED series since {FRED_SINCE}")


if __name__ == "__main__":
    main()
