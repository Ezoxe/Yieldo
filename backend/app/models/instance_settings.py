from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class InstanceSettings(Base):
    """What the installation's administrator decided, one row (id 1) at most.

    `registration_open` is NULL until the administrator first chooses; NULL
    means "follow YIELDO_REGISTRATION_OPEN", so an operator who set the
    variable in .env is never overridden by a row nobody wrote.
    """

    __tablename__ = "instance_settings"

    registration_open: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
