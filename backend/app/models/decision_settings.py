from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class DecisionSettings(Base):
    """Which decision model answers, and how it is reached.

    One row per user, like `LlmSettings` -- and deliberately NOT the same row.
    The two models do different jobs and a household will often want different
    ones: `LlmSettings` is a conversational model that writes French prose
    about a budget, this is a System One model that returns a typed decision in
    tens of milliseconds and never writes a sentence. Folding them together
    would force one endpoint to serve both, which is exactly the compromise
    this design exists to avoid.

    `provider` is one of `decision/contract.PROVIDERS`. `api_key_encrypted` is
    `security/crypto.encrypt_secret()` ciphertext and **never leaves the
    server** -- decrypted only in `decision/registry.build_provider`, for the
    one outbound call it authorises. `endpoint_url` and `model_name` are plain
    text for the reason `LlmSettings` gives: a base URL and a model identifier
    are not secrets, and encrypting them would only make the screen unable to
    show back what was typed.

    `timeout_ms`, not seconds. A conversational model is given two minutes
    (`config.llm_timeout_seconds`); a decision model that has not answered in
    two SECONDS has already failed at the thing it was chosen for, and
    expressing its budget in seconds would invite a value three orders of
    magnitude too large.
    """

    __tablename__ = "decision_settings"
    __table_args__ = (UniqueConstraint("user_id", name="uq_decision_settings_user"),)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # One of app.decision.contract.PROVIDERS.
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    # None for `replay`, which reaches nothing, and for `jev`, which has a
    # documented default endpoint.
    endpoint_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    model_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    timeout_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Les poids du modèle appris (`engines/logistic.LearnedModel.canonical`),
    # quand le foyer en a entraîné un. NULL pour tous les autres fournisseurs.
    learned_model: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC), nullable=False,
    )
