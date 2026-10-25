"""GET/POST/DELETE /api/connector-key — the key EZLink's Yieldo agent holds.

`get_session_user` throughout: a key that could mint or read keys would be a
key that outlives its own revocation.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import ConnectorKey, User
from app.security import connector_keys
from app.security.deps import get_session_user

router = APIRouter(prefix="/connector-key", tags=["connector"])


class ConnectorKeyStatusOut(BaseModel):
    """Whether a key exists, never the key: it is shown once, at creation."""

    exists: bool
    created_at: datetime | None
    last_used_at: datetime | None


class ConnectorKeyCreatedOut(BaseModel):
    key: str
    created_at: datetime


@router.get("", response_model=ConnectorKeyStatusOut)
def read_status(
    user: User = Depends(get_session_user), db: Session = Depends(get_db)
) -> ConnectorKeyStatusOut:
    key = db.query(ConnectorKey).filter(ConnectorKey.user_id == user.id).first()
    if key is None:
        return ConnectorKeyStatusOut(exists=False, created_at=None, last_used_at=None)
    return ConnectorKeyStatusOut(
        exists=True, created_at=key.created_at, last_used_at=key.last_used_at
    )


@router.post("", response_model=ConnectorKeyCreatedOut, status_code=status.HTTP_201_CREATED)
def create_key(
    user: User = Depends(get_session_user), db: Session = Depends(get_db)
) -> ConnectorKeyCreatedOut:
    """Issue a key, replacing the previous one in the same breath: the old
    token stops authenticating on the next request."""
    key, token = connector_keys.issue(db, user.id)
    return ConnectorKeyCreatedOut(key=token, created_at=key.created_at)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def revoke_key(user: User = Depends(get_session_user), db: Session = Depends(get_db)) -> None:
    db.query(ConnectorKey).filter(ConnectorKey.user_id == user.id).delete()
    db.commit()
