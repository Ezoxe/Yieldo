from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# Task 5's five providers. Finnhub and Alpha Vantage price equities;
# CoinGecko prices crypto; Frankfurter and ExchangeRate-API convert currency.
MARKET_PROVIDERS = ("finnhub", "alpha_vantage", "coingecko", "frankfurter", "exchangerate_api")


class ApiKey(Base):
    """One provider credential, encrypted at rest.

    **Carries `user_id`, unlike `Instrument` and `PricePoint`.** Those two
    stay unscoped because a ticker and its close are facts about the world,
    the same for every user; a provider key is not a fact about the world,
    it is a secret one particular user typed into Réglages -> Connexions
    (design §9, "Keys are entered by the user"). CLAUDE.md's isolation rule
    -- "every query on a business table filters on `user_id`" -- applies to
    this table exactly as it does to every other business table: without
    `user_id`, one user's request could spend a quota bought against, and
    make outbound calls authenticated with, a key another user entered and
    never agreed to share. That is the same isolation hole phase 2A's
    whole-branch review found in `api/cashflow.py`, caught here before it
    had a chance to exist. `QuotaWindow` makes the same correction for the
    same reason -- see its docstring.

    `value` is `app.security.crypto.encrypt_secret()`'s ciphertext (Fernet,
    keyed off `settings.secret_key`) -- opaque without it. **This column
    never leaves the server**: it is decrypted only in-process, by the
    market client (Task 4/5) making the one outbound call it authorises, and
    `GET /api/connections` (Task 6) returns whether a key is set and when it
    was last used, never `value` itself, encrypted or not.

    Unique on `(user_id, provider)`: at most one key per provider per user,
    matching exactly one `QuotaWindow` row per `(user_id, provider)`.
    """

    __tablename__ = "api_keys"
    __table_args__ = (UniqueConstraint("user_id", "provider", name="uq_api_key_user_provider"),)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # One of MARKET_PROVIDERS.
    provider: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    # Ciphertext from app.security.crypto.encrypt_secret -- never plaintext,
    # never logged, never echoed in a response.
    value: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
