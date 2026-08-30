"""A PATCH must not be able to empty a column the database forbids emptying.

Every `*Patch` schema types its fields `X | None` so that omitting one means
"leave it alone". Pydantic reads an explicit JSON `null` as a provided value,
so `{"name": null}` passed validation, reached `setattr(row, "name", None)`,
and blew up in `db.commit()` as a raw `sqlalchemy.exc.IntegrityError` -- a 500
with an English traceback, on the same endpoint that answers every other
malformed payload with a French 422.

One test per patchable endpoint, over the fields whose columns are NOT NULL.
"""

import pytest

DEBT = {"name": "Crédit auto", "kind": "auto", "principal_cents": 850_000,
        "annual_rate_bps": 490, "minimum_payment_cents": 18_000}
ACCOUNT = {"name": "Compte courant", "kind": "checking"}
CATEGORY = {"name": "Courses"}


def _headers(client, email):
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


@pytest.mark.parametrize("field", [
    "name", "kind", "principal_cents", "annual_rate_bps",
    "minimum_payment_cents", "archived",
])
def test_a_debt_field_the_database_requires_cannot_be_patched_to_null(client, field):
    headers = _headers(client, f"null-debt-{field}@example.fr")
    debt_id = client.post("/api/debts", json=DEBT, headers=headers).json()["id"]
    response = client.patch(f"/api/debts/{debt_id}", json={field: None}, headers=headers)
    assert response.status_code == 422
    assert "vidé" in response.json()["detail"][0]["msg"]


@pytest.mark.parametrize("field", ["name", "include_in_net_worth", "archived"])
def test_an_account_field_the_database_requires_cannot_be_patched_to_null(client, field):
    headers = _headers(client, f"null-account-{field}@example.fr")
    account_id = client.post("/api/accounts", json=ACCOUNT, headers=headers).json()["id"]
    response = client.patch(f"/api/accounts/{account_id}", json={field: None}, headers=headers)
    assert response.status_code == 422
    assert "vidé" in response.json()["detail"][0]["msg"]


@pytest.mark.parametrize("field", ["name", "color", "icon", "is_essential"])
def test_a_category_field_the_database_requires_cannot_be_patched_to_null(client, field):
    headers = _headers(client, f"null-category-{field}@example.fr")
    category_id = client.post("/api/categories", json=CATEGORY, headers=headers).json()["id"]
    response = client.patch(f"/api/categories/{category_id}", json={field: None}, headers=headers)
    assert response.status_code == 422
    assert "vidé" in response.json()["detail"][0]["msg"]


@pytest.mark.parametrize("field", ["is_transfer", "tags"])
def test_a_transaction_field_the_database_requires_cannot_be_patched_to_null(client, field):
    """No transaction needs to exist: the schema must refuse the body before
    the router ever looks the row up, so a 404 here would mean the null got
    past validation."""
    headers = _headers(client, f"null-tx-{field}@example.fr")
    response = client.patch("/api/transactions/1", json={field: None}, headers=headers)
    assert response.status_code == 422
    assert "vidé" in response.json()["detail"][0]["msg"]


def test_a_nullable_field_can_still_be_cleared(client):
    """The guard is per-field, not blanket. `term_months` and `opened_on` are
    nullable columns: emptying them is a legitimate edit, and a validator
    applied to the whole model would have broken it."""
    headers = _headers(client, "null-ok@example.fr")
    debt_id = client.post("/api/debts", json={**DEBT, "term_months": 60},
                          headers=headers).json()["id"]
    response = client.patch(f"/api/debts/{debt_id}",
                            json={"term_months": None}, headers=headers)
    assert response.status_code == 200
    assert response.json()["term_months"] is None
