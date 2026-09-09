"""The one box that reaches everything, and never past this account."""


def _group(body: dict, kind: str) -> dict:
    return next(group for group in body["groups"] if group["kind"] == kind)


def test_a_transaction_is_found_by_its_label(client, imported):
    headers, _ = imported
    body = client.get("/api/search?q=netflix", headers=headers).json()
    items = _group(body, "transaction")["items"]
    assert len(items) == 1
    assert items[0]["label"] == "PRLV NETFLIX.COM"
    assert items[0]["amount_cents"] == -1349
    assert items[0]["date"] == "2025-03-05"
    assert items[0]["route"].startswith("/transactions")


def test_a_transaction_is_found_by_its_amount(client, imported):
    headers, _ = imported
    items = _group(client.get("/api/search?q=13,49", headers=headers).json(),
                   "transaction")["items"]
    assert [item["amount_cents"] for item in items] == [-1349]


def test_an_account_is_found_by_its_name(client, imported):
    headers, _ = imported
    items = _group(client.get("/api/search?q=courant", headers=headers).json(),
                   "account")["items"]
    assert [item["label"] for item in items] == ["Courant"]
    assert items[0]["route"] == "/reglages"


def test_a_category_is_found_by_its_name(client, imported):
    headers, _ = imported
    items = _group(client.get("/api/search?q=loisirs", headers=headers).json(),
                   "category")["items"]
    assert "Loisirs" in [item["label"] for item in items]
    assert items[0]["route"] == "/categories"


def test_a_goal_is_found_by_its_name(client, imported):
    headers, _ = imported
    client.post("/api/goals", headers=headers, json={
        "name": "Voyage au Japon", "target_cents": 500000, "due_on": "2027-06-01"})
    items = _group(client.get("/api/search?q=japon", headers=headers).json(),
                   "goal")["items"]
    assert [item["label"] for item in items] == ["Voyage au Japon"]
    assert items[0]["amount_cents"] == 500000
    assert items[0]["route"] == "/objectifs"


def test_a_debt_is_found_by_its_name(client, imported):
    headers, _ = imported
    client.post("/api/debts", headers=headers, json={
        "name": "Prêt auto", "kind": "auto", "principal_cents": 800000,
        "annual_rate_bps": 350, "minimum_payment_cents": 20000})
    items = _group(client.get("/api/search?q=auto", headers=headers).json(),
                   "debt")["items"]
    assert [item["label"] for item in items] == ["Prêt auto"]
    assert items[0]["route"] == "/dettes"


def test_a_declared_recurrence_is_found_by_its_label(client, imported):
    headers, account_id = imported
    client.post("/api/recurrences/declared", headers=headers, json={
        "label": "Abonnement salle", "amount_cents": -3900, "periodicity": "monthly",
        "anchor_on": "2025-03-01", "account_id": account_id})
    items = _group(client.get("/api/search?q=salle", headers=headers).json(),
                   "recurrence")["items"]
    assert [item["label"] for item in items] == ["Abonnement salle"]
    assert items[0]["route"] == "/recurrences"


def test_another_household_data_is_never_returned(client, imported):
    headers, _ = imported
    other = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    body = client.get("/api/search?q=netflix", headers=other_headers).json()
    assert all(group["items"] == [] for group in body["groups"])


def test_an_empty_query_returns_empty_groups(client, imported):
    headers, _ = imported
    body = client.get("/api/search?q=%20%20", headers=headers).json()
    assert all(group["items"] == [] for group in body["groups"])


def test_each_group_is_capped(client, imported):
    headers, _ = imported
    for index in range(8):
        client.post("/api/goals", headers=headers, json={
            "name": f"Objectif {index}", "target_cents": 1000})
    items = _group(client.get("/api/search?q=objectif&limit=3", headers=headers).json(),
                   "goal")["items"]
    assert len(items) == 3


def test_the_search_requires_authentication(client):
    assert client.get("/api/search?q=netflix").status_code == 401


def test_every_group_is_present_even_when_it_holds_nothing(client, imported):
    headers, _ = imported
    body = client.get("/api/search?q=introuvable", headers=headers).json()
    assert [group["kind"] for group in body["groups"]] == [
        "transaction", "account", "category", "recurrence", "goal", "debt",
    ]


# Every figure this route prints carries a word saying what it measures --
# except a transaction's own amount, which sits under its label and its date
# and can only be one thing. A number with no name is not information.
def test_a_figure_is_never_returned_without_a_word_naming_it(client, imported):
    headers, account_id = imported
    client.post("/api/goals", headers=headers, json={
        "name": "Ceinture", "target_cents": 100000})
    client.post("/api/debts", headers=headers, json={
        "name": "Ceinture", "kind": "auto", "principal_cents": 100000,
        "minimum_payment_cents": 1000})
    client.post("/api/recurrences/declared", headers=headers, json={
        "label": "Ceinture", "amount_cents": -1000, "periodicity": "monthly",
        "anchor_on": "2025-03-01", "account_id": account_id})
    client.post("/api/accounts", headers=headers, json={
        "name": "Ceinture", "kind": "savings"})

    body = client.get("/api/search?q=ceinture", headers=headers).json()
    for group in body["groups"]:
        for item in group["items"]:
            if item["kind"] == "transaction" or item["amount_cents"] is None:
                continue
            assert item["detail"], f"{item['kind']} prints a figure with no name"


def test_a_category_carries_its_parent_and_no_figure(client, imported):
    headers, _ = imported
    items = _group(client.get("/api/search?q=loisirs", headers=headers).json(),
                   "category")["items"]
    assert all(item["amount_cents"] is None for item in items)
