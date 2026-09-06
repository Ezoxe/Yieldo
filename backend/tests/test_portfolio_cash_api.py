"""The savings a household actually has, on the screen that names its wealth.

Found by the audit: a Livret A holding 9 912,40 EUR showed as 0,00 EUR on
Patrimoine. There are two notions of account in the model with no bridge
between them -- `models/account.py` (bank accounts, with a `kind` among which
`savings`, `pea`, `life_insurance`, `per`) and `models/investment_account.py`
(the envelopes carrying positions) -- and `/api/portfolio/*` read only the
second. A household that imported its livret saw it in its balances and not in
its wealth.

A bank balance is a third kind of number, beside a valued position and a
declared amount, and it is reported as its own section rather than merged: one
comes from a quoted price, one from a statement the household typed, and one
from adding up transactions. Each says something different about how much the
figure can be trusted.
"""


def _register(client, email: str = "max@example.com") -> dict[str, str]:
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def _account(client, headers, name: str, kind: str, **overrides) -> int:
    payload = {"name": name, "kind": kind, "opening_balance_cents": 0}
    payload.update(overrides)
    return client.post("/api/accounts", headers=headers, json=payload).json()["id"]


def _valuation(client, headers) -> dict:
    return client.get("/api/portfolio/valuation", headers=headers).json()


def test_a_livret_counts_in_the_household_s_wealth(client):
    headers = _register(client)
    _account(client, headers, "Livret A", "savings", opening_balance_cents=450_000)

    body = _valuation(client, headers)

    assert [row["name"] for row in body["cash"]] == ["Livret A"]
    assert body["cash"][0]["balance_cents"] == 450_000
    assert body["cash_total_cents"] == 450_000
    assert body["total"]["market_value_cents"] == 450_000


def test_the_balance_counts_the_movements_and_not_only_the_opening(client):
    headers = _register(client)
    livret = _account(client, headers, "Livret A", "savings",
                      opening_balance_cents=450_000)
    client.post("/api/transactions", headers=headers, json={
        "account_id": livret, "date": "2026-03-05", "amount_cents": 30_000,
        "label_raw": "VIR RECU COMPTE COURANT"})

    body = _valuation(client, headers)
    assert body["cash"][0]["balance_cents"] == 480_000


def test_a_current_account_is_not_wealth_on_this_screen(client):
    """The perimeter is `engines/transfer.SAVINGS_ACCOUNT_KINDS`, the same one
    that decides what "mettre de côté" means. A current account is the money
    you live on, and Trésorerie is where it belongs."""
    headers = _register(client)
    _account(client, headers, "Compte courant", "checking",
             opening_balance_cents=180_000)

    body = _valuation(client, headers)
    assert body["cash"] == []
    assert body["cash_total_cents"] == 0


def test_an_account_the_household_kept_out_of_its_net_worth_is_kept_out(client):
    headers = _register(client)
    _account(client, headers, "Livret des enfants", "savings",
             opening_balance_cents=200_000, include_in_net_worth=False)

    assert _valuation(client, headers)["cash"] == []


def test_an_archived_account_is_kept_out(client):
    headers = _register(client)
    livret = _account(client, headers, "Vieux livret", "savings",
                      opening_balance_cents=200_000)
    client.delete(f"/api/accounts/{livret}", headers=headers)

    assert _valuation(client, headers)["cash"] == []


def test_cash_is_added_to_the_total_and_to_nothing_else(client):
    """A bank balance has no cost basis, so folding it into `cost_basis_cents`
    would invent a gain or a loss out of nothing -- the same rule the declared
    amounts already follow. And it names no instrument, asset class or
    currency, so it takes no part in any weight."""
    headers = _register(client)
    _account(client, headers, "Livret A", "savings", opening_balance_cents=450_000)

    body = _valuation(client, headers)

    assert body["total"]["cost_basis_cents"] == 0
    assert body["total"]["unrealised_gain_cents"] == 0
    assert body["total"]["positions_total"] == 0
    assert body["weight_by_asset_class"] == []


def test_one_household_never_sees_another_s_savings(client):
    headers = _register(client)
    _account(client, headers, "Livret A", "savings", opening_balance_cents=450_000)
    other = _register(client, "autre@example.com")

    assert _valuation(client, other)["cash"] == []
