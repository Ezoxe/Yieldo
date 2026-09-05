from sqlalchemy import ForeignKey, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class PlanSettings(Base):
    """Which of the three readings the whole application is answering in, for
    one household. See `app/engines/plan.LEDGER_MODES`.

    **One row per user, and the mode is stored server-side deliberately.** It
    could have lived in the URL or in the browser, and that would have been
    less code -- but the mode changes what every figure in the application
    means, and two things outside the browser have to know it: the export, and
    the assistant. A model asked "how much did I spend in March" must be able
    to say which March it is answering about, and a mode kept in a tab is a
    mode the model cannot see.

    Defaulted to `real` in the column, not just in the application: a household
    that never opens the plan screen must keep reading the ledger it always
    read, and a NULL here silently meaning "real" would be a second way of
    saying the same thing.
    """

    __tablename__ = "plan_settings"
    __table_args__ = (UniqueConstraint("user_id", name="uq_plan_settings_user"),)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    ledger_mode: Mapped[str] = mapped_column(
        String(16), default="real", server_default=text("'real'"), nullable=False
    )
