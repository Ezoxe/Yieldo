"""A budget set on a parent counts what its children spent.

Found by driving the real API with a real ledger: the seeded category tree
files every expense on a CHILD ("Courses", "Carburant", "Energie") while the
natural place to set a budget is the PARENT ("Alimentation", "Transport",
"Logement"). `spent_by_category.get(category.id, 0)` looked only at the
parent's own rows, so a household that had spent 341 EUR on groceries that
month was shown "42,00 EUR de budget, 0,00 EUR depense" -- and no budget alert
could ever fire.
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


def _spend(client, headers, account_id: int, category_id: int, cents: int, label: str):
    client.post("/api/transactions", headers=headers, json={
        "account_id": account_id, "date": "2026-08-12", "amount_cents": cents,
        "label_raw": label, "category_id": category_id})


def _line(client, headers, name: str) -> dict:
    body = client.get("/api/budgets?month=2026-08", headers=headers).json()
    return next(line for line in body["lines"] if line["name"] == name)


def _setup(client, headers) -> tuple[int, dict[str, int]]:
    account_id = client.post("/api/accounts", headers=headers, json={
        "name": "Compte courant", "kind": "checking"}).json()["id"]
    return account_id, _categories(client, headers)


def test_a_budget_on_a_parent_counts_what_its_children_spent(client):
    headers = _register(client)
    account_id, cats = _setup(client, headers)
    client.patch(f"/api/categories/{cats['alimentation']}", headers=headers,
                 json={"monthly_budget_cents": 42_000})

    _spend(client, headers, account_id, cats["alimentation-courses"], -30_000, "CB CARREFOUR")
    _spend(client, headers, account_id, cats["alimentation-restaurant"], -4_000, "CB BISTROT")
    _spend(client, headers, account_id, cats["alimentation"], -1_000, "CB EPICERIE")

    line = _line(client, headers, "Alimentation")
    assert line["spent_cents"] == -35_000
    assert line["remaining_cents"] == 7_000


def test_a_child_with_its_own_budget_is_counted_in_its_line_and_not_twice(client):
    """The rule that keeps the two lines honest. Without it the same euro sits
    in the child's budget AND in the parent's, and the screen's own totals no
    longer add up to what the household spent."""
    headers = _register(client)
    account_id, cats = _setup(client, headers)
    client.patch(f"/api/categories/{cats['alimentation']}", headers=headers,
                 json={"monthly_budget_cents": 42_000})
    client.patch(f"/api/categories/{cats['alimentation-restaurant']}", headers=headers,
                 json={"monthly_budget_cents": 8_000})

    _spend(client, headers, account_id, cats["alimentation-courses"], -30_000, "CB CARREFOUR")
    _spend(client, headers, account_id, cats["alimentation-restaurant"], -4_000, "CB BISTROT")

    assert _line(client, headers, "Alimentation")["spent_cents"] == -30_000
    assert _line(client, headers, "Restaurants")["spent_cents"] == -4_000


def test_a_budget_on_a_leaf_still_counts_only_its_own_rows(client):
    headers = _register(client)
    account_id, cats = _setup(client, headers)
    client.patch(f"/api/categories/{cats['alimentation-courses']}", headers=headers,
                 json={"monthly_budget_cents": 30_000})

    _spend(client, headers, account_id, cats["alimentation-courses"], -12_000, "CB CARREFOUR")
    _spend(client, headers, account_id, cats["alimentation-restaurant"], -4_000, "CB BISTROT")

    assert _line(client, headers, "Courses")["spent_cents"] == -12_000


def test_the_unbudgeted_list_no_longer_repeats_a_child_its_parent_already_counts(client):
    """The screen lists what was spent outside every budget. A child folded
    into its parent's line has been budgeted, through that parent, and showing
    it again under "hors budget" would say the opposite."""
    headers = _register(client)
    account_id, cats = _setup(client, headers)
    client.patch(f"/api/categories/{cats['alimentation']}", headers=headers,
                 json={"monthly_budget_cents": 42_000})

    _spend(client, headers, account_id, cats["alimentation-courses"], -30_000, "CB CARREFOUR")
    _spend(client, headers, account_id, cats["loisirs-sport"], -5_000, "CB DECATHLON")

    body = client.get("/api/budgets?month=2026-08", headers=headers).json()
    names = [row["name"] for row in body["unbudgeted"]]
    assert "Courses" not in names
    assert "Sport" in names


def test_a_budget_crossed_on_the_screen_is_the_budget_the_alert_fires_on(client):
    """The two used to compute the spend separately, and both read only the
    parent's own rows. Sharing the walk is what keeps them from drifting: a
    screen that says a budget is blown while the alerts screen says nothing is
    worse than either one being wrong alone."""
    headers = _register(client)
    account_id, cats = _setup(client, headers)
    client.patch(f"/api/categories/{cats['alimentation']}", headers=headers,
                 json={"monthly_budget_cents": 20_000})
    _spend(client, headers, account_id, cats["alimentation-courses"], -32_000, "CB CARREFOUR")

    line = _line(client, headers, "Alimentation")
    assert line["status"] == "over"

    alerts = client.get("/api/alerts", headers=headers).json()["alerts"]
    assert any(alert["kind"] == "budget_crossed" and "Alimentation" in alert["title"]
               for alert in alerts), [a["title"] for a in alerts]
