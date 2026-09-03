"""GET/POST /api/export -- the filterable context export. Design §8.2.

The isolation test below asserts the OTHER user's own read first. A fixture
that silently wrote nothing would make "the first user sees none of it" pass
for the wrong reason -- there would have been nothing to see either way.
"""

from datetime import date

from app.engines.tax_fr import PEA_EXEMPTION_YEARS
from app.models import Account, Transaction, User

MODULES_ALL = [
    "profil", "budget", "patrimoine", "dettes", "objectifs",
    "positions", "recurrences", "analyses", "projections", "fiscalite",
]


def _register(client, email="export@example.fr"):
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def _user_id(db, email: str) -> int:
    return db.query(User).filter(User.email == email).one().id


def _account(db, user_id: int, name: str = "Courant") -> Account:
    account = Account(user_id=user_id, name=name, kind="checking", currency="EUR",
                      opening_balance_cents=0, include_in_net_worth=True, archived=False)
    db.add(account)
    db.flush()
    return account


def _tx(db, user_id, account_id, on, amount, label, *, is_transfer=False):
    db.add(Transaction(
        user_id=user_id, account_id=account_id, date=on, amount_cents=amount,
        label_raw=label, label_clean=label.lower(), category_id=None,
        category_source="uncategorized", is_transfer=is_transfer,
        dedup_hash=f"{on}{amount}{label}{account_id}", tags=[]))


def _seed(client, db, email: str, label: str, *, year: int = 2026) -> dict:
    headers = _register(client, email)
    user_id = _user_id(db, email)
    account = _account(db, user_id, name=f"Compte de {email}")
    _tx(db, user_id, account.id, date(year, 3, 4), -12_000, label)
    db.commit()
    return headers


def _scope(**overrides) -> dict:
    body = {
        "date_from": "2026-01-01", "date_to": "2026-12-31",
        "account_ids": None, "category_ids": None,
        "granularity": "transaction", "modules": ["profil", "analyses"],
        "anonymise": False, "target_model": None,
    }
    body.update(overrides)
    return body


# --- Portfolio helpers, the same three calls `test_projection_api.py` uses --
# named `_investment_account` rather than `_account` because that name is
# already the ledger-account helper above.


def _investment_account(client, headers, name="CTO Boursorama", kind="cto", opened_on=None):
    payload = {"name": name, "kind": kind}
    if opened_on is not None:
        payload["opened_on"] = opened_on
    return client.post("/api/portfolio/accounts", headers=headers, json=payload).json()


def _instrument(client, headers, symbol="EUR", asset_class="cash", currency="EUR"):
    return client.post("/api/portfolio/instruments", headers=headers, json={
        "symbol": symbol, "name": f"{symbol} test", "asset_class": asset_class,
        "currency": currency, "is_fractionable": True}).json()


def _holding(client, headers, account_id, symbol="EUR", asset_class="cash",
             quantity="100", unit_cost_cents=50):
    instrument = _instrument(client, headers, symbol=symbol, asset_class=asset_class)
    position = client.post("/api/portfolio/positions", headers=headers, json={
        "investment_account_id": account_id, "instrument_id": instrument["id"]}).json()
    client.post("/api/portfolio/lots", headers=headers, json={
        "position_id": position["id"], "quantity": quantity,
        "unit_cost_cents": unit_cost_cents, "acquired_on": "2020-01-15"})
    return position


# --------------------------------------------------------------------------
# The scope panel's own options, and the five templates.
# --------------------------------------------------------------------------


def test_the_options_list_this_users_accounts_and_the_declared_target_models(client, db):
    headers = _seed(client, db, "options@example.fr", "CARTE CARREFOUR")
    body = client.get("/api/export/options", headers=headers).json()
    assert [account["name"] for account in body["accounts"]] == ["Compte de options@example.fr"]
    assert {module["key"] for module in body["modules"]} == set(MODULES_ALL)
    assert any(model["key"] == "gemini-1-5-pro" for model in body["target_models"])
    assert body["ledger_date_from"] == "2026-03-04"


def test_the_five_templates_each_carry_a_scope_and_a_question(client):
    headers = _register(client, "templates@example.fr")
    body = client.get("/api/export/templates", headers=headers).json()
    assert [t["key"] for t in body] == [
        "bilan-annuel", "faisabilite-achat", "revue-portefeuille",
        "optimisation-fiscale", "diagnostic-budgetaire",
    ]
    for template in body:
        assert template["question"].strip()
        assert template["modules"]
        assert template["date_from"] < template["date_to"]


# --------------------------------------------------------------------------
# Isolation. The OTHER user's read is asserted FIRST.
# --------------------------------------------------------------------------


def test_an_export_never_crosses_users(client, db):
    mine = _seed(client, db, "mine-export@example.fr", "CARTE MA BOULANGERIE")
    theirs = _seed(client, db, "theirs-export@example.fr", "CARTE LEUR GARAGE")

    # Their own read FIRST: if the fixture silently wrote nothing, this fails
    # here rather than making the isolation assertion below pass for free.
    theirs_doc = client.post("/api/export", headers=theirs, json=_scope()).json()
    assert "CARTE LEUR GARAGE" in theirs_doc["markdown"]
    assert theirs_doc["transaction_count"] == 1

    mine_doc = client.post("/api/export", headers=mine, json=_scope()).json()
    assert "CARTE MA BOULANGERIE" in mine_doc["markdown"]
    assert "CARTE LEUR GARAGE" not in mine_doc["markdown"]
    assert "theirs-export@example.fr" not in mine_doc["markdown"]
    assert mine_doc["transaction_count"] == 1


def test_an_account_from_another_user_is_refused_rather_than_silently_ignored(client, db):
    mine = _seed(client, db, "a-export@example.fr", "CARTE A")
    _seed(client, db, "b-export@example.fr", "CARTE B")
    other_id = db.query(Account).filter(
        Account.name == "Compte de b-export@example.fr").one().id

    response = client.post("/api/export", headers=mine,
                           json=_scope(account_ids=[other_id]))
    assert response.status_code == 422
    assert str(other_id) in response.json()["detail"]


# --------------------------------------------------------------------------
# The scope, on the wire.
# --------------------------------------------------------------------------


def test_a_2025_2026_scope_excludes_2024_on_the_wire(client, db):
    headers = _register(client, "period-export@example.fr")
    user_id = _user_id(db, "period-export@example.fr")
    account = _account(db, user_id)
    _tx(db, user_id, account.id, date(2024, 6, 12), -123_456, "LOYER ANCIEN 2024")
    _tx(db, user_id, account.id, date(2025, 3, 4), -12_000, "CARTE CARREFOUR")
    db.commit()

    body = client.post("/api/export", headers=headers, json=_scope(
        date_from="2025-01-01", date_to="2026-12-31")).json()
    assert "LOYER ANCIEN 2024" not in body["markdown"]
    assert "1 234,56" not in body["markdown"]
    assert "CARTE CARREFOUR" in body["markdown"]
    assert body["transaction_count"] == 1


def test_anonymisation_leaves_no_merchant_and_no_amount_on_the_wire(client, db):
    headers = _register(client, "anon-export@example.fr")
    user_id = _user_id(db, "anon-export@example.fr")
    account = _account(db, user_id, name="Compte Boursorama Maxime")
    _tx(db, user_id, account.id, date(2026, 3, 4), -12_000, "CARTE X1234 CARREFOUR")
    _tx(db, user_id, account.id, date(2026, 4, 4), -30_000, "CARTE X1234 DARTY")
    db.commit()

    body = client.post("/api/export", headers=headers, json=_scope(
        modules=MODULES_ALL, anonymise=True)).json()
    # Scanned across the WHOLE document, every module included.
    for seeded in ("CARREFOUR", "DARTY", "Boursorama", "Maxime"):
        assert seeded not in body["markdown"]
    assert "€" not in body["markdown"]
    assert "120,00" not in body["markdown"]
    assert "%" in body["markdown"]


def test_anonymisation_with_nothing_to_be_relative_to_is_a_422_in_french(client, db):
    headers = _register(client, "anonempty-export@example.fr")
    user_id = _user_id(db, "anonempty-export@example.fr")
    account = _account(db, user_id)
    _tx(db, user_id, account.id, date(2026, 3, 4), 200_000, "VIREMENT SALAIRE")
    db.commit()

    response = client.post("/api/export", headers=headers,
                           json=_scope(anonymise=True))
    assert response.status_code == 422
    assert "anonymisation" in response.json()["detail"].lower()


def test_an_unknown_module_is_refused_and_names_the_ones_that_exist(client):
    headers = _register(client, "module-export@example.fr")
    response = client.post("/api/export", headers=headers,
                           json=_scope(modules=["profil", "astrologie"]))
    assert response.status_code == 422
    assert "astrologie" in response.json()["detail"]
    assert "profil" in response.json()["detail"]


def test_an_unknown_target_model_is_refused_rather_than_defaulted(client):
    headers = _register(client, "model-export@example.fr")
    response = client.post("/api/export", headers=headers,
                           json=_scope(target_model="gpt-42"))
    assert response.status_code == 422
    assert "gpt-42" in response.json()["detail"]


def test_a_named_target_model_yields_an_estimate_and_a_verdict(client, db):
    headers = _seed(client, db, "window-export@example.fr", "CARTE CARREFOUR")
    body = client.post("/api/export", headers=headers,
                       json=_scope(target_model="gemini-1-5-pro")).json()
    assert body["estimated_tokens"] > 0
    assert body["warning"] is None


def test_a_document_past_the_window_carries_the_warning(client, db):
    headers = _register(client, "big-export@example.fr")
    user_id = _user_id(db, "big-export@example.fr")
    account = _account(db, user_id)
    for index in range(2_000):
        _tx(db, user_id, account.id, date(2026, 3, 4), -1_000 - index,
            f"ACHAT NUMERO {index}")
    db.commit()

    body = client.post("/api/export", headers=headers, json=_scope(
        modules=MODULES_ALL, target_model="local-8k")).json()
    assert body["warning"] is not None
    assert "granularité" in body["warning"]


# --------------------------------------------------------------------------
# Download, in the three formats design §8.2 names.
# --------------------------------------------------------------------------


def test_downloading_markdown_returns_the_document_itself(client, db):
    headers = _seed(client, db, "md-export@example.fr", "CARTE CARREFOUR")
    body = client.post("/api/export/download", headers=headers,
                       json={**_scope(), "format": "md"}).json()
    assert body["filename"].endswith(".md")
    assert body["content_type"] == "text/markdown; charset=utf-8"
    assert body["content"].startswith("# Contexte financier")


def test_downloading_text_returns_the_same_document_under_a_plain_type(client, db):
    headers = _seed(client, db, "txt-export@example.fr", "CARTE CARREFOUR")
    scope = _scope()
    markdown = client.post("/api/export", headers=headers, json=scope).json()["markdown"]
    body = client.post("/api/export/download", headers=headers,
                       json={**scope, "format": "txt"}).json()
    assert body["filename"].endswith(".txt")
    assert body["content_type"] == "text/plain; charset=utf-8"
    assert body["content"] == markdown


def test_downloading_json_returns_the_document_and_its_scope_as_structure(client, db):
    import json

    headers = _seed(client, db, "json-export@example.fr", "CARTE CARREFOUR")
    body = client.post("/api/export/download", headers=headers,
                       json={**_scope(), "format": "json"}).json()
    assert body["filename"].endswith(".json")
    assert body["content_type"] == "application/json; charset=utf-8"
    payload = json.loads(body["content"])
    assert payload["markdown"].startswith("# Contexte financier")
    assert payload["scope"]["granularity"] == "transaction"
    assert payload["estimated_tokens"] > 0
    assert payload["sections"] == ["profil", "analyses"]


def test_an_unknown_download_format_is_refused(client):
    headers = _register(client, "fmt-export@example.fr")
    response = client.post("/api/export/download", headers=headers,
                           json={**_scope(), "format": "pdf"})
    assert response.status_code == 422


def test_a_download_never_crosses_users(client, db):
    mine = _seed(client, db, "dl-mine@example.fr", "CARTE MA BOULANGERIE")
    theirs = _seed(client, db, "dl-theirs@example.fr", "CARTE LEUR GARAGE")

    theirs_file = client.post("/api/export/download", headers=theirs,
                              json={**_scope(), "format": "md"}).json()
    assert "CARTE LEUR GARAGE" in theirs_file["content"]

    mine_file = client.post("/api/export/download", headers=mine,
                            json={**_scope(), "format": "md"}).json()
    assert "CARTE MA BOULANGERIE" in mine_file["content"]
    assert "CARTE LEUR GARAGE" not in mine_file["content"]


# --------------------------------------------------------------------------
# What the modules actually carry.
# --------------------------------------------------------------------------


def test_a_module_with_nothing_behind_it_says_so_rather_than_printing_nothing(client, db):
    headers = _seed(client, db, "empty-export@example.fr", "CARTE CARREFOUR")
    body = client.post("/api/export", headers=headers,
                       json=_scope(modules=MODULES_ALL)).json()
    assert "Aucune dette déclarée." in body["markdown"]
    assert "Aucun objectif déclaré." in body["markdown"]
    assert "Aucune position déclarée." in body["markdown"]
    # The two engine-backed modules name their own cause.
    assert "## Projections" in body["markdown"]
    assert "## Fiscalité" in body["markdown"]
    assert set(body["sections"]) == set(MODULES_ALL)
    # The zero-positions refusal is the tax engine's OWN cause -- it names
    # every regime this household holds no envelope for, and it is never a
    # pointer sending the reader to another screen for the figure this one
    # could not produce itself.
    assert "PFU, barème, PEA, assurance-vie" in body["markdown"]
    assert "écran Projection" not in body["markdown"]


def test_fiscalite_runs_the_real_tax_engine_and_names_the_regime_and_article(client):
    """A PEA past its five-year exemption: the same envelope, the same
    engine call, and the same regime `/api/projection` would name -- proven
    here by asserting the CGI article appears, not merely a euro figure."""
    headers = _register(client, "fiscal-pea@example.fr")
    opened = date.today().replace(year=date.today().year - PEA_EXEMPTION_YEARS - 1)
    account = _investment_account(client, headers, name="PEA Boursorama", kind="pea",
                                  opened_on=opened.isoformat())
    # 100 units at 0,50 EUR, valued at par (cash instrument) for 1,00 EUR:
    # a 50,00 EUR latent gain.
    _holding(client, headers, account["id"], quantity="100", unit_cost_cents=50)

    body = client.post("/api/export", headers=headers,
                       json=_scope(modules=["fiscalite"])).json()
    assert "PEA exonéré d'impôt sur le revenu" in body["markdown"]
    assert "art. 157" in body["markdown"]
    assert "PEA Boursorama" in body["markdown"]
    assert "écran Projection" not in body["markdown"]


def test_fiscalite_never_crosses_users(client):
    """Isolation: the household's own PEA gain must never appear on someone
    else's export. The other user's own read is asserted FIRST so a fixture
    that silently wrote nothing could not make the isolation assertion pass
    for free."""
    mine = _register(client, "fiscal-mine@example.fr")
    theirs = _register(client, "fiscal-theirs@example.fr")
    opened = date.today().replace(year=date.today().year - PEA_EXEMPTION_YEARS - 1)
    account = _investment_account(client, theirs, name="PEA de l'autre", kind="pea",
                                  opened_on=opened.isoformat())
    _holding(client, theirs, account["id"], quantity="100", unit_cost_cents=50)

    theirs_body = client.post("/api/export", headers=theirs,
                              json=_scope(modules=["fiscalite"])).json()
    assert "PEA de l'autre" in theirs_body["markdown"]

    mine_body = client.post("/api/export", headers=mine,
                            json=_scope(modules=["fiscalite"])).json()
    assert "PEA de l'autre" not in mine_body["markdown"]
    assert "PFU, barème, PEA, assurance-vie" in mine_body["markdown"]
