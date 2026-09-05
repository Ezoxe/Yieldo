from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# How a run ended. `answered` is the model reaching a final reply inside its
# budget; `exhausted` is it running out of steps still calling tools;
# `failed` is the endpoint itself (unreachable, timed out, key rejected).
# Kept apart because each names a different remedy — nothing here ever
# collapses into a single "error".
AGENT_RUN_STATES = ("running", "answered", "exhausted", "failed")

# What one step of the loop was. `tool_call` and `tool_result` are recorded
# separately on purpose: the trace has to be able to show what was asked for
# even when the answer to it was an error.
AGENT_STEP_KINDS = ("thought", "tool_call", "tool_result", "answer", "failure")


class AgentRun(Base):
    """One question put to the model as an agent, and everything it did about it.

    **The run is the audit trail, not a cache.** A proposal points back at the
    run that produced it, so a household approving a change can read the exact
    sequence of reads the model made before proposing it. That is the only
    reason to trust a proposal at all, and it is why the steps are persisted
    rather than streamed and forgotten.

    `state` is never a single "error": see `AGENT_RUN_STATES`.
    """

    __tablename__ = "agent_runs"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    question: Mapped[str] = mapped_column(String(2000), nullable=False)
    state: Mapped[str] = mapped_column(
        String(16), default="running", server_default=text("'running'"), nullable=False
    )
    # The model's final reply, or None while it is still running / if it never
    # reached one. Prose only — nothing downstream reads a number out of it.
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    # A French sentence naming what went wrong, for `failed` and `exhausted`.
    notice: Mapped[str | None] = mapped_column(Text, nullable=True)
    steps_used: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AgentStep(Base):
    """One entry in a run's trace, in the order it happened.

    `payload` is JSON, and what it holds depends on `kind`: the arguments for a
    `tool_call`, a short French summary of what came back for a `tool_result`.
    It is never rendered as a figure — a tool result reaching a screen goes
    through the same engines every other figure does.
    """

    __tablename__ = "agent_steps"

    run_id: Mapped[int] = mapped_column(
        ForeignKey("agent_runs.id", ondelete="CASCADE"), index=True, nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    # The tool's name for a call or a result, empty otherwise.
    name: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    # One French sentence: what this step was, in the household's language.
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
