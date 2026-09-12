#!/usr/bin/env python3
"""Apply db/schema.sql to Tiger Data and load the real-world reference data.

  DATABASE_URL=postgres://tsdbadmin:...@HOST:PORT/tsdb?sslmode=require python3 db/load.py

Loads research/data/cards/{card_products,card_offers,macro_rates}.csv (build them first with
research/data/cards/build_cards.py), refreshes the continuous aggregates, and prints a check.
Safe to rerun: reference tables are truncated and reloaded; run data is never touched.
Needs psycopg 3 (`pip install "psycopg[binary]"`).
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import psycopg

GAME = Path(__file__).resolve().parents[1]
CARDS = GAME.parent / "research" / "data" / "cards"


def copy_csv(cur, table: str, path: Path, columns: str | None = None):
    with open(path, "rb") as f:
        header = f.readline().decode().strip()
        cols = columns or header
        with cur.copy(f"COPY {table} ({cols}) FROM STDIN WITH (FORMAT csv)") as cp:
            while chunk := f.read(1 << 16):
                cp.write(chunk)


def main():
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("Set DATABASE_URL (see SETUP.md, Tiger Data).")
    for name in ("card_products.csv", "card_offers.csv", "macro_rates.csv"):
        if not (CARDS / name).exists():
            sys.exit(f"Missing {CARDS / name}; run research/data/cards/build_cards.py first.")

    t0 = time.perf_counter()
    with psycopg.connect(url, autocommit=True) as conn, conn.cursor() as cur:
        cur.execute((GAME / "db" / "schema.sql").read_text())
        cur.execute("TRUNCATE card_offers, card_products, macro_rates")
        copy_csv(cur, "card_products", CARDS / "card_products.csv")
        copy_csv(cur, "card_offers", CARDS / "card_offers.csv")
        # macro_rates.csv is (series, date, value); stage it and convert the date to a timestamp.
        cur.execute("CREATE TEMP TABLE macro_stage (series text, date date, value double precision)")
        copy_csv(cur, "macro_stage", CARDS / "macro_rates.csv", "series, date, value")
        cur.execute("INSERT INTO macro_rates (ts, series, value) SELECT date::timestamptz, series, value FROM macro_stage")
        cur.execute("CALL refresh_continuous_aggregate('macro_rates_monthly', NULL, NULL)")

        cur.execute("SELECT (SELECT count(*) FROM card_products), (SELECT count(*) FROM card_offers), (SELECT count(*) FROM macro_rates)")
        products, offers, rates = cur.fetchone()
        print(f"Loaded {products} card plans, {offers} offers, {rates} rate observations in {time.perf_counter() - t0:.1f}s")
        cur.execute("SELECT tier, avg_apr_pct, plans FROM card_apr_by_tier")
        for tier, apr, n in cur.fetchall():
            print(f"  {tier:<48} {apr}%  ({n})")


if __name__ == "__main__":
    main()
