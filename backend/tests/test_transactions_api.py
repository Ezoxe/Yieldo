def test_listing_returns_transactions_newest_first(client, imported):
    headers, _ = imported
    body = client.get("/api/transactions", headers=headers).json()
    assert body["total"] == 4
    assert body["items"][0]["date"] == "2025-03-07"
    assert body["items"][0]["amount_cents"] == -6810


def test_listing_is_scoped_to_the_authenticated_user(client, imported):
    headers, _ = imported
    other = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    assert client.get("/api/transactions", headers=other_headers).json()["total"] == 0


def test_date_range_filter(client, imported):
    headers, _ = imported
    body = client.get("/api/transactions?date_from=2025-03-03&date_to=2025-03-05",
                      headers=headers).json()
    assert body["total"] == 2


def test_search_filter_matches_the_normalized_label(client, imported):
    headers, _ = imported
    assert client.get("/api/transactions?search=netflix", headers=headers).json()["total"] == 1
    assert client.get("/api/transactions?search=NETFLIX", headers=headers).json()["total"] == 1


# What an empty list means -- no data at all, a period that holds none, or a
# filter excluding it -- is not something the client can tell from `total: 0`.
# These two figures are what let the empty state diagnose it.


def test_listing_reports_the_span_of_the_user_whole_history(client, imported):
    headers, _ = imported
    body = client.get("/api/transactions?date_from=2026-01-01&date_to=2026-01-31",
                      headers=headers).json()
    assert body["total"] == 0
    assert body["period_total"] == 0
    assert body["history"] == {
        "date_from": "2025-03-01", "date_to": "2025-03-07", "transaction_count": 4,
    }


def test_listing_reports_the_period_total_ignoring_the_other_filters(client, imported):
    headers, _ = imported
    body = client.get("/api/transactions?date_from=2025-03-01&date_to=2025-03-31"
                      "&search=introuvable", headers=headers).json()
    assert body["total"] == 0
    assert body["period_total"] == 4


def test_listing_history_is_null_for_a_user_without_any_transaction(client, imported):
    other = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    body = client.get("/api/transactions", headers=other_headers).json()
    assert body["history"] is None
    assert body["period_total"] == 0


def test_amount_range_filter(client, imported):
    headers, _ = imported
    body = client.get("/api/transactions?max_cents=-5000", headers=headers).json()
    assert body["total"] == 1


def test_pagination_reports_the_full_total(client, imported):
    headers, _ = imported
    body = client.get("/api/transactions?limit=2&offset=0", headers=headers).json()
    assert len(body["items"]) == 2
    assert body["total"] == 4


def test_limit_is_capped(client, imported):
    headers, _ = imported
    assert client.get("/api/transactions?limit=99999", headers=headers).status_code == 422


def test_recategorizing_creates_a_learned_rule(client, imported):
    headers, _ = imported
    listed = client.get("/api/transactions?search=netflix", headers=headers).json()
    categories = client.get("/api/categories", headers=headers).json()
    target = next(c for c in categories if c["slug"] == "abonnements-logiciels")

    response = client.patch(f"/api/transactions/{listed['items'][0]['id']}",
                            headers=headers, json={"category_id": target["id"]})
    assert response.status_code == 200
    assert response.json()["category_source"] == "manual"
    assert response.json()["learned_rule_id"] is not None


def test_clearing_category_with_explicit_null_sets_uncategorized(client, imported):
    headers, _ = imported
    listed = client.get("/api/transactions?search=netflix", headers=headers).json()
    transaction_id = listed["items"][0]["id"]
    categories = client.get("/api/categories", headers=headers).json()
    target = next(c for c in categories if c["slug"] == "abonnements-logiciels")
    client.patch(f"/api/transactions/{transaction_id}", headers=headers,
                json={"category_id": target["id"]})

    response = client.patch(f"/api/transactions/{transaction_id}", headers=headers,
                            json={"category_id": None})
    assert response.status_code == 200
    body = response.json()
    assert body["category_id"] is None
    assert body["category_source"] == "uncategorized"
    assert body["learned_rule_id"] is None


def test_patch_omitting_category_id_leaves_it_untouched(client, imported):
    headers, _ = imported
    listed = client.get("/api/transactions?search=netflix", headers=headers).json()
    transaction_id = listed["items"][0]["id"]
    categories = client.get("/api/categories", headers=headers).json()
    target = next(c for c in categories if c["slug"] == "abonnements-logiciels")
    client.patch(f"/api/transactions/{transaction_id}", headers=headers,
                json={"category_id": target["id"]})

    response = client.patch(f"/api/transactions/{transaction_id}", headers=headers,
                            json={"notes": "vu"})
    assert response.status_code == 200
    body = response.json()
    assert body["category_id"] == target["id"]
    assert body["category_source"] == "manual"


def test_patching_someone_elses_transaction_returns_404(client, imported):
    headers, _ = imported
    transaction_id = client.get("/api/transactions", headers=headers).json()["items"][0]["id"]
    other = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    response = client.patch(f"/api/transactions/{transaction_id}",
                            headers=other_headers, json={"notes": "vu"})
    assert response.status_code == 404


def test_patch_rejects_a_category_belonging_to_another_user(client, imported):
    headers, _ = imported
    transaction_id = client.get("/api/transactions", headers=headers).json()["items"][0]["id"]
    other = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    foreign = client.get("/api/categories", headers=other_headers).json()[0]
    response = client.patch(f"/api/transactions/{transaction_id}",
                            headers=headers, json={"category_id": foreign["id"]})
    assert response.status_code == 404


def test_marking_a_transaction_as_transfer_removes_it_from_spending(client, imported):
    headers, _ = imported
    transaction_id = client.get("/api/transactions?search=netflix",
                                headers=headers).json()["items"][0]["id"]
    client.patch(f"/api/transactions/{transaction_id}", headers=headers,
                 json={"is_transfer": True})
    summary = client.get("/api/analytics/summary?date_from=2025-01-01&date_to=2025-12-31",
                         headers=headers).json()
    assert summary["outflow_cents"] == -11542


def test_deleting_a_transaction_removes_it_from_the_listing(client, imported):
    headers, _ = imported
    transaction_id = client.get("/api/transactions", headers=headers).json()["items"][0]["id"]
    response = client.delete(f"/api/transactions/{transaction_id}", headers=headers)
    assert response.status_code == 204
    body = client.get("/api/transactions", headers=headers).json()
    assert body["total"] == 3
    assert all(item["id"] != transaction_id for item in body["items"])


def test_deleting_someone_elses_transaction_returns_404(client, imported):
    headers, _ = imported
    transaction_id = client.get("/api/transactions", headers=headers).json()["items"][0]["id"]
    other = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea8@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    response = client.delete(f"/api/transactions/{transaction_id}", headers=other_headers)
    assert response.status_code == 404


# One box, everything in it. `search` used to read `label_clean` alone, which
# normalize_label has already stripped of dates and long digit runs -- so the
# one thing the reader can see on their statement was the one thing they could
# not search for. These pin every field the single box now reaches.


def test_search_matches_a_fragment_the_normalizer_had_erased(client, imported):
    headers, _ = imported
    # "CARREFOUR MARKET CB 01/03": normalize_label drops the date fragment, so
    # this only ever matches against the raw label.
    body = client.get("/api/transactions?search=01/03", headers=headers).json()
    assert body["total"] == 1
    assert body["items"][0]["label_raw"] == "CARREFOUR MARKET CB 01/03"


def test_search_matches_an_amount_written_with_a_comma(client, imported):
    headers, _ = imported
    body = client.get("/api/transactions?search=13,49", headers=headers).json()
    assert body["total"] == 1
    assert body["items"][0]["amount_cents"] == -1349


def test_search_matches_an_amount_written_with_a_currency_sign(client, imported):
    headers, _ = imported
    body = client.get("/api/transactions?search=2450 €", headers=headers).json()
    assert body["total"] == 1
    assert body["items"][0]["amount_cents"] == 245000


def test_search_matches_an_expense_typed_without_its_minus(client, imported):
    headers, _ = imported
    # The statement shows 68,10 spent; the ledger stores -6810.
    body = client.get("/api/transactions?search=68,10", headers=headers).json()
    assert body["total"] == 1
    assert body["items"][0]["amount_cents"] == -6810


def test_search_matches_an_iso_date(client, imported):
    headers, _ = imported
    body = client.get("/api/transactions?search=2025-03-05", headers=headers).json()
    assert body["total"] == 1
    assert body["items"][0]["date"] == "2025-03-05"


def test_search_matches_a_french_date(client, imported):
    headers, _ = imported
    body = client.get("/api/transactions?search=03/03/2025", headers=headers).json()
    assert body["total"] == 1
    assert body["items"][0]["date"] == "2025-03-03"


def test_search_matches_the_account_name(client, imported):
    headers, _ = imported
    body = client.get("/api/transactions?search=Courant", headers=headers).json()
    assert body["total"] == 4


def test_search_matches_the_category_name(client, imported):
    headers, _ = imported
    categories = client.get("/api/categories", headers=headers).json()
    target = next(c for c in categories if c["name"] == "Loisirs")
    netflix = next(
        item for item in client.get("/api/transactions", headers=headers).json()["items"]
        if "NETFLIX" in item["label_raw"]
    )
    client.patch(f"/api/transactions/{netflix['id']}", headers=headers,
                 json={"category_id": target["id"]})
    body = client.get("/api/transactions?search=Loisirs", headers=headers).json()
    assert body["total"] >= 1
    assert all(item["category_id"] == target["id"] for item in body["items"])


def test_search_still_finds_nothing_when_nothing_matches(client, imported):
    headers, _ = imported
    assert client.get("/api/transactions?search=12", headers=headers).json()["total"] == 0
