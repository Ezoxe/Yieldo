from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class LlmSettings(Base):
    """One user's optional, self-chosen language model. Design §8.3, phase 4
    plan Task 8.

    **At most one row per user** (`user_id` is `unique`, matching `ApiKey`'s
    `(user_id, provider)` uniqueness one level simpler: there is only ever
    one model, never one per provider) -- and, exactly like `ApiKey`, it
    carries `user_id` because an endpoint URL and a model name are a
    household's own choice typed into Réglages -> Connexions, not a fact
    about the world. CLAUDE.md's isolation rule applies here identically:
    without `user_id`, one user's question could be sent to a model another
    user configured and pays for.

    `endpoint_url` and `model_name` are plain text -- an OpenAI-compatible
    base URL and a model identifier are not secrets, and encrypting them
    would only make Réglages harder to read back for editing. `api_key_encrypted`
    is `app.security.crypto.encrypt_secret()`'s ciphertext, exactly like
    `ApiKey.value`, and for the identical reason: **this column never leaves
    the server** -- decrypted only in-process, by `app.llm.client` making the
    one outbound call it authorises. It is `nullable` because a local
    endpoint (Ollama, LM Studio, llama.cpp, vLLM) needs no key at all; an
    online provider (Gemini, Claude, OpenAI) does.
    """

    __tablename__ = "llm_settings"
    __table_args__ = (UniqueConstraint("user_id", name="uq_llm_settings_user"),)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    endpoint_url: Mapped[str] = mapped_column(String(500), nullable=False)
    model_name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Ciphertext from app.security.crypto.encrypt_secret, or None for a
    # provider that needs no key -- never plaintext, never logged, never
    # echoed in a response.
    api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC), nullable=False,
    )
