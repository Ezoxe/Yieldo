"""The agent access key: one rotating credential that lets a program drive Yieldo.

The key is issued BY Yieldo (unlike the provider keys in Réglages -> Connexions,
which the user types in), so it has to be readable back: an operator who cannot
see it cannot hand it to the agent. It is stored encrypted rather than hashed
for exactly that reason, and the tests below pin the properties that make that
choice safe -- a short life, a lookup that does not scan, and a hard boundary
around the account's own credentials.
"""

from datetime import UTC, datetime, timedelta

from app.models import AgentKey


def register(client, email="max@example.com"):
    response = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def issue(client, headers) -> str:
    return client.get("/api/access-key", headers=headers).json()["key"]


def as_agent(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}"}


# -- Issuing ------------------------------------------------------------------


def test_access_key_requires_authentication(client):
    assert client.get("/api/access-key").status_code == 401


def test_first_read_issues_a_key(client):
    headers = register(client)

    response = client.get("/api/access-key", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["key"].startswith("yld_")
    assert body["expires_at"] is not None


def test_reading_twice_returns_the_same_key(client):
    """A read is not a rotation: an operator opening Réglages twice must not
    invalidate the key they pasted into their agent five minutes ago."""
    headers = register(client)

    assert issue(client, headers) == issue(client, headers)


def test_the_key_is_stored_encrypted_not_in_the_clear(client, db):
    headers = register(client)
    key = issue(client, headers)

    stored = db.query(AgentKey).one()
    secret = key.rsplit("_", 1)[-1]
    assert secret not in stored.secret_encrypted


def test_rotation_issues_a_different_key_and_kills_the_old_one(client):
    headers = register(client)
    old = issue(client, headers)

    rotated = client.post("/api/access-key/rotate", headers=headers)

    assert rotated.status_code == 200
    new = rotated.json()["key"]
    assert new != old
    assert client.get("/api/auth/me", headers=as_agent(old)).status_code == 401
    assert client.get("/api/auth/me", headers=as_agent(new)).status_code == 200


def test_revoking_leaves_no_key_at_all(client):
    headers = register(client)
    key = issue(client, headers)

    assert client.delete("/api/access-key", headers=headers).status_code == 204
    assert client.get("/api/auth/me", headers=as_agent(key)).status_code == 401


def test_revoking_then_reading_issues_a_fresh_one(client):
    headers = register(client)
    first = issue(client, headers)
    client.delete("/api/access-key", headers=headers)

    assert issue(client, headers) != first


# -- Using it -----------------------------------------------------------------


def test_the_key_authenticates_like_a_session(client):
    headers = register(client)
    key = issue(client, headers)

    response = client.get("/api/auth/me", headers=as_agent(key))

    assert response.status_code == 200
    assert response.json()["email"] == "max@example.com"


def test_the_key_reads_the_account_s_data(client):
    headers = register(client)
    key = issue(client, headers)

    assert client.get("/api/accounts", headers=as_agent(key)).status_code == 200
    assert client.get("/api/categories", headers=as_agent(key)).status_code == 200


def test_the_key_can_write(client):
    """"Accès à tout, et peut modifier" -- a read-only key would not let an
    agent do the work this feature exists for."""
    headers = register(client)
    key = issue(client, headers)

    response = client.post("/api/accounts", json={
        "name": "Compte courant", "kind": "checking", "currency": "EUR",
        "opening_balance_cents": 0}, headers=as_agent(key))

    assert response.status_code == 201


def test_an_unknown_key_is_refused(client):
    register(client)
    assert client.get("/api/auth/me",
                      headers=as_agent("yld_aaaaaaaaaaaa_" + "b" * 43)).status_code == 401


def test_a_malformed_key_is_refused(client):
    register(client)
    assert client.get("/api/auth/me", headers=as_agent("yld_pasunecle")).status_code == 401


def test_a_key_whose_secret_is_wrong_is_refused(client):
    """The selector is public and indexed; only the secret proves anything."""
    headers = register(client)
    key = issue(client, headers)
    selector = key.split("_")[1]

    assert client.get("/api/auth/me",
                      headers=as_agent(f"yld_{selector}_" + "z" * 43)).status_code == 401


def test_one_account_s_key_never_reaches_another_s(client, db):
    theirs = register(client, "lea@example.com")
    key = issue(client, theirs)
    register(client, "max@example.com")

    from app.models import User
    max_id = db.query(User).filter(User.email == "max@example.com").one().id
    lea_id = db.query(User).filter(User.email == "lea@example.com").one().id

    assert client.get("/api/auth/me", headers=as_agent(key)).json()["email"] == "lea@example.com"
    assert max_id != lea_id


# -- Expiry -------------------------------------------------------------------


def test_an_expired_key_is_refused_with_a_sentence_that_says_what_to_do(client, db):
    headers = register(client)
    key = issue(client, headers)

    stored = db.query(AgentKey).one()
    stored.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()

    response = client.get("/api/auth/me", headers=as_agent(key))

    assert response.status_code == 401
    assert "Réglages" in response.json()["detail"]


def test_reading_after_expiry_hands_over_the_next_key(client, db):
    headers = register(client)
    expired = issue(client, headers)

    stored = db.query(AgentKey).one()
    stored.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()

    fresh = issue(client, headers)

    assert fresh != expired
    assert client.get("/api/auth/me", headers=as_agent(fresh)).status_code == 200


def test_the_key_lasts_twenty_four_hours(client):
    headers = register(client)

    body = client.get("/api/access-key", headers=headers).json()

    issued = datetime.fromisoformat(body["created_at"])
    expires = datetime.fromisoformat(body["expires_at"])
    assert timedelta(hours=23, minutes=59) < expires - issued <= timedelta(hours=24)


def test_using_the_key_records_when(client, db):
    headers = register(client)
    key = issue(client, headers)
    assert db.query(AgentKey).one().last_used_at is None

    client.get("/api/auth/me", headers=as_agent(key))

    assert db.query(AgentKey).one().last_used_at is not None


# -- The boundary -------------------------------------------------------------
#
# The key opens the ledger, not the account. An agent that could change the
# password could lock its owner out of their own finances, and an agent that
# could rotate the key could hand itself a longer life than the 24 hours this
# design promises. Both are refused, and both say why.


def test_the_key_cannot_change_the_password(client):
    headers = register(client)
    key = issue(client, headers)

    response = client.post("/api/auth/password", json={
        "current_password": "motdepasse123", "new_password": "nouveaumotdepasse"},
        headers=as_agent(key))

    assert response.status_code == 401
    assert "session" in response.json()["detail"].lower()
    # And the password really did not change.
    assert client.post("/api/auth/login", json={
        "email": "max@example.com", "password": "motdepasse123"}).status_code == 200


def test_the_key_cannot_change_the_email(client):
    headers = register(client)
    key = issue(client, headers)

    assert client.patch("/api/auth/me", json={"email": "autre@example.com"},
                        headers=as_agent(key)).status_code == 401


def test_the_key_cannot_read_or_rotate_itself(client):
    headers = register(client)
    key = issue(client, headers)

    assert client.get("/api/access-key", headers=as_agent(key)).status_code == 401
    assert client.post("/api/access-key/rotate", headers=as_agent(key)).status_code == 401
    assert client.delete("/api/access-key", headers=as_agent(key)).status_code == 401


def test_the_key_cannot_reach_the_provider_credentials(client):
    """Réglages -> Connexions holds keys to services outside this machine.
    An agent with an hour of access must not be able to walk off with them."""
    headers = register(client)
    key = issue(client, headers)

    assert client.get("/api/connections", headers=as_agent(key)).status_code == 401
