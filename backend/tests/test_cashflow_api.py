import random
from datetime import date

from app.config import settings

_MONTH_NAMES = [
    "JANVIER", "FEVRIER", "MARS", "AVRIL", "MAI", "JUIN",
    "JUILLET", "AOUT", "SEPTEMBRE", "OCTOBRE", "NOVEMBRE", "DECEMBRE",
]


def _commit(client, headers, account_id, rows):
    csv = "\n".join(rows).encode("utf-8")
    preview = client.post("/api/imports/analyze", headers=headers,
                          files={"file": ("c.csv", csv, "text/csv")},
                          data={"account_id": str(account_id)}).json()
    client.post("/api/imports/commit", headers=headers, json={
        "upload_token": preview["upload_token"], "account_id": account_id,
        "dialect": preview["dialect"], "mapping": preview["suggested_mapping"],
        "overrides": {}, "keep_duplicates": [],
    })


def _import_months(client, headers, account_id, label, amount, first_month, count, day=15):
    """One charge a month, at a fixed amount, under one label -- a genuine
    recurrence, detected by `detect_recurrences` and windowed whole out of the
    residual by `build_observations`."""
    rows = ["date;libelle;montant"]
    year, month = first_month
    for _ in range(count):
        rows.append(f"{day:02d}/{month:02d}/{year};{label};{amount / 100:.2f}".replace(".", ","))
        month += 1
        if month > 12:
            month, year = 1, year + 1
    _commit(client, headers, account_id, rows)


def _import_unique_months(client, headers, account_id, base_label, amounts, first_month, day=5):
    """One uniquely-labelled, one-off transaction per month (a distinct French
    month name appended to the label). `detect_recurrences` groups by label key
    alone, and a label seen only once is `rejected_thin` -- `MIN_OCCURRENCES`
    is 3 -- so none of this can ever be windowed out of the residual the way a
    fixed monthly label is. This is what makes it genuine residual data rather
    than an accidental second recurrence."""
    rows = ["date;libelle;montant"]
    year, month = first_month
    for i, amount in enumerate(amounts):
        label = f"{base_label} {_MONTH_NAMES[i % 12]}"
        rows.append(f"{day:02d}/{month:02d}/{year};{label};{amount / 100:.2f}".replace(".", ","))
        month += 1
        if month > 12:
            month, year = 1, year + 1
    _commit(client, headers, account_id, rows)


_VARIED_AMOUNTS = [-8000, -15000, -6000, -22000, -9500, -13000, -7000, -18000, -11000, -16000]


def test_a_sparse_ledger_refuses_to_forecast_and_explains_why(client, imported):
    """The Boursorama sample spans one week. Six complete observed months is the
    floor, and the response has to name the shortfall rather than return an
    empty months array with no comment."""
    headers, _ = imported
    body = client.get("/api/cashflow/forecast", headers=headers).json()
    assert body["months"] == []
    assert body["insufficient_reason"] is not None
    assert "6 mois" in body["insufficient_reason"]


def test_enough_history_produces_twelve_banded_months(client, imported):
    """Uses uniquely-labelled residual rows, not a fixed monthly label: a fixed
    label repeated every month at a regular interval is itself a genuine
    recurrence and `build_observations` would window it whole out of the
    residual, leaving nothing to measure a band from."""
    headers, account_id = imported
    _import_unique_months(client, headers, account_id, "ACHAT DIVERS", _VARIED_AMOUNTS, (2025, 1))

    body = client.get("/api/cashflow/forecast", headers=headers).json()
    assert body["insufficient_reason"] is None
    assert len(body["months"]) == 12
    first = body["months"][0]
    assert first["balance_p10_cents"] < first["balance_p50_cents"] < first["balance_p90_cents"]


def test_the_horizon_and_the_threshold_are_both_honoured(client, imported):
    headers, account_id = imported
    _import_unique_months(client, headers, account_id, "ACHAT DIVERS", _VARIED_AMOUNTS, (2025, 1))

    body = client.get("/api/cashflow/forecast?months=6&threshold_cents=-100000",
                      headers=headers).json()
    assert len(body["months"]) == 6
    assert body["threshold_cents"] == -100_000


def test_an_out_of_range_horizon_is_refused_in_french(client, imported):
    """`forecast.MAX_HORIZON_MONTHS` is 24, not the 60 the auto-extracted brief's
    Query bound used: past 24, `project_cashflow` itself raises a ValueError
    that nothing in this app catches (an untranslated 500), so the route's own
    bound must match the engine's or 25..60 would 500 instead of the clean
    French 422 every other malformed input in this API gets."""
    headers, _ = imported
    response = client.get("/api/cashflow/forecast?months=0", headers=headers)
    assert response.status_code == 422
    response = client.get("/api/cashflow/forecast?months=25", headers=headers)
    assert response.status_code == 422
    assert "24" in response.json()["detail"][0]["msg"]


def test_the_opening_balance_is_the_liquid_balance(client, imported):
    headers, _ = imported
    body = client.get("/api/cashflow/forecast", headers=headers).json()
    runway = client.get("/api/cashflow/runway", headers=headers).json()
    assert body["opening_balance_cents"] == runway["balance_cents"]


def test_forecast_distinguishes_ledger_months_from_residual_months(client, imported):
    """`ForecastReport`'s own docstring: the screen needs BOTH counts ("12 mois
    de relevés, 3 exploitables") to avoid conflating "no statement imported"
    with "nothing non-recurring happened". June here carries only the
    projected rent charge -- a complete ledger month with zero residual -- and
    must count in `ledger_months_observed` without counting in
    `months_observed`."""
    headers, account_id = imported

    rows = ["date;libelle;montant"]
    year, month = 2025, 1
    for _ in range(10):
        rows.append(f"15/{month:02d}/{year};PRELEVEMENT SEPA LOYER;-700,00")
        month += 1
        if month > 12:
            month, year = 1, year + 1
    # A unique residual purchase every month except June.
    amounts_by_month = {1: -8000, 2: -15000, 3: -6000, 4: -22000,
                        5: -9500, 7: -13000, 8: -7000, 9: -18000, 10: -16000}
    for month_num, amount in amounts_by_month.items():
        rows.append(
            f"05/{month_num:02d}/2025;ACHAT DIVERS {_MONTH_NAMES[month_num - 1]};"
            + f"{amount / 100:.2f}".replace(".", ",")
        )
    _commit(client, headers, account_id, rows)

    body = client.get("/api/cashflow/forecast", headers=headers).json()
    assert body["insufficient_reason"] is None
    assert body["ledger_months_observed"] > body["months_observed"]


def test_forecast_projects_from_the_ledgers_own_last_date_not_the_real_clock(
    client, imported
):
    """The ledger built here stops in October 2025, long before the real clock
    this test runs against. A recurring monthly charge running right up to the
    ledger's last imported row must still read as an active, projected
    recurrence -- exactly the failure task 8 fixed for `/api/recurrences`,
    reproduced here for the forecast's own `today`. Using the real clock
    instead would age the charge past `ended` and silently zero out
    `recurring_cents` in every projected month."""
    headers, account_id = imported
    _import_months(client, headers, account_id, "PRELEVEMENT SEPA LOYER", -70_000,
                   (2025, 1), 10, day=15)
    _import_unique_months(client, headers, account_id, "ACHAT DIVERS", _VARIED_AMOUNTS,
                          (2025, 1), day=5)

    body = client.get("/api/cashflow/forecast", headers=headers).json()
    assert body["insufficient_reason"] is None
    assert body["ledger_last_on"] == "2025-10-15"
    assert any(month["recurring_cents"] != 0 for month in body["months"])


def test_forecast_reports_the_scales_and_recurrence_count_the_band_is_built_from(
    client, imported
):
    """`ForecastReport`'s own docstring: these fields exist "so a screen can
    explain a band without re-measuring it" and "the screen needs the
    difference to explain what is in the chart" -- dropping them forces task
    13 to re-derive methodology the engine already measured."""
    headers, account_id = imported
    _import_months(client, headers, account_id, "PRELEVEMENT SEPA LOYER", -70_000,
                   (2025, 1), 10, day=15)
    _import_unique_months(client, headers, account_id, "ACHAT DIVERS", _VARIED_AMOUNTS,
                          (2025, 1), day=5)

    body = client.get("/api/cashflow/forecast", headers=headers).json()
    assert body["recurrences_projected"] == 1
    assert body["pooled_scale_cents"] > 0
    assert body["seasonal_scale_cents"] is None or body["seasonal_scale_cents"] >= 0


def test_both_payloads_name_their_own_projection_anchor(client, imported):
    """The forecast and the runway project from two different dates on
    purpose (see `api/cashflow.py`'s module docstring). Neither payload can
    leave the screen to infer its anchor from a backend docstring it will
    never read."""
    headers, account_id = imported
    _import_unique_months(client, headers, account_id, "ACHAT DIVERS", _VARIED_AMOUNTS, (2025, 1))

    forecast_body = client.get("/api/cashflow/forecast", headers=headers).json()
    runway_body = client.get("/api/cashflow/runway", headers=headers).json()

    assert forecast_body["projected_from"] == forecast_body["ledger_last_on"]
    assert runway_body["projected_from"] == str(date.today())


def test_runway_refuses_on_two_observed_months(client, imported):
    headers, _ = imported
    body = client.get("/api/cashflow/runway", headers=headers).json()
    assert body["normal"] is None
    assert body["normal_unavailable_reason"] is not None
    assert "3 mois" in body["normal_unavailable_reason"]
    assert body["essentials"] is None
    assert body["essentials_unavailable_reason"] is not None


def test_runway_reports_both_scenarios_when_it_can(client, imported):
    headers, account_id = imported
    # "COURSES" matches the builtin grocery rule, which is an essential category.
    _import_months(client, headers, account_id, "CARTE X1234 CARREFOUR COURSES",
                   -20_000, (2025, 1), 6)
    _import_months(client, headers, account_id, "CARTE X1234 RESTAURANT LE COMPTOIR",
                   -15_000, (2025, 1), 6)

    body = client.get("/api/cashflow/runway", headers=headers).json()
    assert body["months_observed"] >= 3
    assert body["normal"] is not None
    assert body["essentials"] is not None
    # Cutting to essentials always costs less than not cutting.
    assert body["essentials"]["monthly_burn_cents"] <= body["normal"]["monthly_burn_cents"]


def test_runway_scenarios_carry_their_own_independent_sample_size(client, imported):
    """`runway.RunwayScenario.rate` publishes the band AND the scenario's OWN
    sample size -- `essentials` is measured over its own, self-selected set
    of months, which can be narrower than `normal`'s. A restaurant charge (not
    essential) runs six months; the essential grocery charge only runs the
    first four of those -- so `essentials.rate.months` must come out smaller
    than `normal.rate.months`, and a single combined `months_observed` could
    never say so."""
    headers, account_id = imported
    _import_months(client, headers, account_id, "CARTE X1234 CARREFOUR COURSES",
                   -20_000, (2025, 1), 4)
    _import_months(client, headers, account_id, "CARTE X1234 RESTAURANT LE COMPTOIR",
                   -15_000, (2025, 1), 6)

    body = client.get("/api/cashflow/runway", headers=headers).json()
    assert body["normal"]["rate"]["months"] == 4
    assert body["essentials"]["rate"]["months"] == 3
    assert body["essentials"]["rate"]["months"] < body["normal"]["rate"]["months"]
    for scenario in (body["normal"], body["essentials"]):
        rate = scenario["rate"]
        assert rate["low_cents"] <= rate["median_cents"] <= rate["high_cents"]


def test_an_uncategorised_transaction_counts_toward_normal_but_not_essentials(
    client, imported
):
    """Task 10's precondition, carried into task 12: `category_id IS NULL` is
    not essential. It can only shorten the essentials runway, never inflate
    it. A label matching no builtin rule stays uncategorised; its spend must
    widen `normal`'s burn without ever reaching `essentials`'."""
    headers, account_id = imported
    _import_months(client, headers, account_id, "CARTE X1234 CARREFOUR COURSES",
                   -20_000, (2025, 1), 6)
    _import_months(client, headers, account_id, "ZQXJVK OPERATION 5591 REF 8823",
                   -50_000, (2025, 1), 6)

    transactions = client.get("/api/transactions?limit=200", headers=headers).json()["items"]
    unmatched = [t for t in transactions if "ZQXJVK" in t["label_raw"]]
    assert unmatched and all(t["category_id"] is None for t in unmatched)

    body = client.get("/api/cashflow/runway", headers=headers).json()
    assert body["normal"]["monthly_burn_cents"] > body["essentials"]["monthly_burn_cents"]


def test_runway_reports_how_many_categories_are_marked_essential(client, imported):
    """The reduced scenario is only as meaningful as that list, so the screen
    has to be able to say how many categories it rests on."""
    headers, _ = imported
    body = client.get("/api/cashflow/runway", headers=headers).json()
    assert body["essential_category_count"] == 21


def test_runway_projects_the_depletion_date_from_the_real_clock(client, imported):
    """Unlike `forecast`, `compute_runway` does not classify anything by
    staleness -- `today` only anchors `depleted_on`, a forward calendar date,
    and the "already at zero" branch. Anchoring it to the stale ledger date
    instead would land `depleted_on` in the past whenever the runway is
    shorter than the gap since the last import, a worse answer than a burn
    rate measured on old data but projected forward from today."""
    headers, account_id = imported
    _import_months(client, headers, account_id, "CARTE X1234 CARREFOUR COURSES",
                   -20_000, (2025, 1), 6)

    body = client.get("/api/cashflow/runway", headers=headers).json()
    depleted_on = body["normal"]["depleted_on"]
    assert depleted_on is None or depleted_on >= str(date.today())


def test_runway_carries_the_ledgers_last_date_alongside_the_real_projection(
    client, imported
):
    headers, account_id = imported
    _import_months(client, headers, account_id, "CARTE X1234 CARREFOUR COURSES",
                   -20_000, (2025, 1), 6)
    body = client.get("/api/cashflow/runway", headers=headers).json()
    assert body["ledger_last_on"] == "2025-06-15"


def test_cashflow_requires_authentication(client, imported):
    assert client.get("/api/cashflow/forecast").status_code == 401
    assert client.get("/api/cashflow/runway").status_code == 401


def test_cashflow_never_crosses_users(client, imported):
    headers, account_id = imported
    _import_unique_months(client, headers, account_id, "ACHAT DIVERS", _VARIED_AMOUNTS, (2025, 1))

    other = client.post("/api/auth/register", json={
        "name": "Autre", "email": "autre@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}

    forecast = client.get("/api/cashflow/forecast", headers=other_headers).json()
    runway = client.get("/api/cashflow/runway", headers=other_headers).json()
    assert forecast["months"] == []
    assert runway["balance_cents"] == 0
    assert runway["normal"] is None


def test_the_operators_own_data_shape_forecast_refuses_and_runway_computes(
    client, tmp_path, monkeypatch
):
    """The operator's real ledger has 3 complete observed months (2025-01 and
    2026-01 are partial; the nine months between are an unimported hole, never
    counted as zero-spend). The forecast's floor is 6, so it refuses; the
    runway's floor is 3, so it computes and is measured on exactly that count.
    The ledger's dates still span thirteen distinct calendar months
    (2025-01..2026-01 inclusive) -- `ledger_span_months` is what lets the
    screen tell this dense-looking "3 mois mesurés" apart from a genuinely
    dense three-month ledger with no hole at all."""
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)

    registered = client.post("/api/auth/register", json={
        "name": "Operateur", "email": "operateur@example.com",
        "password": "motdepasse123"}).json()
    headers = {"Authorization": f"Bearer {registered['access_token']}"}
    account = client.post("/api/accounts", headers=headers,
                          json={"name": "Société Générale", "kind": "checking"}).json()

    debit_merchants = [
        ("CARTE X1234 CARREFOUR MARKET PARIS", (-12000, -1500)),
        ("CARTE X1234 LECLERC DRIVE", (-9500, -2200)),
        ("PRELEVEMENT SEPA EDF CLIENTS PARTICULIERS", (-11000, -4200)),
        ("VIREMENT SEPA EMIS LOYER AOUT", (-78000, -78000)),
    ]
    credit_merchants = [
        ("VIREMENT SEPA RECU SALAIRE MENSUEL EMPLOYEUR SAS", (210000, 240000)),
    ]
    month_counts = {
        (2025, 1): 13, (2025, 2): 61, (2025, 3): 20, (2025, 12): 77, (2026, 1): 26,
    }
    first_day, last_day = date(2025, 1, 24), date(2026, 1, 9)

    rng = random.Random(20260812)
    rows = ["date;libelle;montant"]
    total = sum(month_counts.values())
    credit_slots = set(rng.sample(range(total), 18))
    index = 0
    for (year, month), count in month_counts.items():
        for _ in range(count):
            if month == 1 and year == 2025:
                day = rng.randint(24, 31)
            elif month == 1 and year == 2026:
                day = rng.randint(1, 9)
            else:
                last = 28 if month == 2 else 31
                day = rng.randint(1, last)
            on = min(max(date(year, month, day), first_day), last_day)
            label, (low, high) = rng.choice(
                credit_merchants if index in credit_slots else debit_merchants
            )
            amount = rng.randint(min(low, high), max(low, high))
            rows.append(f"{on.strftime('%d/%m/%Y')};{label};{amount / 100:.2f}".replace(".", ","))
            index += 1

    _commit(client, headers, account["id"], rows)

    forecast_body = client.get("/api/cashflow/forecast", headers=headers).json()
    runway_body = client.get("/api/cashflow/runway", headers=headers).json()
    assert forecast_body["months"] == []
    assert "6 mois" in forecast_body["insufficient_reason"]
    assert runway_body["months_observed"] == 3
    assert runway_body["ledger_span_months"] == 13
