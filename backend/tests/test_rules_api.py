"""/api/rules -- the household writes, changes and removes its own rules.

The built-in library is copied into every account and kept by migrations
(`categorization/seed.py`), so a household never edits those rows: it adds a
rule of its own, which outranks them.
"""

from app.models import RULE_PRIORITIES, CategoryRule


def register(client, email="max@example.com"):
    response = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def a_category(client, headers, name="Boulangeries") -> int:
    return client.post("/api/categories", headers=headers,
                       json={"name": name, "kind": "expense"}).json()["id"]


def test_the_list_shows_every_rule_of_the_household(client):
    headers = register(client)
    rules = client.get("/api/rules", headers=headers).json()

    assert rules, "the built-in library is copied at registration"
    assert {"id", "pattern", "category_id", "category_name", "origin", "direction",
            "priority", "hit_count"} <= set(rules[0])
    assert {rule["origin"] for rule in rules} == {"builtin"}


def test_a_new_rule_is_manual_and_outranks_the_library(client):
    headers = register(client)
    category_id = a_category(client, headers)

    response = client.post("/api/rules", headers=headers,
                           json={"pattern": "  Paul ", "category_id": category_id})

    assert response.status_code == 201
    body = response.json()
    assert body["pattern"] == "paul"
    assert body["origin"] == "manual"
    assert body["priority"] == RULE_PRIORITIES["manual"]
    assert body["direction"] == "any"
    assert body["category_name"] == "Boulangeries"


def test_the_same_rule_twice_is_refused(client):
    headers = register(client)
    category_id = a_category(client, headers)
    client.post("/api/rules", headers=headers, json={"pattern": "paul", "category_id": category_id})

    response = client.post("/api/rules", headers=headers,
                           json={"pattern": "PAUL", "category_id": category_id})

    assert response.status_code == 409


def test_an_empty_pattern_and_an_unknown_direction_are_refused(client):
    headers = register(client)
    category_id = a_category(client, headers)

    empty = client.post("/api/rules", headers=headers,
                        json={"pattern": "  ", "category_id": category_id})
    wrong = client.post("/api/rules", headers=headers,
                        json={"pattern": "paul", "category_id": category_id, "direction": "east"})

    assert empty.status_code == 422
    assert wrong.status_code == 422


def test_a_rule_cannot_send_to_another_households_category(client):
    first = register(client, "un@example.com")
    second = register(client, "deux@example.com")
    theirs = a_category(client, second)

    response = client.post("/api/rules", headers=first,
                           json={"pattern": "paul", "category_id": theirs})

    assert response.status_code == 404


def test_a_household_rule_is_changed_and_removed(client, db):
    headers = register(client)
    category_id = a_category(client, headers)
    other = a_category(client, headers, "Pâtisseries")
    rule_id = client.post("/api/rules", headers=headers,
                          json={"pattern": "paul", "category_id": category_id}).json()["id"]

    patched = client.patch(f"/api/rules/{rule_id}", headers=headers,
                           json={"category_id": other, "direction": "debit"})

    assert patched.status_code == 200
    assert patched.json()["category_id"] == other
    assert patched.json()["direction"] == "debit"
    assert client.delete(f"/api/rules/{rule_id}", headers=headers).status_code == 204
    assert db.get(CategoryRule, rule_id) is None


def test_a_builtin_rule_is_neither_changed_nor_removed(client):
    headers = register(client)
    builtin = client.get("/api/rules", headers=headers).json()[0]["id"]

    patched = client.patch(f"/api/rules/{builtin}", headers=headers, json={"direction": "debit"})
    deleted = client.delete(f"/api/rules/{builtin}", headers=headers)

    assert patched.status_code == 409
    assert deleted.status_code == 409
    assert "intégrée" in patched.json()["detail"]


def test_another_households_rule_is_not_found(client):
    first = register(client, "un@example.com")
    second = register(client, "deux@example.com")
    category_id = a_category(client, second)
    rule_id = client.post("/api/rules", headers=second,
                          json={"pattern": "paul", "category_id": category_id}).json()["id"]

    patched = client.patch(f"/api/rules/{rule_id}", headers=first, json={"direction": "debit"})
    assert patched.status_code == 404
    assert client.delete(f"/api/rules/{rule_id}", headers=first).status_code == 404
    assert all(rule["id"] != rule_id for rule in client.get("/api/rules", headers=first).json())
