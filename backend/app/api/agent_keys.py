from datetime import datetime

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import AgentKey, User
from app.security import agent_keys
from app.security.deps import get_session_user

router = APIRouter(prefix="/access-key", tags=["access-key"])


class AgentKeyOut(BaseModel):
    """The key, in the clear.

    Yieldo issues this one rather than receiving it, so unlike a provider
    credential it is meant to be read back: an operator who cannot see it
    cannot paste it into their agent. `app/models/agent_key.py` explains what
    makes that safe.
    """

    key: str
    created_at: datetime
    expires_at: datetime
    last_used_at: datetime | None


def _out(key: AgentKey, token: str) -> AgentKeyOut:
    return AgentKeyOut(
        key=token,
        created_at=key.created_at,
        expires_at=key.expires_at,
        last_used_at=key.last_used_at,
    )


def _current_token(key: AgentKey) -> str:
    """Reassemble the token from the row. The secret is decrypted here and
    nowhere else in this module."""
    from app.security.crypto import decrypt_secret

    return f"{agent_keys.PREFIX}_{key.selector}_{decrypt_secret(key.secret_encrypted)}"


@router.get("", response_model=AgentKeyOut)
def read_key(
    user: User = Depends(get_session_user),
    db: Session = Depends(get_db),
) -> AgentKeyOut:
    """The account's current key, issuing one if there is none or the last has
    expired.

    A read is deliberately NOT a rotation. An operator who opens Réglages twice
    must not invalidate the key they pasted into their agent five minutes ago —
    that would make the screen a trap. Rotation is `POST /rotate`, and it is a
    button the operator presses on purpose.
    """
    key = db.query(AgentKey).filter(AgentKey.user_id == user.id).first()

    if key is None or agent_keys.expired(key):
        key, token = agent_keys.issue(db, user.id)
        return _out(key, token)

    return _out(key, _current_token(key))


@router.post("/rotate", response_model=AgentKeyOut)
def rotate_key(
    user: User = Depends(get_session_user),
    db: Session = Depends(get_db),
) -> AgentKeyOut:
    """Issue a new key now, and kill the old one in the same breath.

    The way out of "I pasted it somewhere I should not have". It takes effect
    immediately — the previous key stops authenticating on the next request,
    not at the end of its 24 hours.
    """
    key, token = agent_keys.issue(db, user.id)
    return _out(key, token)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def revoke_key(
    user: User = Depends(get_session_user),
    db: Session = Depends(get_db),
) -> None:
    """Remove the key entirely: no program can drive this account until the
    operator asks for another one."""
    db.query(AgentKey).filter(AgentKey.user_id == user.id).delete()
    db.commit()
