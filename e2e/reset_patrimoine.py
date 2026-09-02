"""Put the portfolio back to the operator's real state: nothing declared.

`shoot.mjs task-10` photographs a household that has declared no investment
account, no position and no target allocation -- which is where `seed_fixture.py`
leaves things and where every new user starts. `shoot.mjs task-10-positions`
then declares three holdings through the real API to photograph the other
state, and it is NOT reversible from the API alone: `DELETE /portfolio/accounts`
archives rather than deletes, by design.

So the two-state sequence is:

    python reset_patrimoine.py
    node shoot.mjs task-10
    node shoot.mjs task-10-positions

Without the reset, a second run of `task-10` photographs the seeded portfolio
and silently claims it is the empty state.

Instruments and price points are cleared too. An instrument is shared,
unowned reference data and nothing forces its removal -- but leaving a stale
`price_points` row behind would make the next `task-10-positions` run answer
from a cache this script's own caller did not put there, which is exactly the
kind of "passes for the wrong reason" this repository keeps paying for.
"""

import sqlite3
from pathlib import Path

DB = Path(__file__).resolve().parent.parent / "backend" / "data" / "yieldo.db"
EMAIL = "demo@yieldo-demo.fr"


def main() -> int:
    if not DB.exists():
        print(f"database not found: {DB}")
        return 1

    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA foreign_keys = ON")

    row = conn.execute("SELECT id FROM users WHERE email = ?", (EMAIL,)).fetchone()
    if row is None:
        print(f"no user {EMAIL} -- run seed_fixture.py first")
        return 1
    user_id = row[0]

    # Ordered by dependency: lots reference positions, positions reference
    # accounts and instruments, price points reference instruments.
    counts = {}
    for table, sql, params in (
        ("lots", "DELETE FROM lots WHERE user_id = ?", (user_id,)),
        ("positions", "DELETE FROM positions WHERE user_id = ?", (user_id,)),
        ("investment_accounts", "DELETE FROM investment_accounts WHERE user_id = ?", (user_id,)),
        ("allocation_targets", "DELETE FROM allocation_targets WHERE user_id = ?", (user_id,)),
        ("quota_windows", "DELETE FROM quota_windows WHERE user_id = ?", (user_id,)),
        ("price_points", "DELETE FROM price_points", ()),
        ("instruments", "DELETE FROM instruments", ()),
    ):
        counts[table] = conn.execute(sql, params).rowcount

    conn.commit()
    conn.close()
    print("reset: " + ", ".join(f"{table} {n}" for table, n in counts.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
