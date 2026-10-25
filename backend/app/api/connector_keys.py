"""GET/POST/DELETE /api/connector-key — the key EZLink's Yieldo agent holds.

`get_session_user` throughout: a key that could mint or read keys would be a
key that outlives its own revocation.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.connector.catalog import CATALOG
from app.db import get_db
from app.models import ConnectorAction, ConnectorKey, User
from app.security import connector_keys
from app.security.deps import get_session_user

router = APIRouter(prefix="/connector-key", tags=["connector"])


class ConnectorKeyStatusOut(BaseModel):
    """Whether a key exists, never the key: it is shown once, at creation."""

    exists: bool
    created_at: datetime | None
    last_used_at: datetime | None


class ConnectorActionOut(BaseModel):
    id: int
    tool: str
    title: str
    tier: str
    approval_id: str | None
    status_code: int
    created_at: datetime


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


@router.get("/actions", response_model=list[ConnectorActionOut])
def list_actions(
    limit: int = Query(30, ge=1, le=200),
    user: User = Depends(get_session_user),
    db: Session = Depends(get_db),
) -> list[ConnectorActionOut]:
    """« Ce que Claude a fait » : the latest writes the connector made or tried."""
    rows = (
        db.query(ConnectorAction)
        .filter(ConnectorAction.user_id == user.id)
        .order_by(ConnectorAction.created_at.desc(), ConnectorAction.id.desc())
        .limit(limit)
        .all()
    )
    out = []
    for row in rows:
        tool = CATALOG.get(row.tool)
        out.append(ConnectorActionOut(
            id=row.id, tool=row.tool,
            title=tool.title if tool else row.tool,
            tier=tool.tier if tool else "write",
            approval_id=row.approval_id, status_code=row.status_code, created_at=row.created_at,
        ))
    return out
