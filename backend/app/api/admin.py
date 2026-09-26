"""The installation's own settings, which only its administrator changes.

A session and the `admin` role, both: an agent key never administers the
installation, whoever it belongs to (`deps.require_session_admin`).
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import InstanceSettings, User
from app.schemas.admin import InstanceSettingsOut, InstanceSettingsPatch
from app.security.deps import require_session_admin

router = APIRouter(prefix="/admin", tags=["admin"])

_ROW_ID = 1


def registration_open(db: Session) -> bool:
    """Whether a new household may create an account. The first account always
    may; that is decided by the caller, which knows whether any user exists."""
    row = db.get(InstanceSettings, _ROW_ID)
    if row is None or row.registration_open is None:
        return settings.registration_open
    return row.registration_open


def _out(db: Session) -> InstanceSettingsOut:
    row = db.get(InstanceSettings, _ROW_ID)
    decided = row is not None and row.registration_open is not None
    return InstanceSettingsOut(
        registration_open=registration_open(db),
        source="instance" if decided else "environment",
    )


@router.get("/settings", response_model=InstanceSettingsOut)
def read_settings(
    _: User = Depends(require_session_admin), db: Session = Depends(get_db)
) -> InstanceSettingsOut:
    return _out(db)


@router.patch("/settings", response_model=InstanceSettingsOut)
def update_settings(
    payload: InstanceSettingsPatch,
    _: User = Depends(require_session_admin),
    db: Session = Depends(get_db),
) -> InstanceSettingsOut:
    row = db.get(InstanceSettings, _ROW_ID)
    if row is None:
        row = InstanceSettings(id=_ROW_ID)
        db.add(row)
    row.registration_open = payload.registration_open
    row.updated_at = datetime.now(UTC)
    db.commit()
    return _out(db)
