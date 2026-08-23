from datetime import date, timedelta

from app.engines.anomaly import MIN_HISTORY
from app.models import Account, Transaction


def _category(client, headers, slug: str):
    categories = client.get("/api/categories", headers=headers).json()
    return next(c for c in categories if c["slug"] == slug)


def test_the_operators_shape_cannot_compare_and_says_why(client, imported):
    """The Boursorama sample covers one week of March 2025, and the window a
    year earlier is empty. Every line must come back not comparable, with a
    reason -- never as -100 %."""
    headers, _ = imported
    body = client.get("/api/analysis/inflation", headers=headers).json()
    assert body["comparable"] is False
    assert body["basket_ratio"] is None
    assert body["reason"] is not None
    assert "un an plus tôt" in body["reason"]


def test_the_two_windows_are_reported_so_the_reader_knows_what_is_compared(client, imported):
    headers, _ = imported
    body = client.get("/api/analysis/inflation?date_from=2025-03-01&date_to=2025-03-31",
                      headers=headers).json()
    assert body["current_from"] == "2025-03-01"
    assert body["current_to"] == "2025-03-31"
    assert body["previous_from"] == "2024-03-01"
    assert body["previous_to"] == "2024-03-31"


def test_inflation_lines_carry_the_category_name_and_colour(client, imported):
    headers, _ = imported
    body = client.get("/api/analysis/inflation", headers=headers).json()
    assert body["lines"]
    assert all(line["name"] for line in body["lines"])
    assert all(line["color"].startswith("#") for line in body["lines"])


def test_a_price_index_round_trips_as_exact_hundredths(client, imported):
    headers, _ = imported
    response = client.put("/api/analysis/price-index", headers=headers, json={
        "points": [
            {"month": "2025-01", "value": "118.42"},
            {"month": "2026-01", "value": "120.78"},
        ],
    })
    assert response.status_code == 200
    stored = client.get("/api/analysis/price-index", headers=headers).json()
    assert [point["value_hundredths"] for point in stored] == [11842, 12078]
    assert [point["month"] for point in stored] == ["2025-01", "2026-01"]


def test_putting_the_series_again_replaces_it_rather_than_appending(client, imported):
    headers, _ = imported
    client.put("/api/analysis/price-index", headers=headers,
               json={"points": [{"month": "2025-01", "value": "118.42"}]})
    client.put("/api/analysis/price-index", headers=headers,
               json={"points": [{"month": "2025-02", "value": "119.10"}]})
    stored = client.get("/api/analysis/price-index", headers=headers).json()
    assert [point["month"] for point in stored] == ["2025-02"]


def test_an_empty_series_clears_the_index(client, imported):
    headers, _ = imported
    client.put("/api/analysis/price-index", headers=headers,
               json={"points": [{"month": "2025-01", "value": "118.42"}]})
    client.put("/api/analysis/price-index", headers=headers, json={"points": []})
    assert client.get("/api/analysis/price-index", headers=headers).json() == []


def test_a_malformed_month_in_the_index_is_refused_in_french(client, imported):
    headers, _ = imported
    response = client.put("/api/analysis/price-index", headers=headers,
                          json={"points": [{"month": "janvier 2025", "value": "118.42"}]})
    assert response.status_code == 422
    assert "AAAA-MM" in response.json()["detail"]


def test_a_year_of_zero_in_the_index_is_refused_in_french_not_a_500(client, imported):
    """Mirrors `test_a_year_of_zero_is_refused_in_french_not_a_500` in
    `test_budgets_api.py`: `_MONTH_KEY` matches any four digits, including
    "0000" -- month 05 is within 1..12, so without an explicit year check
    `date(0, 5, 1)` reaches the constructor and raises an unhandled
    `ValueError` (Python's MINYEAR is 1) instead of the French 422 every
    other malformed-month path here returns."""
    headers, _ = imported
    response = client.put("/api/analysis/price-index", headers=headers,
                          json={"points": [{"month": "0000-05", "value": "100.00"}]})
    assert response.status_code == 422
    assert "AAAA-MM" in response.json()["detail"]


def test_a_duplicated_month_is_refused_rather_than_silently_kept_once(client, imported):
    headers, _ = imported
    response = client.put("/api/analysis/price-index", headers=headers, json={
        "points": [
            {"month": "2025-01", "value": "118.42"},
            {"month": "2025-01", "value": "119.00"},
        ],
    })
    assert response.status_code == 422


def test_a_zero_or_negative_index_value_is_refused_at_the_schema_boundary(client, imported):
    """Task 15's review left a live gap: `reference_ratio_from_index`'s
    zero-baseline guard is `before == 0` rather than `before <= 0`, so a
    negative index value divides and returns a sign-inverted ratio. The index
    is typed in by a human, so it is refused here, before it ever reaches the
    engine, rather than trusted to a guard that was never written for it."""
    headers, _ = imported
    zero = client.put("/api/analysis/price-index", headers=headers,
                      json={"points": [{"month": "2025-01", "value": "0"}]})
    assert zero.status_code == 422

    negative = client.put("/api/analysis/price-index", headers=headers,
                          json={"points": [{"month": "2025-01", "value": "-5.00"}]})
    assert negative.status_code == 422

    # Refused before the delete-then-insert even runs: the previously stored
    # (valid) series must survive a rejected PUT.
    client.put("/api/analysis/price-index", headers=headers,
               json={"points": [{"month": "2025-01", "value": "100.00"}]})
    client.put("/api/analysis/price-index", headers=headers,
               json={"points": [{"month": "2025-02", "value": "-1"}]})
    stored = client.get("/api/analysis/price-index", headers=headers).json()
    assert [point["month"] for point in stored] == ["2025-01"]


def test_no_index_means_no_reference_ratio_not_zero(client, imported):
    headers, _ = imported
    body = client.get("/api/analysis/inflation", headers=headers).json()
    assert body["reference_ratio"] is None


def test_a_reference_index_covering_both_windows_produces_a_reference_ratio(client, imported):
    headers, _ = imported
    client.put("/api/analysis/price-index", headers=headers, json={
        "points": [
            {"month": "2024-03", "value": "100.00"},
            {"month": "2025-03", "value": "102.00"},
        ],
    })
    body = client.get("/api/analysis/inflation?date_from=2025-03-01&date_to=2025-03-31",
                      headers=headers).json()
    assert body["reference_ratio"] == 0.02


def test_transfers_are_excluded_from_the_inflation_basket(client, db, imported):
    """`inflation._monthly_costs` does not filter transfers itself -- the
    engine's own docstring makes that the caller's job, the same exclusion
    `api/common.py`'s `user_history` already applies for every other cashflow
    engine. A standing order into savings, fed in unfiltered, would repeat
    every month and dominate the basket ranking. Three months of a large
    `is_transfer=True` movement, in both windows, and nothing else in that
    category: if the router forgot to filter, this category would appear as
    the dominant, comparable line; filtered correctly, it never appears in
    `lines` at all, because it contributes to neither window's cost dict."""
    headers, account_id = imported
    epargne = client.post("/api/categories", headers=headers,
                          json={"name": "Épargne interne"}).json()

    account = db.query(Account).filter(Account.id == account_id).first()
    for year in (2024, 2025):
        for month in (1, 2, 3):
            db.add(Transaction(
                user_id=account.user_id, account_id=account_id,
                date=date(year, month, 15), value_date=date(year, month, 15),
                amount_cents=-300_000, label_raw="VIREMENT INTERNE LIVRET A",
                label_clean="virement interne livret a", category_id=epargne["id"],
                category_source="manual", is_transfer=True,
                dedup_hash=f"transfer-{year}-{month}", tags=[],
            ))
    db.commit()

    body = client.get("/api/analysis/inflation?date_from=2025-01-01&date_to=2025-03-31",
                      headers=headers).json()
    category_ids = [line["category_id"] for line in body["lines"]]
    assert epargne["id"] not in category_ids


def test_anomalies_are_scored_over_history_and_reported_for_the_period(client, imported):
    headers, _ = imported
    body = client.get("/api/analysis/anomalies", headers=headers).json()
    assert "anomalies" in body and "skipped" in body
    assert body["date_from"] and body["date_to"]
    # The sample has four transactions, one per category: every category+sign
    # group sits at a single observation, well under MIN_HISTORY.
    assert body["anomalies"] == []
    assert body["skipped"]
    assert any(
        f"{MIN_HISTORY} dépenses" in entry["reason"] or f"{MIN_HISTORY} recettes" in entry["reason"]
        for entry in body["skipped"]
    )


def test_skipped_categories_carry_their_name(client, imported):
    headers, _ = imported
    body = client.get("/api/analysis/anomalies", headers=headers).json()
    assert all(entry["name"] for entry in body["skipped"])


def test_the_operators_data_shape_leaves_some_anomalies_scored_and_others_skipped(
    client, db, imported,
):
    """Mirrors `test_anomaly.py`'s own operator-shape fixture (2026-08-16
    phase 2A plan, Lot E overview: "19 categories, ~10 rows each | mixed --
    some scored, some skipped") through the actual HTTP endpoint rather than
    the pure engine: one category scored with a finding, one scored with none,
    two skipped under `MIN_HISTORY`, each with its own true count."""
    headers, account_id = imported
    account = db.query(Account).filter(Account.id == account_id).first()

    scored_outlier = client.post("/api/categories", headers=headers,
                                 json={"name": "Scored avec anomalie"}).json()
    scored_ordinary = client.post("/api/categories", headers=headers,
                                  json={"name": "Scored sans anomalie"}).json()
    skipped_nine = client.post("/api/categories", headers=headers,
                               json={"name": "Sous le seuil neuf"}).json()
    skipped_five = client.post("/api/categories", headers=headers,
                               json={"name": "Sous le seuil cinq"}).json()

    def _rows(category_id, amounts, start, prefix):
        for index, amount in enumerate(amounts):
            on = start + timedelta(days=index * 3)
            db.add(Transaction(
                user_id=account.user_id, account_id=account_id,
                date=on, value_date=on, amount_cents=amount,
                label_raw=f"{prefix} {index}", label_clean=f"{prefix.lower()} {index}",
                category_id=category_id, category_source="manual", is_transfer=False,
                dedup_hash=f"{prefix}-{index}", tags=[],
            ))

    _rows(scored_outlier["id"], [-4000] * 11 + [-90000], date(2025, 1, 1), "OUTLIER")
    _rows(scored_ordinary["id"],
          [-4000, -4200, -3900, -4100, -4050, -3950, -4150, -4000, -4300, -3800],
          date(2025, 2, 1), "ORDINARY")
    _rows(skipped_nine["id"], [-4000] * 8 + [-90000], date(2025, 3, 1), "SKIP9")
    _rows(skipped_five["id"], [-4000] * 5, date(2025, 4, 1), "SKIP5")
    db.commit()

    body = client.get("/api/analysis/anomalies?date_from=2025-01-01&date_to=2025-12-31",
                      headers=headers).json()

    assert body["scored_groups"] == 2
    assert [a["category_id"] for a in body["anomalies"]] == [scored_outlier["id"]]

    skipped_by_category = {entry["category_id"]: entry for entry in body["skipped"]}
    assert skipped_by_category[skipped_nine["id"]]["observations"] == 9
    assert skipped_by_category[skipped_five["id"]]["observations"] == 5


def test_analysis_requires_authentication(client, imported):
    assert client.get("/api/analysis/inflation").status_code == 401
    assert client.get("/api/analysis/anomalies").status_code == 401
    assert client.get("/api/analysis/price-index").status_code == 401
    assert client.put("/api/analysis/price-index", json={"points": []}).status_code == 401


def test_analysis_never_crosses_users(client, imported):
    headers, _ = imported
    client.put("/api/analysis/price-index", headers=headers,
               json={"points": [{"month": "2025-01", "value": "118.42"}]})

    other = client.post("/api/auth/register", json={
        "name": "Autre", "email": "autre@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}

    assert client.get("/api/analysis/price-index", headers=other_headers).json() == []
    assert client.get("/api/analysis/anomalies", headers=other_headers).json()["anomalies"] == []
    assert client.get("/api/analysis/inflation", headers=other_headers).json()["lines"] == []


def test_a_price_index_put_never_touches_another_users_series(client, imported):
    """The replace is a delete-then-insert scoped by `user_id` -- prove it
    stays scoped: a second user putting their own series must neither read
    nor overwrite the first user's rows."""
    headers, _ = imported
    client.put("/api/analysis/price-index", headers=headers,
               json={"points": [{"month": "2025-01", "value": "100.00"}]})

    other = client.post("/api/auth/register", json={
        "name": "Autre", "email": "autre-put@example.com",
        "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    client.put("/api/analysis/price-index", headers=other_headers,
               json={"points": [{"month": "2025-06", "value": "200.00"}]})

    mine = client.get("/api/analysis/price-index", headers=headers).json()
    theirs = client.get("/api/analysis/price-index", headers=other_headers).json()
    assert [p["month"] for p in mine] == ["2025-01"]
    assert [p["month"] for p in theirs] == ["2025-06"]
