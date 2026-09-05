"""`PATCH /api/transactions/{id}` — correcting the line itself, not just its
category.

A ledger row can be wrong in ways no recategorisation reaches: a date typed a
month off, an amount entered as a debit when it was a credit, a label that says
nothing three weeks later. Until now the only editable fields were the
category, the note, the transfer flag and the tags — everything that made the
row *the row it is* was frozen at import or at creation.

Two properties are what these tests exist to hold:

* **an edited identity is re-fingerprinted**. `dedup_hash` is computed from the
  account, the date, the amount and the label; change any of them and the old
  fingerprint describes a transaction that no longer exists. It is recomputed,
  through the same collision-suffix convention a hand-typed duplicate uses, so
  editing a row into an exact copy of another one is still two rows and never
  an `IntegrityError`;
* **an edit is not a recategorisation**. Moving a date does not touch
  `category_source` and teaches the categoriser nothing — only an explicit
  `category_id` does, exactly as before.
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


def _create(client, headers, account_id: int, **overrides) -> dict:
    return client.post("/api/transactions", headers=headers,
                       json=_payload(account_id, **overrides)).json()


def test_the_date_can_be_corrected(client, imported):
    headers, account_id = imported
    created = _create(client, headers, account_id)

    response = client.patch(f"/api/transactions/{created['id']}", headers=headers,
                            json={"date": "2025-12-08"})

    assert response.status_code == 200
    assert response.json()["date"] == "2025-12-08"


def test_the_amount_and_label_can_be_corrected(client, imported):
    headers, account_id = imported
    created = _create(client, headers, account_id)

    body = client.patch(f"/api/transactions/{created['id']}", headers=headers, json={
        "amount_cents": 4500, "label_raw": "Remboursement Léa"}).json()

    assert body["amount_cents"] == 4500
    assert body["label_raw"] == "Remboursement Léa"
    # label_clean is derived, never sent: the search index would otherwise keep
    # matching the label the row no longer carries.
    assert body["label_clean"] == "remboursement lea"


def test_an_imported_row_can_be_corrected_too(client, imported):
    headers, _ = imported
    row = client.get("/api/transactions", headers=headers).json()["items"][0]

    body = client.patch(f"/api/transactions/{row['id']}", headers=headers,
                        json={"label_raw": "Virement interne"}).json()

    assert body["label_raw"] == "Virement interne"
    # Still an imported row: editing what it says does not rewrite where it
    # came from.
    assert body["manual"] is False


def test_the_value_date_can_be_cleared(client, imported):
    headers, account_id = imported
    created = _create(client, headers, account_id, value_date="2025-03-11")

    body = client.patch(f"/api/transactions/{created['id']}", headers=headers,
                        json={"value_date": None}).json()

    assert body["value_date"] is None


def test_the_row_can_move_to_another_account(client, imported):
    headers, account_id = imported
    created = _create(client, headers, account_id)
    other = client.post("/api/accounts", headers=headers,
                        json={"name": "Livret A", "kind": "savings"}).json()

    body = client.patch(f"/api/transactions/{created['id']}", headers=headers,
                        json={"account_id": other["id"]}).json()

    assert body["account_id"] == other["id"]


def test_another_users_account_is_refused(client, imported):
    headers, account_id = imported
    created = _create(client, headers, account_id)
    other_headers = _register(client, "lea@example.com")
    foreign = client.post("/api/accounts", headers=other_headers,
                          json={"name": "Courant", "kind": "checking"}).json()

    response = client.patch(f"/api/transactions/{created['id']}", headers=headers,
                            json={"account_id": foreign["id"]})

    assert response.status_code == 404
    assert response.json()["detail"] == "Compte introuvable"


def test_a_zero_amount_is_refused(client, imported):
    headers, account_id = imported
    created = _create(client, headers, account_id)

    response = client.patch(f"/api/transactions/{created['id']}", headers=headers,
                            json={"amount_cents": 0})

    assert response.status_code == 422


def test_a_blank_label_is_refused(client, imported):
    headers, account_id = imported
    created = _create(client, headers, account_id)

    response = client.patch(f"/api/transactions/{created['id']}", headers=headers,
                            json={"label_raw": "   "})

    assert response.status_code == 422


def test_clearing_a_not_null_column_is_refused(client, imported):
    headers, account_id = imported
    created = _create(client, headers, account_id)

    for field in ("date", "amount_cents", "label_raw", "account_id"):
        response = client.patch(f"/api/transactions/{created['id']}", headers=headers,
                                json={field: None})
        assert response.status_code == 422, field


def test_an_edit_leaves_the_category_alone(client, imported):
    headers, account_id = imported
    category = client.get("/api/categories", headers=headers).json()[0]
    created = _create(client, headers, account_id, category_id=category["id"])

    body = client.patch(f"/api/transactions/{created['id']}", headers=headers,
                        json={"date": "2025-12-08"}).json()

    assert body["category_id"] == category["id"]
    assert body["category_source"] == "manual"
    assert body["learned_rule_id"] is None
    assert body["backfilled"] == 0


def test_the_fingerprint_follows_the_edit(client, imported, db):
    headers, account_id = imported
    created = _create(client, headers, account_id)
    before = db.get(Transaction, created["id"]).dedup_hash

    client.patch(f"/api/transactions/{created['id']}", headers=headers,
                 json={"date": "2025-12-08"})

    db.expire_all()
    assert db.get(Transaction, created["id"]).dedup_hash != before


def test_editing_a_row_into_a_twin_keeps_both(client, imported):
    headers, account_id = imported
    twin = _create(client, headers, account_id)
    other = _create(client, headers, account_id, date="2025-04-01")

    response = client.patch(f"/api/transactions/{other['id']}", headers=headers,
                            json={"date": twin["date"]})

    assert response.status_code == 200
    body = client.get("/api/transactions", headers=headers).json()
    assert len([row for row in body["items"] if row["label_raw"] == "Boulangerie du coin"]) == 2


def test_an_edit_that_changes_nothing_is_accepted(client, imported):
    headers, account_id = imported
    created = _create(client, headers, account_id)

    # The recomputed fingerprint is the row's own: the collision suffix must
    # not treat a row as a duplicate of itself.
    response = client.patch(f"/api/transactions/{created['id']}", headers=headers,
                            json={"date": created["date"], "amount_cents": created["amount_cents"]})

    assert response.status_code == 200
    assert response.json()["date"] == created["date"]


def test_another_users_transaction_is_out_of_reach(client, imported):
    headers, account_id = imported
    created = _create(client, headers, account_id)
    other_headers = _register(client, "lea@example.com")

    response = client.patch(f"/api/transactions/{created['id']}", headers=other_headers,
                            json={"date": "2025-12-08"})

    assert response.status_code == 404
