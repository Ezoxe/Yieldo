from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# Everything worth being unable to deny afterwards.
AUDIT_KINDS = (
    "policy_changed",
    "venue_added",
    "venue_removed",
    "venue_mode_changed",
    "model_changed",
    "armed",
    "disarmed",
    "halted",
    "resumed",
    "decision",
    "order_refused",
    "order_sent",
    "order_filled",
    "order_failed",
    "sandbox_reset",
)


class TradeAuditEvent(Base):
    """The append-only journal, chained by hash.

    Every row carries the SHA-256 of `(previous row's hash, this row's
    sequence, kind, payload)`. Change one payload after the fact and every
    subsequent hash stops matching -- `trading/audit.verify_chain` walks the
    chain and names the first row where it broke.

    **Why bother, on a self-hosted application whose owner also owns the
    database file?** Because the owner is not the only writer. This feature
    hands an agent access key to a program that can read the ledger, and it
    invites an external model to supervise the pipeline. A journal that any of
    those could quietly edit proves nothing about what the pipeline did. The
    chain does not make the file immutable; it makes an edit *visible*, which
    is the property an audit actually needs.

    Nothing in this application updates or deletes a row of this table. The
    only write is an append, through `trading/audit.append`.

    `sequence` is per user and dense, starting at 1 -- a gap is itself
    evidence, which a global autoincrement id could not show.
    """

    __tablename__ = "trade_audit_events"
    __table_args__ = (
        UniqueConstraint("user_id", "sequence", name="uq_trade_audit_user_sequence"),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    # One of AUDIT_KINDS.
    kind: Mapped[str] = mapped_column(String(24), index=True, nullable=False)
    # The event, as data. Never a sentence: the screen words it, from the kind
    # and the payload, so one event cannot be described two ways.
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    # Who caused it: "session" (the browser), "agent" (an access key), or
    # "system" (the pipeline itself). The three have different authority and an
    # audit that cannot tell them apart cannot answer the one question it will
    # be asked.
    actor: Mapped[str] = mapped_column(String(12), nullable=False)
    # Empty string for the first row of a user's chain -- not NULL, so the hash
    # of row 1 is computed over a defined value like every other row's.
    previous_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    entry_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), index=True, nullable=False
    )
