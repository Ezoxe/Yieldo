from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ChatMessage(Base):
    """One question asked of the deterministic chat. Design §8.1.

    **`text` holds the QUESTION, never the computed answer** -- the identical
    contract `models.Scenario` documents for a saved feasibility scenario, and
    for the same reason: a figure the assistant computed last winter must not
    read as though it were current when the history is reopened months later.
    `GET /api/chat` re-parses and re-executes every stored row's `text`
    against the ledger as it stands today, every time it is read.
    """

    __tablename__ = "chat_messages"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Which thread this question belongs to. A plain integer, scoped to the
    # user, and NOT a foreign key to a `conversations` table -- because there
    # is nothing such a table would hold. A conversation is exactly "the
    # messages that share this number": its start, its end, its length and its
    # title are all READ from those messages, so a row carrying them would be
    # a second copy of facts the messages already state, free to drift from
    # them. The same reasoning `design/ai/targets.categoryTargetId` gives for
    # deriving an id both sides can compute rather than storing one they must
    # agree on.
    #
    # It follows that an empty conversation does not exist, and does not need
    # to: "Nouvelle conversation" is a client-side state until the first
    # question lands, and a thread nobody asked anything in is not a thread.
    conversation_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # The model's run, when the parser did not recognise the question and a
    # model was configured to take it instead.
    #
    # This is the ONE thing about a chat message that is not re-executed on
    # read, and the exception is deliberate. Re-running a language model on
    # every GET would mean a model call per message per page load, and — worse
    # — the same question would come back differently every time the history
    # was reopened, which is the opposite of the staleness contract above. The
    # run holds what the model actually said, when it said it, and every FIGURE
    # inside it still came from an engine through a read tool: see
    # `llm/tools.py`. `SET NULL`, not `CASCADE`: a deleted run must not take
    # the household's question with it.
    agent_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("agent_runs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
