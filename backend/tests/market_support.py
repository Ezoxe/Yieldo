"""Shared scaffolding for `tests/test_provider_*.py`: build an
`httpx.MockTransport` from a recorded response fixture, so every provider
test runs against the exact JSON a provider actually returned once,
never a live network. Not itself a test module -- no `test_` prefix, so
pytest never tries to collect it.
"""

import json
from pathlib import Path

import httpx

FIXTURES = Path(__file__).parent / "fixtures" / "market"


def load_fixture(provider: str, name: str) -> dict:
    with (FIXTURES / provider / f"{name}.json").open(encoding="utf-8") as handle:
        return json.load(handle)


def json_transport(provider: str, name: str, status: int = 200) -> httpx.MockTransport:
    """Answers every request with the recorded fixture, regardless of the
    request's own URL or params -- each test targets one provider method at
    a time, so there is only ever one call in flight."""
    body = load_fixture(provider, name)

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json=body)

    return httpx.MockTransport(handler)


def failing_transport(build_exc) -> httpx.MockTransport:
    """Every request raises the transport-level exception `build_exc`
    constructs (given the request) -- simulates a connection that never
    reaches the provider at all."""

    def handler(request: httpx.Request):
        raise build_exc(request)

    return httpx.MockTransport(handler)


def flaky_then_ok_transport(
    provider: str, ok_name: str, status: int = 200
) -> tuple[httpx.MockTransport, dict]:
    """Fails with a connection error on the first call, then answers with
    the recorded fixture on every call after -- proves a provider's fetch
    method actually retries a transient failure rather than merely being
    ALLOWED to. `calls["n"]` lets a test assert exactly how many attempts
    were made.
    """
    body = load_fixture(provider, ok_name)
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.ConnectError("connection refused", request=request)
        return httpx.Response(status, json=body)

    return httpx.MockTransport(handler), calls
