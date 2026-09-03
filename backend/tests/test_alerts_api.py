"""GET /api/alerts and PUT /api/alerts/settings.

Every ledger below is built through the REAL import path (`/api/imports/analyze`
then `/commit`), so the coverage the router measures is the coverage a genuine
statement would produce -- a month is "imported" here because rows were
actually committed for it, never because a fixture said so.

Nothing in this file needs an API key or a network: no alert condition touches
a market provider or a model.
"""

from datetime import date

from app.config import settings
from app.models import AlertSettings

_MONTH_NAMES = [
    "JANVIER", "FEVRIER", "MARS", "AVRIL", "MAI", "JUIN",
    "JUILLET", "AOUT", "SEPTEMBRE", "OCTOBRE", "NOVEMBRE", "DECEMBRE",
]


def _register(client, tmp_path, monkeypatch, email="alertes@example.fr"):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    headers = {"Authorization": f"Bearer {body['access_token']}"}
    account = client.post("/api/accounts", headers=headers,
                          json={"name": "Courant", "kind": "checking"}).json()
    return headers, account["id"]


def _commit(client, headers, account_id, rows):
    csv = "\n".join(rows).encode("utf-8")
    preview = client.post("/api/imports/analyze", headers=headers,
                          files={"file": ("c.csv", csv, "text/csv")},
                          data={"account_id": str(account_id)}).json()
    response = client.post("/api/imports/commit", headers=headers, json={
        "upload_token": preview["upload_token"], "account_id": account_id,
        "dialect": preview["dialect"], "mapping": preview["suggested_mapping"],
        "overrides": {}, "keep_duplicates": [],
    })
    assert response.status_code in (200, 201), response.text


def _row(on: date, label: str, cents: int) -> str:
    return f"{on.day:02d}/{on.month:02d}/{on.year};{label};{cents / 100:.2f}".replace(".", ",")


def _condition(body, kind):
    return next(item for item in body["conditions"] if item["kind"] == kind)


def _alerts(body, kind):
    return [alert for alert in body["alerts"] if alert["kind"] == kind]


# -- The empty ledger -------------------------------------------------------


def test_a_household_with_no_statement_has_five_unmeasured_conditions(client):
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": "vide@example.fr", "password": "motdepasse123"}).json()
    headers = {"Authorization": f"Bearer {body['access_token']}"}

    report = client.get("/api/alerts", headers=headers)
    assert report.status_code == 200
    payload = report.json()

    assert payload["alerts"] == []
    assert len(payload["conditions"]) == 5
    assert all(item["measured"] is False for item in payload["conditions"])
    # Five conditions, five DIFFERENT causes: a shared sentence is how a wrong
    # cause spreads from one condition to the next.
    details = [item["detail"] for item in payload["conditions"]]
    assert len(set(details)) == 5
    assert payload["coverage"]["first_on"] is None
    assert payload["coverage"]["missing_months"] == []
    assert payload["notice"] is None
    assert payload["settings"]["balance_floor_cents"] is None


# -- The gap gate -----------------------------------------------------------


def test_a_debit_expected_in_an_unimported_month_is_reported_as_a_gap_not_a_miss(
    client, tmp_path, monkeypatch
):
    """The defect this whole task exists to prevent, end to end.

    Three monthly charges to 2025-05-04, then nothing at all in June, then one
    unrelated row on 2025-07-01. The subscription's next charge was due
    2025-06-03 -- inside a month no statement covers. The ledger cannot say
    whether it was paid, and the API must say exactly that.
    """
    headers, account_id = _register(client, tmp_path, monkeypatch)
    _commit(client, headers, account_id, [
        "date;libelle;montant",
        _row(date(2025, 3, 5), "PRELEVEMENT SEPA ABONNEMENT TEST", -1999),
        _row(date(2025, 4, 4), "PRELEVEMENT SEPA ABONNEMENT TEST", -1999),
        _row(date(2025, 5, 4), "PRELEVEMENT SEPA ABONNEMENT TEST", -1999),
        _row(date(2025, 7, 1), "CARTE X1234 UNE COURSE", -4200),
    ])

    body = client.get("/api/alerts", headers=headers).json()

    assert body["coverage"]["missing_months"] == ["2025-06"]
    assert _alerts(body, "missing_debit") == []

    missing = _condition(body, "missing_debit")
    assert missing["measured"] is True
    assert len(missing["withheld"]) == 1
    withheld = missing["withheld"][0]
    assert "juin 2025" in withheld
    assert "un mois que vos relevés ne couvrent pas" in withheld
    assert "un trou dans les données, pas un paiement manqué" in withheld

    # And the gap is announced once, at the top, because it governs how every
    # other card on the screen should be read.
    assert body["notice"] is not None
    assert "juin 2025" in body["notice"]


def test_a_debit_expected_inside_an_imported_month_really_does_fire(
    client, tmp_path, monkeypatch
):
    """The other half of the gate. Without this, a router that withheld
    everything would satisfy the test above for the wrong reason."""
    headers, account_id = _register(client, tmp_path, monkeypatch)
    _commit(client, headers, account_id, [
        "date;libelle;montant",
        _row(date(2025, 4, 5), "PRELEVEMENT SEPA ABONNEMENT TEST", -1999),
        _row(date(2025, 5, 5), "PRELEVEMENT SEPA ABONNEMENT TEST", -1999),
        _row(date(2025, 6, 4), "PRELEVEMENT SEPA ABONNEMENT TEST", -1999),
        _row(date(2025, 7, 20), "CARTE X1234 UNE COURSE", -4200),
    ])

    body = client.get("/api/alerts", headers=headers).json()

    assert body["coverage"]["missing_months"] == []
    fired = _alerts(body, "missing_debit")
    assert len(fired) == 1
    alert = fired[0]
    assert "ABONNEMENT TEST" in alert["title"]
    assert "19,99 €" in alert["measured"]
    assert "juillet 2025 est couvert par vos relevés" in alert["period"]
    assert alert["clears_when"]
    assert _condition(body, "missing_debit")["withheld"] == []


# -- The stored threshold ---------------------------------------------------


def test_a_threshold_is_absent_until_it_is_stored_and_absent_is_not_zero(
    client, tmp_path, monkeypatch
):
    headers, account_id = _register(client, tmp_path, monkeypatch)
    _commit(client, headers, account_id, [
        "date;libelle;montant",
        _row(date(2025, 4, 5), "CARTE X1234 UNE COURSE", -4200),
        _row(date(2025, 5, 5), "CARTE X1234 UNE AUTRE", -8200),
    ])

    body = client.get("/api/alerts", headers=headers).json()
    state = _condition(body, "balance_floor")
    assert state["measured"] is False
    assert "Un seuil absent n'est pas un seuil à 0 €" in state["detail"]
    assert _alerts(body, "balance_floor") == []


def test_storing_a_threshold_persists_it_and_clearing_it_removes_it(
    client, tmp_path, monkeypatch, db
):
    headers, _ = _register(client, tmp_path, monkeypatch)

    stored = client.put("/api/alerts/settings", headers=headers,
                        json={"balance_floor_cents": -50000})
    assert stored.status_code == 200
    assert stored.json()["balance_floor_cents"] == -50000
    assert db.query(AlertSettings).one().balance_floor_cents == -50000

    read_back = client.get("/api/alerts", headers=headers).json()
    assert read_back["settings"]["balance_floor_cents"] == -50000

    cleared = client.put("/api/alerts/settings", headers=headers,
                         json={"balance_floor_cents": None})
    assert cleared.json()["balance_floor_cents"] is None
    # The row survives, holding a real NULL -- not a 0 standing in for one.
    assert db.query(AlertSettings).one().balance_floor_cents is None
    assert client.get("/api/alerts", headers=headers).json()[
        "settings"]["balance_floor_cents"] is None


def test_a_threshold_stored_on_a_ledger_too_short_to_project_carries_the_engines_refusal(
    client, tmp_path, monkeypatch
):
    """An engine refusal travels through unchanged: the condition explains that
    the PROJECTION could not be built, never that no threshold was set."""
    headers, account_id = _register(client, tmp_path, monkeypatch)
    _commit(client, headers, account_id, [
        "date;libelle;montant",
        _row(date(2025, 4, 5), "CARTE X1234 UNE COURSE", -4200),
        _row(date(2025, 5, 5), "CARTE X1234 UNE AUTRE", -8200),
    ])
    client.put("/api/alerts/settings", headers=headers, json={"balance_floor_cents": 0})

    state = _condition(client.get("/api/alerts", headers=headers).json(), "balance_floor")
    assert state["measured"] is False
    assert "6 mois" in state["detail"]
    assert "Un seuil absent" not in state["detail"]


def test_a_long_ledger_under_a_high_floor_raises_the_balance_alert(
    client, tmp_path, monkeypatch
):
    """Ten complete months of real spending, then a floor set well above the
    projected band: the alert must fire, name the P10 it tested, and say what
    would clear it."""
    headers, account_id = _register(client, tmp_path, monkeypatch)
    rows = ["date;libelle;montant"]
    year, month = 2025, 1
    for index in range(11):
        rows.append(_row(date(year, month, 5), "PRELEVEMENT SEPA LOYER", -78000))
        rows.append(
            _row(date(year, month, 12), f"CARTE X1234 COURSES {_MONTH_NAMES[index % 12]}",
                 -30000 - index * 1500)
        )
        month += 1
        if month > 12:
            month, year = 1, year + 1
    _commit(client, headers, account_id, rows)

    client.put("/api/alerts/settings", headers=headers,
               json={"balance_floor_cents": 500_000_00})
    body = client.get("/api/alerts", headers=headers).json()

    fired = _alerts(body, "balance_floor")
    assert len(fired) == 1
    alert = fired[0]
    assert alert["severity"] == "critical"
    assert "pire dixième" in alert["measured"]
    assert "500 000,00 €" in alert["measured"]
    assert "Horizon projeté" in alert["period"]
    assert "seuil" in alert["clears_when"]
    assert _condition(body, "balance_floor")["measured"] is True


# -- Budgets ----------------------------------------------------------------


def test_a_crossed_budget_becomes_an_alert_naming_the_month_it_belongs_to(
    client, tmp_path, monkeypatch
):
    headers, account_id = _register(client, tmp_path, monkeypatch)
    _commit(client, headers, account_id, [
        "date;libelle;montant",
        _row(date(2025, 5, 6), "CARTE X1234 CARREFOUR MARKET", -22000),
        _row(date(2025, 5, 18), "CARTE X1234 CARREFOUR MARKET", -19000),
    ])
    categories = client.get("/api/categories", headers=headers).json()
    target = next(
        item for item in categories
        if client.get("/api/transactions", headers=headers).json()["items"][0]["category_id"]
        == item["id"]
    )
    client.patch(f"/api/categories/{target['id']}", headers=headers,
                 json={"monthly_budget_cents": 30000})

    body = client.get("/api/alerts", headers=headers).json()
    fired = _alerts(body, "budget_crossed")
    assert len(fired) == 1
    alert = fired[0]
    assert target["name"] in alert["title"]
    assert "410,00 €" in alert["measured"]
    assert "300,00 €" in alert["measured"]
    assert "mai 2025" in alert["period"]
    assert "1er juin 2025" in alert["clears_when"]


def test_with_no_budget_declared_the_budget_condition_is_unmeasured(
    client, tmp_path, monkeypatch
):
    headers, account_id = _register(client, tmp_path, monkeypatch)
    _commit(client, headers, account_id, [
        "date;libelle;montant",
        _row(date(2025, 5, 6), "CARTE X1234 CARREFOUR MARKET", -22000),
    ])
    state = _condition(client.get("/api/alerts", headers=headers).json(), "budget_crossed")
    assert state["measured"] is False
    assert "Aucun budget mensuel n'est déclaré" in state["detail"]


# -- Isolation --------------------------------------------------------------


def test_alerts_never_cross_users(client, tmp_path, monkeypatch):
    """Isolation, proven both ways. Bob's own read is asserted FIRST: if the
    seeding step silently wrote nothing -- a broken fixture, a rolled-back
    transaction -- that assertion fails before the isolation one ever gets a
    chance to pass for the wrong reason."""
    bob, bob_account = _register(client, tmp_path, monkeypatch, "bob@example.fr")
    alice, _ = _register(client, tmp_path, monkeypatch, "alice@example.fr")

    _commit(client, bob, bob_account, [
        "date;libelle;montant",
        _row(date(2025, 4, 5), "PRELEVEMENT SEPA ABONNEMENT BOB", -1999),
        _row(date(2025, 5, 5), "PRELEVEMENT SEPA ABONNEMENT BOB", -1999),
        _row(date(2025, 6, 4), "PRELEVEMENT SEPA ABONNEMENT BOB", -1999),
        _row(date(2025, 7, 20), "CARTE X1234 UNE COURSE", -4200),
    ])
    client.put("/api/alerts/settings", headers=bob, json={"balance_floor_cents": -12345})

    # First: the seed actually took effect for the user it was written for.
    bob_view = client.get("/api/alerts", headers=bob).json()
    assert bob_view["settings"]["balance_floor_cents"] == -12345
    assert bob_view["coverage"]["first_on"] == "2025-04-05"
    assert len(_alerts(bob_view, "missing_debit")) == 1
    assert "ABONNEMENT BOB" in _alerts(bob_view, "missing_debit")[0]["title"]

    # Only now: a different user, who did nothing, sees none of it.
    alice_view = client.get("/api/alerts", headers=alice).json()
    assert alice_view["settings"]["balance_floor_cents"] is None
    assert alice_view["coverage"]["first_on"] is None
    assert alice_view["alerts"] == []
    assert all(item["measured"] is False for item in alice_view["conditions"])


def test_alert_settings_are_per_user(client, tmp_path, monkeypatch, db):
    bob, _ = _register(client, tmp_path, monkeypatch, "bob2@example.fr")
    alice, _ = _register(client, tmp_path, monkeypatch, "alice2@example.fr")

    client.put("/api/alerts/settings", headers=bob, json={"balance_floor_cents": -1000})
    assert client.get("/api/alerts", headers=bob).json()[
        "settings"]["balance_floor_cents"] == -1000

    client.put("/api/alerts/settings", headers=alice, json={"balance_floor_cents": 250000})
    assert client.get("/api/alerts", headers=alice).json()[
        "settings"]["balance_floor_cents"] == 250000
    # Bob's own value is untouched by Alice writing hers.
    assert client.get("/api/alerts", headers=bob).json()[
        "settings"]["balance_floor_cents"] == -1000
    assert db.query(AlertSettings).count() == 2


def test_the_alerts_endpoint_requires_a_session(client):
    assert client.get("/api/alerts").status_code == 401
    assert client.put("/api/alerts/settings", json={"balance_floor_cents": 0}).status_code == 401
