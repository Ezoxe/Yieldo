from sqlalchemy import Boolean, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

INSTRUMENT_ASSET_CLASSES = ("equity", "etf", "bond", "crypto", "cash", "real_estate", "other")


class Instrument(Base):
    """A tradable identity a market data provider can price: a stock, an ETF,
    a cryptocurrency.

    **No `user_id`.** AAPL is AAPL for every user of this self-hosted
    installation -- an objective market fact, not personal data, unlike
    `ApiKey` and `QuotaWindow` (see their docstrings), which carry `user_id`
    precisely because a provider key is a secret one user typed in, not a
    fact about the world. Giving `Instrument` a `user_id` would mean
    fetching and storing "AAPL" once per user for no benefit; every user's
    `Position` rows that hold AAPL reference this SAME row.

    Unique on `(symbol, asset_class)` rather than `symbol` alone: a ticker is
    not a global namespace (a crypto pair and an equity could coincide), and
    the asset class is exactly the dimension design's Task 7 valuation
    already needs ("weight ... per asset class").

    `is_fractionable` defaults to `False` -- the conservative default. Task
    8's rebalancing "refuses rather than proposing a trade it cannot size"
    for a non-fractionable instrument; defaulting to `True` would let a
    freshly-created instrument silently claim a capability (fractional
    trading) most brokers do not actually offer for it.
    """

    __tablename__ = "instruments"
    __table_args__ = (
        UniqueConstraint("symbol", "asset_class", name="uq_instrument_symbol_asset_class"),
    )

    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # One of INSTRUMENT_ASSET_CLASSES.
    asset_class: Mapped[str] = mapped_column(String(24), nullable=False)
    # The instrument's own trading currency -- NOT necessarily the holder's
    # reporting currency. Converting between the two is Task 7's job.
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    is_fractionable: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("0"), nullable=False
    )
