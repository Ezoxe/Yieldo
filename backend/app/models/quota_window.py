from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class QuotaWindow(Base):
    """Persisted call-count state for one user's rate limit against one
    provider -- so the pool survives a process restart.

    **Carries `user_id`, for the same reason `ApiKey` now does -- see that
    model's docstring.** Each user enters their own provider key in
    Réglages -> Connexions, so each user's calls draw down THEIR OWN counter
    against THEIR OWN key; a `user_id`-less window would let one user's
    traffic exhaust a budget bought against a key they never provided.

    This table stores only the mutable counter -- `used` and when the
    current window began. The window's LENGTH (60/minute, 25/day, 1 500/
    month, ...) and the 80 % pre-emptive ceiling are constants in
    `market/quota.py` (Task 3), not data: that module is pure and decides,
    from `window_started_at` and "now", whether the window has rolled over;
    this table only remembers what it was told last.

    Unique on `(user_id, provider)`: one live window per user per provider,
    updated in place as calls are made and reset in place when the window
    rolls over -- never a growing history table.
    """

    __tablename__ = "quota_windows"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", name="uq_quota_window_user_provider"),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # One of app.models.api_key.MARKET_PROVIDERS.
    provider: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    window_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
