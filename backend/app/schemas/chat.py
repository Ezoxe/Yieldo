"""Wire shapes for /api/chat.

`ChatMessageOut.answer` is always freshly computed, never read off a stored
column -- `models.ChatMessage` holds only the question, and `GET /api/chat`
re-parses and re-executes every row's `text` against the CURRENT ledger on
every read. See that model's own docstring for why.
"""

from datetime import datetime

from pydantic import BaseModel, Field


class ChatMessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    # Which thread to continue. **None means "open a new one"**, never "guess
    # which thread this belongs to": a client that lost track must not silently
    # append to a conversation the reader believed was closed. An id naming a
    # conversation this account does not have is a 404, not a new thread --
    # `conversation_id` is the one field on this API that names a row by
    # number, so it is the one place isolation could be lost.
    conversation_id: int | None = Field(default=None, ge=1)


class ChatChartPointOut(BaseModel):
    label: str
    amount_cents: int


class ChatChartOut(BaseModel):
    """The decomposition of the figure the answer quotes, when it has one.

    `null` on `ChatAnswerOut.chart` is a designed state, not a missing value:
    a refusal has no figure to decompose, and several intents answer with
    something a chart could only decorate. See `engines/answer.AnswerChart`.
    """

    kind: str
    title: str
    points: list[ChatChartPointOut]


class ChatStepOut(BaseModel):
    """One step of what was actually executed to reach the figure.

    Produced by `engines/answer.trace_query`, never assembled here: the front
    end animates the reveal, and an animation over a list this router had
    invented would be exactly the theatre design forbids.
    """

    tool: str
    label: str
    source: str
    #: The route showing the same data, or null when nothing on screen does.
    screen: str | None


class ChatAnswerOut(BaseModel):
    # False when the question could not be parsed at all -- `query_description`
    # and `amount_cents` are then both empty/null, and `text` carries the
    # French refusal plus `supported_formulations`.
    recognised: bool
    query_description: str | None
    text: str
    amount_cents: int | None
    is_refusal: bool
    supported_formulations: list[str] | None
    chart: ChatChartOut | None
    # Never empty: even a question that could not be parsed was READ, and the
    # reading is a step. See `engines/answer.AnswerStep`.
    steps: list[ChatStepOut]


class ConversationOut(BaseModel):
    """One thread, summarised from its own messages.

    Every field here is READ from the messages that share `id` -- nothing is
    stored alongside them. See `models.ChatMessage.conversation_id`.
    """

    id: int
    #: The first question asked, which is what a reader recognises a thread by.
    #: Derived, never stored: a stored title is a second copy of that question.
    title: str
    started_at: datetime
    #: The most recent question in the thread — what the list is ordered on.
    last_at: datetime
    message_count: int


class ChatMessageOut(BaseModel):
    id: int
    conversation_id: int
    text: str
    created_at: datetime
    answer: ChatAnswerOut
