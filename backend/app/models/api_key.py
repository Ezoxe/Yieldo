from datetime import UTC, datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# Task 5's five providers. Finnhub and Alpha Vantage price equities;
# CoinGecko prices crypto; Frankfurter and ExchangeRate-API convert currency.
MARKET_PROVIDERS = ("finnhub", "alpha_vantage", "coingecko", "frankfurter", "exchangerate_api")


class ApiKey(Base):
    """One provider credential for this self-hosted installation, encrypted
    at rest.

    **No `user_id`.** Design's "persistent quota pool" (plan, Lot B) is only
    a pool because every route, every user, draws down the SAME counter
    behind the SAME key -- "Keys are entered by the operator in Réglages ->
    Connexions after installation" (plan, global constraints) describes ONE
    key per provider for the whole install, not one per `User`. Scoping this
    table by `user_id` would give each user an independent quota, which
    contradicts the very idea of a shared pool. `QuotaWindow` makes the same
    choice for the same reason -- see its docstring.

    `value` is `app.security.crypto.encrypt_secret()`'s ciphertext (Fernet,
    keyed off `settings.secret_key`) -- opaque without it. **This column
    never leaves the server**: it is decrypted only in-process, by the
    market client (Task 4/5) making the one outbound call it authorises, and
    `GET /api/connections` (Task 6) returns whether a key is set and when it
    was last used, never `value` itself, encrypted or not.

    Unique on `provider`: at most one key per provider, matching exactly one
    `QuotaWindow` row per provider.
    """

    __tablename__ = "api_keys"

    # One of MARKET_PROVIDERS.
    provider: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    # Ciphertext from app.security.crypto.encrypt_secret -- never plaintext,
    # never logged, never echoed in a response.
    value: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
