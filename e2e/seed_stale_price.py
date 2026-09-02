"""Insert one deliberately OLD price point, so the browser gate can photograph
a stale price with no API key and no network.

`shoot.mjs` does everything else through the real API, which is the honest
user path. This one thing has no API: nothing in `/api/portfolio` writes a
`price_points` row directly -- a price gets there only as the side effect of a
provider fetch, which needs a key and a network the gate deliberately does not
have.

**Why this produces a stale price rather than a missing one.** `api/portfolio`'s
`_resolve_quote` reads the newest cached point first. Inside the quote TTL (five
minutes, `market/cache.py`) it answers fresh. Past it, it asks the provider --
which, with no key registered, raises `MarketError(NO_KEY)` -- and then falls
back to the cached value LABELLED STALE rather than dropping it. That fallback
is the whole point: a stale price is a different answer from a missing one, it
still counts toward every total, and it travels with the timestamp that makes
it honest.

So the row below is written far enough in the past to be unambiguously stale,
and the symbol it is written for is one the gate then declares a position in.

Usage:  python seed_stale_price.py <symbol> <asset_class> <price_cents> <days_old>
"""

import sqlite3
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

DB = Path(__file__).resolve().parent.parent / "backend" / "data" / "yieldo.db"


def main() -> int:
    if len(sys.argv) != 5:
        print(__doc__)
        return 2
    symbol, asset_class, price_cents, days_old = sys.argv[1:5]

    if not DB.exists():
        print(f"database not found: {DB}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA foreign_keys = ON")

    row = conn.execute(
        "SELECT id FROM instruments WHERE symbol = ? AND asset_class = ?",
        (symbol, asset_class),
    ).fetchone()
    if row is None:
        print(
            f"no instrument {symbol} ({asset_class}) -- declare it through the API first",
            file=sys.stderr,
        )
        return 1
    instrument_id = row[0]

    fetched_at = datetime.now(UTC) - timedelta(days=int(days_old))
    as_of = fetched_at.date()

    # `price_points` is unique on (instrument_id, as_of) -- upsert by hand so a
    # re-run of the gate replaces the row rather than failing on it.
    existing = conn.execute(
        "SELECT id FROM price_points WHERE instrument_id = ? AND as_of = ?",
        (instrument_id, as_of.isoformat()),
    ).fetchone()
    if existing is None:
        conn.execute(
            "INSERT INTO price_points (instrument_id, as_of, price_cents, source, fetched_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (instrument_id, as_of.isoformat(), int(price_cents), "finnhub",
             fetched_at.replace(tzinfo=None).isoformat()),
        )
    else:
        conn.execute(
            "UPDATE price_points SET price_cents = ?, source = ?, fetched_at = ? WHERE id = ?",
            (int(price_cents), "finnhub", fetched_at.replace(tzinfo=None).isoformat(),
             existing[0]),
        )

    # Any NEWER point for the same instrument would be picked first and answer
    # fresh, which would silently defeat the whole purpose of this script.
    conn.execute(
        "DELETE FROM price_points WHERE instrument_id = ? AND fetched_at > ?",
        (instrument_id, fetched_at.replace(tzinfo=None).isoformat()),
    )

    conn.commit()
    conn.close()
    print(f"{symbol}: cached {price_cents} cents as of {as_of}, fetched {days_old} days ago")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
