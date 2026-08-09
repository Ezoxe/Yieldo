from pathlib import Path

import pytest

from app.config import settings

FIXTURES = Path(__file__).parent / "fixtures"

FULL_DIALECT = {
    "encoding": "utf-8",
    "delimiter": ";",
    "decimal_separator": ",",
    "date_format": "%d/%m/%Y",
    "header_row": 0,
    "preamble_rows": 0,
    "quotechar": '"',
    "sample_headers": [],
}


@pytest.fixture(autouse=True)
def isolated_uploads_dir(tmp_path, monkeypatch):
    """Redirect settings.uploads_dir to a throwaway directory for every test.

    Tests must never write into the real backend/data/uploads directory. It also
    matters for correctness: ImportBatch ids restart at 1 on each test's fresh
    in-memory database, so archived files named batch-<id>.csv would otherwise
    collide across tests that share one on-disk directory.
    """
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)


@pytest.fixture
def auth(client):
    registered = client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {registered['access_token']}"}


@pytest.fixture
def account_id(client, auth) -> int:
    response = client.post("/api/accounts", headers=auth,
                           json={"name": "Compte courant", "kind": "checking"})
    return response.json()["id"]


def test_accounts_require_authentication(client):
    assert client.get("/api/accounts").status_code == 401


def test_account_creation_and_listing(client, auth):
    client.post("/api/accounts", headers=auth, json={"name": "Livret A", "kind": "savings"})
    listed = client.get("/api/accounts", headers=auth).json()
    assert [a["name"] for a in listed] == ["Livret A"]
    assert listed[0]["currency"] == "EUR"


def test_account_rejects_unknown_kind(client, auth):
    response = client.post("/api/accounts", headers=auth,
                           json={"name": "X", "kind": "not-a-kind"})
    assert response.status_code == 422


def test_analyze_returns_preview_with_suggested_mapping(client, auth, account_id):
    with (FIXTURES / "boursorama.csv").open("rb") as handle:
        response = client.post("/api/imports/analyze", headers=auth,
                               files={"file": ("boursorama.csv", handle, "text/csv")},
                               data={"account_id": str(account_id)})
    assert response.status_code == 200
    body = response.json()
    assert body["upload_token"]
    assert body["headers"] == ["dateOp", "dateVal", "label", "category", "amount"]
    assert body["suggested_mapping"]["0"] == "date"
    assert body["summary"]["importable"] == 4
    assert len(body["rows"]) == 4


def test_analyze_rejects_a_non_csv_extension(client, auth, account_id):
    response = client.post("/api/imports/analyze", headers=auth,
                           files={"file": ("photo.png", b"\x89PNG", "image/png")},
                           data={"account_id": str(account_id)})
    assert response.status_code == 400
    assert "CSV" in response.json()["detail"]


def test_analyze_rejects_an_account_owned_by_someone_else(client, auth, account_id):
    other = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea@example.com", "password": "motdepasse123"}).json()
    headers = {"Authorization": f"Bearer {other['access_token']}"}
    with (FIXTURES / "boursorama.csv").open("rb") as handle:
        response = client.post("/api/imports/analyze", headers=headers,
                               files={"file": ("b.csv", handle, "text/csv")},
                               data={"account_id": str(account_id)})
    assert response.status_code == 404


def test_commit_flow_creates_transactions(client, auth, account_id):
    with (FIXTURES / "boursorama.csv").open("rb") as handle:
        preview = client.post("/api/imports/analyze", headers=auth,
                              files={"file": ("b.csv", handle, "text/csv")},
                              data={"account_id": str(account_id)}).json()

    response = client.post("/api/imports/commit", headers=auth, json={
        "upload_token": preview["upload_token"],
        "account_id": account_id,
        "dialect": preview["dialect"],
        "mapping": preview["suggested_mapping"],
        "overrides": {},
        "keep_duplicates": [],
    })
    assert response.status_code == 201
    assert response.json()["rows_imported"] == 4

    batches = client.get("/api/imports", headers=auth).json()
    assert len(batches) == 1
    assert batches[0]["filename"] == "b.csv"


def test_commit_rejects_a_mapping_without_a_date_column(client, auth, account_id):
    with (FIXTURES / "boursorama.csv").open("rb") as handle:
        preview = client.post("/api/imports/analyze", headers=auth,
                              files={"file": ("b.csv", handle, "text/csv")},
                              data={"account_id": str(account_id)}).json()
    broken = dict(preview["suggested_mapping"])
    broken["0"] = "ignore"
    response = client.post("/api/imports/commit", headers=auth, json={
        "upload_token": preview["upload_token"], "account_id": account_id,
        "dialect": preview["dialect"], "mapping": broken,
        "overrides": {}, "keep_duplicates": [],
    })
    assert response.status_code == 422
    assert "Date" in response.json()["detail"]


def test_delete_batch_rolls_back_its_transactions(client, auth, account_id):
    with (FIXTURES / "boursorama.csv").open("rb") as handle:
        preview = client.post("/api/imports/analyze", headers=auth,
                              files={"file": ("b.csv", handle, "text/csv")},
                              data={"account_id": str(account_id)}).json()
    batch = client.post("/api/imports/commit", headers=auth, json={
        "upload_token": preview["upload_token"], "account_id": account_id,
        "dialect": preview["dialect"], "mapping": preview["suggested_mapping"],
        "overrides": {}, "keep_duplicates": [],
    }).json()

    assert client.delete(f"/api/imports/{batch['id']}", headers=auth).status_code == 200
    assert client.get("/api/imports", headers=auth).json() == []


def test_delete_batch_owned_by_someone_else_returns_404(client, auth, account_id):
    """PermissionError from rollback_import must read as 404, not 403 -- the
    existence of someone else's batch must not be disclosed."""
    with (FIXTURES / "boursorama.csv").open("rb") as handle:
        preview = client.post("/api/imports/analyze", headers=auth,
                              files={"file": ("b.csv", handle, "text/csv")},
                              data={"account_id": str(account_id)}).json()
    batch = client.post("/api/imports/commit", headers=auth, json={
        "upload_token": preview["upload_token"], "account_id": account_id,
        "dialect": preview["dialect"], "mapping": preview["suggested_mapping"],
        "overrides": {}, "keep_duplicates": [],
    }).json()

    other = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea3@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}

    response = client.delete(f"/api/imports/{batch['id']}", headers=other_headers)
    assert response.status_code == 404


def test_delete_batch_unknown_id_returns_404(client, auth):
    assert client.delete("/api/imports/999999", headers=auth).status_code == 404


def test_commit_rejects_a_path_traversal_upload_token(client, auth, account_id):
    """The upload token reaches _upload_path straight from the request body: it
    must reject a token trying to climb out of the uploads directory, whether via
    '..' or via an embedded path separator."""
    for bad_token in ("../evil.csv", "..\\evil.csv", "sub/evil.csv", "sub\\evil.csv"):
        response = client.post("/api/imports/commit", headers=auth, json={
            "upload_token": bad_token, "account_id": account_id,
            "dialect": FULL_DIALECT, "mapping": {"0": "date"},
            "overrides": {}, "keep_duplicates": [],
        })
        assert response.status_code == 400, bad_token
        assert "invalide" in response.json()["detail"]


def test_analyze_rejects_a_file_over_20mb(client, auth, account_id):
    huge = b"a" * (20 * 1024 * 1024 + 1)
    response = client.post("/api/imports/analyze", headers=auth,
                           files={"file": ("big.csv", huge, "text/csv")},
                           data={"account_id": str(account_id)})
    assert response.status_code == 413
    assert "Mo" in response.json()["detail"]


def test_column_profile_can_be_saved_and_recalled(client, auth, account_id):
    with (FIXTURES / "boursorama.csv").open("rb") as handle:
        preview = client.post("/api/imports/analyze", headers=auth,
                              files={"file": ("b.csv", handle, "text/csv")},
                              data={"account_id": str(account_id)}).json()
    created = client.post("/api/imports/profiles", headers=auth, json={
        "name": "Boursorama", "dialect": preview["dialect"],
        "mapping": preview["suggested_mapping"],
    })
    assert created.status_code == 201
    profiles = client.get("/api/imports/profiles", headers=auth).json()
    assert profiles[0]["name"] == "Boursorama"
    assert profiles[0]["mapping"]["0"] == "date"


def test_saving_two_profiles_with_the_same_name_is_rejected(client, auth):
    payload = {"name": "Boursorama", "dialect": {}, "mapping": {"0": "date"}}
    client.post("/api/imports/profiles", headers=auth, json=payload)
    assert client.post("/api/imports/profiles", headers=auth, json=payload).status_code == 409
