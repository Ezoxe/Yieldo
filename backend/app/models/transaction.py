from datetime import date

from sqlalchemy import JSON, Boolean, Date, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

# "builtin" and "rule" both mean "matched a rule"; "builtin" additionally says the
# rule shipped with Yieldo rather than being written by the user. classify() returns
# the rule's origin verbatim, so every origin value must be listed here.
TRANSACTION_CATEGORY_SOURCES = (
    "builtin", "rule", "learned", "manual", "csv", "uncategorized",
)


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        UniqueConstraint("user_id", "dedup_hash", name="uq_transaction_user_dedup"),
        Index("ix_transaction_user_date", "user_id", "date"),
        Index("ix_transaction_user_category", "user_id", "category_id"),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True, nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    value_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    label_raw: Mapped[str] = mapped_column(String(500), nullable=False)
    label_clean: Mapped[str] = mapped_column(String(500), nullable=False)
    merchant: Mapped[str | None] = mapped_column(String(200), nullable=True)
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    category_source: Mapped[str] = mapped_column(
        String(16), default="uncategorized", nullable=False)
    is_transfer: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_recurring: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    recurrence_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    import_batch_id: Mapped[int | None] = mapped_column(
        ForeignKey("import_batches.id", ondelete="SET NULL"), index=True, nullable=True)
    # 64 for the sha256 digest, plus room for the ":n" suffix a deliberately
    # kept duplicate carries (importers/service.py, api/transactions.py).
    dedup_hash: Mapped[str] = mapped_column(String(80), nullable=False)
    notes: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)

    account = relationship("Account", back_populates="transactions")
    category = relationship("Category")

    @property
    def manual(self) -> bool:
        """Typed in by hand rather than read off a statement.

        Derived, never stored: a hand-typed line is exactly a line no import
        batch produced, and a second column claiming the same thing could
        drift out of step with the first. `category_source == "manual"` is a
        different fact entirely -- it says who chose the CATEGORY, and an
        imported line whose category the user corrected carries it too.
        """
        return self.import_batch_id is None
