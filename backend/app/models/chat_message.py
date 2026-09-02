from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ChatMessage(Base):
    """One question asked of the deterministic chat. Design §8.1.

    **`text` holds the QUESTION, never the computed answer** -- the identical
    contract `models.Scenario` documents for a saved feasibility scenario, and
    for the same reason: a figure the assistant computed last winter must not
    read as though it were current when the history is reopened months later.
    `GET /api/chat` re-parses and re-executes every stored row's `text`
    against the ledger as it stands today, every time it is read.
    """

    __tablename__ = "chat_messages"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
