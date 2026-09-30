"""GET /budgets/{category_id}/detail -- the universe page of one category.

Driven through the real API with transactions posted by hand, so every figure
below can be checked on the back of an envelope: the page must say what the
category cost in the month on screen, what it costs in an ordinary month, and
agree with the Budgets screen about every ceiling.
"""


def _register(client, email: str = "max@example.com") -> dict[str, str]:
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def _categories(client, headers) -> dict[str, int]:
    flat: dict[str, int] = {}

    def walk(rows):
        for row in rows:
            flat[row["slug"]] = row["id"]
            walk(row.get("children", []))

    walk(client.get("/api/categories", headers=headers).json())
    return flat


def _account(client, headers) -> int:
    return client.post("/api/accounts", headers=headers, json={
        "name": "Compte courant", "kind": "checking"}).json()["id"]


def _tx(client, headers, account_id: int, category_id: int, on: str, cents: int,
        label: str = "CB TEST") -> None:
    response = client.post("/api/transactions", headers=headers, json={
        "account_id": account_id, "date": on, "amount_cents": cents,
        "label_raw": label, "category_id": category_id})
    assert response.status_code == 201, response.text


def _detail(client, headers, category_id: int, month: str) -> dict:
    response = client.get(f"/api/budgets/{category_id}/detail?month={month}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_a_family_sums_its_children_and_lists_them(client):
    headers = _register(client)
    account, cats = _account(client, headers), _categories(client, headers)
    _tx(client, headers, account, cats["transport-carburant"], "2026-08-03", -6000)
    _tx(client, headers, account, cats["transport-carburant"], "2026-08-19", -5800)
    _tx(client, headers, account, cats["transport-peage"], "2026-08-10", -3400)

    body = _detail(client, headers, cats["transport"], "2026-08")
    assert body["category"]["slug"] == "transport"
    assert body["category"]["parent"] is None
    assert (body["spent_cents"], body["count"]) == (-15200, 3)
    fuel = next(p for p in body["parts"] if p["slug"] == "transport-carburant")
    assert (fuel["spent_cents"], fuel["count"], fuel["average_ticket_cents"]) == (-11800, 2, -5900)
    assert {"transport-carburant", "transport-entretien", "transport-assurance",
            "transport-peage"} <= {p["slug"] for p in body["parts"]}
    assert body["siblings"] == []


def test_a_child_names_its_parent_and_its_siblings(client):
    headers = _register(client)
    account, cats = _account(client, headers), _categories(client, headers)
    _tx(client, headers, account, cats["transport-carburant"], "2026-08-03", -6000)

    body = _detail(client, headers, cats["transport-carburant"], "2026-08")
    assert body["category"]["parent"] == {"id": cats["transport"], "name": "Transport",
                                          "slug": "transport"}
    assert body["parts"] == []
    siblings = {s["slug"]: s for s in body["siblings"]}
    assert siblings["transport-carburant"]["spent_cents"] == -6000
    assert "transport-peage" in siblings


def test_the_average_runs_over_complete_months_only(client):
    headers = _register(client)
    account, cats = _account(client, headers), _categories(client, headers)
    fuel = cats["transport-carburant"]
    # The ledger runs from 2026-01-01 to 2026-04-15: January to March are
    # complete, April is not.
    _tx(client, headers, account, fuel, "2026-01-01", -9000)
    _tx(client, headers, account, fuel, "2026-03-10", -6000)
    _tx(client, headers, account, fuel, "2026-04-15", -50000)

    body = _detail(client, headers, fuel, "2026-04")
    assert body["spent_cents"] == -50000
    assert (body["average_cents"], body["months_counted"]) == (-5000, 3)
    assert [m["month"] for m in body["series"]] == ["2026-01", "2026-02", "2026-03", "2026-04"]
    assert [m["complete"] for m in body["series"]] == [True, True, True, False]
    assert body["years"] == [{"year": 2026, "spent_cents": -15000, "months_counted": 3,
                              "monthly_average_cents": -5000}]


def test_the_budget_reading_is_the_budgets_screen_line(client):
    headers = _register(client)
    account, cats = _account(client, headers), _categories(client, headers)
    client.patch(f"/api/categories/{cats['transport']}", headers=headers,
                 json={"monthly_budget_cents": 35_000})
    _tx(client, headers, account, cats["transport-carburant"], "2026-08-03", -11800)
    _tx(client, headers, account, cats["transport-peage"], "2026-08-10", -3400)

    detail = _detail(client, headers, cats["transport"], "2026-08")
    report = client.get("/api/budgets?month=2026-08", headers=headers).json()
    line = next(line for line in report["lines"] if line["category_id"] == cats["transport"])
    assert detail["budget"]["budget_cents"] == 35_000
    assert detail["budget"]["spent_cents"] == line["spent_cents"]
    assert detail["budget"]["remaining_cents"] == line["remaining_cents"]
    assert detail["budget"]["status"] == line["status"]
    fuel = next(p for p in detail["parts"] if p["slug"] == "transport-carburant")
    assert fuel["budget"] is None


def test_another_households_category_is_not_found(client):
    owner = _register(client, "a@example.com")
    cats = _categories(client, owner)
    stranger = _register(client, "b@example.com")
    response = client.get(f"/api/budgets/{cats['transport']}/detail", headers=stranger)
    assert response.status_code == 404
    assert response.json()["detail"] == "Catégorie introuvable"


def test_a_malformed_month_is_refused_in_french(client):
    headers = _register(client)
    cats = _categories(client, headers)
    response = client.get(f"/api/budgets/{cats['transport']}/detail?month=aout",
                          headers=headers)
    assert response.status_code == 422
    assert "AAAA-MM" in response.json()["detail"]


def test_a_household_without_statements_gets_an_empty_page(client):
    headers = _register(client)
    cats = _categories(client, headers)
    response = client.get(f"/api/budgets/{cats['transport']}/detail", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["history"] is None
    assert body["series"] == [] and body["years"] == []
    assert (body["spent_cents"], body["average_cents"]) == (0, None)
