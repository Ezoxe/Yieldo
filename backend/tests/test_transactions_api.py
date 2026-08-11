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
