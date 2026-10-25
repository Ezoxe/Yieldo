from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ConnectorAction(Base):
    """One write the connector made, or tried to make, on the household's behalf.

    Read by Réglages → Connexions (« Ce que Claude a fait »). Recorded whether
    the route accepted the call or refused it: a refused deletion is as much
    part of what the connector did as an accepted one. Reads are not recorded
    -- EZLink's own audit keeps every call, and a table of reads would bury the
    writes it exists to show.
    """

    __tablename__ = "connector_actions"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    tool: Mapped[str] = mapped_column(String(64), nullable=False)
    args: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    # The Discord approval this call carried, for an `approve` tool.
    approval_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status_code: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
