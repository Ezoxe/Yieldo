from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt

from app.config import settings

_ALGORITHM = "HS256"


class TokenError(Exception):
    """Raised when a token is missing, malformed, expired, or of the wrong type."""


@dataclass(frozen=True)
class TokenClaims:
    user_id: int
    # The `User.session_version` the token was issued under. A token minted
    # before versions existed carries none and reads as 0.
    session_version: int


def _create(user_id: int, session_version: int, token_type: str, lifetime: timedelta) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "type": token_type,
        "sv": session_version,
        "iat": int(now.timestamp()),
        "exp": int((now + lifetime).timestamp()),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=_ALGORITHM)


def create_access_token(user_id: int, session_version: int = 0) -> str:
    return _create(user_id, session_version, "access",
                   timedelta(minutes=settings.access_token_minutes))


def create_refresh_token(user_id: int, session_version: int = 0) -> str:
    return _create(user_id, session_version, "refresh",
                   timedelta(days=settings.refresh_token_days))


def decode_claims(token: str, expected_type: str) -> TokenClaims:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise TokenError("Jeton invalide ou expiré") from exc
    if payload.get("type") != expected_type:
        raise TokenError("Type de jeton inattendu")
    try:
        user_id = int(payload["sub"])
    except (KeyError, TypeError, ValueError) as exc:
        raise TokenError("Jeton sans identifiant utilisateur exploitable") from exc
    version = payload.get("sv", 0)
    # `bool` is an `int` to Python; a token claiming `"sv": true` is not one
    # this code wrote.
    if not isinstance(version, int) or isinstance(version, bool):
        raise TokenError("Jeton sans version de session exploitable")
    return TokenClaims(user_id=user_id, session_version=version)


def decode_token(token: str, expected_type: str) -> int:
    """The user id alone, for callers that do not check the session version."""
    return decode_claims(token, expected_type).user_id
