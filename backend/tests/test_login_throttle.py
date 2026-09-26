"""Five wrong passwords for one account, fifty from one address, then a wait."""

from app.security import throttle
from app.security.throttle import (
    MAX_FAILURES_PER_ACCOUNT,
    MAX_FAILURES_PER_ADDRESS,
    WINDOW_SECONDS,
    LoginThrottle,
    wait_message,
)


class Clock:
    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now


def test_an_account_is_let_through_until_its_fifth_failure():
    clock = Clock()
    gate = LoginThrottle(clock=clock)
    for _ in range(MAX_FAILURES_PER_ACCOUNT - 1):
        gate.record_failure("10.0.0.1", "max@example.com")
    assert gate.retry_after("10.0.0.1", "max@example.com") is None
    gate.record_failure("10.0.0.1", "max@example.com")
    assert gate.retry_after("10.0.0.1", "max@example.com") == WINDOW_SECONDS


def test_the_wait_ends_when_the_oldest_failure_leaves_the_window():
    clock = Clock()
    gate = LoginThrottle(clock=clock)
    for _ in range(MAX_FAILURES_PER_ACCOUNT):
        gate.record_failure("10.0.0.1", "max@example.com")
    clock.now += WINDOW_SECONDS - 60
    assert gate.retry_after("10.0.0.1", "max@example.com") == 60
    clock.now += 60
    assert gate.retry_after("10.0.0.1", "max@example.com") is None


def test_a_success_forgets_the_account_failures():
    gate = LoginThrottle(clock=Clock())
    for _ in range(MAX_FAILURES_PER_ACCOUNT - 1):
        gate.record_failure("10.0.0.1", "max@example.com")
    gate.record_success("10.0.0.1", "max@example.com")
    gate.record_failure("10.0.0.1", "max@example.com")
    assert gate.retry_after("10.0.0.1", "max@example.com") is None


def test_one_address_walking_many_accounts_is_stopped_at_fifty():
    gate = LoginThrottle(clock=Clock())
    for index in range(MAX_FAILURES_PER_ADDRESS):
        gate.record_failure("10.0.0.9", f"victime{index}@example.com")
    assert gate.retry_after("10.0.0.9", "autre@example.com") == WINDOW_SECONDS
    assert gate.retry_after("10.0.0.10", "autre@example.com") is None


def test_a_flood_of_distinct_emails_does_not_grow_memory_without_bound():
    clock = Clock()
    gate = LoginThrottle(clock=clock)
    for index in range(throttle.MAX_KEYS):
        gate.record_failure(f"10.1.{index // 250}.{index % 250}", f"x{index}@example.com")
    clock.now += WINDOW_SECONDS
    gate.record_failure("10.9.9.9", "dernier@example.com")
    remembered = len(gate._by_account) + len(gate._by_address)
    assert remembered <= 2


def test_the_wait_is_said_in_whole_minutes():
    assert wait_message(30) == "Trop de tentatives de connexion. Réessayez dans 1 minute."
    assert wait_message(900) == "Trop de tentatives de connexion. Réessayez dans 15 minutes."


def _register(client):
    client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"})


def test_the_sixth_attempt_is_refused_even_with_the_right_password(client):
    _register(client)
    for _ in range(MAX_FAILURES_PER_ACCOUNT):
        assert client.post("/api/auth/login", json={
            "email": "max@example.com", "password": "mauvais"}).status_code == 401

    response = client.post("/api/auth/login", json={
        "email": "max@example.com", "password": "motdepasse123"})

    assert response.status_code == 429
    assert response.json()["detail"] == (
        "Trop de tentatives de connexion. Réessayez dans 15 minutes.")
    assert response.headers["Retry-After"] == str(WINDOW_SECONDS)


def test_the_email_is_counted_case_insensitively(client):
    _register(client)
    for _ in range(MAX_FAILURES_PER_ACCOUNT):
        client.post("/api/auth/login", json={"email": "MAX@example.com", "password": "x"})
    assert client.post("/api/auth/login", json={
        "email": "max@example.com", "password": "motdepasse123"}).status_code == 429


def test_a_successful_login_is_not_counted(client):
    _register(client)
    for _ in range(MAX_FAILURES_PER_ACCOUNT + 1):
        assert client.post("/api/auth/login", json={
            "email": "max@example.com", "password": "motdepasse123"}).status_code == 200


def test_the_throttle_is_fresh_for_every_test():
    assert throttle.login_throttle.retry_after("testclient", "max@example.com") is None
