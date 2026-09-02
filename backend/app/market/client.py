"""The provider interface, the five French failure causes, and the retry
policy every provider (`market/providers/`, Task 5) is built against.

Phase 3 plan Task 4. No provider implementation lives here -- only the
contract. `market/quota.py` and `market/cache.py` decide WHETHER a call
should be attempted and how fresh a cached value is; this module decides
HOW a call is made (the retry policy) and, when it fails, WHICH of exactly
five things went wrong.

**The five causes, and why they must never collapse into each other.**
"Aucune clé n'est enregistrée" (no key was ever entered), "la clé a été
refusée" (a key was entered but the provider rejected it), "le quota est
épuisé" (the key is fine, but the budget for this window is spent), "le
service est injoignable" (none of the above -- a network failure, a
timeout, a 5xx) and "ce symbole est inconnu" (the provider answered, but
has nothing for the instrument or currency asked about). Each names a
different remedy: enter a key, fix the key, wait, retry later, or check the
symbol. Collapsing two of them into one sentence has been this project's
single most repeated defect (sixteen prior tasks), which is why
`failure_message` is the ONE place all five are built -- a provider (Task
5) calls it rather than writing its own French, so the wording for a given
cause can never drift between providers.

**The retry policy is scoped to `SERVICE_UNREACHABLE` only.** The other
four causes are permanent for the call just made: a rejected key stays
rejected, an exhausted quota stays exhausted (and retrying would only spend
more of it), and an unknown symbol stays unknown. Retrying any of those
would repeat exactly the same answer at a cost. Only a transient failure --
the network blipped, the provider returned a 5xx -- is worth trying again.
"""

import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from enum import StrEnum
from typing import Protocol, runtime_checkable

from app.market.quota import PROVIDER_LABELS


class MarketFailureCause(StrEnum):
    NO_KEY = "no_key"
    KEY_REJECTED = "key_rejected"
    QUOTA_EXHAUSTED = "quota_exhausted"
    SERVICE_UNREACHABLE = "service_unreachable"
    UNKNOWN_SYMBOL = "unknown_symbol"


class MarketError(Exception):
    """Raised by a provider or by the orchestration layer around it,
    carrying exactly one of the five causes above and a French sentence
    already fit to show the user -- built by `failure_message`, never typed
    out again at the call site."""

    def __init__(self, cause: MarketFailureCause, message: str) -> None:
        super().__init__(message)
        self.cause = cause
        self.message = message


def failure_message(
    cause: MarketFailureCause, provider: str, *, symbol: str | None = None
) -> str:
    """The one place all five French sentences are written.

    Each branch below is a distinct sentence naming a distinct remedy --
    see the module docstring. `symbol` is required for `UNKNOWN_SYMBOL` and
    refused for it being absent rather than falling back to a vague
    "symbole inconnu" with nothing to point at.
    """
    label = PROVIDER_LABELS[provider]
    if cause is MarketFailureCause.NO_KEY:
        return (
            f"Aucune clé n'est enregistrée pour {label} : ajoutez-en une dans "
            "Réglages → Connexions pour activer cette donnée de marché."
        )
    if cause is MarketFailureCause.KEY_REJECTED:
        return (
            f"La clé enregistrée pour {label} a été refusée par le fournisseur : "
            "vérifiez qu'elle est valide dans Réglages → Connexions."
        )
    if cause is MarketFailureCause.QUOTA_EXHAUSTED:
        return (
            f"Le quota d'appels vers {label} est épuisé pour cette période : "
            "réessayez plus tard."
        )
    if cause is MarketFailureCause.SERVICE_UNREACHABLE:
        return f"Le service {label} est injoignable pour le moment : réessayez plus tard."
    if cause is MarketFailureCause.UNKNOWN_SYMBOL:
        if symbol is None:
            raise ValueError(
                "Un symbole est requis pour construire le message « symbole inconnu »."
            )
        return f"Le symbole « {symbol} » est inconnu de {label}."
    raise ValueError(f"Cause d'échec de marché inconnue : {cause}")  # pragma: no cover


def market_error(
    cause: MarketFailureCause, provider: str, *, symbol: str | None = None
) -> MarketError:
    """Build the ready-to-raise error in one call -- the idiom every
    provider in Task 5 uses instead of constructing `MarketError` by hand."""
    return MarketError(cause=cause, message=failure_message(cause, provider, symbol=symbol))


def should_retry(cause: MarketFailureCause) -> bool:
    """Only a transient service failure is worth retrying -- see the module
    docstring for why the other four must never be retried."""
    return cause is MarketFailureCause.SERVICE_UNREACHABLE


@dataclass(frozen=True)
class RetryPolicy:
    max_attempts: int = 3
    # One entry per gap between attempts (so `max_attempts - 1` entries are
    # actually used); the last value repeats if `max_attempts` grows past
    # the tuple's length.
    backoff_seconds: tuple[float, ...] = (0.5, 1.5)


DEFAULT_RETRY_POLICY = RetryPolicy()


def call_with_retry[T](
    fn: Callable[[], T],
    policy: RetryPolicy = DEFAULT_RETRY_POLICY,
    sleep: Callable[[float], None] = time.sleep,
) -> T:
    """Run `fn`, retrying only on a `MarketError` whose cause is
    `SERVICE_UNREACHABLE`, up to `policy.max_attempts` attempts in total.

    Any other exception -- a `MarketError` with a permanent cause, or a bug
    that raised something else entirely -- propagates on the first attempt:
    retrying a permanent cause would waste calls for an identical answer,
    and silently retrying an unrelated bug would turn it into a misleading
    "service unreachable" after enough attempts.

    `sleep` is injected so a test can prove the backoff schedule without an
    actual delay -- the same reason every pure module in this codebase
    takes `now` as a parameter rather than reading a clock.
    """
    attempt = 0
    while True:
        attempt += 1
        try:
            return fn()
        except MarketError as exc:
            if not should_retry(exc.cause) or attempt >= policy.max_attempts:
                raise
            index = min(attempt - 1, len(policy.backoff_seconds) - 1)
            sleep(policy.backoff_seconds[index])


@dataclass(frozen=True)
class Quote:
    """The latest traded price for one instrument, as a provider answered
    it -- the shape Task 5's equity and crypto providers return."""

    symbol: str
    price_cents: int
    currency: str
    as_of: date
    fetched_at: datetime
    # The provider that answered -- one of `quota.QUOTA_SPECS`' keys.
    source: str


@dataclass(frozen=True)
class FxRate:
    """One currency conversion rate, as a provider answered it -- the shape
    Task 5's Frankfurter and ExchangeRate-API providers return.

    `rate` travels as text, never as a `float`: the same wire-boundary
    discipline `engines.quantity.parse` enforces for a `Quantity`, applied
    here because a rate is about to be multiplied against real money and a
    `float` cannot represent most decimal rates exactly.
    """

    base_currency: str
    quote_currency: str
    rate: str
    as_of: date
    fetched_at: datetime
    source: str

    def __post_init__(self) -> None:
        try:
            Decimal(self.rate)
        except InvalidOperation as exc:
            raise ValueError(
                f"Taux de change invalide : « {self.rate} » n'est pas un nombre."
            ) from exc


@runtime_checkable
class QuoteProvider(Protocol):
    """What Finnhub, Alpha Vantage and CoinGecko each implement."""

    name: str
    requires_key: bool

    def validate_key(self, api_key: str) -> None:
        """One cheap real call proving the key works. Returns normally on
        success; raises `MarketError` (cause `KEY_REJECTED` or
        `SERVICE_UNREACHABLE`) otherwise. Used by `/api/connections`
        (Task 6) so storing a key validates it immediately."""

    def fetch_quote(self, symbol: str, api_key: str | None, *, now: datetime) -> Quote: ...


@runtime_checkable
class FxProvider(Protocol):
    """What Frankfurter and ExchangeRate-API each implement."""

    name: str
    requires_key: bool

    def validate_key(self, api_key: str) -> None: ...

    def fetch_rate(
        self, base_currency: str, quote_currency: str, api_key: str | None, *, now: datetime
    ) -> FxRate: ...
