from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from datetime import UTC, datetime

from app.db import get_db
from app.models import User
from app.security import agent_keys
from app.security.tokens import TokenError, decode_token


def _unauthorized() -> HTTPException:
    """A fresh exception per call -- a shared instance would have its __cause__
    rewritten by concurrent requests."""
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentification requise",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _expired_key() -> HTTPException:
    """Named, not merged into `_unauthorized`: an agent that is told only
    "authentification requise" has no way to know its key simply ran out, and
    the operator gets a bug report instead of opening Réglages."""
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Clé d'accès expirée — la nouvelle est dans Réglages, elle change toutes les 24 h",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _bearer(request: Request) -> str:
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise _unauthorized()
    return token


def _session_user(token: str, db: Session) -> User:
    try:
        user_id = decode_token(token, expected_type="access")
    except TokenError as exc:
        raise _unauthorized() from exc
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise _unauthorized()
    return user


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """The account behind the request, however it proved itself.

    Two credentials reach this: the browser's short-lived JWT, and the agent
    access key an operator pastes into a program (see
    `app/security/agent_keys.py`). They are told apart by the token's own
    prefix rather than by a second header, so every existing client keeps
    working and an agent needs nothing but `Authorization: Bearer <clé>`.

    Both resolve to the same `User`, with the same rights over the same data.
    The routes that must NOT accept a key — the ones that change the account's
    own credentials — take `get_session_user` below instead.
    """
    token = _bearer(request)

    if agent_keys.looks_like_agent_key(token):
        key = agent_keys.find(db, token)
        if key is None:
            raise _unauthorized()
        if agent_keys.expired(key):
            raise _expired_key()
        user = db.get(User, key.user_id)
        if user is None or not user.is_active:
            raise _unauthorized()
        # Last, and only on success: a failed attempt is not a use, and
        # recording one would let anyone holding a selector keep the row
        # looking alive.
        key.last_used_at = datetime.now(UTC)
        db.commit()
        return user

    return _session_user(token, db)


def get_session_user(request: Request, db: Session = Depends(get_db)) -> User:
    """The account behind the request, proved by a SESSION and nothing else.

    The boundary the agent key stops at. A key opens the ledger; it does not
    open the account. An agent that could change the password could lock its
    owner out of their own finances, one that could change the email could
    move the account somewhere they cannot sign in to, one that could rotate
    the key could grant itself a longer life than the 24 hours this design
    promises, and one that could read Réglages -> Connexions could walk off
    with credentials to services outside this machine.

    Those five routes take this instead. Everything else — every figure, every
    import, every correction — takes `get_current_user`.
    """
    token = _bearer(request)
    if agent_keys.looks_like_agent_key(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Cette opération demande une session : une clé d'accès ne peut pas la faire",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _session_user(token, db)


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Droits administrateur requis")
    return user
