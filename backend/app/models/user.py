from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class User(Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(16), default="user", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )

    accounts = relationship("Account", back_populates="user", cascade="all, delete-orphan")
    categories = relationship("Category", back_populates="user", cascade="all, delete-orphan")


# Make email lookups case-insensitive, including on the in-memory test database.
#
# The real case-insensitive-unique constraint is also applied by the migration via the
# NOCASE collation on the column type; this mirrors that for SQLite databases created
# directly from Base.metadata (e.g. in tests), which never run migrations.
#
# Note: an `after_parent_attach` event listener registered here (as one might expect)
# does NOT work — by the time `User.__table__` exists to listen on, the column has
# already attached to the table (that happens during class body execution), so the
# event has already fired and a listener added afterward never runs. Mutating the
# type directly, once, at import time achieves the same effect reliably.
User.__table__.c.email.type = String(320, collation="NOCASE")
