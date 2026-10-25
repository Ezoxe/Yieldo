"""Minting and verifying the connector key (`ycn_<selector>_<secret>`).

Same shape as `security/agent_keys.py` -- a public selector for an indexed
lookup and a secret compared in constant time -- with one difference: the
secret is hashed rather than encrypted, because it is never shown twice (see
`models/connector_key.py`).
"""

import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models import ConnectorKey

PREFIX = "ycn"

# Hex for the same reason as the agent key: "_" is the token's separator.
_SELECTOR_BYTES = 6
_SECRET_BYTES = 32


@dataclass(frozen=True)
class ParsedKey:
    selector: str
    secret: str


def digest(secret: str) -> str:
    return hashlib.sha256(secret.encode("ascii")).hexdigest()


def mint() -> tuple[str, str, str]:
    """`(token, selector, secret)` for a fresh key."""
    selector = secrets.token_hex(_SELECTOR_BYTES)
    secret = secrets.token_hex(_SECRET_BYTES)
    return f"{PREFIX}_{selector}_{secret}", selector, secret


def looks_like_connector_key(token: str) -> bool:
    return token.startswith(f"{PREFIX}_")


def parse(token: str) -> ParsedKey | None:
    parts = token.split("_")
    if len(parts) != 3 or parts[0] != PREFIX or not parts[1] or not parts[2]:
        return None
    try:
        parts[2].encode("ascii")
    except UnicodeEncodeError:
        return None
    return ParsedKey(selector=parts[1], secret=parts[2])


def issue(db: Session, user_id: int, *, now: datetime | None = None) -> tuple[ConnectorKey, str]:
    """Replace this account's key with a new one; the token exists in the
    clear only in the return value."""
    token, selector, secret = mint()
    db.query(ConnectorKey).filter(ConnectorKey.user_id == user_id).delete()
    key = ConnectorKey(
        user_id=user_id,
        selector=selector,
        secret_hash=digest(secret),
        created_at=now or datetime.now(UTC),
    )
    db.add(key)
    db.commit()
    db.refresh(key)
    return key, token


def find(db: Session, token: str) -> ConnectorKey | None:
    parsed = parse(token)
    if parsed is None:
        return None
    key = db.query(ConnectorKey).filter(ConnectorKey.selector == parsed.selector).first()
    if key is None or not secrets.compare_digest(key.secret_hash, digest(parsed.secret)):
        return None
    return key
