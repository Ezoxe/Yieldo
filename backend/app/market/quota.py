"""Per-user, per-provider call-count tracking against each market provider's
published rate limit -- pre-emptive at 80%, never at the provider's own
100%, and the reset date.

Pure: no session, no network, no implicit clock -- `now` is always a
parameter, exactly like every module under `app/engines/`. Persisting the
counter (reading and writing `models.QuotaWindow`) is the orchestration
layer's job (Task 6's router and, later, Task 9's valuation client); this
module only decides, from a `WindowState` and `now`, whether a call may
proceed.

**Why pre-emptive and not the provider's own limit.** A provider's own 429
still happens sometimes -- a concurrent request, a clock a few seconds off --
but stopping OURSELVES at 80% means Yieldo's refusal is a deliberate policy
decision with its own French sentence, not a scramble to interpret whatever
error shape the provider hands back after the fact. `market/providers/`
(Task 5) maps a provider's OWN rate-limit response onto the same
`quota_exhausted` cause for the rare case this pool undershoots.

**Why day/month windows are calendar-aligned, not a rolling duration from
whenever the window happened to start.** Every provider here advertises its
limit as "per day" or "per month" in the ordinary sense -- resetting at
midnight, or on the first of the month -- not "60 minutes after your last
reset". A window that started at 23:58 must still roll over two minutes
later, at midnight, not 24 hours after 23:58. Computing the CURRENT window's
boundary directly from `now` (rather than adding a fixed duration to the
stored `window_started_at`) is what makes this correct, and it is also
exactly why `now` cannot be read from an implicit clock: a test proving the
midnight rollover has to construct two `now` values three minutes apart and
watch the counter reset between them.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

# Design §12 / phase 3 plan Task 3. Frankfurter's `limit` is `None`:
# unlimited, and `evaluate` short-circuits before consulting `window_kind`
# for it at all.
PROVIDER_LABELS: dict[str, str] = {
    "finnhub": "Finnhub",
    "alpha_vantage": "Alpha Vantage",
    "coingecko": "CoinGecko",
    "frankfurter": "Frankfurter",
    "exchangerate_api": "ExchangeRate-API",
}


@dataclass(frozen=True)
class QuotaSpec:
    # None means unlimited (Frankfurter) -- never a large integer standing
    # in for "no limit", which is exactly the kind of fallback value
    # CLAUDE.md forbids ("no fallback value standing in for real data").
    limit: int | None
    window_kind: str  # "minute" | "day" | "month" | "none"


QUOTA_SPECS: dict[str, QuotaSpec] = {
    "finnhub": QuotaSpec(limit=60, window_kind="minute"),
    "alpha_vantage": QuotaSpec(limit=25, window_kind="day"),
    "exchangerate_api": QuotaSpec(limit=1500, window_kind="month"),
    "coingecko": QuotaSpec(limit=30, window_kind="minute"),
    "frankfurter": QuotaSpec(limit=None, window_kind="none"),
}

# 80%, expressed as exact integer arithmetic (`limit * 4 // 5`) rather than
# `int(limit * 0.8)` -- every published limit above divides evenly by 5, so
# this is never an approximation, and it never touches a float on the way to
# a count.
_PREEMPTIVE_NUMERATOR = 4
_PREEMPTIVE_DENOMINATOR = 5


@dataclass(frozen=True)
class WindowState:
    """The mutable half of one `models.QuotaWindow` row -- what the caller
    persisted last, handed back in without the ORM attached."""

    window_started_at: datetime
    used: int


@dataclass(frozen=True)
class QuotaDecision:
    allowed: bool
    provider: str
    # The count this decision was made against -- 0 on a freshly rolled-over
    # window, even if the state handed in carried a stale, larger count.
    used: int
    limit: int | None
    ceiling: int | None
    remaining: int | None
    # The window this decision belongs to -- may differ from the input
    # state's own `window_started_at` when the window has just rolled over.
    window_started_at: datetime
    reset_at: datetime | None
    # French. Set if and only if `allowed` is False.
    refusal_reason: str | None


def _spec(provider: str) -> QuotaSpec:
    try:
        return QUOTA_SPECS[provider]
    except KeyError:
        raise ValueError(f"Fournisseur de données de marché inconnu : {provider}") from None


def window_start(provider: str, now: datetime) -> datetime:
    """The calendar boundary the CURRENT window began at, computed directly
    from `now` -- never from a stored value, which is what lets a window
    roll over at midnight rather than a fixed duration after it started."""
    kind = _spec(provider).window_kind
    if kind == "minute":
        return now.replace(second=0, microsecond=0)
    if kind == "day":
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
    if kind == "month":
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    raise ValueError(f"{PROVIDER_LABELS[provider]} n'a pas de fenêtre de quota (accès illimité).")


def window_end(provider: str, started_at: datetime) -> datetime:
    """The next calendar boundary after `started_at` -- a real calendar
    step, not `started_at + timedelta(days=30)`, which would answer wrongly
    for every month that is not exactly 30 days and would not survive a
    December-to-January rollover at all."""
    kind = _spec(provider).window_kind
    if kind == "minute":
        return started_at + timedelta(minutes=1)
    if kind == "day":
        return started_at + timedelta(days=1)
    if kind == "month":
        if started_at.month == 12:
            return started_at.replace(year=started_at.year + 1, month=1)
        return started_at.replace(month=started_at.month + 1)
    raise ValueError(f"{PROVIDER_LABELS[provider]} n'a pas de fenêtre de quota (accès illimité).")


def preemptive_ceiling(limit: int) -> int:
    return limit * _PREEMPTIVE_NUMERATOR // _PREEMPTIVE_DENOMINATOR


def _reason_quota_exhausted(provider: str, reset_at: datetime) -> str:
    """One of the lot's five causes: "le quota est épuisé". Names the
    provider and the moment the pool refills, so the remedy ("attendez" or
    "revenez plus tard") is legible without the reader doing arithmetic on a
    raw timestamp."""
    label = PROVIDER_LABELS[provider]
    return (
        f"Le quota d'appels vers {label} est épuisé pour cette période : "
        f"il sera réinitialisé le {reset_at.strftime('%d/%m/%Y à %H:%M')}."
    )


def evaluate(provider: str, state: WindowState | None, now: datetime) -> QuotaDecision:
    """May a call to `provider` proceed right now?

    Reads `state` (what was last persisted, or `None` on a provider never
    called before) and decides, without writing anything: whether the
    window `state` describes still applies at `now` or has rolled over, and
    whether the count in the applicable window has reached the 80%
    pre-emptive ceiling. Refusing is an answer with its own field
    (`refusal_reason`), never an exception -- the plan's own words: "an
    answer with its own French sentence, not an exception."
    """
    spec = _spec(provider)
    if spec.limit is None:
        return QuotaDecision(
            allowed=True, provider=provider, used=0 if state is None else state.used,
            limit=None, ceiling=None, remaining=None,
            window_started_at=now if state is None else state.window_started_at,
            reset_at=None, refusal_reason=None,
        )

    boundary = window_start(provider, now)
    if state is None or state.window_started_at < boundary:
        used = 0
        started_at = boundary
    else:
        used = state.used
        started_at = state.window_started_at

    ceiling = preemptive_ceiling(spec.limit)
    reset_at = window_end(provider, started_at)

    if used >= ceiling:
        return QuotaDecision(
            allowed=False, provider=provider, used=used, limit=spec.limit, ceiling=ceiling,
            remaining=0, window_started_at=started_at, reset_at=reset_at,
            refusal_reason=_reason_quota_exhausted(provider, reset_at),
        )
    return QuotaDecision(
        allowed=True, provider=provider, used=used, limit=spec.limit, ceiling=ceiling,
        remaining=ceiling - used, window_started_at=started_at, reset_at=reset_at,
        refusal_reason=None,
    )


def record_call(provider: str, state: WindowState | None, now: datetime) -> WindowState:
    """The state to persist after a call was actually made -- the caller's
    job to write back to `models.QuotaWindow`. Rolls the window over exactly
    the same way `evaluate` does, so the two can never disagree about which
    window a given `now` belongs to."""
    spec = _spec(provider)
    if spec.limit is None:
        return WindowState(window_started_at=now, used=(0 if state is None else state.used) + 1)

    boundary = window_start(provider, now)
    if state is None or state.window_started_at < boundary:
        return WindowState(window_started_at=boundary, used=1)
    return WindowState(window_started_at=state.window_started_at, used=state.used + 1)
