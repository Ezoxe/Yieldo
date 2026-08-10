def test_create_category_generates_a_slug(client, imported):
    headers, _ = imported
    response = client.post("/api/categories", headers=headers,
                           json={"name": "Café du coin"})
    assert response.status_code == 201
    body = response.json()
    assert body["slug"] == "cafe-du-coin"
    assert body["kind"] == "expense"


def test_create_category_rejects_unknown_kind(client, imported):
    headers, _ = imported
    response = client.post("/api/categories", headers=headers,
                           json={"name": "Test", "kind": "bogus"})
    assert response.status_code == 422


def test_create_category_rejects_a_duplicate_name(client, imported):
    headers, _ = imported
    client.post("/api/categories", headers=headers, json={"name": "Bricolage"})
    response = client.post("/api/categories", headers=headers, json={"name": "Bricolage"})
    assert response.status_code == 409


def test_create_category_rejects_a_third_hierarchy_level(client, imported):
    headers, _ = imported
    categories = client.get("/api/categories", headers=headers).json()
    child = next(c for c in categories if c["slug"] == "alimentation-courses")
    response = client.post("/api/categories", headers=headers,
                           json={"name": "Sous-sous-categorie", "parent_id": child["id"]})
    assert response.status_code == 422


def test_create_category_rejects_a_parent_owned_by_another_user(client, imported):
    headers, _ = imported
    other = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea4@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    foreign = client.get("/api/categories", headers=other_headers).json()[0]
    response = client.post("/api/categories", headers=headers,
                           json={"name": "Test", "parent_id": foreign["id"]})
    assert response.status_code == 404


def test_patch_category_updates_fields(client, imported):
    headers, _ = imported
    created = client.post("/api/categories", headers=headers, json={"name": "Bricolage"}).json()
    response = client.patch(f"/api/categories/{created['id']}", headers=headers,
                            json={"color": "#123456"})
    assert response.status_code == 200
    assert response.json()["color"] == "#123456"


def test_patch_someone_elses_category_returns_404(client, imported):
    headers, _ = imported
    other = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea6@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    foreign = client.get("/api/categories", headers=other_headers).json()[0]
    response = client.patch(f"/api/categories/{foreign['id']}", headers=headers,
                            json={"color": "#123456"})
    assert response.status_code == 404


def test_delete_category_uncategorizes_its_transactions_instead_of_deleting_them(
    client, imported
):
    headers, _ = imported
    listed = client.get("/api/transactions?search=netflix", headers=headers).json()
    categories = client.get("/api/categories", headers=headers).json()
    target = next(c for c in categories if c["slug"] == "abonnements-logiciels")
    transaction_id = listed["items"][0]["id"]
    client.patch(f"/api/transactions/{transaction_id}", headers=headers,
                 json={"category_id": target["id"]})

    response = client.delete(f"/api/categories/{target['id']}", headers=headers)
    assert response.status_code == 204

    transactions = client.get("/api/transactions", headers=headers).json()["items"]
    assert len(transactions) == 4
    surviving = next(t for t in transactions if t["id"] == transaction_id)
    assert surviving["category_id"] is None
    assert surviving["category_source"] == "uncategorized"


def test_delete_someone_elses_category_returns_404(client, imported):
    headers, _ = imported
    other = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea7@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    foreign = client.get("/api/categories", headers=other_headers).json()[0]
    response = client.delete(f"/api/categories/{foreign['id']}", headers=headers)
    assert response.status_code == 404
