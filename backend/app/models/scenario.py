from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

SCENARIO_KINDS = ("feasibility",)


class Scenario(Base):
    """A saved simulation, for design §6.3's "chaque scénario est enregistrable
    et comparable aux autres".

    **`payload` holds the REQUEST, never the computed result.** Every scenario
    is recomputed against the current ledger when it is read back. Storing the
    figures would show a verdict measured on last winter's statements as though
    it were today's answer -- the same staleness trap `api/cashflow.py`'s module
    docstring works through for its clock, and a much worse one here, since the
    whole point of the feasibility engine is that its capacity input is
    measured from transactions that change with every import.

    JSON in a `Text` column rather than SQLAlchemy's `JSON` type: the payload is
    never queried into, only read whole and validated by the same Pydantic model
    that validated it on the way in, so a typed column would buy nothing and
    would make the "validate on read, do not trust the database" contract less
    obvious. Money inside the JSON is still an integer number of cents.
    """

    __tablename__ = "scenarios"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    payload: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
