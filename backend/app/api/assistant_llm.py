"""`/api/assistant/llm-settings` and `POST /api/assistant/llm`. Design §8.3,
phase 4 plan Task 8.

**Storing, reading and deleting the model configuration** follows
`api/connections.py`'s own shape: reading never returns the key, only
whether one is set; deleting removes it outright. Unlike a market provider
there is nothing to validate with an immediate call here -- an endpoint URL
and a model name are not proven wrong until they are actually asked a
question, and `POST /api/assistant/llm` is where that happens, not the
settings form.

**`POST /api/assistant/llm` runs the IDENTICAL deterministic pipeline
`/api/chat` runs** -- `app.api.chat._build_context` and `._compute_answer`,
reused rather than re-derived, so the two routes can never disagree about
what a question means or what it computes. The model, when one is
configured, is handed that SAME answer and asked to comment; see
`app.llm.client`'s module docstring for the contract this whole feature
exists to keep: the model never calculates, and nothing it writes ever
reaches a numeric wire field.

**An unrecognised question is never sent to the model.** `ChatAnswerOut
.recognised is False` means there is no engine figure to hand it -- only the
formulations the parser understands -- and asking a model to comment on
"I did not understand this" invites it to guess at what was meant, which is
exactly the fabricated-answer failure design §8.1 forbids for the
deterministic assistant itself. The unrecognised answer is returned as-is,
`commentary` and `degraded_reason` both `None`.

Every query below filters on `user_id`, via `get_current_user` for
`LlmSettings` and via the same context-building helpers `/api/chat` already
uses for the ledger.
"""

from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.chat import _build_context, _compute_answer
from app.db import get_db
from app.llm.client import (
    LlmError,
    LlmFailureCause,
    LlmSettingsInput,
    build_commentary_prompt,
    failure_message,
    request_commentary,
)
from app.models import LlmSettings, User
from app.schemas.assistant_llm import (
    AssistantLlmAnswerOut,
    AssistantLlmQueryIn,
    LlmSettingsIn,
    LlmSettingsOut,
)
from app.security.crypto import decrypt_secret, encrypt_secret
from app.security.deps import get_current_user

router = APIRouter(prefix="/assistant", tags=["assistant"])


def _fetch_settings(db: Session, user_id: int) -> LlmSettings | None:
    return db.query(LlmSettings).filter(LlmSettings.user_id == user_id).first()


def _settings_out(row: LlmSettings | None) -> LlmSettingsOut:
    if row is None:
        return LlmSettingsOut(
            configured=False, endpoint_url=None, model_name=None, has_key=False
        )
    return LlmSettingsOut(
        configured=True, endpoint_url=row.endpoint_url, model_name=row.model_name,
        has_key=row.api_key_encrypted is not None,
    )


@router.get("/llm-settings", response_model=LlmSettingsOut)
def get_llm_settings(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> LlmSettingsOut:
    return _settings_out(_fetch_settings(db, user.id))


@router.put("/llm-settings", response_model=LlmSettingsOut)
def set_llm_settings(
    payload: LlmSettingsIn,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
) -> LlmSettingsOut:
    row = _fetch_settings(db, user.id)
    ciphertext = None if payload.api_key is None else encrypt_secret(payload.api_key)
    if row is None:
        row = LlmSettings(
            user_id=user.id, endpoint_url=payload.endpoint_url,
            model_name=payload.model_name, api_key_encrypted=ciphertext,
        )
        db.add(row)
    else:
        row.endpoint_url = payload.endpoint_url
        row.model_name = payload.model_name
        # `payload.api_key is None` means the form field was left untouched
        # -- see `LlmSettingsIn`'s own docstring -- so an existing key
        # survives a plain URL or model-name edit rather than being wiped
        # by omission.
        if payload.api_key is not None:
            row.api_key_encrypted = ciphertext
    db.commit()
    db.refresh(row)
    return _settings_out(row)


@router.delete("/llm-settings", response_model=LlmSettingsOut)
def delete_llm_settings(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> LlmSettingsOut:
    row = _fetch_settings(db, user.id)
    if row is not None:
        db.delete(row)
        db.commit()
    return LlmSettingsOut(configured=False, endpoint_url=None, model_name=None, has_key=False)


def _comment(
    settings_row: LlmSettings, query_description: str, answer_text: str,
    amount_cents: int | None,
) -> tuple[str | None, str | None]:
    """`(commentary, degraded_reason)` -- always exactly one of the two."""
    settings = LlmSettingsInput(
        endpoint_url=settings_row.endpoint_url, model_name=settings_row.model_name,
        api_key=(
            None if settings_row.api_key_encrypted is None
            else decrypt_secret(settings_row.api_key_encrypted)
        ),
    )
    prompt = build_commentary_prompt(query_description, answer_text, amount_cents)
    try:
        commentary = request_commentary(settings, prompt)
    except LlmError as exc:
        return None, exc.message
    return commentary, None


@router.post("/llm", response_model=AssistantLlmAnswerOut)
def ask_with_commentary(
    payload: AssistantLlmQueryIn,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
) -> AssistantLlmAnswerOut:
    today = date.today()
    ctx = _build_context(db, user, today)
    engine_answer = _compute_answer(payload.text, ctx, today)

    if not engine_answer.recognised:
        # Nothing for a model to comment on -- see the module docstring.
        return AssistantLlmAnswerOut(
            engine_answer=engine_answer, commentary=None, degraded_reason=None
        )

    settings_row = _fetch_settings(db, user.id)
    if settings_row is None:
        return AssistantLlmAnswerOut(
            engine_answer=engine_answer, commentary=None,
            degraded_reason=failure_message(LlmFailureCause.NOT_CONFIGURED),
        )

    commentary, degraded_reason = _comment(
        settings_row, engine_answer.query_description or payload.text,
        engine_answer.text, engine_answer.amount_cents,
    )
    return AssistantLlmAnswerOut(
        engine_answer=engine_answer, commentary=commentary, degraded_reason=degraded_reason
    )
