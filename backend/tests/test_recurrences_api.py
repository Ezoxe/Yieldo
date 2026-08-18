import random
from datetime import date

from app.config import settings


def _seed_monthly(client, headers, account_id, label, amount, start, count):
    """Write a monthly charge straight through the transactions API is not
    possible (there is no POST), so this uses the import pipeline's own commit
    path via a small CSV built in memory."""
    rows = ["date;libelle;montant"]
    for index in range(count):
        month = start.month - 1 + index
        year = start.year + month // 12
        on = date(year, month % 12 + 1, start.day)
        rows.append(f"{on.strftime('%d/%m/%Y')};{label};{amount / 100:.2f}".replace(".", ","))
    csv = "\n".join(rows).encode("utf-8")

    preview = client.post("/api/imports/analyze", headers=headers,
                          files={"file": ("r.csv", csv, "text/csv")},
                          data={"account_id": str(account_id)}).json()
    client.post("/api/imports/commit", headers=headers, json={
        "upload_token": preview["upload_token"], "account_id": account_id,
        "dialect": preview["dialect"], "mapping": preview["suggested_mapping"],
        "overrides": {}, "keep_duplicates": [],
    })


# (label, amount range in cents). The same French bank-export shapes as the
# operator's real seeded ledger (see
# .superpowers/sdd/2026-08-12-yieldo-phase-1-5-interface/seed_fixture.py),
# reduced to the fields this test actually needs. 22 debit merchants + 3
# credit merchants = 25 distinct label keys once normalised, matching the
# operator's real analysed_groups count.
_DEBIT_MERCHANTS = [
    ("CARTE X1234 CARREFOUR MARKET PARIS", (-12000, -1500)),
    ("CARTE X1234 LECLERC DRIVE", (-9500, -2200)),
    ("CARTE X1234 BOULANGERIE DU COIN", (-1800, -300)),
    ("CARTE X1234 TOTALENERGIES ACCESS", (-9000, -3500)),
    ("CARTE X1234 SNCF CONNECT", (-12000, -1900)),
    ("CARTE X1234 RATP NAVIGO", (-8600, -8600)),
    ("PRELEVEMENT EUROPEEN 0800042905 DE: PayPal Europe S.a.r.l. et Cie S.C.A", (-8900, -700)),
    ("PRELEVEMENT SEPA EDF CLIENTS PARTICULIERS", (-11000, -4200)),
    ("PRELEVEMENT SEPA FREE MOBILE", (-1999, -1999)),
    ("PRELEVEMENT SEPA SPOTIFY AB", (-1199, -1199)),
    ("PRELEVEMENT SEPA NETFLIX INTERNATIONAL BV", (-1549, -1549)),
    ("CARTE X1234 PHARMACIE CENTRALE", (-4200, -800)),
    ("CARTE X1234 AMAZON EU SARL", (-15000, -1200)),
    ("CARTE X1234 FNAC DARTY", (-24000, -1900)),
    ("CARTE X1234 DECATHLON", (-9000, -1500)),
    ("CARTE X1234 UBER EATS", (-3600, -1400)),
    ("CARTE X1234 LE COMPTOIR DES HALLES", (-6500, -1800)),
    ("VIREMENT SEPA EMIS LOYER AOUT", (-78000, -78000)),
    ("PRELEVEMENT SEPA MAIF ASSURANCES", (-3400, -3400)),
    ("FRAIS DE TENUE DE COMPTE", (-200, -200)),
    ("COTISATION CARTE BANCAIRE", (-450, -450)),
    ("RETRAIT DAB 12/03 PARIS RUE DE RIVOLI", (-20000, -2000)),
]
_CREDIT_MERCHANTS = [
    ("VIREMENT SEPA RECU SALAIRE MENSUEL EMPLOYEUR SAS", (210000, 240000)),
    ("VIREMENT SEPA RECU REMBOURSEMENT AMELI", (1200, 8900)),
    ("VIREMENT SEPA RECU CAF ALLOCATIONS", (9800, 21000)),
]
_MONTH_COUNTS = {
    (2025, 1): 13,
    (2025, 2): 61,
    (2025, 3): 20,
    (2025, 12): 77,
    (2026, 1): 26,
}
_FIRST_DAY = date(2025, 1, 24)
_LAST_DAY = date(2026, 1, 9)


def _seed_operator_shape(client, headers, account_id):
    """197 transactions across 25 merchant labels, dense in two months and
    sparse across a nine-month hole -- the real shape of the operator's own
    ledger (same source data as `.../seed_fixture.py`, generated here so it
    goes through the real import/dedup pipeline rather than a raw DB write).
    """
    rng = random.Random(20260812)
    rows = ["date;libelle;montant"]
    credit_slots = set(rng.sample(range(197), 18))
    index = 0
    for (year, month), count in _MONTH_COUNTS.items():
        for _ in range(count):
            if month == 1 and year == 2025:
                day = rng.randint(24, 31)
            elif month == 1 and year == 2026:
                day = rng.randint(1, 9)
            else:
                last = 28 if month == 2 else 31
                day = rng.randint(1, last)
            on = min(max(date(year, month, day), _FIRST_DAY), _LAST_DAY)

            label, (low, high) = rng.choice(
                _CREDIT_MERCHANTS if index in credit_slots else _DEBIT_MERCHANTS
            )
            amount = rng.randint(min(low, high), max(low, high))
            rows.append(
                f"{on.strftime('%d/%m/%Y')};{label};{amount / 100:.2f}".replace(".", ",")
            )
            index += 1

    csv = "\n".join(rows).encode("utf-8")
    preview = client.post("/api/imports/analyze", headers=headers,
                          files={"file": ("operateur.csv", csv, "text/csv")},
                          data={"account_id": str(account_id)}).json()
    client.post("/api/imports/commit", headers=headers, json={
        "upload_token": preview["upload_token"], "account_id": account_id,
        "dialect": preview["dialect"], "mapping": preview["suggested_mapping"],
        "overrides": {}, "keep_duplicates": [],
    })


def test_a_sparse_ledger_reports_nothing_and_explains_why(client, imported):
    """The Boursorama sample is four transactions over one week. Nothing in it
    is a recurrence, and the response must say so rather than return an
    unexplained empty list."""
    headers, _ = imported
    body = client.get("/api/recurrences", headers=headers).json()
    assert body["recurrences"] == []
    assert body["notice"] is not None
    assert "libellé" in body["notice"]


def test_a_monthly_charge_is_detected_and_annualised(client, imported):
    headers, account_id = imported
    _seed_monthly(client, headers, account_id, "PRELEVEMENT SEPA NETFLIX",
                  -1549, date(2026, 1, 10), 6)

    body = client.get("/api/recurrences", headers=headers).json()
    found = next(r for r in body["recurrences"] if "NETFLIX" in r["label"])
    assert found["periodicity"] == "monthly"
    assert found["occurrences"] == 6
    assert found["amount_cents"] == -1549
    assert found["annual_cents"] == -1549 * 12
    assert found["expected_next_on"] > found["last_on"]


def test_the_subscription_totals_are_reported(client, imported):
    headers, account_id = imported
    _seed_monthly(client, headers, account_id, "PRELEVEMENT SEPA NETFLIX",
                  -1549, date(2026, 1, 10), 6)

    body = client.get("/api/recurrences", headers=headers).json()
    assert body["annual_subscription_cents"] <= -1549 * 12
    assert body["monthly_subscription_cents"] < 0


def test_a_price_rise_is_carried_through_to_the_wire(client, imported):
    headers, account_id = imported
    _seed_monthly(client, headers, account_id, "PRELEVEMENT SEPA NETFLIX",
                  -1349, date(2025, 6, 10), 4)
    _seed_monthly(client, headers, account_id, "PRELEVEMENT SEPA NETFLIX",
                  -1599, date(2025, 10, 10), 4)

    body = client.get("/api/recurrences", headers=headers).json()
    found = next(r for r in body["recurrences"] if "NETFLIX" in r["label"])
    assert found["price_change"] is not None
    assert found["price_change"]["previous_cents"] == -1349
    assert found["price_change"]["current_cents"] == -1599
    assert body["price_change_count"] >= 1


def test_the_category_name_travels_with_the_recurrence(client, imported):
    headers, account_id = imported
    _seed_monthly(client, headers, account_id, "PRELEVEMENT SEPA NETFLIX",
                  -1549, date(2026, 1, 10), 6)
    body = client.get("/api/recurrences", headers=headers).json()
    found = next(r for r in body["recurrences"] if "NETFLIX" in r["label"])
    # The builtin rules file streaming under Abonnements; if they did not match,
    # the name is null rather than a guess.
    assert found["category_name"] is None or isinstance(found["category_name"], str)


def test_internal_transfers_are_never_reported_as_subscriptions(client, imported):
    headers, account_id = imported
    _seed_monthly(client, headers, account_id, "VIREMENT SEPA EMIS LIVRET A",
                  -50000, date(2026, 1, 5), 6)
    transactions = client.get("/api/transactions?limit=200", headers=headers).json()["items"]
    livret = [t for t in transactions if "LIVRET" in t["label_raw"]]
    for row in livret:
        client.patch(f"/api/transactions/{row['id']}", headers=headers,
                     json={"is_transfer": True})

    body = client.get("/api/recurrences", headers=headers).json()
    assert all("LIVRET" not in r["label"] for r in body["recurrences"])


def test_recurrences_require_authentication(client, imported):
    assert client.get("/api/recurrences").status_code == 401


def test_recurrences_never_cross_users(client, imported):
    headers, account_id = imported
    _seed_monthly(client, headers, account_id, "PRELEVEMENT SEPA NETFLIX",
                  -1549, date(2026, 1, 10), 6)

    other = client.post("/api/auth/register", json={
        "name": "Autre", "email": "autre@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}

    body = client.get("/api/recurrences", headers=other_headers).json()
    assert body["recurrences"] == []
    assert body["annual_subscription_cents"] == 0


def test_a_debit_at_the_ledgers_own_last_day_is_not_reported_ended(client, imported):
    """Task 7's carry-forward: `ended` must be judged against this user's own
    ledger, not the real calendar. A monthly charge whose last occurrence is
    the very last row imported has no later data contradicting it, and must
    not read as cancelled just because the test (and the real operator) is
    being read long after that date."""
    headers, account_id = imported
    _seed_monthly(client, headers, account_id, "PRELEVEMENT SEPA NETFLIX",
                  -1549, date(2025, 1, 10), 6)

    body = client.get("/api/recurrences", headers=headers).json()
    found = next(r for r in body["recurrences"] if "NETFLIX" in r["label"])
    assert found["status"] == "active"
    assert body["ledger_last_on"] == found["last_on"]


def test_the_operators_own_data_shape_explains_itself_in_french(client, tmp_path, monkeypatch):
    """197 transactions, 25 distinct merchant labels, two dense months either
    side of a nine-month hole -- the real shape of the operator's own ledger
    (see .superpowers/sdd/2026-08-12-yieldo-phase-1-5-interface/seed_fixture.py).
    A fresh user is registered here rather than reusing the `imported` fixture:
    that fixture's own Boursorama sample would add its own label keys to
    `analysed_groups` and blur the count this test pins.

    Nothing in this ledger is a subscription observed for long enough to
    annualise: the handful of card-purchase bursts that do pass the
    regularity test are each confined to a few weeks inside one dense month,
    well under the engine's 91-day floor. The screen must show this honestly
    (rows present, nothing annualised, a French notice) rather than either an
    unexplained empty list or a fabricated yearly total."""
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)

    registered = client.post("/api/auth/register", json={
        "name": "Operateur", "email": "operateur@example.com",
        "password": "motdepasse123"}).json()
    headers = {"Authorization": f"Bearer {registered['access_token']}"}
    account = client.post("/api/accounts", headers=headers,
                          json={"name": "Société Générale", "kind": "checking"}).json()
    _seed_operator_shape(client, headers, account["id"])

    body = client.get("/api/recurrences", headers=headers).json()
    assert body["analysed_groups"] == 25
    assert body["annual_subscription_cents"] == 0
    assert body["notice"] is not None
    assert "annualisable" in body["notice"] or "91" in body["notice"]
    # Not vacuous: several bursts (Decathlon, Amazon, Leclerc, a restaurant)
    # do clear the regularity test and are listed -- just never annualised.
    assert body["recurrences"] != []
    assert all(not r["annualisable"] for r in body["recurrences"])
    assert all(r["observed_span_days"] < 91 for r in body["recurrences"])
