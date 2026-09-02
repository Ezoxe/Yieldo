"""`market/quota.py`: pure per-user, per-provider rate-limit tracking.

Design §12 / phase 3 plan Task 3. The pool pre-empts at 80% of each
provider's published limit, never at 100%, and the day/month windows roll
over at a calendar boundary (midnight, the first of the month) rather than a
fixed duration measured from whenever the window happened to start -- which
is exactly why every function here takes `now` as a parameter instead of
reading the clock itself (CLAUDE.md's pure-engine rule, extended to
`app/market/quota.py` and `cache.py` by the phase 3 plan).
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.market import quota


def test_below_the_80_percent_ceiling_is_allowed_and_above_it_is_refused():
    """The trap named in the plan: a fixture that never approaches the limit
    cannot tell 80% pre-emption from 100%. 48 is 80% of Finnhub's 60/minute
    -- and 48 is well under the provider's own 60, so a refusal here can only
    come from the pre-emptive ceiling, never from the real limit."""
    now = datetime(2026, 9, 2, 10, 30, 40, tzinfo=UTC)
    window_started = now.replace(second=0, microsecond=0)

    just_under = quota.evaluate(
        "finnhub", quota.WindowState(window_started_at=window_started, used=47), now
    )
    assert just_under.allowed is True
    assert just_under.remaining == 1

    at_ceiling = quota.evaluate(
        "finnhub", quota.WindowState(window_started_at=window_started, used=48), now
    )
    assert at_ceiling.allowed is False
    assert at_ceiling.limit == 60
    assert at_ceiling.ceiling == 48
    # The proof: refused well below the provider's own hard limit.
    assert at_ceiling.used < at_ceiling.limit
    assert at_ceiling.refusal_reason is not None
    assert "quota" in at_ceiling.refusal_reason
    assert "épuisé" in at_ceiling.refusal_reason
    assert "Finnhub" in at_ceiling.refusal_reason


@pytest.mark.parametrize(
    "provider,limit,ceiling",
    [
        ("finnhub", 60, 48),
        ("alpha_vantage", 25, 20),
        ("exchangerate_api", 1500, 1200),
        ("coingecko", 30, 24),
    ],
)
def test_the_preemptive_ceiling_is_exactly_80_percent_of_each_providers_published_limit(
    provider, limit, ceiling
):
    now = datetime(2026, 9, 2, 12, 0, tzinfo=UTC)
    started = quota.window_start(provider, now)
    decision = quota.evaluate(
        provider, quota.WindowState(window_started_at=started, used=0), now
    )
    assert decision.limit == limit
    assert decision.ceiling == ceiling


def test_frankfurter_is_never_refused_however_large_the_recorded_use():
    """Task 5's own proof requirement, pinned here too: Frankfurter is
    unlimited, so no recorded usage -- however large -- may ever refuse it.
    A fixture that only tries `used=0` could not tell "unlimited" from "a
    limit nobody has hit yet"."""
    now = datetime(2026, 9, 2, 12, 0, tzinfo=UTC)
    decision = quota.evaluate(
        "frankfurter", quota.WindowState(window_started_at=now, used=999_999), now
    )
    assert decision.allowed is True
    assert decision.limit is None
    assert decision.ceiling is None
    assert decision.remaining is None
    assert decision.reset_at is None
    assert decision.refusal_reason is None


def test_frankfurter_with_no_recorded_state_at_all_is_also_allowed():
    now = datetime(2026, 9, 2, 12, 0, tzinfo=UTC)
    decision = quota.evaluate("frankfurter", None, now)
    assert decision.allowed is True


def test_a_missing_window_state_is_treated_as_a_fresh_window():
    now = datetime(2026, 9, 2, 12, 0, 0, tzinfo=UTC)
    decision = quota.evaluate("finnhub", None, now)
    assert decision.allowed is True
    assert decision.used == 0
    assert decision.window_started_at == now.replace(second=0, microsecond=0)


def test_the_minute_window_rolls_over_at_the_minute_boundary_not_60_seconds_after_first_call():
    """Finnhub and CoinGecko: 'now is a parameter -- a window that rolls over
    ... cannot depend on an implicit clock' applies to the minute window too.
    A window that started at :10 must roll over at the NEXT minute mark
    (:00), not 60 seconds after :10."""
    started = datetime(2026, 9, 2, 10, 30, 10, tzinfo=UTC)
    exhausted = quota.WindowState(window_started_at=started.replace(second=0, microsecond=0),
                                  used=48)

    still_within = quota.evaluate(
        "finnhub", exhausted, datetime(2026, 9, 2, 10, 30, 55, tzinfo=UTC)
    )
    assert still_within.allowed is False

    rolled_over = quota.evaluate("finnhub", exhausted, datetime(2026, 9, 2, 10, 31, 5, tzinfo=UTC))
    assert rolled_over.allowed is True
    assert rolled_over.used == 0
    assert rolled_over.window_started_at == datetime(2026, 9, 2, 10, 31, 0, tzinfo=UTC)


def test_the_day_window_rolls_over_at_midnight_not_24_hours_after_the_window_started():
    """Alpha Vantage, 25/day. A window that began at 23:58 must still roll
    over at the NEXT midnight -- two minutes later -- not 24 hours after
    23:58. Proves the window is calendar-aligned, not a rolling duration."""
    started = datetime(2026, 9, 1, 23, 58, 0, tzinfo=UTC)
    exhausted = quota.WindowState(window_started_at=started.replace(hour=0, minute=0, second=0,
                                                                      microsecond=0), used=20)

    just_before_midnight = quota.evaluate(
        "alpha_vantage", exhausted, datetime(2026, 9, 1, 23, 59, tzinfo=UTC)
    )
    assert just_before_midnight.allowed is False

    just_after_midnight = quota.evaluate(
        "alpha_vantage", exhausted, datetime(2026, 9, 2, 0, 1, tzinfo=UTC)
    )
    assert just_after_midnight.allowed is True
    assert just_after_midnight.used == 0
    assert just_after_midnight.window_started_at == datetime(2026, 9, 2, 0, 0, tzinfo=UTC)


def test_the_month_window_rolls_over_at_the_first_of_the_month_across_a_year_boundary():
    """ExchangeRate-API, 1500/month. December 31st 23:00 must still be
    inside November's -- no, December's -- window; January 1st rolls over,
    even across the year boundary, which a naive `+ timedelta(days=30)`
    would get wrong."""
    started = datetime(2026, 12, 1, tzinfo=UTC)
    at_ceiling = quota.WindowState(window_started_at=started, used=1200)

    still_december = quota.evaluate(
        "exchangerate_api", at_ceiling, datetime(2026, 12, 31, 23, 0, tzinfo=UTC)
    )
    assert still_december.allowed is False
    assert still_december.window_started_at == started

    rolled_into_january = quota.evaluate(
        "exchangerate_api", at_ceiling, datetime(2027, 1, 1, 0, 5, tzinfo=UTC)
    )
    assert rolled_into_january.allowed is True
    assert rolled_into_january.used == 0
    assert rolled_into_january.window_started_at == datetime(2027, 1, 1, tzinfo=UTC)


def test_reset_at_names_the_end_of_the_current_window():
    now = datetime(2026, 9, 2, 10, 30, tzinfo=UTC)
    decision = quota.evaluate("finnhub", None, now)
    assert decision.reset_at == datetime(2026, 9, 2, 10, 31, tzinfo=UTC)

    day_decision = quota.evaluate("alpha_vantage", None, now)
    assert day_decision.reset_at == datetime(2026, 9, 3, 0, 0, tzinfo=UTC)


def test_record_call_increments_the_counter_within_the_same_window():
    now = datetime(2026, 9, 2, 10, 30, 15, tzinfo=UTC)
    first = quota.record_call("finnhub", None, now)
    assert first.used == 1
    assert first.window_started_at == now.replace(second=0, microsecond=0)

    second = quota.record_call("finnhub", first, now + timedelta(seconds=20))
    assert second.used == 2
    assert second.window_started_at == first.window_started_at


def test_record_call_resets_the_counter_once_the_window_has_rolled_over():
    now = datetime(2026, 9, 2, 10, 30, 15, tzinfo=UTC)
    state = quota.record_call("finnhub", None, now)
    next_window = now.replace(second=0, microsecond=0) + timedelta(minutes=1, seconds=5)

    rolled = quota.record_call("finnhub", state, next_window)
    assert rolled.used == 1
    assert rolled.window_started_at == next_window.replace(second=0, microsecond=0)


def test_an_unknown_provider_raises_a_french_value_error():
    with pytest.raises(ValueError, match="inconnu"):
        quota.evaluate("robinhood", None, datetime.now(UTC))
    with pytest.raises(ValueError, match="inconnu"):
        quota.record_call("robinhood", None, datetime.now(UTC))


def test_a_refusal_and_an_allowance_never_share_the_same_reset_at_for_a_rolled_window():
    """Regression against a decision object that forgets to recompute
    reset_at on rollover -- the window_started_at changes, so reset_at must
    move with it."""
    started = datetime(2026, 9, 1, 23, 58, 0, tzinfo=UTC).replace(hour=0, minute=0, second=0,
                                                                    microsecond=0)
    state = quota.WindowState(window_started_at=started, used=20)
    before = quota.evaluate("alpha_vantage", state, datetime(2026, 9, 1, 23, 59, tzinfo=UTC))
    after = quota.evaluate("alpha_vantage", state, datetime(2026, 9, 2, 0, 30, tzinfo=UTC))
    assert before.reset_at == datetime(2026, 9, 2, 0, 0, tzinfo=UTC)
    assert after.reset_at == datetime(2026, 9, 3, 0, 0, tzinfo=UTC)
