"""Imports the connector prepares, and the household confirms.

The tool analyses a CSV and keeps it; it never commits one. The Imports
screen lists what was prepared, downloads the file and runs the ordinary
wizard on it, where the household confirms the columns itself.
"""

from pathlib import Path

from app.models import ImportBatch, PendingImport, Transaction

FIXTURES = Path(__file__).parent / "fixtures"


def register(client, email="max@example.com"):
    response = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def connector(client, headers):
    token = client.post("/api/connector-key", headers=headers).json()["key"]
    return {"Authorization": f"Bearer {token}"}


def an_account(client, headers, name="Courant") -> int:
    return client.post("/api/accounts", headers=headers,
                       json={"name": name, "kind": "checking"}).json()["id"]


def statement_text() -> str:
    return (FIXTURES / "boursorama.csv").read_bytes().decode("utf-8", errors="replace")


def prepare(client, key, account_id, name="releve.csv", content=None):
    return client.post("/api/connector/call", headers=key, json={
        "tool": "yieldo_import_preparer",
        "args": {"account_id": account_id, "nom_fichier": name,
                 "contenu": statement_text() if content is None else content},
    })


def test_preparing_analyses_and_keeps_the_file_but_imports_nothing(client, db):
    headers = register(client)
    account_id = an_account(client, headers)

    response = prepare(client, connector(client, headers), account_id)

    assert response.status_code == 201
    body = response.json()["body"]
    assert body["lignes"] > 0
    assert body["mapping_propose"]
    assert "confirmez les colonnes" in body["message"]
    assert db.query(PendingImport).count() == 1
    assert db.query(ImportBatch).count() == 0
    assert db.query(Transaction).count() == 0


def test_the_prepared_import_is_listed_and_its_file_is_the_one_sent(client):
    headers = register(client)
    account_id = an_account(client, headers)
    prepared = prepare(client, connector(client, headers), account_id)
    pending_id = prepared.json()["body"]["pending_id"]

    listed = client.get("/api/imports/pending", headers=headers).json()
    file = client.get(f"/api/imports/pending/{pending_id}/file", headers=headers)

    assert listed[0]["id"] == pending_id
    assert listed[0]["account_name"] == "Courant"
    assert listed[0]["filename"] == "releve.csv"
    assert listed[0]["rows"] > 0
    assert file.status_code == 200
    assert file.content.decode("utf-8") == statement_text()


def test_the_household_sets_a_prepared_import_aside(client, db):
    headers = register(client)
    account_id = an_account(client, headers)
    prepared = prepare(client, connector(client, headers), account_id)
    pending_id = prepared.json()["body"]["pending_id"]

    assert client.delete(f"/api/imports/pending/{pending_id}", headers=headers).status_code == 204
    assert db.query(PendingImport).count() == 0


def test_another_household_never_sees_a_prepared_import(client):
    headers = register(client, "un@example.com")
    stranger = register(client, "deux@example.com")
    pending_id = prepare(client, connector(client, headers),
                         an_account(client, headers)).json()["body"]["pending_id"]

    assert client.get("/api/imports/pending", headers=stranger).json() == []
    assert client.get(f"/api/imports/pending/{pending_id}/file",
                      headers=stranger).status_code == 404
    assert client.delete(f"/api/imports/pending/{pending_id}",
                         headers=stranger).status_code == 404


def test_preparing_into_another_households_account_is_refused(client, db):
    headers = register(client, "un@example.com")
    theirs = an_account(client, register(client, "deux@example.com"))

    response = prepare(client, connector(client, headers), theirs)

    assert response.status_code == 404
    assert db.query(PendingImport).count() == 0


def test_only_a_csv_of_reasonable_size_is_prepared(client, db):
    headers = register(client)
    key = connector(client, headers)
    account_id = an_account(client, headers)

    wrong_kind = prepare(client, key, account_id, name="releve.pdf")
    too_large = prepare(client, key, account_id, content="a;b\n" * 600_000)
    empty = prepare(client, key, account_id, content="   ")

    assert wrong_kind.status_code == 422
    assert "CSV" in wrong_kind.json()["detail"]
    assert too_large.status_code == 413
    assert empty.status_code == 422
    assert db.query(PendingImport).count() == 0


def test_the_prepared_list_is_read_by_the_connector_and_setting_aside_waits(client):
    headers = register(client)
    key = connector(client, headers)
    pending_id = prepare(client, key, an_account(client, headers)).json()["body"]["pending_id"]

    listed = client.post("/api/connector/call", headers=key,
                         json={"tool": "yieldo_lire_imports_prepares", "args": {}})
    refused = client.post("/api/connector/call", headers=key,
                          json={"tool": "yieldo_ecarter_import_prepare",
                                "args": {"pending_id": pending_id}})

    assert listed.json()["body"][0]["id"] == pending_id
    assert refused.status_code == 403
