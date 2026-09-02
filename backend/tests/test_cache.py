"""`market/cache.py`: a pure, in-memory freshness decision per data kind.

Phase 3 plan Task 4. TTL differs by what was fetched: a quote is minutes, a
daily close is a day, an FX rate is hours, an instrument's identity is
permanent. **A value returned past its TTL is explicitly labelled stale and
still carries the timestamp it was fetched at** -- the cache never drops it
and never pretends it is fresh; the caller decides what a stale hit means.

Pure: no session, no network, no implicit clock -- `now` is always a
parameter, same contract as `market/quota.py`.
"""

from datetime import UTC, datetime, timedelta

from app.market import cache


def test_a_key_never_set_is_not_found_and_is_not_marked_stale():
    store = cache.Cache()
    lookup = store.get(cache.MarketDataKind.QUOTE, "AAPL", datetime.now(UTC))
    assert lookup.value is None
    assert lookup.fetched_at is None
    assert lookup.is_stale is False


def test_a_value_just_set_is_found_and_fresh():
    store = cache.Cache()
    fetched_at = datetime(2026, 9, 2, 10, 0, tzinfo=UTC)
    store.set(cache.MarketDataKind.QUOTE, "AAPL", 19_034, fetched_at)

    lookup = store.get(
        cache.MarketDataKind.QUOTE, "AAPL", fetched_at + timedelta(minutes=1)
    )
    assert lookup.value == 19_034
    assert lookup.fetched_at == fetched_at
    assert lookup.is_stale is False


def test_a_stale_value_is_still_returned_labelled_stale_with_its_original_timestamp():
    """The whole point of the module: staleness is a label, not a deletion.
    Dropping the value on staleness (returning None) would be exactly the
    silent fallback CLAUDE.md forbids -- the caller must be able to choose
    'show it anyway, marked as of <fetched_at>' over 'refuse to answer'."""
    store = cache.Cache()
    fetched_at = datetime(2026, 9, 2, 10, 0, tzinfo=UTC)
    store.set(cache.MarketDataKind.QUOTE, "AAPL", 19_034, fetched_at)

    lookup = store.get(
        cache.MarketDataKind.QUOTE, "AAPL", fetched_at + timedelta(minutes=10)
    )
    assert lookup.value == 19_034
    assert lookup.fetched_at == fetched_at
    assert lookup.is_stale is True


def test_the_quote_ttl_boundary_is_exactly_5_minutes():
    """Pins the boundary itself, not just 'somewhere before' and 'somewhere
    after' -- a fixture that only tests 1 minute and 1 hour could not tell a
    5-minute TTL from a 30-minute one."""
    store = cache.Cache()
    fetched_at = datetime(2026, 9, 2, 10, 0, 0, tzinfo=UTC)
    store.set(cache.MarketDataKind.QUOTE, "AAPL", 100, fetched_at)

    just_under = store.get(
        cache.MarketDataKind.QUOTE, "AAPL", fetched_at + timedelta(minutes=4, seconds=59)
    )
    assert just_under.is_stale is False

    at_boundary = store.get(
        cache.MarketDataKind.QUOTE, "AAPL", fetched_at + timedelta(minutes=5)
    )
    assert at_boundary.is_stale is True


def test_the_daily_close_ttl_is_one_day():
    store = cache.Cache()
    fetched_at = datetime(2026, 9, 2, 10, 0, tzinfo=UTC)
    store.set(cache.MarketDataKind.DAILY_CLOSE, "AAPL", 19_000, fetched_at)

    just_under = store.get(
        cache.MarketDataKind.DAILY_CLOSE, "AAPL", fetched_at + timedelta(hours=23, minutes=59)
    )
    assert just_under.is_stale is False

    past_a_day = store.get(
        cache.MarketDataKind.DAILY_CLOSE, "AAPL", fetched_at + timedelta(days=1)
    )
    assert past_a_day.is_stale is True


def test_the_fx_rate_ttl_is_measured_in_hours_not_minutes_or_days():
    """Distinguishes the FX TTL from BOTH neighbours: shorter than a day
    (daily close), longer than the 5-minute quote TTL."""
    store = cache.Cache()
    fetched_at = datetime(2026, 9, 2, 10, 0, tzinfo=UTC)
    store.set(cache.MarketDataKind.FX_RATE, "EUR/USD", "1.08", fetched_at)

    fresh_past_quote_ttl = store.get(
        cache.MarketDataKind.FX_RATE, "EUR/USD", fetched_at + timedelta(minutes=30)
    )
    assert fresh_past_quote_ttl.is_stale is False

    stale_before_a_full_day = store.get(
        cache.MarketDataKind.FX_RATE, "EUR/USD", fetched_at + timedelta(hours=23)
    )
    assert stale_before_a_full_day.is_stale is True


def test_an_instruments_identity_never_goes_stale():
    """Permanent TTL, proven with a duration long enough that any finite TTL
    would have expired -- not just 'a day later', which every other kind
    here would ALSO still consider fresh at times shorter than that."""
    store = cache.Cache()
    fetched_at = datetime(2020, 1, 1, tzinfo=UTC)
    store.set(cache.MarketDataKind.INSTRUMENT, "AAPL/equity", {"name": "Apple Inc."}, fetched_at)

    decades_later = store.get(
        cache.MarketDataKind.INSTRUMENT, "AAPL/equity", fetched_at + timedelta(days=365 * 50)
    )
    assert decades_later.is_stale is False
    assert decades_later.value == {"name": "Apple Inc."}


def test_setting_a_key_again_overwrites_the_previous_entry():
    store = cache.Cache()
    first_fetch = datetime(2026, 9, 2, 10, 0, tzinfo=UTC)
    second_fetch = datetime(2026, 9, 2, 10, 6, tzinfo=UTC)
    store.set(cache.MarketDataKind.QUOTE, "AAPL", 100, first_fetch)
    store.set(cache.MarketDataKind.QUOTE, "AAPL", 200, second_fetch)

    lookup = store.get(cache.MarketDataKind.QUOTE, "AAPL", second_fetch)
    assert lookup.value == 200
    assert lookup.fetched_at == second_fetch


def test_different_keys_do_not_collide():
    store = cache.Cache()
    fetched_at = datetime(2026, 9, 2, 10, 0, tzinfo=UTC)
    store.set(cache.MarketDataKind.QUOTE, "AAPL", 100, fetched_at)
    store.set(cache.MarketDataKind.QUOTE, "MSFT", 300, fetched_at)

    assert store.get(cache.MarketDataKind.QUOTE, "AAPL", fetched_at).value == 100
    assert store.get(cache.MarketDataKind.QUOTE, "MSFT", fetched_at).value == 300


def test_the_same_key_under_different_kinds_does_not_collide():
    """A quote and a daily close for the same symbol are different data --
    the cache key must include the kind, not just the symbol string."""
    store = cache.Cache()
    fetched_at = datetime(2026, 9, 2, 10, 0, tzinfo=UTC)
    store.set(cache.MarketDataKind.QUOTE, "AAPL", 100, fetched_at)
    store.set(cache.MarketDataKind.DAILY_CLOSE, "AAPL", 999, fetched_at)

    assert store.get(cache.MarketDataKind.QUOTE, "AAPL", fetched_at).value == 100
    assert store.get(cache.MarketDataKind.DAILY_CLOSE, "AAPL", fetched_at).value == 999


def test_evaluate_is_a_pure_function_usable_without_the_cache_class():
    """The orchestration layer (Task 9, valuation) will source entries from
    `price_points` rather than this in-memory store -- `evaluate` must work
    from any `CacheEntry`, not only one the `Cache` class produced."""
    entry = cache.CacheEntry(value=42, fetched_at=datetime(2026, 9, 2, tzinfo=UTC))
    lookup = cache.evaluate(
        entry, cache.MarketDataKind.QUOTE, datetime(2026, 9, 2, 0, 10, tzinfo=UTC)
    )
    assert lookup.value == 42
    assert lookup.is_stale is True

    fresh = cache.evaluate(
        None, cache.MarketDataKind.QUOTE, datetime(2026, 9, 2, tzinfo=UTC)
    )
    assert fresh.value is None
    assert fresh.is_stale is False
