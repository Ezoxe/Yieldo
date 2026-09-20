from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# How one instrument's turn through the pipeline ended. Every decision has
# exactly one, and the screen groups the feed by it.
#
# `skipped`   a rule answered before the model was asked (decision/strategy.prefilter)
# `held`      the model answered, and the answer was "ne rien faire" or fell
#             short of a threshold
# `refused`   an order was sized and the mandate refused it
# `ordered`   an order was sized, the mandate allowed or reduced it, and it was sent
# `failed`    the model or the venue failed; the cause is named
DECISION_OUTCOMES = ("skipped", "held", "refused", "ordered", "failed")


class TradeDecision(Base):
    """One instrument, one pass of the pipeline, and everything it saw.

    **This row is the audit.** The Salle de contrôle reads it, the oversight
    API returns it, and `POST /api/invest/oversight/replay/{id}` re-runs the
    stored `features` through the stored questions and compares the answer to
    the stored one. Every column below exists because that replay, or the
    household reading the screen, needs it -- there is nothing here for
    convenience.

    **`features`, `context` and `answers` are stored as they were, not as a
    summary.** `features` is `engines/signals.MarketFeatures.canonical()`;
    `context` is the exact mapping handed to the model
    (`decision/strategy.build_context`); `answers` holds each typed answer
    beside the provider's raw payload and its latency. A trace written after
    the fact is a description of a run, and this codebase already decided that
    question once, for `AgentStep`: what is persisted is what ran.

    **`inputs_hash` is what makes tampering visible.** It is the SHA-256 of the
    canonical features plus the questions asked, computed at write time by
    `trading/audit.py`. A replay recomputes it: if the stored features were
    edited afterwards, the hash no longer matches and the endpoint says so
    rather than reporting a clean replay against altered inputs.

    **No figure here was produced by the model except the answers themselves.**
    `reference_price_cents` comes from the venue's quote, the features from
    `engines/signals`, the sizing from `decision/strategy.size_intent`, the
    verdict from `engines/trading_risk`. That is `llm/tools.py`'s rule -- the
    model never calculates -- carried into the one place where breaking it
    would cost money.
    """

    __tablename__ = "trade_decisions"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Every decision of one cycle shares a run id, so the screen can show "ce
    # tour a examiné 5 instruments, en a écarté 3, a passé 1 ordre".
    run_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    # `paper` or `live` -- models.trading_venue.VENUE_MODES. Stored on the
    # decision, not only on the order, because a decision that produced no
    # order still happened in one mode or the other.
    mode: Mapped[str] = mapped_column(String(8), nullable=False)
    venue_id: Mapped[int | None] = mapped_column(
        ForeignKey("trading_venues.id", ondelete="SET NULL"), index=True, nullable=True
    )

    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    model: Mapped[str] = mapped_column(String(200), nullable=False)

    # engines.signals.MarketFeatures.canonical()
    features: Mapped[dict] = mapped_column(JSON, nullable=False)
    # engines.signals.FeatureWindows, so a replay recomputes identically even
    # after the household changes its windows.
    windows: Mapped[dict] = mapped_column(JSON, nullable=False)
    # decision.strategy.build_context() -- exactly what was sent.
    context: Mapped[dict] = mapped_column(JSON, nullable=False)
    # The questions as asked, so a replay asks the same ones after the
    # catalogue has moved on.
    questions: Mapped[list] = mapped_column(JSON, nullable=False)
    # {"direction": {...}, "conviction": {...}, "continuation": {...}} -- each
    # entry the answer's canonical() plus `raw`, `latency_ms`, `confidence_bps`.
    answers: Mapped[dict] = mapped_column(JSON, nullable=False)

    reference_price_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # One of DECISION_OUTCOMES.
    outcome: Mapped[str] = mapped_column(String(16), index=True, nullable=False)
    # The rule that ended it, when one did: a prefilter rule, a threshold, a
    # risk rule, or a decision failure cause. Stable identifiers -- the screen
    # groups on them.
    rule: Mapped[str | None] = mapped_column(String(48), nullable=True)
    # The French sentence shown to the household. Built by the engine that
    # refused, never re-worded here.
    message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # engines.trading_risk.RiskVerdict.canonical(), when an order was sized.
    risk_verdict: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # SHA-256 over the canonical features and questions. See the class
    # docstring.
    inputs_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), index=True, nullable=False
    )
