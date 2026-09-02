from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class PricePoint(Base):
    """One observed close for one instrument, as a provider actually
    returned it.

    **No `user_id`** -- same reasoning as `Instrument`: a price is the same
    number for every user of this installation, fetched at most once (Task
    3's quota pool exists precisely because there is one budget, not one per
    user) and shared by everyone's valuation.

    `price_cents` is in the INSTRUMENT'S OWN currency (`instrument.
    currency`), integer cents -- never a float, matching every other
    monetary column. It is a price, not an exchange rate: this table does
    not attempt to represent an FX rate (a ratio, not money), which Task 4/5
    define their own way.

    `fetched_at` is when Yieldo actually called the provider -- distinct
    from `as_of`, the trading date the price is FOR. A valuation reading a
    stale row states both: "the design's own words: 'a stale price is not a
    fallback -- it is a different answer, and it travels with the timestamp
    that makes it honest'". `source` names which provider answered, one of
    Task 5's five.

    Unique on `(instrument_id, as_of)`: at most one recorded close per
    instrument per day. A re-fetch of the same day overwrites this row
    rather than accumulating duplicates -- Task 4's cache layer owns that
    decision, not this table.
    """

    __tablename__ = "price_points"
    __table_args__ = (
        UniqueConstraint("instrument_id", "as_of", name="uq_price_point_instrument_as_of"),
    )

    instrument_id: Mapped[int] = mapped_column(
        ForeignKey("instruments.id", ondelete="CASCADE"), index=True, nullable=False
    )
    as_of: Mapped[date] = mapped_column(Date, nullable=False)
    price_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    # Which of Task 5's five providers answered: e.g. "finnhub", "coingecko".
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
