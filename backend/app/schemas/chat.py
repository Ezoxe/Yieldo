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


class ChatMessageOut(BaseModel):
    id: int
    text: str
    created_at: datetime
    answer: ChatAnswerOut
