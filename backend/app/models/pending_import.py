from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Integer, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class PendingImport(Base):
    """A statement the connector prepared, waiting for the household.

    The connector may hand Yieldo a CSV and see how it reads; it may not
    decide which column is the date or the amount (CLAUDE.md, "Column tagging
    is user-driven"). So the file is kept here, whole, and the Imports screen
    downloads it and runs the ordinary wizard on it -- the mapping is then
    confirmed by the household exactly as for a file it dropped itself.

    The content is kept in the row rather than in `uploads/pending`, whose
    files are purged after 24 hours: a household that opens Yieldo three days
    later must still find what Claude prepared.
    """

    __tablename__ = "pending_imports"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    # How many data rows the analysis read, for the list on screen.
    rows: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
