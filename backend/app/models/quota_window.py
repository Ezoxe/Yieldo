from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class QuotaWindow(Base):
    """Persisted call-count state for one provider's rate limit -- so the
    pool survives a process restart.

    **No `user_id`**, for the same reason `ApiKey` has none: Task 3's "pool"
    is a pool precisely because every consumer of a provider draws against
    the SAME counter, behind the SAME key. A `user_id` here would give each
    user their own independent budget against a single shared key, which is
    not what a rate limit ON THAT KEY means.

    This table stores only the mutable counter -- `used` and when the
    current window began. The window's LENGTH (60/minute, 25/day, 1 500/
    month, ...) and the 80 % pre-emptive ceiling are constants in
    `market/quota.py` (Task 3), not data: that module is pure and decides,
    from `window_started_at` and "now", whether the window has rolled over;
    this table only remembers what it was told last.

    Unique on `provider`: one live window per provider, updated in place as
    calls are made and reset in place when the window rolls over -- never a
    growing history table.
    """

    __tablename__ = "quota_windows"

    # One of app.models.api_key.MARKET_PROVIDERS.
    provider: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    window_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
