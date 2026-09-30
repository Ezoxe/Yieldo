"""A demonstration household, eighteen months deep, in the DEVELOPMENT database.

What it is for: judging the screens -- Avenir above all -- on a ledger shaped
like a real one (a salary on the 28th, rent on the 5th, subscriptions, a
quarterly water bill, a yearly insurance, groceries twice a week, a summer
holiday, a Christmas, a monthly transfer to a livret and one to a PEA), which
neither the `?apercu=1` stub nor the three-line test fixtures can give.

What it does:

1. deletes the demo user if it exists -- that user and nothing else, never the
   operator's own account;
2. creates it directly in the database (registration is closed once the first
   account exists, and the demo must not need the administrator);
3. goes through the REAL API, in-process: creates the three accounts, then
   imports one CSV per account through analyze + commit with the suggested
   mapping, exactly as the Import screen does. Categorisation, transfer
   marking and deduplication all run as they do for a real household.

Deterministic: the same seed always writes the same ledger.

Test credentials for this local development instance only -- they exist in no
other database and open nothing else.

Usage, from `backend/`:  ./.venv/Scripts/python.exe ../e2e/seed_demo_household.py
"""

import calendar
import io
import os
import random
import sys
from datetime import date, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
os.chdir(BACKEND)
sys.path.insert(0, str(BACKEND))

from fastapi.testclient import TestClient  # noqa: E402

from app.categorization.seed import seed_categories, seed_rules  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402
from app.security.passwords import hash_password  # noqa: E402

DEMO_EMAIL = "demo-avenir@example.com"
DEMO_PASSWORD = "demo-avenir-2026"
DEMO_NAME = "Foyer de démonstration"

START = date(2025, 3, 1)
END = date(2026, 9, 24)
SEED = 2026


def _day(year: int, month: int, day: int) -> date:
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def _months():
    year, month = START.year, START.month
    while (year, month) <= (END.year, END.month):
        yield year, month
        month += 1
        if month == 13:
            year, month = year + 1, 1


def _checking(rng: random.Random) -> list[tuple[date, str, int]]:
    rows: list[tuple[date, str, int]] = []

    def add(on: date, label: str, cents: int) -> None:
        if START <= on <= END:
            rows.append((on, label, cents))

    for year, month in _months():
        winter = month in (11, 12, 1, 2, 3)
        summer = month in (6, 7, 8)
        add(_day(year, month, 28), "VIR SEPA ACME SAS SALAIRE", 281_000)
        add(_day(year, month, 5), "PRLV SEPA FONCIA LOYER", -92_000)
        edf = 11_800 if winter else 5_200 if summer else 7_800
        add(_day(year, month, 8), "PRLV SEPA EDF CLIENTS PARTICULIERS", -(edf + rng.randint(-600, 600)))
        add(_day(year, month, 10), "PRLV SEPA DIRECT ASSURANCE AUTO", -5_230)
        add(_day(year, month, 12), "PRLV SEPA FREE TELECOM", -2_999)
        add(_day(year, month, 14), "PRLV SEPA BOUYGUES TELECOM", -1_599)
        netflix = -1_599 if (year, month) >= (2026, 1) else -1_349
        add(_day(year, month, 3), "PRLV NETFLIX.COM", netflix)
        add(_day(year, month, 21), "PRLV SPOTIFY AB", -1_112)
        add(_day(year, month, 2), "VIR SEPA VERS PEA", -20_000)
        add(_day(year, month, 30), "VIR PERMANENT VERS LIVRET A", -30_000)
        if month in (1, 4, 7, 10):
            add(_day(year, month, 15), "PRLV SEPA VEOLIA EAU", -(9_500 + rng.randint(-1_000, 1_000)))
        if month == 3:
            add(_day(year, month, 20), "PRLV SEPA MAIF HABITATION", -28_000)
        if month == 12:
            add(_day(year, month, 20), "VIR SEPA ACME SAS PRIME ANNUELLE", 120_000)
            add(_day(year, month, 16), "CB FNAC PARIS", -18_000)
            add(_day(year, month, 19), "CB GALERIES LAFAYETTE", -22_000)
        if month == 7:
            add(_day(year, month, 8), "CB AIRBNB", -65_000)
        if month == 8:
            add(_day(year, month, 3), "CB SNCF CONNECT", -18_000)
            add(_day(year, month, 11), "CB CAMPING LES PINS", -42_000)

        # Everyday spending: twice a week at the supermarket, a few meals out,
        # fuel twice a month, a purchase or two, the pharmacy.
        days = calendar.monthrange(year, month)[1]
        for day in range(1, days + 1):
            on = date(year, month, day)
            if on.weekday() in (1, 5) and rng.random() < 0.9:
                shop = rng.choice(["CB CARREFOUR MARKET", "CB LIDL", "CB BIOCOOP"])
                add(on, shop, -rng.randint(3_000, 8_500))
        for _ in range(rng.randint(3, 5) + (3 if month in (7, 8) else 0)):
            place = rng.choice(["CB LE COMPTOIR", "CB SUSHI SHOP", "CB BOULANGERIE PAUL"])
            add(_day(year, month, rng.randint(1, days)), place, -rng.randint(1_500, 6_000))
        for _ in range(2):
            add(_day(year, month, rng.randint(1, days)), "CB TOTALENERGIES", -rng.randint(4_500, 7_500))
        for _ in range(rng.randint(1, 2)):
            shop = rng.choice(["CB AMAZON EU", "CB DECATHLON"])
            add(_day(year, month, rng.randint(1, days)), shop, -rng.randint(2_000, 15_000))
        if rng.random() < 0.7:
            add(_day(year, month, rng.randint(1, days)), "CB PHARMACIE DU CENTRE", -rng.randint(800, 4_000))
        if rng.random() < 0.15:
            add(_day(year, month, rng.randint(1, days)), "VIR LEBONCOIN", rng.randint(3_000, 12_000))

    # The car, beyond fuel: tolls and parking most months (more of them in
    # summer), a garage visit each spring and autumn, one technical
    # inspection. A generator of its own, so every draw above keeps the value
    # it had before the car universe existed.
    car = random.Random(SEED + 7)
    for year, month in _months():
        days = calendar.monthrange(year, month)[1]
        for _ in range(car.randint(1, 2) + (2 if month in (7, 8) else 0)):
            toll = -car.randint(450, 2_200)
            add(_day(year, month, car.randint(1, days)), "CB VINCI AUTOROUTES", toll)
        for _ in range(car.randint(0, 2)):
            add(_day(year, month, car.randint(1, days)), "CB INDIGO PARK", -car.randint(300, 1_500))
        if month in (4, 10):
            add(_day(year, month, car.randint(5, 25)), "CB NORAUTO", -car.randint(9_000, 24_000))
    add(date(2026, 6, 18), "CB CONTROLE TECHNIQUE AUTOSUR", -8_900)

    add(date(2025, 9, 15), "PRLV DGFIP IMPOT REVENU", -31_000)
    return rows


def _livret() -> list[tuple[date, str, int]]:
    rows = [
        (_day(year, month, 30), "VIR PERMANENT DEPUIS COMPTE COURANT", 30_000)
        for year, month in _months()
        if START <= _day(year, month, 30) <= END
    ]
    rows.append((date(2025, 12, 31), "INTERETS ANNUELS", 9_650))
    return rows


def _pea() -> list[tuple[date, str, int]]:
    return [
        (_day(year, month, 2), "VIR SEPA DEPUIS COMPTE COURANT", 20_000)
        for year, month in _months()
        if START <= _day(year, month, 2) <= END
    ]


def _csv(rows: list[tuple[date, str, int]], title: str) -> bytes:
    """The Boursorama shape the importer's own fixture uses."""
    out = io.StringIO()
    out.write(f"Exportation des opérations du compte\r\n{title}\r\n\r\n")
    out.write("dateOp;dateVal;label;category;amount\r\n")
    for on, label, cents in sorted(rows):
        sign = "-" if cents < 0 else ""
        value = abs(cents)
        stamp = on.strftime("%d/%m/%Y")
        out.write(f"{stamp};{stamp};{label};;{sign}{value // 100},{value % 100:02d}\r\n")
    return out.getvalue().encode("utf-8")


def _recreate_user() -> None:
    with SessionLocal() as db:
        existing = db.query(User).filter(User.email == DEMO_EMAIL).first()
        if existing is not None:
            db.delete(existing)
            db.commit()
        user = User(email=DEMO_EMAIL, name=DEMO_NAME,
                    password_hash=hash_password(DEMO_PASSWORD), role="user")
        db.add(user)
        db.commit()
        db.refresh(user)
        seed_rules(db, user.id, seed_categories(db, user.id))


def _import(client: TestClient, headers: dict, account_id: int, content: bytes, name: str) -> int:
    preview = client.post(
        "/api/imports/analyze", headers=headers,
        files={"file": (name, content, "text/csv")},
        data={"account_id": str(account_id)},
    )
    preview.raise_for_status()
    body = preview.json()
    committed = client.post("/api/imports/commit", headers=headers, json={
        "upload_token": body["upload_token"], "account_id": account_id,
        "dialect": body["dialect"], "mapping": body["suggested_mapping"],
        "original_filename": name, "overrides": {}, "keep_duplicates": [],
    })
    committed.raise_for_status()
    return body["summary"]["importable"]


def _set_budgets(client: TestClient, headers: dict, ceilings: dict[str, int]) -> None:
    """Ceilings on the car's family and on its fuel, so the Transport universe
    has a dial to draw and a tank with a level."""
    flat: dict[str, int] = {}

    def walk(rows: list[dict]) -> None:
        for row in rows:
            flat[row["slug"]] = row["id"]
            walk(row.get("children", []))

    categories = client.get("/api/categories", headers=headers)
    categories.raise_for_status()
    walk(categories.json())
    for slug, cents in ceilings.items():
        client.patch(f"/api/categories/{flat[slug]}", headers=headers,
                     json={"monthly_budget_cents": cents}).raise_for_status()


def main() -> int:
    rng = random.Random(SEED)
    _recreate_user()
    with TestClient(app) as client:
        login = client.post("/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
        login.raise_for_status()
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        def account(name: str, kind: str, opening: int) -> int:
            response = client.post("/api/accounts", headers=headers, json={
                "name": name, "kind": kind, "opening_balance_cents": opening,
                "opened_on": START.isoformat()})
            response.raise_for_status()
            return response.json()["id"]

        checking = account("Compte courant", "checking", 80_000)
        livret = account("Livret A", "savings", 420_000)
        pea = account("PEA", "pea", 300_000)
        counts = {
            "Compte courant": _import(client, headers, checking,
                                      _csv(_checking(rng), "Compte courant"), "courant.csv"),
            "Livret A": _import(client, headers, livret, _csv(_livret(), "Livret A"), "livret.csv"),
            "PEA": _import(client, headers, pea, _csv(_pea(), "PEA"), "pea.csv"),
        }
        _set_budgets(client, headers, {"transport": 35_000, "transport-carburant": 15_000})
    for name, count in counts.items():
        print(f"{name} : {count} opérations importées")
    print(f"Du {START.isoformat()} au {END.isoformat()} ; compte : {DEMO_EMAIL}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
