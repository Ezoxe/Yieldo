"""Wire shapes for `/api/assistant/llm` and `/api/assistant/llm-settings`.
Design §8.3, phase 4 plan Task 8.

**`LlmSettingsOut` has no field that could ever carry a key**, encrypted or
not -- the same shape discipline `schemas/connections.py`'s `ConnectionOut`
already established for the five market providers. `LlmSettingsIn` is the
only schema in this module that ever carries a plaintext key, and it is a
REQUEST schema: it is never returned in a response body.
"""

from pydantic import BaseModel, Field

from app.schemas.chat import ChatAnswerOut


class LlmSettingsIn(BaseModel):
    endpoint_url: str = Field(min_length=1, max_length=500)
    model_name: str = Field(min_length=1, max_length=200)
    # None (or omitted) leaves any previously stored key untouched when a
    # local endpoint that never had one is being configured for the first
    # time; an empty string is not accepted here on purpose -- clearing a
    # key is `DELETE /api/assistant/llm-settings`'s job, an explicit action
    # rather than a side effect of an empty form field.
    api_key: str | None = None


class LlmSettingsOut(BaseModel):
    configured: bool
    endpoint_url: str | None
    model_name: str | None
    has_key: bool


class AssistantLlmQueryIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)


class AssistantLlmAnswerOut(BaseModel):
    """The deterministic answer, unchanged, plus whatever the model added.

    **`engine_answer` is `schemas.chat.ChatAnswerOut`, verbatim** -- the same
    shape `/api/chat` already returns, assembled by the same engines. Every
    numeric field on this whole response comes from `engine_answer`; `commentary`
    is free text and, when present, is the ONLY field the model's own reply
    ever populates. `degraded_reason` is set, in French, exactly when
    `commentary` is `None`: disabled, an unreachable endpoint, a rejected
    key or a timeout are four different causes and never share one sentence.
    """

    engine_answer: ChatAnswerOut
    commentary: str | None
    degraded_reason: str | None
