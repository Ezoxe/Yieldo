from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# What a proposal would do. One kind per write the agent is allowed to
# suggest; there is no generic "other", because a change nobody wrote an
# applier for is a change nobody can review either.
PROPOSAL_KINDS = (
    "recategorize",
    "category_rule",
    "plan_line",
    "alert_note",
    "category_budget",
    "goal",
    "debt_strategy",
)

# `pending` until a human decides. `applied` and `refused` are both final; a
# refused proposal keeps its row and its reason rather than vanishing, so the
# same suggestion coming back a third time is visible as such.
PROPOSAL_STATES = ("pending", "applied", "refused")


class AgentProposal(Base):
    """A change the model wants to make, which no code will make without a
    human saying yes.

    **Nothing in this table has happened.** The agent's write tools do not
    write: they append a row here and return "proposé" to the model. The only
    code that turns one of these into real data is
    `app/api/proposals.apply_proposal`, and it does so through the same service
    functions the ordinary routes use — never raw SQL, so a proposal cannot
    reach a state the application's own rules would have refused.

    `payload` is the change, in the shape the applier reads. `summary` is the
    same change in one French sentence, and `evidence` is the engine-computed
    figure that justifies it -- which is the answer to the one hard question
    this feature raises. A model choosing an amount IS the model producing a
    number, which `llm/client.py`'s contract forbids reaching a wire field. The
    resolution is that a model-authored number lives ONLY here, in a pending
    proposal, always displayed beside the real figure in `evidence`, and
    becomes data only by a human approving it. It is a suggestion under review,
    not a measurement.

    `before` is what the change would overwrite, recorded at approval time so
    an applied proposal can be described afterwards in terms of what actually
    changed.
    """

    __tablename__ = "agent_proposals"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # The run that produced it. Nullable so a proposal survives a run being
    # deleted, and because the audit trail is a courtesy to the reviewer, not
    # a foreign key the review depends on.
    run_id: Mapped[int | None] = mapped_column(
        ForeignKey("agent_runs.id", ondelete="SET NULL"), index=True, nullable=True
    )
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    # The engine-computed figure the model was looking at, in French prose.
    # Never optional in spirit: a proposal with nothing behind it is a guess.
    evidence: Mapped[str] = mapped_column(Text, default="", nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    before: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    state: Mapped[str] = mapped_column(
        String(16), default="pending", server_default=text("'pending'"), nullable=False
    )
    # Why it was refused, when it was. French, the household's own words.
    decision_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # What applying it actually did, in French. Written by the applier, not by
    # the model.
    applied_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # How many rows the application touched, for a proposal that touched rows.
    affected: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
