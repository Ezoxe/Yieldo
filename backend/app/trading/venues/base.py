"""The venue contract, and the five ways reaching one can fail.

`market/client.py` made this argument once already, for price providers, and
every word of it applies here with money at stake instead of a figure on a
screen: **five causes, never collapsed into each other**, because each names a
different remedy. No credentials (none were ever entered), credentials refused
(some were, and the venue rejected them), the service is unreachable (a
network failure, a 5xx), the symbol is unknown to this venue, and the venue
itself rejected the order (insufficient funds, market closed, a size below its
own minimum). A household told only "l'ordre a échoué" has nothing to do next.

**No retry on a placement, ever.** `market/client.py` retries a price fetch on
a transient failure because fetching a price twice costs a quota unit. Sending
an order twice costs a position. A timeout on `place_order` leaves the caller
unable to distinguish a lost request from a lost response, and the only safe
move is to stop and say so -- which is why every adapter sends an idempotency
key the venue can deduplicate on, and why `trading/service.py` marks the order
`failed` rather than trying again.

**An adapter never decides anything.** It quotes, it fetches closes, it sends
what it was given. The mandate has already run by the time any method here is
called; there is no branch in this package that could let an order past
`engines/trading_risk`, because no adapter is ever constructed with the
mandate at all.
"""

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol, runtime_checkable

from app.engines.paper_book import Quote
from app.engines.quantity import Quantity


class VenueFailureCause(StrEnum):
    NO_CREDENTIALS = "no_credentials"
    CREDENTIALS_REJECTED = "credentials_rejected"
    SERVICE_UNREACHABLE = "service_unreachable"
    UNKNOWN_SYMBOL = "unknown_symbol"
    REJECTED_BY_VENUE = "rejected_by_venue"


class VenueError(Exception):
    def __init__(self, cause: VenueFailureCause, message: str) -> None:
        super().__init__(message)
        self.cause = cause
        self.message = message


def failure_message(
    cause: VenueFailureCause, venue_label: str, detail: str | None = None
) -> str:
    suffix = f" ({detail})" if detail else ""
    if cause is VenueFailureCause.NO_CREDENTIALS:
        return (
            f"Aucune clé n'est enregistrée pour {venue_label} : ouvrez Investissement → "
            "Courtiers pour en enregistrer une. Rien n'est transmis en attendant."
        )
    if cause is VenueFailureCause.CREDENTIALS_REJECTED:
        return (
            f"{venue_label} a refusé la clé enregistrée{suffix}. Vérifiez-la dans "
            "Investissement → Courtiers, ainsi que les permissions accordées à la clé "
            "chez le courtier."
        )
    if cause is VenueFailureCause.SERVICE_UNREACHABLE:
        return (
            f"{venue_label} est injoignable{suffix}. Aucun ordre n'est transmis tant que "
            "la liaison n'est pas rétablie ; rien n'est retenté automatiquement."
        )
    if cause is VenueFailureCause.UNKNOWN_SYMBOL:
        return (
            f"{venue_label} ne connaît pas cet instrument{suffix}. Vérifiez son code dans "
            "le mandat : chaque courtier a sa propre écriture."
        )
    return (
        f"{venue_label} a refusé l'ordre{suffix}. L'ordre est enregistré comme refusé et "
        "n'est pas retransmis."
    )


def venue_error(
    cause: VenueFailureCause, venue_label: str, detail: str | None = None
) -> VenueError:
    return VenueError(cause, failure_message(cause, venue_label, detail))


@dataclass(frozen=True)
class VenueOrderResult:
    """What the venue did with the order.

    `state` is one of `models/trade_order.ORDER_STATES` minus `refused`, which
    only the mandate produces -- a venue never refuses on Yieldo's behalf, and
    conflating the two would hide which of them stopped an order.
    """

    state: str  # "filled" | "pending" | "cancelled" | "failed"
    external_id: str | None
    filled_quantity: Quantity
    average_price_cents: int
    # What execution cost beyond the mid price. 0 when the venue does not say.
    cost_cents: int
    # French, and set if and only if the order did not fill.
    reason: str | None = None


@runtime_checkable
class VenueAdapter(Protocol):
    """Everything `trading/service.py` knows about a place orders can go."""

    name: str
    label: str
    mode: str

    def check(self) -> str:
        """Prove the credentials work, and say so in French. Raises
        `VenueError` when they do not -- this is the one call
        `POST /api/invest/venues` makes before saving, exactly as
        `api/connections.py` validates a market key with one real call."""
        ...

    def closes(self, symbol: str, count: int) -> tuple[int, ...]:
        """`count` closing prices in integer cents, oldest first."""
        ...

    def quote(self, symbol: str) -> Quote:
        ...

    def place_order(
        self,
        *,
        symbol: str,
        side: str,
        quantity: Quantity,
        order_type: str,
        limit_price_cents: int | None,
        idempotency_key: str,
    ) -> VenueOrderResult:
        ...
