from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ConnectorKey(Base):
    """The credential EZLink's Yieldo agent presents on every connector call.

    **Hashed, not encrypted** -- the opposite of `AgentKey`, and for the
    opposite reason. The agent key is read back on screen every day because it
    rotates; this one is shown once, at creation, pasted into the agent's key
    file, and never displayed again. Nothing needs the secret back, so nothing
    keeps it: `secret_hash` is the SHA-256 of a 256-bit random secret, which a
    stolen database cannot turn back into a key.

    It does not expire. What makes that acceptable is that it is revocable at
    once from Réglages → Connexions, that one row exists per account (creating
    a new key replaces the old one), and that it stops at the same wall as the
    agent key: every route behind `get_session_user` refuses it.
    """

    __tablename__ = "connector_keys"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True, nullable=False
    )
    # Public half of the token: identifies the row, proves nothing.
    selector: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    # Hex SHA-256 of the secret half. Never the secret itself.
    secret_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
