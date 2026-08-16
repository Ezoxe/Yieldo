import pytest


def test_monthly_series_is_gap_filled(client, imported):
    headers, _ = imported
    body = client.get(
        "/api/analytics/series?granularity=month&date_from=2025-01-01&date_to=2025-04-30",
        headers=headers).json()
    assert [b["key"] for b in body] == ["2025-01", "2025-02", "2025-03", "2025-04"]
    march = next(b for b in body if b["key"] == "2025-03")
    assert march["inflow_cents"] == 245000
    assert march["outflow_cents"] == -12891


def test_daily_granularity_is_supported(client, imported):
    headers, _ = imported
    body = client.get(
        "/api/analytics/series?granularity=day&date_from=2025-03-01&date_to=2025-03-07",
        headers=headers).json()
    assert len(body) == 7
    assert body[0]["outflow_cents"] == -4732


def test_unknown_granularity_is_rejected(client, imported):
    headers, _ = imported
    assert client.get("/api/analytics/series?granularity=fortnight",
                      headers=headers).status_code == 422


def test_category_breakdown_carries_names_and_colors(client, imported):
    headers, _ = imported
    body = client.get("/api/analytics/categories?date_from=2025-01-01&date_to=2025-12-31",
                      headers=headers).json()
    top = body[0]
    assert top["name"] == "Carburant"
    assert top["total_cents"] == -6810
    assert top["color"].startswith("#")
    assert 0 < top["share"] <= 1


def test_summary_reports_savings_rate(client, imported):
    headers, _ = imported
    body = client.get("/api/analytics/summary?date_from=2025-03-01&date_to=2025-03-31",
                      headers=headers).json()
    assert body["inflow_cents"] == 245000
    assert body["outflow_cents"] == -12891
    assert body["net_cents"] == 232109
    assert body["savings_rate"] == pytest.approx(232109 / 245000)


def test_summary_savings_rate_is_null_without_income(client, imported):
    headers, _ = imported
    body = client.get("/api/analytics/summary?date_from=2025-03-05&date_to=2025-03-07",
                      headers=headers).json()
    assert body["inflow_cents"] == 0
    assert body["savings_rate"] is None


def test_summary_compares_with_the_preceding_period(client, imported):
    headers, _ = imported
    body = client.get("/api/analytics/summary?date_from=2025-03-01&date_to=2025-03-31",
                      headers=headers).json()
    assert body["previous"]["date_from"] == "2025-01-29"
    assert body["comparison"]["delta_cents"] == 232109


# "Tout" sends no dates at all. Until this task the backend answered those with
# the current calendar year, so a statement imported last year was invisible on
# the dashboard's own default.


def test_summary_without_dates_covers_the_whole_history(client, imported):
    headers, _ = imported
    body = client.get("/api/analytics/summary", headers=headers).json()
    assert body["date_from"] == "2025-03-01"
    assert body["date_to"] == "2025-03-07"
    assert body["transaction_count"] == 4


def test_series_without_dates_spans_the_whole_history(client, imported):
    headers, _ = imported
    body = client.get("/api/analytics/series?granularity=month", headers=headers).json()
    assert [b["key"] for b in body] == ["2025-03"]


def test_categories_without_dates_cover_the_whole_history(client, imported):
    headers, _ = imported
    body = client.get("/api/analytics/categories", headers=headers).json()
    # 3, not 4: the breakdown is expense-only, and one of the four rows is the
    # salary credit. Zero is what it answered before the fix.
    assert sum(c["count"] for c in body) == 3


def test_summary_reports_the_span_of_the_user_whole_history(client, imported):
    headers, _ = imported
    body = client.get("/api/analytics/summary?date_from=2026-01-01&date_to=2026-01-31",
                      headers=headers).json()
    assert body["transaction_count"] == 0
    assert body["history"] == {
        "date_from": "2025-03-01", "date_to": "2025-03-07", "transaction_count": 4,
    }


def test_summary_history_is_null_for_a_user_without_any_transaction(client):
    registered = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea@example.com", "password": "motdepasse123"}).json()
    headers = {"Authorization": f"Bearer {registered['access_token']}"}
    body = client.get("/api/analytics/summary", headers=headers).json()
    assert body["history"] is None
    assert body["transaction_count"] == 0
    assert body["date_from"] == body["date_to"]


def test_the_history_span_never_reaches_across_users(client, imported):
    headers, _ = imported
    other = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    body = client.get("/api/analytics/summary", headers=other_headers).json()
    assert body["history"] is None


def test_calendar_returns_one_point_per_day_with_activity(client, imported):
    headers, _ = imported
    body = client.get("/api/analytics/calendar?year=2025", headers=headers).json()
    by_day = {point["date"]: point for point in body}
    assert by_day["2025-03-01"]["outflow_cents"] == -4732
    assert "2025-03-02" not in by_day


def test_analytics_require_authentication(client):
    assert client.get("/api/analytics/summary").status_code == 401
