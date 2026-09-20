from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# The four execution venues. `internal` is Yieldo's own simulated order book
# (`engines/paper_book.py`) and takes no credentials at all; the other three
# are real services with real keys, each of which offers a paper or testnet
# endpoint alongside its live one.
TRADING_VENUES = ("internal", "alpaca", "kraken", "binance")

VENUE_LABELS = {
    "internal": "Carnet simulé de Yieldo",
    "alpaca": "Alpaca",
    "kraken": "Kraken",
    "binance": "Binance",
}

# `paper` reaches a simulator -- Yieldo's own, or the venue's own paper/testnet
# endpoint. `live` reaches the real book with real money. There is no third
# mode, and nothing in this application converts one into the other silently.
VENUE_MODES = ("paper", "live")

# Where the price series the decision is taken on comes from.
#
# `venue`      the venue's own bars -- the price you decide on is the price
#              you trade on, which is the only arrangement with no basis risk.
# `synthetic`  a deterministic pseudo-random walk (`trading/sandbox.py`). The
#              fully offline sandbox: no market hours, no provider quota, no
#              network, and the same seed gives the same week every time, so a
#              strategy change is measured against an identical market.
# `market`     the phase 3 price providers (`market/`), for a simulated book
#              running on real prices.
PRICE_SOURCES = ("venue", "synthetic", "market")


class TradingVenue(Base):
    """One place orders can be sent, and the credentials that authorise it.

    **A `live` row is the only object in this application that can lose money.**
    Everything about this table is shaped by that:

    * `api_key_encrypted` and `api_secret_encrypted` are
      `security/crypto.encrypt_secret()` ciphertext, like `ApiKey.value` and
      `LlmSettings.api_key_encrypted`, and for the same reason those two spell
      out: **these columns never leave the server.** They are decrypted
      in-process by `trading/venues/*.py` for the one call they authorise.
      `GET /api/invest/venues` returns whether credentials are set, never what
      they are.
    * Every route that writes this table takes `get_session_user`, not
      `get_current_user`. An agent access key opens the ledger; it does not add
      a broker, and it does not switch one to `live`. That is the boundary
      `security/deps.py` already draws for Réglages → Connexions, applied to
      the one screen where crossing it costs money rather than privacy.
    * `mode` is `paper` on creation, always. Moving a venue to `live` is its
      own route, its own confirmation phrase, and its own audit event.

    `slippage_bps` is what the simulated book charges beyond the touch price
    (`engines/paper_book.simulate_fill`). It lives on the venue rather than in
    a constant because the honest figure is the one measured from that venue's
    own live fills -- a household that has traded Kraken knows its spread
    better than this codebase can guess it.

    Unique on `(user_id, venue, mode)`: one household may hold an Alpaca paper
    connection and an Alpaca live connection at once, which is exactly how a
    strategy is meant to graduate from one to the other.
    """

    __tablename__ = "trading_venues"
    __table_args__ = (
        UniqueConstraint("user_id", "venue", "mode", name="uq_trading_venue_user_venue_mode"),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # One of TRADING_VENUES.
    venue: Mapped[str] = mapped_column(String(24), nullable=False)
    # One of VENUE_MODES.
    mode: Mapped[str] = mapped_column(String(8), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    # Ciphertext, or None for `internal`, which authenticates against nothing.
    api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    api_secret_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Overrides the adapter's default base URL -- a venue's testnet host, or a
    # self-hosted gateway. Plain text: a hostname is not a secret.
    base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    slippage_bps: Mapped[int] = mapped_column(
        Integer, default=10, server_default=text("10"), nullable=False
    )
    # One of PRICE_SOURCES. `internal` defaults to `synthetic` (it is the
    # sandbox); a real venue defaults to `venue`.
    price_source: Mapped[str] = mapped_column(
        String(12), default="venue", server_default=text("'venue'"), nullable=False
    )
    # The synthetic market's own clock, for `price_source == "synthetic"`.
    # Advanced by one on every cycle, so the sandbox market moves when the
    # pipeline runs and stays still while a household reads a decision's detail
    # panel -- which is what makes that panel's figures reproducible.
    sandbox_step: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("1"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # What the venue said the last time credentials were checked. French, and
    # kept so the screen can show a connection that WAS working and stopped,
    # rather than only a green tick or nothing.
    last_check_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_check_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    last_check_message: Mapped[str | None] = mapped_column(Text, nullable=True)
