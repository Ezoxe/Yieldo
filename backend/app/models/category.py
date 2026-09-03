from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

CATEGORY_KINDS = ("expense", "income", "transfer")


class Category(Base):
    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("user_id", "slug", name="uq_category_user_slug"),)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), default="expense", nullable=False)
    color: Mapped[str] = mapped_column(String(9), default="#7ee2d6", nullable=False)
    icon: Mapped[str] = mapped_column(String(40), default="circle", nullable=False)
    monthly_budget_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # What the household still pays when income stops -- rent, food, energy,
    # health, insurance, tax. It is what makes the runway's reduced scenario a
    # measurement of the user's own ledger rather than a guessed percentage.
    # Editable: only the user knows whether their gym membership is optional.
    is_essential: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("0"), nullable=False
    )

    user = relationship("User", back_populates="categories")
    parent = relationship("Category", remote_side="Category.id", back_populates="children")
    children = relationship("Category", back_populates="parent", cascade="all, delete-orphan")
