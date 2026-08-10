import json
import logging
import secrets
import time
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.importers.dialect import CsvDialect
from app.importers.service import MappingError, build_preview, commit_import, rollback_import
from app.models import Account, ColumnProfile, ImportBatch, User
from app.schemas.imports import BatchOut, CommitIn, PreviewOut, ProfileIn, ProfileOut
from app.security.deps import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/imports", tags=["imports"])

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
UPLOAD_CHUNK_BYTES = 64 * 1024
ALLOWED_SUFFIXES = {".csv", ".txt", ".tsv"}
# A pending upload not committed within this window is considered abandoned.
PENDING_MAX_AGE_SECONDS = 24 * 60 * 60


def _require_account(db: Session, user: User, account_id: int) -> Account:
    account = (
        db.query(Account)
        .filter(Account.id == account_id, Account.user_id == user.id)
        .first()
    )
    if account is None:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    return account


def _pending_dir(user_id: int) -> Path:
    """Where this user's not-yet-committed uploads live. Derived from the
    authenticated user, never from client input."""
    directory = settings.uploads_dir / "pending" / str(user_id)
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _archive_dir(user_id: int) -> Path:
    """Where a user's committed batches are archived. Outside the pending
    tree, so no upload token -- however crafted -- can ever resolve here."""
    directory = settings.uploads_dir / "archive" / str(user_id)
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _upload_path(user_id: int, token: str) -> Path:
    """Resolve a token inside this user's pending directory, and nowhere else.

    The user segment comes from the session, so a token cannot reach another
    user's uploads however it is crafted. The containment check then catches
    traversal within the segment itself.
    """
    if not token or "\x00" in token:
        raise HTTPException(status_code=400, detail="Jeton de téléversement invalide")
    base = _pending_dir(user_id).resolve()
    candidate = (base / token).resolve()
    if candidate.parent != base:
        raise HTTPException(status_code=400, detail="Jeton de téléversement invalide")
    return candidate


def _clean_filename(name: str | None) -> str:
    """A friendly display name for the batch. Never used to build a path --
    the pending/archive filenames are always a random token or a batch id."""
    cleaned = Path(name or "").name.strip()
    return cleaned[:255] or "import.csv"


def _purge_stale_pending_uploads() -> None:
    """Delete pending uploads older than 24h.

    There is no scheduler in this deployment, so this runs opportunistically at
    the start of `analyze`: any active user's request is enough to keep the
    directory from growing forever. A delete failure must not fail the
    request that triggered the sweep, but it must not vanish silently either.
    """
    pending_root = settings.uploads_dir / "pending"
    if not pending_root.is_dir():
        return
    cutoff = time.time() - PENDING_MAX_AGE_SECONDS
    removed = 0
    for path in pending_root.rglob("*"):
        if not path.is_file():
            continue
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
                removed += 1
        except OSError as exc:
            logger.warning("Failed to purge stale upload %s: %s", path, exc)
    if removed:
        logger.debug("Purged %d stale pending upload(s)", removed)


def _int_keys(mapping: dict[str, str]) -> dict[int, str]:
    try:
        return {int(k): v for k, v in mapping.items()}
    except ValueError as exc:
        raise HTTPException(status_code=422,
                            detail="Index de colonne invalide dans le mapping") from exc


@router.post("/analyze", response_model=PreviewOut)
async def analyze(
    file: UploadFile = File(...),
    account_id: int = Form(...),
    mapping: str | None = Form(None),
    dialect: str | None = Form(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PreviewOut:
    _purge_stale_pending_uploads()
    _require_account(db, user, account_id)

    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=400,
                            detail="Format non pris en charge : déposez un fichier CSV.")

    # Read in chunks and stop at the cap. Reading the whole body first and checking
    # its length afterwards lets an authenticated client exhaust memory before the
    # limit is ever consulted.
    chunks: list[bytes] = []
    received = 0
    while chunk := await file.read(UPLOAD_CHUNK_BYTES):
        received += len(chunk)
        if received > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413,
                                detail="Fichier trop volumineux (20 Mo maximum).")
        chunks.append(chunk)
    raw = b"".join(chunks)
    if not raw.strip():
        raise HTTPException(status_code=400, detail="Le fichier est vide.")

    parsed_dialect = CsvDialect(**json.loads(dialect)) if dialect else None
    parsed_mapping = _int_keys(json.loads(mapping)) if mapping else None

    preview = build_preview(db, user.id, account_id, raw, parsed_dialect, parsed_mapping)

    token = secrets.token_urlsafe(24)
    _upload_path(user.id, token).write_bytes(raw)

    return PreviewOut(
        upload_token=token,
        original_filename=_clean_filename(file.filename),
        dialect=preview.dialect.__dict__,
        headers=preview.headers,
        sample_rows=preview.sample_rows,
        suggested_mapping={str(k): v for k, v in preview.suggested_mapping.items()},
        rows=[r.__dict__ for r in preview.rows],
        summary=preview.summary,
    )


@router.post("/commit", response_model=BatchOut, status_code=status.HTTP_201_CREATED)
def commit(payload: CommitIn, user: User = Depends(get_current_user),
           db: Session = Depends(get_db)) -> ImportBatch:
    _require_account(db, user, payload.account_id)

    path = _upload_path(user.id, payload.upload_token)
    if not path.is_file():
        raise HTTPException(status_code=410,
                            detail="Le fichier téléversé a expiré. Recommencez l'import.")

    try:
        batch = commit_import(
            db, user.id, payload.account_id, path.read_bytes(),
            filename=_clean_filename(payload.original_filename),
            dialect=CsvDialect(**payload.dialect.model_dump()),
            mapping=_int_keys(payload.mapping),
            overrides={int(k): v for k, v in payload.overrides.items()},
            keep_duplicates=payload.keep_duplicates,
        )
    except MappingError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Keep the original file next to the batch so an import can be replayed later.
    # Archived under this user's own subtree, outside pending/ -- _upload_path
    # never looks there, so no upload token can ever address another user's
    # archive. .replace() (not .rename()) is used deliberately: Path.rename()
    # raises on Windows when the target already exists but silently overwrites
    # on POSIX -- an inconsistency worth removing outright. batch.id is
    # monotonic for the life of the database, so a live deployment never
    # actually hits this path; .replace() just makes the (already here-to-stay)
    # fallback behavior explicit and identical on every platform instead of
    # OS-dependent.
    archived = _archive_dir(user.id) / f"batch-{batch.id}.csv"
    path.replace(archived)
    batch.stored_path = str(archived)
    db.commit()
    db.refresh(batch)
    return batch


@router.get("", response_model=list[BatchOut])
def list_batches(user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)) -> list[ImportBatch]:
    return (
        db.query(ImportBatch)
        .filter(ImportBatch.user_id == user.id)
        .order_by(ImportBatch.created_at.desc())
        .all()
    )


@router.delete("/{batch_id}")
def delete_batch(batch_id: int, user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)) -> dict[str, int]:
    try:
        removed = rollback_import(db, user.id, batch_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        # Converted to 404, not 403: the existence of someone else's batch
        # must not be disclosed to the caller.
        raise HTTPException(status_code=404, detail="Lot d'import introuvable") from exc
    return {"removed": removed}


@router.get("/profiles", response_model=list[ProfileOut])
def list_profiles(user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)) -> list[ProfileOut]:
    profiles = (
        db.query(ColumnProfile)
        .filter(ColumnProfile.user_id == user.id)
        .order_by(ColumnProfile.name)
        .all()
    )
    return [
        ProfileOut(id=p.id, name=p.name, dialect=p.dialect_json,
                   mapping=p.mapping_json, created_at=p.created_at)
        for p in profiles
    ]


@router.post("/profiles", response_model=ProfileOut, status_code=status.HTTP_201_CREATED)
def create_profile(payload: ProfileIn, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)) -> ProfileOut:
    exists = (
        db.query(ColumnProfile)
        .filter(ColumnProfile.user_id == user.id, ColumnProfile.name == payload.name)
        .first()
    )
    if exists is not None:
        raise HTTPException(status_code=409, detail="Un profil porte déjà ce nom")

    profile = ColumnProfile(user_id=user.id, name=payload.name,
                            dialect_json=payload.dialect, mapping_json=payload.mapping)
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return ProfileOut(id=profile.id, name=profile.name, dialect=profile.dialect_json,
                      mapping=profile.mapping_json, created_at=profile.created_at)


@router.delete("/profiles/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_profile(profile_id: int, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)) -> None:
    profile = (
        db.query(ColumnProfile)
        .filter(ColumnProfile.id == profile_id, ColumnProfile.user_id == user.id)
        .first()
    )
    if profile is None:
        raise HTTPException(status_code=404, detail="Profil introuvable")
    db.delete(profile)
    db.commit()
