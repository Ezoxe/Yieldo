"""`GET /api/reports/bilan`.

Tests the actual response bytes -- a real PDF, opened and its text
extracted through `pypdf` -- never a mocked renderer, and never a figure
asserted against a JSON field a mock could fake. The isolation test asserts
the OTHER user's own read first, the same discipline `test_export_api.py`'s
own module docstring explains: a fixture that silently wrote nothing would
make "the first user sees none of it" pass for the wrong reason.
"""

import io
from datetime import date

from pypdf import PdfReader

from app.models import Account, Debt, Transaction, User


def _register(client, email="reports@example.fr"):
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def _user_id(db, email: str) -> int:
    return db.query(User).filter(User.email == email).one().id


def _account(db, user_id: int, name: str = "Courant", balance: int = 0) -> Account:
    account = Account(user_id=user_id, name=name, kind="checking", currency="EUR",
                      opening_balance_cents=balance, include_in_net_worth=True, archived=False)
    db.add(account)
    db.flush()
    return account


def _tx(db, user_id, account_id, on, amount, label):
    db.add(Transaction(
        user_id=user_id, account_id=account_id, date=on, amount_cents=amount,
        label_raw=label, label_clean=label.lower(), category_id=None,
        category_source="uncategorized", is_transfer=False,
        dedup_hash=f"{on}{amount}{label}{account_id}", tags=[]))


def _pdf_text(content: bytes) -> str:
    reader = PdfReader(io.BytesIO(content))
    return " ".join(page.extract_text() for page in reader.pages).replace("\n", " ")


def test_the_response_is_a_downloadable_pdf(client):
    headers = _register(client, "download-report@example.fr")
    response = client.get("/api/reports/bilan", headers=headers)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert "attachment" in response.headers["content-disposition"]
    assert response.content.startswith(b"%PDF-")
    reader = PdfReader(io.BytesIO(response.content))
    assert len(reader.pages) >= 1


def test_a_household_with_no_data_gets_refusals_naming_their_own_cause(client):
    headers = _register(client, "empty-report@example.fr")
    response = client.get("/api/reports/bilan", headers=headers)
    text = _pdf_text(response.content)
    assert "Aucune dette déclarée." in text
    assert "Aucun objectif déclaré." in text
    assert "Aucune position déclarée." in text
    assert "PFU, barème, PEA, assurance-vie" in text


def test_a_real_debt_appears_with_its_own_figures(client, db):
    headers = _register(client, "debt-report@example.fr")
    user_id = _user_id(db, "debt-report@example.fr")
    db.add(Debt(user_id=user_id, name="Prêt auto Cetelem", kind="auto",
                principal_cents=800_000, annual_rate_bps=490, minimum_payment_cents=15_000,
                archived=False))
    db.commit()

    response = client.get("/api/reports/bilan", headers=headers)
    text = _pdf_text(response.content)
    assert "Prêt auto Cetelem" in text
    assert "8 000,00" in text
    assert "4,90 %" in text


def test_the_balance_is_the_real_measured_one_never_a_client_supplied_value(client, db):
    headers = _register(client, "balance-report@example.fr")
    user_id = _user_id(db, "balance-report@example.fr")
    account = _account(db, user_id, balance=200_000)
    _tx(db, user_id, account.id, date(2026, 3, 4), -12_000, "CARTE CARREFOUR")
    db.commit()

    response = client.get("/api/reports/bilan", headers=headers)
    text = _pdf_text(response.content)
    # 200 000 opening + a -120,00 movement = 1 880,00 EUR liquid balance --
    # measured from the ledger, never a figure this test could have handed
    # the endpoint itself.
    assert "1 880,00" in text


# --------------------------------------------------------------------------
# Isolation. The OTHER user's own read is asserted FIRST.
# --------------------------------------------------------------------------


def test_a_report_never_crosses_users(client, db):
    mine = _register(client, "mine-report@example.fr")
    theirs = _register(client, "theirs-report@example.fr")
    theirs_id = _user_id(db, "theirs-report@example.fr")
    db.add(Debt(user_id=theirs_id, name="Dette de l'autre foyer", kind="auto",
                principal_cents=500_000, annual_rate_bps=300, minimum_payment_cents=10_000,
                archived=False))
    db.commit()

    # Their own read FIRST: if the fixture silently wrote nothing, this
    # fails here rather than making the isolation assertion below pass for
    # free.
    theirs_text = _pdf_text(client.get("/api/reports/bilan", headers=theirs).content)
    assert "Dette de l'autre foyer" in theirs_text

    mine_text = _pdf_text(client.get("/api/reports/bilan", headers=mine).content)
    assert "Dette de l'autre foyer" not in mine_text
    assert "Aucune dette déclarée." in mine_text
