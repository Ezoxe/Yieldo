"""`market/client.py`: the provider interface, the five French failure
causes, and the retry policy.

Phase 3 plan Task 4. "Aucune clé n'est enregistrée", "la clé a été
refusée", "le quota est épuisé", "le service est injoignable" and "ce
symbole est inconnu" are five different causes with five different
remedies -- the single most repeated defect in this project is a French
sentence naming the wrong one. `failure_message` is the one place all five
sentences are built, so a provider (Task 5) can never invent a sixth
wording or collapse two causes into one.

No provider implementation lives here yet -- only the contract every
provider in Task 5 must satisfy, and the retry policy providers use when
calling out over HTTP.
"""

from datetime import date, datetime

import pytest

from app.market import client
from app.market.client import MarketError, MarketFailureCause


def test_every_provider_has_a_french_label():
    for provider in ("finnhub", "alpha_vantage", "coingecko", "frankfurter", "exchangerate_api"):
        message = client.failure_message(MarketFailureCause.SERVICE_UNREACHABLE, provider)
        assert isinstance(message, str)
        assert len(message) > 0


def test_no_key_names_reglages_connexions_as_the_remedy():
    message = client.failure_message(MarketFailureCause.NO_KEY, "finnhub")
    assert "Aucune clé n'est enregistrée" in message
    assert "Finnhub" in message
    assert "Connexions" in message


def test_key_rejected_names_the_key_itself_as_the_problem():
    message = client.failure_message(MarketFailureCause.KEY_REJECTED, "alpha_vantage")
    assert "clé" in message
    assert "refusée" in message
    assert "Alpha Vantage" in message


def test_quota_exhausted_says_the_quota_not_the_key_or_the_service():
    message = client.failure_message(MarketFailureCause.QUOTA_EXHAUSTED, "coingecko")
    assert "quota" in message
    assert "épuisé" in message
    assert "CoinGecko" in message


def test_service_unreachable_says_the_service_not_the_key_or_the_quota():
    message = client.failure_message(MarketFailureCause.SERVICE_UNREACHABLE, "frankfurter")
    assert "injoignable" in message
    assert "Frankfurter" in message


def test_unknown_symbol_names_the_actual_symbol_that_was_looked_up():
    message = client.failure_message(
        MarketFailureCause.UNKNOWN_SYMBOL, "exchangerate_api", symbol="ZZZ"
    )
    assert "ZZZ" in message
    assert "inconnu" in message
    assert "ExchangeRate-API" in message


def test_unknown_symbol_without_a_symbol_refuses_rather_than_building_a_vague_message():
    with pytest.raises(ValueError, match="symbole"):
        client.failure_message(MarketFailureCause.UNKNOWN_SYMBOL, "finnhub")


def test_the_five_causes_produce_five_genuinely_different_sentences():
    """The trap this lot exists to close: two causes must never collapse
    into the same wording. Five distinct causes must yield five distinct
    strings for the SAME provider."""
    provider = "finnhub"
    messages = {
        client.failure_message(cause, provider, symbol="AAPL" if cause
                               is MarketFailureCause.UNKNOWN_SYMBOL else None)
        for cause in MarketFailureCause
    }
    assert len(messages) == 5


def test_market_error_carries_its_cause_and_is_catchable_as_such():
    error = client.market_error(MarketFailureCause.KEY_REJECTED, "finnhub")
    assert isinstance(error, MarketError)
    assert error.cause is MarketFailureCause.KEY_REJECTED
    assert "refusée" in error.message
    with pytest.raises(MarketError) as excinfo:
        raise error
    assert excinfo.value.cause is MarketFailureCause.KEY_REJECTED


@pytest.mark.parametrize("cause", list(MarketFailureCause))
def test_only_service_unreachable_is_worth_retrying(cause):
    """A rejected key, an exhausted quota and an unknown symbol are
    permanent for this call -- retrying would burn more of an already
    exhausted quota to get exactly the same answer. Parametrized over
    every cause so a change that makes retry lenient by default is
    caught immediately, not just for the one cause someone thought to
    check."""
    assert client.should_retry(cause) == (cause is MarketFailureCause.SERVICE_UNREACHABLE)


def test_call_with_retry_returns_on_first_success_without_sleeping():
    sleeps: list[float] = []
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        return "ok"

    result = client.call_with_retry(fn, sleep=sleeps.append)
    assert result == "ok"
    assert calls["n"] == 1
    assert sleeps == []


def test_call_with_retry_retries_a_transient_failure_and_then_succeeds():
    sleeps: list[float] = []
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        if calls["n"] < 3:
            raise client.market_error(MarketFailureCause.SERVICE_UNREACHABLE, "finnhub")
        return "ok"

    policy = client.RetryPolicy(max_attempts=3, backoff_seconds=(0.1, 0.2))
    result = client.call_with_retry(fn, policy=policy, sleep=sleeps.append)
    assert result == "ok"
    assert calls["n"] == 3
    assert sleeps == [0.1, 0.2]


def test_call_with_retry_gives_up_after_max_attempts_and_raises_the_last_market_error():
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        raise client.market_error(MarketFailureCause.SERVICE_UNREACHABLE, "finnhub")

    policy = client.RetryPolicy(max_attempts=3, backoff_seconds=(0.1, 0.1))
    sleeps: list[float] = []
    with pytest.raises(MarketError) as excinfo:
        client.call_with_retry(fn, policy=policy, sleep=sleeps.append)
    assert excinfo.value.cause is MarketFailureCause.SERVICE_UNREACHABLE
    assert calls["n"] == 3
    # Two sleeps between three attempts -- never a sleep after the final,
    # already-failed, attempt.
    assert sleeps == [0.1, 0.1]


def test_call_with_retry_never_retries_a_permanent_cause():
    calls = {"n": 0}
    sleeps: list[float] = []

    def fn():
        calls["n"] += 1
        raise client.market_error(MarketFailureCause.KEY_REJECTED, "finnhub")

    with pytest.raises(MarketError):
        client.call_with_retry(fn, sleep=sleeps.append)
    assert calls["n"] == 1
    assert sleeps == []


def test_a_non_market_error_is_never_caught_or_retried():
    """The retry loop is scoped to MarketError -- a bug (e.g. a KeyError in
    provider parsing code) must propagate immediately, not be silently
    retried and swallowed into a misleading SERVICE_UNREACHABLE."""
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        raise KeyError("unexpected shape")

    with pytest.raises(KeyError):
        client.call_with_retry(fn, sleep=lambda _seconds: None)
    assert calls["n"] == 1


def test_quote_and_fx_rate_are_plain_dataclasses_carrying_provenance():
    quote = client.Quote(
        symbol="AAPL", price_cents=19_034, currency="USD",
        as_of=date(2026, 9, 1), fetched_at=datetime(2026, 9, 2, 8, 0), source="finnhub",
    )
    assert quote.price_cents == 19_034
    assert quote.source == "finnhub"

    rate = client.FxRate(
        base_currency="EUR", quote_currency="USD", rate="1.0842",
        as_of=date(2026, 9, 1), fetched_at=datetime(2026, 9, 2, 8, 0), source="frankfurter",
    )
    assert rate.rate == "1.0842"


def test_an_fx_rate_that_is_not_a_valid_decimal_string_is_refused():
    """The same discipline `engines.quantity` enforces: a rate travels as
    text so a provider parsing JSON can never smuggle a float in unnoticed."""
    with pytest.raises(ValueError, match="Taux de change invalide"):
        client.FxRate(
            base_currency="EUR", quote_currency="USD", rate="not-a-number",
            as_of=date(2026, 9, 1), fetched_at=datetime(2026, 9, 2, 8, 0), source="frankfurter",
        )
