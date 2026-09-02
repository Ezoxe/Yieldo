"""A freshness decision per market data kind -- pure, and an in-memory store
built on it.

Phase 3 plan Task 4. Time-to-live differs by what was fetched: a quote is
minutes, a daily close is a day, an FX rate is hours, an instrument's
identity is permanent (it never changes once assigned). **A value returned
past its TTL is explicitly labelled stale, and it still carries the
timestamp it was fetched at.** This module never drops a stale value and
never presents one as fresh -- CLAUDE.md's own words, echoed in the plan:
"a stale price is not a fallback -- it is a different answer, and it
travels with the timestamp that makes it honest." The caller (Task 9's
valuation client, later) decides what a stale hit means: show it anyway
with a caveat, or refuse and say why. This module only tells the truth
about the value's age.

Pure: no session, no network, no implicit clock -- `now` is always a
parameter to `evaluate` and to `Cache.get`, exactly like `market/quota.py`.
`Cache` itself holds state (an in-memory dict), but that state is process
memory, never I/O -- deterministic given what was `set` and what `now` is
handed to `get`.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum


class MarketDataKind(StrEnum):
    QUOTE = "quote"
    DAILY_CLOSE = "daily_close"
    FX_RATE = "fx_rate"
    INSTRUMENT = "instrument"


# None means permanent -- never stale, unlike a very large timedelta standing
# in for "forever", which would still expire eventually and would be exactly
# the kind of value silently doing another value's job that this project's
# review process keeps catching.
TTL_BY_KIND: dict[MarketDataKind, timedelta | None] = {
    MarketDataKind.QUOTE: timedelta(minutes=5),
    MarketDataKind.DAILY_CLOSE: timedelta(days=1),
    MarketDataKind.FX_RATE: timedelta(hours=4),
    MarketDataKind.INSTRUMENT: None,
}


@dataclass(frozen=True)
class CacheEntry[T]:
    value: T
    fetched_at: datetime


@dataclass(frozen=True)
class CacheLookup[T]:
    kind: MarketDataKind
    # None exactly when nothing has ever been recorded for this key -- a
    # cache miss, distinct from a stale hit, which still carries a value.
    value: T | None
    fetched_at: datetime | None
    # Never True when value is None: there is nothing to be stale about.
    is_stale: bool


def evaluate[T](entry: CacheEntry[T] | None, kind: MarketDataKind, now: datetime) -> CacheLookup[T]:
    """The pure decision, from one entry (or none) and `now`. Works on any
    `CacheEntry`, not only one the `Cache` class produced -- the later
    valuation client sources entries from `price_points` for daily closes
    and instrument identities, and from its own in-memory store for quotes
    and FX rates, through this same function."""
    if entry is None:
        return CacheLookup(kind=kind, value=None, fetched_at=None, is_stale=False)
    ttl = TTL_BY_KIND[kind]
    # >= : an entry exactly TTL old is already due for a refresh, not still
    # good for one more instant -- the boundary test pins this both ways.
    is_stale = False if ttl is None else (now - entry.fetched_at) >= ttl
    return CacheLookup(kind=kind, value=entry.value, fetched_at=entry.fetched_at, is_stale=is_stale)


class Cache[T]:
    """The most recently recorded value per `(kind, key)`, entirely in
    process memory. No session, no network, no implicit clock: `now` is
    supplied by the caller on every `get`, never read from the wall clock,
    so a rollover past a TTL boundary is exactly as testable here as it is
    in `market/quota.py`."""

    def __init__(self) -> None:
        self._entries: dict[tuple[MarketDataKind, str], CacheEntry[T]] = {}

    def get(self, kind: MarketDataKind, key: str, now: datetime) -> CacheLookup[T]:
        return evaluate(self._entries.get((kind, key)), kind, now)

    def set(self, kind: MarketDataKind, key: str, value: T, fetched_at: datetime) -> None:
        self._entries[(kind, key)] = CacheEntry(value=value, fetched_at=fetched_at)
