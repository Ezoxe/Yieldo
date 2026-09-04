from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class AgentKey(Base):
    """The rotating credential a program uses to drive Yieldo on the user's behalf.

    **Encrypted, not hashed** -- and that is the one decision in this file worth
    reading twice. `ApiKey` beside it holds credentials the USER typed in, which
    Yieldo only ever needs to send somewhere; those are written once and never
    read back, and hashing would do just as well if they did not have to be
    replayed. This key runs the other way: Yieldo issues it, and the operator
    has to be able to look at it to paste it into their agent. A hash cannot be
    shown. So the secret is stored as `app.security.crypto.encrypt_secret()`
    ciphertext, keyed off `settings.secret_key`, which is not in the database --
    a stolen `yieldo.db` yields nothing here without the deployment's own secret.

    What makes that trade acceptable is the rest of the row: `expires_at` is
    twenty-four hours out, one key exists per user at a time, and
    `app/api/agent_keys.py` refuses to let the key rotate or read itself.

    **`selector` is public, `secret_encrypted` is not.** The token on the wire is
    `yld_<selector>_<secret>`: the selector is an indexed lookup, so verifying a
    key is one indexed read rather than a decrypt of every row in the table, and
    the secret is compared with `secrets.compare_digest`. Splitting the two is
    what keeps the comparison constant-time AND the lookup cheap; a single
    opaque token would have forced a choice between them.

    One row per user: `user_id` is unique. Rotating replaces the row rather than
    appending to it, so "the current key" is never a question of which of
    several is newest.
    """

    __tablename__ = "agent_keys"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True, nullable=False
    )
    # Public half of the token: identifies the row, proves nothing.
    selector: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    # Fernet ciphertext of the secret half. Never plaintext, never logged.
    secret_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    # The whole point of the feature. Past this instant the key authenticates
    # nothing, and the next look at Réglages issues its replacement.
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
