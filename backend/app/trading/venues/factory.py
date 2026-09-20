"""The one place a venue adapter is built, and the one place its credentials
are decrypted.

`trading/service.py` receives an adapter; it never constructs one. That is what
lets a test run the whole pipeline against `InternalVenue` with no network, and
it is what keeps the decryption of a broker secret to a single function that
can be read in one sitting.

**Two rules this module enforces that nothing downstream re-checks, because it
cannot be reached any other way:**

* `internal` is always `paper`. A row claiming otherwise is refused here.
* A `paper` order on a venue with no simulator of its own (Kraken has no
  testnet) is executed on Yieldo's simulated book against that venue's real
  prices -- never sent to the venue. `execution_adapter` below is what returns
  the simulator in that case, and `service.py` calls it rather than choosing
  for itself.
"""

from collections.abc import Callable

from app.models import TradingVenue
from app.security.crypto import SecretDecryptionError, decrypt_secret
from app.trading.venues.alpaca import AlpacaVenue
from app.trading.venues.base import VenueAdapter, VenueFailureCause, venue_error
from app.trading.venues.binance import BinanceVenue
from app.trading.venues.internal import InternalVenue
from app.trading.venues.kraken import KrakenVenue

# Which venues run their own paper environment. Alpaca's paper API and
# Binance's testnet really match orders; Kraken has neither, so a paper order
# there is simulated locally against Kraken's real book.
VENUES_WITH_PAPER = ("alpaca", "binance")

LABELS = {
    "internal": "le carnet simulé de Yieldo",
    "alpaca": "Alpaca",
    "kraken": "Kraken",
    "binance": "Binance",
}


def _secret(blob: str | None, venue: str) -> str | None:
    if not blob:
        return None
    try:
        return decrypt_secret(blob)
    except SecretDecryptionError as exc:
        raise venue_error(
            VenueFailureCause.CREDENTIALS_REJECTED, LABELS.get(venue, venue),
            "la clé enregistrée est illisible avec la clé de chiffrement actuelle",
        ) from exc


def build(
    row: TradingVenue,
    *,
    history: Callable[[str, int], tuple[int, ...]] | None = None,
) -> VenueAdapter:
    """The adapter for this row, credentials decrypted on the way in."""
    if row.venue == "internal":
        if row.mode != "paper":
            raise venue_error(
                VenueFailureCause.REJECTED_BY_VENUE, LABELS["internal"],
                "le carnet simulé n'existe qu'en mode papier",
            )
        return InternalVenue(
            slippage_bps=row.slippage_bps, price_source=row.price_source,
            step=row.sandbox_step, history=history,
        )

    key = _secret(row.api_key_encrypted, row.venue)
    secret = _secret(row.api_secret_encrypted, row.venue)

    if row.venue == "alpaca":
        return AlpacaVenue(
            mode=row.mode, api_key=key, api_secret=secret, base_url=row.base_url
        )
    if row.venue == "kraken":
        return KrakenVenue(
            mode=row.mode, api_key=key, api_secret=secret, base_url=row.base_url
        )
    if row.venue == "binance":
        return BinanceVenue(
            mode=row.mode, api_key=key, api_secret=secret, base_url=row.base_url
        )
    raise venue_error(
        VenueFailureCause.SERVICE_UNREACHABLE, row.venue, "place de marché inconnue"
    )


def execution_adapter(
    row: TradingVenue,
    quoting: VenueAdapter,
) -> VenueAdapter:
    """Where the order actually goes.

    Usually `quoting` itself. The exception is a `paper` venue with no paper
    environment of its own: the quotes stay real, the execution moves to the
    simulated book. Returning a different object -- rather than branching
    inside `service.py` -- is what makes that substitution visible in one
    place and testable on its own.
    """
    if row.mode != "paper" or row.venue in ("internal", *VENUES_WITH_PAPER):
        return quoting
    return InternalVenue(
        slippage_bps=row.slippage_bps,
        price_source="market",
        history=lambda symbol, count: quoting.closes(symbol, count),
    )
