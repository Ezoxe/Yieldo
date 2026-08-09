from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

RULE_ORIGINS = ("builtin", "learned", "manual")
RULE_PRIORITIES = {"builtin": 100, "learned": 200, "manual": 300}


class CategoryRule(Base):
    __tablename__ = "category_rules"
    __table_args__ = (
        UniqueConstraint("user_id", "pattern", "category_id", name="uq_rule_user_pattern_cat"),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    pattern: Mapped[str] = mapped_column(String(200), nullable=False)
    is_regex: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE"), nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    origin: Mapped[str] = mapped_column(String(16), default="builtin", nullable=False)
    direction: Mapped[str] = mapped_column(String(8), default="any", nullable=False)
    hit_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)
