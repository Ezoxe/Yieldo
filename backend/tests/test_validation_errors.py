"""Every 422 this API returns is written in French.

The defect these cover: /connexion, "pas-un-email", and the alert on screen read
"value is not a valid email address: An email address must have an @-sign." --
pydantic's own English, straight through FastAPI's default handler onto the
first screen anyone touches.
"""

import re

# Anything in a message that is unmistakably English rather than a field
# identifier. Field names (`limit`, `account_id`) are identifiers and may appear.
ENGLISH_MARKERS = re.compile(
    r"\b(value|valid|should|must|have|address|character|input|field|required|"
    r"less|greater|than|equal|type|expected|string)\b",
    re.IGNORECASE,
)


def messages(response) -> list[str]:
    return [item["msg"] for item in response.json()["detail"]]


def test_an_invalid_email_is_reported_in_french(client):
    response = client.post("/api/auth/login", json={
        "email": "pas-un-email", "password": "MotDePasseDemo123!"})

    assert response.status_code == 422
    assert messages(response) == ["L'adresse e-mail n'est pas valide."]


def test_no_validation_message_leaks_english(client):
    response = client.post("/api/auth/register", json={
        "name": "", "email": "pas-un-email", "password": "court"})

    assert response.status_code == 422
    for message in messages(response):
        assert not ENGLISH_MARKERS.search(message), message


def test_a_too_short_password_says_how_long_it_must_be(client):
    response = client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "court"})

    assert response.status_code == 422
    assert "Le mot de passe doit contenir au moins 8 caractères." in messages(response)


def test_a_missing_field_names_itself(client):
    response = client.post("/api/auth/login", json={"email": "max@example.com"})

    assert response.status_code == 422
    assert messages(response) == ["Le mot de passe est obligatoire."]


def test_an_out_of_range_query_parameter_is_reported_in_french(client, imported):
    headers, _ = imported
    response = client.get("/api/transactions?limit=99999", headers=headers)

    assert response.status_code == 422
    assert messages(response) == ["Le champ « limit » doit être inférieur ou égal à 500."]


def test_a_non_numeric_query_parameter_is_reported_in_french(client, imported):
    headers, _ = imported
    response = client.get("/api/transactions?limit=beaucoup", headers=headers)

    assert response.status_code == 422
    assert messages(response) == ["Le champ « limit » doit être un nombre entier."]


def test_a_malformed_json_body_is_reported_in_french(client):
    response = client.post("/api/auth/login", content=b"{pas du json",
                           headers={"Content-Type": "application/json"})

    assert response.status_code == 422
    assert messages(response) == ["Le corps de la requête n'est pas un JSON valide."]


def test_a_missing_upload_is_reported_in_french(client):
    registered = client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"}).json()
    headers = {"Authorization": f"Bearer {registered['access_token']}"}

    response = client.post("/api/imports/analyze", headers=headers, data={"account_id": "1"})

    assert response.status_code == 422
    assert messages(response) == ["Le fichier est obligatoire."]


def test_the_validation_reply_keeps_the_field_it_is_about(client):
    """`msg` is rewritten; `loc` and `type` are not -- the client still knows
    which field failed and why, without reading French prose."""
    response = client.post("/api/auth/login", json={
        "email": "pas-un-email", "password": "MotDePasseDemo123!"})

    error = response.json()["detail"][0]
    assert error["loc"] == ["body", "email"]
    assert error["type"] == "value_error"


def test_the_validation_reply_never_echoes_the_submitted_value(client):
    """FastAPI's default 422 carries `input` back to the client -- which, on a
    too-short password, is the password itself in plain text."""
    response = client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "court"})

    body = response.text
    assert "court" not in body
    assert all("input" not in error for error in response.json()["detail"])
