"""GET/POST/DELETE /api/connections.

Storing a key validates it with one real call and says plainly whether it
worked (`valid`, `reason`); reading never returns a key, only whether one
is set, when it was last used, and the quota window's state; deleting
removes it. The real network call is replaced by monkeypatching one entry
in `market.providers.PROVIDERS` with a fake that records whether it was
called at all -- the same dict object the router itself reads from, so the
substitution reaches it without touching the router's imports.
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.market.client import MarketError, MarketFailureCause
from app.market.providers import PROVIDERS
from app.models import ApiKey, QuotaWindow


def _register(client, email="connexions@example.fr"):
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


class _FakeProvider:
    """A stand-in for a real provider -- `requires_key`/`name` match the
    protocol, and `validate_key` either succeeds or raises the `MarketError`
    it was built with, recording whether it was ever actually called."""

    def __init__(self, name: str, requires_key: bool = True,
                error: MarketError | None = None) -> None:
        self.name = name
        self.requires_key = requires_key
        self._error = error
        self.calls = 0

    def validate_key(self, api_key: str) -> None:
        self.calls += 1
        if self._error is not None:
            raise self._error


def _install_fake(monkeypatch, provider: str, **kwargs) -> _FakeProvider:
    fake = _FakeProvider(provider, **kwargs)
    monkeypatch.setitem(PROVIDERS, provider, fake)
    return fake


def test_with_no_key_ever_stored_every_provider_reads_as_unconfigured(client):
    headers = _register(client)
    body = client.get("/api/connections", headers=headers).json()
    assert {row["provider"] for row in body} == {
        "finnhub", "alpha_vantage", "coingecko", "frankfurter", "exchangerate_api",
    }
    for row in body:
        assert row["configured"] is False
        assert row["last_used_at"] is None
        assert row["quota"]["used"] == 0
        assert row["quota"]["can_call"] is True

    finnhub = next(row for row in body if row["provider"] == "finnhub")
    assert finnhub["quota"]["limit"] == 60
    assert finnhub["requires_key"] is True

    frankfurter = next(row for row in body if row["provider"] == "frankfurter")
    assert frankfurter["quota"]["limit"] is None
    assert frankfurter["requires_key"] is False


def test_storing_a_valid_key_reports_success_and_never_echoes_the_plaintext(client, monkeypatch):
    _install_fake(monkeypatch, "finnhub")
    headers = _register(client)

    response = client.post(
        "/api/connections/finnhub", headers=headers, json={"api_key": "sk-super-secret-123"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is True
    assert body["reason"] is None
    assert body["configured"] is True
    assert body["last_used_at"] is not None
    # The one thing this endpoint must never do, checked against the raw
    # response text, not just the known field names.
    assert "sk-super-secret-123" not in response.text

    listed = client.get("/api/connections", headers=headers).json()
    finnhub = next(row for row in listed if row["provider"] == "finnhub")
    assert finnhub["configured"] is True
    assert "sk-super-secret-123" not in client.get("/api/connections", headers=headers).text


def test_a_key_the_provider_rejects_is_reported_invalid_and_never_stored(client, monkeypatch):
    _install_fake(
        monkeypatch, "finnhub",
        error=MarketError(MarketFailureCause.KEY_REJECTED,
                          "La clé enregistrée pour Finnhub a été refusée."),
    )
    headers = _register(client)

    response = client.post(
        "/api/connections/finnhub", headers=headers, json={"api_key": "sk-bad-key"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is False
    assert "refusée" in body["reason"]
    assert body["configured"] is False

    listed = client.get("/api/connections", headers=headers).json()
    finnhub = next(row for row in listed if row["provider"] == "finnhub")
    assert finnhub["configured"] is False


def test_when_the_quota_pool_is_already_at_its_ceiling_the_provider_is_never_even_called(
    client, monkeypatch, db,
):
    """The pre-emptive quota check runs BEFORE the real call -- proven by a
    fake that raises AssertionError if it is ever invoked at all, not just
    by checking the response shape."""
    def _must_not_be_called(_api_key):
        raise AssertionError("must not call the provider once the pool is at its ceiling")

    fake = _install_fake(monkeypatch, "finnhub")
    fake.validate_key = _must_not_be_called
    headers = _register(client)

    # Seed a window already at Finnhub's 80% ceiling (48 of 60) for THIS user.
    from app.models import User
    user = db.query(User).filter(User.email == "connexions@example.fr").first()
    now = datetime.now(UTC).replace(second=0, microsecond=0)
    db.add(QuotaWindow(user_id=user.id, provider="finnhub", window_started_at=now, used=48))
    db.commit()

    response = client.post(
        "/api/connections/finnhub", headers=headers, json={"api_key": "sk-whatever"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is False
    assert "quota" in body["reason"]
    assert "épuisé" in body["reason"]
    assert body["configured"] is False


def test_an_unknown_provider_is_404_on_post_and_delete(client):
    headers = _register(client)
    assert client.post("/api/connections/robinhood", headers=headers,
                       json={"api_key": "x"}).status_code == 404
    assert client.delete("/api/connections/robinhood", headers=headers).status_code == 404


def test_deleting_a_configured_key_removes_it(client, monkeypatch):
    _install_fake(monkeypatch, "finnhub")
    headers = _register(client)
    client.post("/api/connections/finnhub", headers=headers, json={"api_key": "sk-123"})

    assert client.delete("/api/connections/finnhub", headers=headers).status_code == 204

    listed = client.get("/api/connections", headers=headers).json()
    finnhub = next(row for row in listed if row["provider"] == "finnhub")
    assert finnhub["configured"] is False


def test_deleting_when_nothing_is_configured_is_404(client):
    headers = _register(client)
    assert client.delete("/api/connections/finnhub", headers=headers).status_code == 404


def test_a_key_never_leaves_the_server_even_encrypted(client, monkeypatch, db):
    """The database column itself must hold ciphertext, not the plaintext --
    a defect here would not show up in the API response at all."""
    _install_fake(monkeypatch, "finnhub")
    headers = _register(client)
    client.post("/api/connections/finnhub", headers=headers,
               json={"api_key": "sk-super-secret-123"})

    row = db.query(ApiKey).filter(ApiKey.provider == "finnhub").one()
    assert row.value != "sk-super-secret-123"
    assert "sk-super-secret-123" not in row.value


def test_connections_never_cross_users(client, monkeypatch):
    """Isolation, proven both ways. Seeds user B's OWN connection first and
    asserts user B's own read reflects it -- if the seeding step silently
    wrote nothing (a broken fixture, a rolled-back transaction), THIS
    assertion fails before the isolation assertion ever gets a chance to
    pass for the wrong reason. Only then does it check that user A, who
    never touched Finnhub, reads every provider as unconfigured."""
    _install_fake(monkeypatch, "finnhub")
    alice = _register(client, "alice@example.fr")
    bob = _register(client, "bob@example.fr")

    seeded = client.post(
        "/api/connections/finnhub", headers=bob, json={"api_key": "sk-bobs-key"}
    )
    assert seeded.status_code == 200
    assert seeded.json()["valid"] is True

    # First: the seed actually took effect for the user it was written for.
    bob_view = client.get("/api/connections", headers=bob).json()
    bob_finnhub = next(row for row in bob_view if row["provider"] == "finnhub")
    assert bob_finnhub["configured"] is True
    assert bob_finnhub["last_used_at"] is not None

    # Only now: a different user, who did nothing, sees none of it.
    alice_view = client.get("/api/connections", headers=alice).json()
    assert all(row["configured"] is False for row in alice_view)
    assert all(row["last_used_at"] is None for row in alice_view)


def test_a_new_valid_key_replaces_the_previously_stored_one(client, monkeypatch, db):
    _install_fake(monkeypatch, "finnhub")
    headers = _register(client)
    client.post("/api/connections/finnhub", headers=headers, json={"api_key": "sk-first"})
    first_row = db.query(ApiKey).filter(ApiKey.provider == "finnhub").one()
    first_ciphertext = first_row.value

    client.post("/api/connections/finnhub", headers=headers, json={"api_key": "sk-second"})
    assert db.query(ApiKey).filter(ApiKey.provider == "finnhub").count() == 1
    second_row = db.query(ApiKey).filter(ApiKey.provider == "finnhub").one()
    assert second_row.value != first_ciphertext


def test_a_provider_that_needs_no_key_can_still_be_configured(client, monkeypatch):
    """Frankfurter never rejects for lack of a key -- proves the router does
    not special-case `requires_key` into a refusal it has no reason to
    make; whether a key is USEFUL is the provider's own business."""
    _install_fake(monkeypatch, "frankfurter", requires_key=False)
    headers = _register(client)

    response = client.post(
        "/api/connections/frankfurter", headers=headers, json={"api_key": "unused-but-stored"}
    )
    assert response.status_code == 200
    assert response.json()["valid"] is True


def test_quota_state_reflects_a_seeded_window_not_only_the_freshly_created_default(
    client, db,
):
    headers = _register(client)
    from app.models import User
    user = db.query(User).filter(User.email == "connexions@example.fr").first()
    now = datetime.now(UTC).replace(second=0, microsecond=0)
    db.add(QuotaWindow(user_id=user.id, provider="finnhub", window_started_at=now, used=10))
    db.commit()

    listed = client.get("/api/connections", headers=headers).json()
    finnhub = next(row for row in listed if row["provider"] == "finnhub")
    assert finnhub["quota"]["used"] == 10
    assert finnhub["quota"]["remaining"] == 38  # 48 ceiling - 10 used
    assert finnhub["quota"]["can_call"] is True


def test_a_window_from_a_rolled_over_minute_reports_zero_used_not_the_stale_count(client, db):
    """The same calendar-rollover rule `market/quota.py` enforces end to
    end through the router: a window recorded a full minute ago must read
    as fresh, not carry a stale count forward."""
    headers = _register(client)
    from app.models import User
    user = db.query(User).filter(User.email == "connexions@example.fr").first()
    stale_start = datetime.now(UTC).replace(second=0, microsecond=0) - timedelta(minutes=5)
    db.add(QuotaWindow(user_id=user.id, provider="finnhub", window_started_at=stale_start,
                       used=59))
    db.commit()

    listed = client.get("/api/connections", headers=headers).json()
    finnhub = next(row for row in listed if row["provider"] == "finnhub")
    assert finnhub["quota"]["used"] == 0
    assert finnhub["quota"]["can_call"] is True


def test_getting_connections_requires_authentication(client):
    assert client.get("/api/connections").status_code == 401


@pytest.mark.parametrize("field", ["api_key"])
def test_posting_a_null_key_is_refused_in_french(client, field):
    headers = _register(client)
    response = client.post("/api/connections/finnhub", headers=headers, json={field: None})
    assert response.status_code == 422
