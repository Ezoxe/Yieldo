"""`POST /api/transactions` — an operation typed in by hand.

A statement is not the only source of truth a household has. Cash, a purchase
made before the statement arrives, a reimbursement between two people: these
are real movements with no CSV behind them, and until now the ledger had no
way to hear about them.

Two properties are what these tests exist to hold:

* **a hand-typed line is not an import**. It carries no `import_batch_id`, and
  that absence is what `manual` reports — nothing else in the schema claims it,
  so the two can never disagree;
* **two identical purchases are two purchases**. Buying the same coffee twice
  in one afternoon produces the same fingerprint twice, and the unique
  `(user_id, dedup_hash)` constraint would reject the second. The suffix
  convention `app/importers/service.py` already uses for a deliberately kept
  duplicate is reused here rather than invented a second time.
"""

from app.models import Transaction


def _register(client, email: str) -> dict[str, str]:
    body = client.post("/api/auth/register", json={
        "name": "Lea", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def _payload(account_id: int, **overrides) -> dict:
    base = {
        "account_id": account_id,
        "date": "2025-03-09",
        "amount_cents": -1250,
        "label_raw": "Boulangerie du coin",
    }
    base.update(overrides)
    return base


def test_creating_a_manual_transaction_returns_it(client, imported):
    headers, account_id = imported
    response = client.post("/api/transactions", headers=headers, json=_payload(account_id))

    assert response.status_code == 201
    body = response.json()
    assert body["amount_cents"] == -1250
    assert body["label_raw"] == "Boulangerie du coin"
    assert body["label_clean"] == "boulangerie du coin"
    assert body["manual"] is True


def test_a_manual_transaction_joins_the_ledger(client, imported):
    headers, account_id = imported
    client.post("/api/transactions", headers=headers, json=_payload(account_id))

    body = client.get("/api/transactions", headers=headers).json()
    assert body["total"] == 5
    assert body["items"][0]["label_raw"] == "Boulangerie du coin"


# The one fact `manual` reports, and the only place it can come from.
def test_an_imported_transaction_is_not_manual(client, imported):
    headers, _ = imported
    body = client.get("/api/transactions", headers=headers).json()
    assert all(item["manual"] is False for item in body["items"])


def test_the_same_purchase_twice_is_two_transactions(client, imported):
    headers, account_id = imported
    first = client.post("/api/transactions", headers=headers, json=_payload(account_id))
    second = client.post("/api/transactions", headers=headers, json=_payload(account_id))

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] != second.json()["id"]
    assert client.get("/api/transactions", headers=headers).json()["total"] == 6


def test_a_manual_transaction_carries_no_import_batch(client, db, imported):
    headers, account_id = imported
    created = client.post("/api/transactions", headers=headers, json=_payload(account_id)).json()

    row = db.query(Transaction).filter(Transaction.id == created["id"]).one()
    assert row.import_batch_id is None


def test_an_explicit_category_is_recorded_as_manual(client, imported):
    headers, account_id = imported
    category = client.get("/api/categories", headers=headers).json()[0]

    body = client.post("/api/transactions", headers=headers,
                       json=_payload(account_id, category_id=category["id"])).json()
    assert body["category_id"] == category["id"]
    assert body["category_source"] == "manual"


# Leaving the category blank is not the same as saying "no category": the rules
# the household already owns are what the import would have applied, and a
# hand-typed line has no reason to be treated worse.
def test_an_omitted_category_falls_through_the_users_own_rules(client, imported):
    headers, account_id = imported
    body = client.post("/api/transactions", headers=headers,
                       json=_payload(account_id, label_raw="NETFLIX.COM", amount_cents=-1399)).json()

    assert body["category_id"] is not None
    assert body["category_source"] in {"builtin", "rule", "learned"}


def test_a_line_matching_no_rule_stays_uncategorized(client, imported):
    headers, account_id = imported
    body = client.post("/api/transactions", headers=headers,
                       json=_payload(account_id, label_raw="Zzzz inconnu")).json()

    assert body["category_id"] is None
    assert body["category_source"] == "uncategorized"


def test_notes_and_tags_are_kept(client, imported):
    headers, account_id = imported
    body = client.post("/api/transactions", headers=headers, json=_payload(
        account_id, notes="Payé en espèces", tags=["cash"], is_transfer=False)).json()

    assert body["notes"] == "Payé en espèces"
    assert body["tags"] == ["cash"]


def test_another_users_account_is_not_a_valid_target(client, imported):
    headers, account_id = imported
    other_headers = _register(client, "lea@example.com")

    response = client.post("/api/transactions", headers=other_headers,
                           json=_payload(account_id))
    assert response.status_code == 404
    assert response.json()["detail"] == "Compte introuvable"


def test_another_users_category_is_not_a_valid_target(client, imported):
    headers, account_id = imported
    other_headers = _register(client, "lea@example.com")
    foreign_category = client.get("/api/categories", headers=other_headers).json()[0]

    response = client.post("/api/transactions", headers=headers,
                           json=_payload(account_id, category_id=foreign_category["id"]))
    assert response.status_code == 404
    assert response.json()["detail"] == "Catégorie introuvable"


def test_a_zero_amount_is_refused(client, imported):
    headers, account_id = imported
    response = client.post("/api/transactions", headers=headers,
                           json=_payload(account_id, amount_cents=0))
    assert response.status_code == 422


def test_an_empty_label_is_refused(client, imported):
    headers, account_id = imported
    response = client.post("/api/transactions", headers=headers,
                           json=_payload(account_id, label_raw="   "))
    assert response.status_code == 422


def test_a_manual_transaction_can_be_deleted(client, imported):
    headers, account_id = imported
    created = client.post("/api/transactions", headers=headers, json=_payload(account_id)).json()

    assert client.delete(f"/api/transactions/{created['id']}", headers=headers).status_code == 204
    assert client.get("/api/transactions", headers=headers).json()["total"] == 4
