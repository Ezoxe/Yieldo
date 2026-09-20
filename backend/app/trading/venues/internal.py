"""Yieldo's own order book: the sandbox, and the only venue that needs no
credentials.

`internal` is always `paper`. There is no code path in this application that
constructs it with `mode="live"` -- `api/invest_venues.py` refuses one -- so
nothing here can reach real money however it is called.

Its prices come from one of two places, per the venue's `price_source`:

* `synthetic` -- `trading/sandbox.py`, a deterministic series that is always
  open. The default, and the one that makes the sandbox usable at 22 h on a
  Sunday.
* `market` -- the prices phase 3 already stores in `price_points`, so a
  simulated book can run on the real history a household has collected. Passed
  in as a callable by `trading/venues/factory.py`, because reading that table
  needs a session and an adapter has none.

Execution is `engines/paper_book.simulate_fill` -- the same slippage, the same
spread, the same refusal of a non-marketable limit order that a household would
meet live. A simulator that filled at the mid price would teach a strategy to
expect an execution no venue gives.
"""

from collections.abc import Callable

from app.engines.paper_book import Quote, simulate_fill
from app.engines.quantity import Quantity
from app.trading import sandbox
from app.trading.venues.base import (
    VenueFailureCause,
    VenueOrderResult,
    venue_error,
)

NAME = "internal"
LABEL = "le carnet simulé de Yieldo"


class InternalVenue:
    """The simulated book. `step` is the synthetic market's clock -- see
    `models/trading_venue.sandbox_step`."""

    name = NAME
    label = LABEL

    def __init__(
        self,
        *,
        slippage_bps: int,
        price_source: str = "synthetic",
        step: int = 0,
        history: Callable[[str, int], tuple[int, ...]] | None = None,
    ) -> None:
        self.mode = "paper"
        self.slippage_bps = slippage_bps
        self.price_source = price_source
        self.step = step
        self._history = history

    def check(self) -> str:
        return (
            "Le carnet simulé est prêt : il n'a besoin d'aucune clé et ne transmet rien "
            "à l'extérieur."
        )

    def closes(self, symbol: str, count: int) -> tuple[int, ...]:
        if self.price_source == "synthetic":
            return sandbox.closes(symbol, end_index=self.step, count=count)
        if self._history is None:
            raise venue_error(
                VenueFailureCause.SERVICE_UNREACHABLE, LABEL,
                "aucune source de cours enregistrés n'est disponible",
            )
        series = self._history(symbol, count)
        if len(series) < count:
            raise venue_error(
                VenueFailureCause.UNKNOWN_SYMBOL, LABEL,
                f"{len(series)} cours enregistrés pour « {symbol} », {count} demandés",
            )
        return series

    def quote(self, symbol: str) -> Quote:
        if self.price_source == "synthetic":
            bid, ask = sandbox.quote_cents(symbol, self.step)
            return Quote(symbol=symbol, bid_cents=bid, ask_cents=ask)
        series = self.closes(symbol, 1)
        # A stored daily close has no book. Both sides take the same figure and
        # execution pays the venue's slippage alone -- stated rather than
        # invented, so nobody reads a spread that was never measured.
        last = series[-1]
        return Quote(symbol=symbol, bid_cents=last, ask_cents=last)

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
        fill = simulate_fill(
            side=side, quantity=quantity, order_type=order_type, quote=self.quote(symbol),
            slippage_bps=self.slippage_bps, limit_price_cents=limit_price_cents,
        )
        return VenueOrderResult(
            state="filled" if fill.state == "filled" else (
                "pending" if fill.state == "pending" else "failed"
            ),
            # The simulated book's identifier IS the idempotency key: there is
            # no external system to ask, and inventing a second identifier
            # would only make two things to reconcile.
            external_id=idempotency_key,
            filled_quantity=fill.quantity,
            average_price_cents=fill.price_cents,
            cost_cents=fill.cost_cents,
            reason=fill.reason,
        )
