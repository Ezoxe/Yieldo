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


def _adder(rows: list[tuple[date, str, int]]):
    def add(on: date, label: str, cents: int) -> None:
        if START <= on <= END:
            rows.append((on, label, cents))

    return add


def _checking(rng: random.Random) -> list[tuple[date, str, int]]:
    rows: list[tuple[date, str, int]] = []
    add = _adder(rows)

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

    # The income tax is withheld from the salary; only the yearly balance
    # reaches the account, and a balance over 300 € is taken in four
    # instalments from September to December.
    for month in (9, 10, 11, 12):
        add(_day(2025, month, 15), "PRLV DGFIP IMPOT REVENU", -31_000 // 4)

    # Everything the budget universes added is spending this household was not
    # designed with. The partner's monthly share into the joint account covers
    # it on average, so the account still ends each month where Avenir's story
    # needs it: tight, and just under zero at the end of September 2026.
    extras = _universe_extras()
    share = round(-sum(cents for _, _, cents in extras) / len(list(_months())))
    for year, month in _months():
        add(_day(year, month, 1), "VIR SEPA PARTICIPATION COMPTE JOINT", share)
    return rows + extras


def _universe_extras() -> list[tuple[date, str, int]]:
    """What the budget universes need to show something: the car beyond fuel,
    health, leisure, shopping, the 2026 tax balance and a fine.
    Each draws from a generator of its own, so the household above draws
    exactly what it drew before the universes existed."""
    rows: list[tuple[date, str, int]] = []
    add = _adder(rows)

    # The car, beyond fuel: tolls and parking most months (more of them in
    # summer), a garage visit each spring and autumn, one technical inspection.
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

    # Health, beyond the pharmacy: the mutuelle every month (up each January),
    # a GP visit or two most months, a specialist now and then, the optician
    # once and the dentist twice.
    care = random.Random(SEED + 11)
    for year, month in _months():
        days = calendar.monthrange(year, month)[1]
        premium = -6_790 if (year, month) >= (2026, 1) else -6_490
        add(_day(year, month, 6), "PRLV SEPA HARMONIE MUTUELLE", premium)
        for _ in range(care.choice([0, 1, 1, 2])):
            add(_day(year, month, care.randint(1, days)), "CB CABINET MEDICAL DU PARC", -3_000)
        if care.random() < 0.2:
            add(_day(year, month, care.randint(1, days)), "CB DR LEROY DERMATOLOGUE", -5_000)
    add(date(2025, 11, 14), "CB KRYS OPTICIEN", -18_900)
    add(date(2026, 3, 9), "CB CABINET DENTAIRE DU MAIL", -6_000)
    add(date(2026, 6, 22), "CB CABINET DENTAIRE DU MAIL", -4_500)

    # Leisure, which no built-in rule files (see HAND_FILING): the cinema
    # most months, a concert now and then, the pool, books and music, a tennis
    # club, a ski week.
    fun = random.Random(SEED + 13)
    for year, month in _months():
        days = calendar.monthrange(year, month)[1]
        for _ in range(fun.randint(1, 3)):
            seats = fun.randint(1, 2)
            add(_day(year, month, fun.randint(1, days)), "CB UGC CINE CITE", -1_190 * seats)
        if fun.random() < 0.25:
            concert = -fun.randint(4_500, 9_000)
            add(_day(year, month, fun.randint(1, days)), "CB TICKETMASTER", concert)
        for _ in range(fun.randint(1, 4)):
            add(_day(year, month, fun.randint(1, days)), "CB PISCINE MUNICIPALE", -450)
        if fun.random() < 0.6:
            add(_day(year, month, fun.randint(1, days)), "CB CULTURA", -fun.randint(1_200, 4_500))
    add(date(2025, 10, 4), "CB TENNIS CLUB MONTSOURIS", -18_000)
    add(date(2026, 2, 14), "CB PIERRE ET VACANCES", -38_000)

    # Shopping beyond the Amazon parcels and Decathlon above: clothes most
    # months, the furniture shop now and then, one appliance.
    shop = random.Random(SEED + 17)
    for year, month in _months():
        days = calendar.monthrange(year, month)[1]
        if shop.random() < 0.7:
            add(_day(year, month, shop.randint(1, days)), "CB ZARA", -shop.randint(2_500, 9_000))
        if shop.random() < 0.3:
            add(_day(year, month, shop.randint(1, days)), "CB UNIQLO", -shop.randint(1_500, 5_000))
        if shop.random() < 0.35:
            add(_day(year, month, shop.randint(1, days)), "CB IKEA", -shop.randint(1_500, 12_000))
    add(date(2026, 4, 11), "CB BOULANGER", -54_900)

    # The 2026 tax balance, taken from September like the 2025 one; a traffic
    # fine, filed by hand.
    for month in (9, 10, 11, 12):
        add(_day(2026, month, 15), "PRLV DGFIP IMPOT REVENU", -52_000 // 4)
    add(date(2026, 4, 8), "PRLV ANTAI AMENDE", -13_500)
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


def _category_ids(client: TestClient, headers: dict) -> dict[str, int]:
    flat: dict[str, int] = {}

    def walk(rows: list[dict]) -> None:
        for row in rows:
            flat[row["slug"]] = row["id"]
            walk(row.get("children", []))

    categories = client.get("/api/categories", headers=headers)
    categories.raise_for_status()
    walk(categories.json())
    return flat


def _set_budgets(client: TestClient, headers: dict, ceilings: dict[str, int]) -> None:
    """Ceilings on each universe's family and on the part that carries its
    gauge (fuel, energy, streaming, groceries, pharmacy, outings), so each
    universe has a dial to draw and a level to show."""
    ids = _category_ids(client, headers)
    for slug, cents in ceilings.items():
        client.patch(f"/api/categories/{ids[slug]}", headers=headers,
                     json={"monthly_budget_cents": cents}).raise_for_status()


# What the household files by hand, label by label: no built-in rule knows
# these, and the holiday rental is travel to the rules but a holiday to them.
HAND_FILING = {
    "CB UGC CINE CITE": "loisirs-sorties",
    "CB TICKETMASTER": "loisirs-sorties",
    "CB PISCINE MUNICIPALE": "loisirs-sport",
    "CB TENNIS CLUB MONTSOURIS": "loisirs-sport",
    "CB CULTURA": "loisirs-hobbies",
    "CB AIRBNB": "loisirs-vacances",
    "CB CAMPING LES PINS": "loisirs-vacances",
    "CB PIERRE ET VACANCES": "loisirs-vacances",
    "PRLV ANTAI AMENDE": "impots-autres",
}


def _file_by_hand(client: TestClient, headers: dict, filing: dict[str, str]) -> None:
    """Every operation whose label is in `filing` goes to that category,
    through the same PATCH the Transactions screen sends -- which also learns
    a rule from it, as it would for the household."""
    ids = _category_ids(client, headers)
    for label, slug in filing.items():
        page = client.get("/api/transactions", headers=headers,
                          params={"search": label, "limit": 500})
        page.raise_for_status()
        for row in page.json()["items"]:
            if row["label_raw"] == label and row["category_id"] != ids[slug]:
                client.patch(f"/api/transactions/{row['id']}", headers=headers,
                             json={"category_id": ids[slug]}).raise_for_status()


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
        _set_budgets(client, headers, {
            "transport": 35_000, "transport-carburant": 15_000,
            "logement": 125_000, "logement-energie": 15_000,
            "abonnements": 9_000, "abonnements-streaming": 3_000,
            "alimentation": 60_000, "alimentation-courses": 45_000,
            "sante": 18_000, "sante-pharmacie": 4_000,
            "loisirs": 25_000, "loisirs-sorties": 10_000,
            "achats": 30_000, "achats-vetements": 12_000,
            "impots": 30_000, "impots-revenu": 20_000,
        })
        _file_by_hand(client, headers, HAND_FILING)
    for name, count in counts.items():
        print(f"{name} : {count} opérations importées")
    print(f"Du {START.isoformat()} au {END.isoformat()} ; compte : {DEMO_EMAIL}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
