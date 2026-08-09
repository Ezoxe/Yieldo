import json
import re
import secrets
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

router = APIRouter(prefix="/imports", tags=["imports"])

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
ALLOWED_SUFFIXES = {".csv", ".txt", ".tsv"}
# Separates the random prefix from the recovered original filename in a token.
# secrets.token_urlsafe only ever emits [A-Za-z0-9_-], so this character can
# never appear in the random part, and the first occurrence unambiguously
# marks the boundary.
_TOKEN_SEPARATOR = "~"
_UNSAFE_NAME_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


def _require_account(db: Session, user: User, account_id: int) -> Account:
    account = (
        db.query(Account)
        .filter(Account.id == account_id, Account.user_id == user.id)
        .first()
    )
    if account is None:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    return account


def _upload_path(token: str) -> Path:
    """Resolve a token to a path inside the uploads directory, and nowhere else.

    The token travels straight from the request body (the commit step reads it
    from JSON supplied by the client), so it can never be trusted to name a path
    segment: '..' or an embedded separator could otherwise walk the lookup
    outside uploads_dir. Requiring the resolved candidate's parent to be exactly
    uploads_dir rejects both.
    """
    candidate = (settings.uploads_dir / token).resolve()
    if candidate.parent != settings.uploads_dir.resolve():
        raise HTTPException(status_code=400, detail="Jeton de téléversement invalide")
    return candidate


def _safe_original_name(filename: str | None) -> str:
    """Keep only the final path component, restricted to a safe filename charset.

    Path(...).name already drops any directory components (whether '/' or '\\'
    separated), so this cannot be used to smuggle a path back out through the
    filename half of an upload token.
    """
    name = Path(filename or "").name or "import.csv"
    cleaned = _UNSAFE_NAME_CHARS.sub("_", name).strip("._")
    return cleaned[:80] or "import.csv"


def _build_upload_token(original_name: str) -> str:
    """A random prefix keeps the token unguessable; the suffix lets the commit
    step recover the client's original filename without the client resending
    it -- CommitIn carries no filename field. The full token is still
    re-validated by _upload_path before it ever touches the filesystem."""
    return f"{secrets.token_urlsafe(24)}{_TOKEN_SEPARATOR}{original_name}"


def _token_original_name(token: str) -> str:
    _, _, name = token.partition(_TOKEN_SEPARATOR)
    return name or token


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
    _require_account(db, user, account_id)

    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=400,
                            detail="Format non pris en charge : déposez un fichier CSV.")

    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413,
                            detail="Fichier trop volumineux (20 Mo maximum).")
    if not raw.strip():
        raise HTTPException(status_code=400, detail="Le fichier est vide.")

    parsed_dialect = CsvDialect(**json.loads(dialect)) if dialect else None
    parsed_mapping = _int_keys(json.loads(mapping)) if mapping else None

    preview = build_preview(db, user.id, account_id, raw, parsed_dialect, parsed_mapping)

    token = _build_upload_token(_safe_original_name(file.filename))
    _upload_path(token).write_bytes(raw)

    return PreviewOut(
        upload_token=token,
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

    path = _upload_path(payload.upload_token)
    if not path.is_file():
        raise HTTPException(status_code=410,
                            detail="Le fichier téléversé a expiré. Recommencez l'import.")

    try:
        batch = commit_import(
            db, user.id, payload.account_id, path.read_bytes(),
            filename=_token_original_name(payload.upload_token),
            dialect=CsvDialect(**payload.dialect.model_dump()),
            mapping=_int_keys(payload.mapping),
            overrides={int(k): v for k, v in payload.overrides.items()},
            keep_duplicates=payload.keep_duplicates,
        )
    except MappingError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Keep the original file next to the batch so an import can be replayed later.
    # .replace() (not .rename()) is used deliberately: Path.rename() raises on
    # Windows when the target already exists but silently overwrites on POSIX --
    # an inconsistency worth removing outright. batch.id is monotonic for the
    # life of the database, so a live deployment never actually hits this path;
    # .replace() just makes the (already here-to-stay) fallback behavior explicit
    # and identical on every platform instead of OS-dependent.
    archived = settings.uploads_dir / f"batch-{batch.id}.csv"
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
