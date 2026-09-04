"""Minting, parsing and verifying the agent access key.

Pure of the database on purpose: `mint`, `parse` and `matches` are functions of
their arguments, so the token format is testable without a session and cannot
drift between the route that issues a key and the dependency that checks one.
The two places a `Session` appears are `issue` and `find`.
"""

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.config import settings
from app.models import AgentKey
from app.security.crypto import SecretDecryptionError, decrypt_secret, encrypt_secret

# The token's own namespace. It is what tells `get_current_user` that a bearer
# value is an agent key rather than a JWT, without decoding either first.
PREFIX = "yld"

# HEX, not base64url, and that is not a style choice: `secrets.token_urlsafe`
# draws from an alphabet that includes "_", which is also this token's own
# separator — a secret containing one split into four parts and never
# authenticated. Hex costs a third more characters and cannot collide with the
# separator at all.
#
# The selector only has to be unique among a household's keys; the secret is
# the one that has to resist guessing, and 32 bytes of it is 256 bits.
_SELECTOR_BYTES = 6
_SECRET_BYTES = 32


@dataclass(frozen=True)
class ParsedKey:
    selector: str
    secret: str


def mint() -> tuple[str, str, str]:
    """A fresh key: the token to show once, and the two halves to store.

    Returns `(token, selector, secret)`. The caller encrypts the secret; this
    function deliberately does not, so a test can read the plaintext it just
    minted without reaching for the deployment's Fernet key.
    """
    selector = secrets.token_hex(_SELECTOR_BYTES)
    secret = secrets.token_hex(_SECRET_BYTES)
    return f"{PREFIX}_{selector}_{secret}", selector, secret


def looks_like_agent_key(token: str) -> bool:
    """Cheap enough to run on every request, and wrong about nothing: a JWT is
    three base64 segments joined by dots and cannot start with this prefix."""
    return token.startswith(f"{PREFIX}_")


def parse(token: str) -> ParsedKey | None:
    """Split a token into its two halves, or None if it is not one.

    `None`, not an exception: a malformed key is an ordinary 401, and the
    dependency that calls this has one refusal path for every reason a key can
    fail. Reporting *which* part was wrong would tell an attacker whether the
    selector they guessed exists.
    """
    parts = token.split("_")
    if len(parts) != 3 or parts[0] != PREFIX:
        return None
    _, selector, secret = parts
    if not selector or not secret:
        return None
    return ParsedKey(selector=selector, secret=secret)


def matches(stored_ciphertext: str, presented_secret: str) -> bool:
    """Constant-time comparison of a presented secret against a stored one.

    `compare_digest` rather than `==`: the two strings are the same length on
    every legitimate call, so a short-circuiting comparison would leak how many
    leading characters a guess got right.

    A ciphertext that cannot be decrypted is a `False`, not a crash: it means
    SECRET_KEY changed under a key issued before it, which makes that key
    unusable — the honest answer to "does this key authenticate" is no.
    """
    try:
        return secrets.compare_digest(decrypt_secret(stored_ciphertext), presented_secret)
    except SecretDecryptionError:
        return False


def lifetime() -> timedelta:
    return timedelta(hours=settings.agent_key_hours)


def issue(db: Session, user_id: int, *, now: datetime | None = None) -> tuple[AgentKey, str]:
    """Replace whatever key this user had with a new one, and return both the
    row and the token — the only moment the token exists in the clear.

    Deletes rather than marking revoked: one row per user is what makes "the
    current key" unambiguous, and a table of dead keys would be a table of
    secrets kept for no reason.
    """
    moment = now or datetime.now(UTC)
    token, selector, secret = mint()

    db.query(AgentKey).filter(AgentKey.user_id == user_id).delete()
    key = AgentKey(
        user_id=user_id,
        selector=selector,
        secret_encrypted=encrypt_secret(secret),
        created_at=moment,
        expires_at=moment + lifetime(),
    )
    db.add(key)
    db.commit()
    db.refresh(key)
    return key, token


def expired(key: AgentKey, *, now: datetime | None = None) -> bool:
    """SQLite hands back naive datetimes even from a `DateTime(timezone=True)`
    column, so the stored instant is reattached to UTC before being compared —
    without it this raises "can't compare offset-naive and offset-aware"."""
    moment = now or datetime.now(UTC)
    stored = key.expires_at
    if stored.tzinfo is None:
        stored = stored.replace(tzinfo=UTC)
    return stored <= moment


def find(db: Session, token: str) -> AgentKey | None:
    """The row a token proves ownership of, expired or not.

    Expiry is deliberately NOT checked here. A caller that cannot tell "this is
    not a key" from "this key ran out" cannot say the second thing on screen,
    and "votre clé a expiré, la nouvelle est dans Réglages" is the whole
    difference between a feature an operator can use and one they file a bug
    against. It leaks nothing: reaching this point already required the secret.
    """
    parsed = parse(token)
    if parsed is None:
        return None
    key = db.query(AgentKey).filter(AgentKey.selector == parsed.selector).first()
    if key is None:
        return None
    if not matches(key.secret_encrypted, parsed.secret):
        return None
    return key
