"""`GET /api/accounts/balance` — where the solde comes from, account by account.

The screen said "Solde disponible aujourd'hui : +50 639,30 €" and the household
answered "je n'ai pas ça sur mes comptes". One aggregate cannot be argued with:
it is an opening balance plus five years of movements over an unknown number of
accounts, and every way of being wrong -- a statement imported twice under two
accounts, an opening balance typed as today's balance on top of a backfilled
history, a savings account declared but never imported -- collapses into the
same single figure.

This route takes it apart. Three properties:

* **every liquid account is named with its own two halves**, the declared
  opening balance and the movements imported onto it, and they add up to the
  same total `liquid_balance_cents` reports -- there is one balance in this
  application, shown two ways, never two figures that could drift;
* **non-liquid accounts are listed too, and excluded from the total.** A PEA is
  wealth, not runway (`common.LIQUID_ACCOUNT_KINDS`); leaving it off the list
  entirely would look like a missing account rather than an excluded one;
* **the internal transfers are audited.** A transfer has two legs. The measured
  rates drop every row flagged `is_transfer` (`common.recurrence_points`) while
  the balance keeps them, so a receipt flagged on one side and an emission left
  unflagged on the other inflates income and spares spending -- the exact shape
  of "on dirait qu'il prend mes revenus sans prendre en compte les dépenses".
  `unmatched_cents` is what the two sides fail to cancel by.
"""

from datetime import date

from app.models import Account, Transaction


def _register(client, email: str = "max@example.com") -> dict[str, str]:
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def _account(client, headers, name: str, kind: str = "checking", opening: int = 0) -> dict:
    return client.post("/api/accounts", headers=headers, json={
        "name": name, "kind": kind, "opening_balance_cents": opening}).json()


def _row(db, user_id: int, account_id: int, amount: int, *, on: str = "2025-03-09",
         transfer: bool = False, label: str = "OP") -> None:
    db.add(Transaction(
        user_id=user_id, account_id=account_id, date=date.fromisoformat(on),
        amount_cents=amount, label_raw=label, label_clean=label.lower(),
        category_source="uncategorized", is_transfer=transfer,
        dedup_hash=f"{account_id}-{amount}-{on}-{label}-{transfer}",
    ))
    db.commit()


def _user_id(db, headers) -> int:
    return db.query(Account).first().user_id


def test_each_account_shows_its_two_halves(client, db):
    headers = _register(client)
    account = _account(client, headers, "Courant", opening=100_000)
    user_id = _user_id(db, headers)
    _row(db, user_id, account["id"], -25_000)
    _row(db, user_id, account["id"], 5_000)

    body = client.get("/api/accounts/balance", headers=headers).json()

    row = body["accounts"][0]
    assert row["name"] == "Courant"
    assert row["opening_balance_cents"] == 100_000
    assert row["movements_cents"] == -20_000
    assert row["transaction_count"] == 2
    assert row["balance_cents"] == 80_000


def test_the_halves_add_up_to_the_one_balance_the_rest_of_the_app_uses(client, db):
    from app.api.common import liquid_balance_cents

    headers = _register(client)
    first = _account(client, headers, "Courant", opening=100_000)
    second = _account(client, headers, "Livret", kind="savings", opening=250_000)
    user_id = _user_id(db, headers)
    _row(db, user_id, first["id"], -25_000)
    _row(db, user_id, second["id"], 25_000)

    body = client.get("/api/accounts/balance", headers=headers).json()

    assert body["liquid_total_cents"] == liquid_balance_cents(db, user_id)
    assert body["liquid_total_cents"] == 350_000


def test_a_non_liquid_account_is_listed_but_left_out_of_the_total(client, db):
    headers = _register(client)
    _account(client, headers, "Courant", opening=100_000)
    _account(client, headers, "PEA", kind="brokerage", opening=900_000)

    body = client.get("/api/accounts/balance", headers=headers).json()

    pea = next(row for row in body["accounts"] if row["name"] == "PEA")
    assert pea["liquid"] is False
    assert pea["balance_cents"] == 900_000
    assert body["liquid_total_cents"] == 100_000


def test_transfers_that_cancel_report_nothing_unmatched(client, db):
    headers = _register(client)
    account = _account(client, headers, "Courant")
    user_id = _user_id(db, headers)
    _row(db, user_id, account["id"], 40_000, transfer=True, label="VIR RECU DE MOI")
    _row(db, user_id, account["id"], -40_000, transfer=True, label="VIR EMIS POUR MOI")

    audit = client.get("/api/accounts/balance", headers=headers).json()["transfers"]

    assert audit["count"] == 2
    assert audit["received_cents"] == 40_000
    assert audit["sent_cents"] == -40_000
    assert audit["unmatched_cents"] == 0


def test_a_leg_flagged_on_one_side_only_is_reported(client, db):
    """The defect this route exists to make visible.

    The receipt is flagged and dropped from the measured rates; its matching
    emission is not, so it is counted as spending. Income and spending are then
    measured over two different halves of the same movement.
    """
    headers = _register(client)
    account = _account(client, headers, "Courant")
    user_id = _user_id(db, headers)
    _row(db, user_id, account["id"], 40_000, transfer=True, label="VIR RECU DE MOI")
    _row(db, user_id, account["id"], -40_000, transfer=False, label="VIR EMIS POUR MOI")

    audit = client.get("/api/accounts/balance", headers=headers).json()["transfers"]

    assert audit["count"] == 1
    assert audit["unmatched_cents"] == 40_000


def test_another_users_accounts_are_out_of_reach(client, db):
    headers = _register(client)
    _account(client, headers, "Courant", opening=100_000)
    other = _register(client, "lea@example.com")

    body = client.get("/api/accounts/balance", headers=other).json()

    assert body["accounts"] == []
    assert body["liquid_total_cents"] == 0


def test_the_opening_balance_can_be_corrected(client, db):
    """A wrong opening balance was unfixable: `AccountPatch` did not carry the
    field, so a household that typed today's balance and then imported five
    years of history had no way back but deleting the account."""
    headers = _register(client)
    account = _account(client, headers, "Courant", opening=5_000_000)

    patched = client.patch(f"/api/accounts/{account['id']}", headers=headers,
                           json={"opening_balance_cents": 0})

    assert patched.status_code == 200
    assert patched.json()["opening_balance_cents"] == 0


def test_the_opening_balance_may_not_be_cleared(client, db):
    headers = _register(client)
    account = _account(client, headers, "Courant", opening=5_000)

    response = client.patch(f"/api/accounts/{account['id']}", headers=headers,
                            json={"opening_balance_cents": None})

    assert response.status_code == 422
