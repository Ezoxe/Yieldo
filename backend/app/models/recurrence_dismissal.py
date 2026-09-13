from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class RecurrenceDismissal(Base):
    """A label the household has said is not a subscription.

    `engines/recurrence.py` detects a rhythm and never a nature: four weekly
    trips to the same supermarket are a recurrence to it, and the audit of
    2026-09-06 found « Coût des abonnements » printing 8,6 times the real
    figure for exactly that reason. The panel was renamed; this row is the
    other half of the fix — the household can say « ce n'est pas un
    abonnement » once, and the label leaves the detection until it says
    otherwise.

    Keyed on `label_key`, the normalised label `api/common.recurrence_points`
    groups by, so the dismissal matches by the same rule the detection
    groups by. `label` keeps the raw statement text for the list in Réglages
    where the dismissal can be undone: a row the household cannot read is a
    filter it cannot revoke.
    """

    __tablename__ = "recurrence_dismissals"
    __table_args__ = (
        UniqueConstraint("user_id", "label_key", name="uq_recurrence_dismissal_user_key"),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    label_key: Mapped[str] = mapped_column(String(500), nullable=False)
    label: Mapped[str] = mapped_column(String(500), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
