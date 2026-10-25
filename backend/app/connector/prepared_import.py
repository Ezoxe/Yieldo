"""`yieldo_import_preparer` -- a statement handed over by the connector.

The connector cannot send a multipart upload, and it must not commit an
import: the household confirms the columns (CLAUDE.md, "Column tagging is
user-driven"). So this tool reads the CSV the way `/imports/analyze` would,
tells the connector what it found, and keeps the file in `pending_imports`
for the Imports screen, where the ordinary wizard takes it from there.
"""

from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.api.imports import ALLOWED_SUFFIXES, _clean_filename, _require_account
from app.connector.custom import CustomTool
from app.importers.service import build_preview
from app.models import PendingImport, User

# Text, not bytes: what a model can carry in one tool argument. A longer
# statement is dropped into Imports by hand.
MAX_TEXT_CHARS = 2_000_000

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "account_id": {"type": "integer", "description": "Le compte où le relevé sera importé."},
        "nom_fichier": {"type": "string", "maxLength": 255,
                        "description": "Le nom du fichier, terminé par .csv."},
        "contenu": {"type": "string", "description": "Le texte du relevé CSV, tel quel."},
    },
    "required": ["account_id", "nom_fichier", "contenu"],
    "additionalProperties": False,
}


async def prepare(db: Session, user: User, args: dict[str, Any]) -> tuple[int, Any]:
    filename = _clean_filename(str(args["nom_fichier"]))
    if Path(filename).suffix.lower() not in ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=422,
            detail="Seul un relevé CSV se prépare par le connecteur : déposez un OFX ou un QIF "
                   "dans Imports.",
        )
    content = args["contenu"]
    if not isinstance(content, str) or not content.strip():
        raise HTTPException(status_code=422, detail="Le relevé est vide.")
    if len(content) > MAX_TEXT_CHARS:
        raise HTTPException(
            status_code=413,
            detail="Relevé trop long pour passer par le connecteur (2 millions de caractères au "
                   "plus) : déposez-le dans Imports.",
        )
    account = _require_account(db, user, int(args["account_id"]))

    raw = content.encode("utf-8")
    preview = build_preview(db, user.id, account.id, raw, None, None)
    pending = PendingImport(
        user_id=user.id, account_id=account.id, filename=filename, content=raw,
        rows=preview.summary["total"],
    )
    db.add(pending)
    db.commit()
    db.refresh(pending)

    return 201, {
        "pending_id": pending.id,
        "compte": account.name,
        "lignes": preview.summary["total"],
        "importables": preview.summary["importable"],
        "doublons": preview.summary["duplicates"],
        "colonnes": preview.headers,
        "mapping_propose": {str(index): role for index, role in preview.suggested_mapping.items()},
        "message": "Analyse rangée dans Imports → « Préparé par Claude » : confirmez les colonnes "
                   "à l'écran, rien n'est importé avant.",
    }


PREPARE_IMPORT = CustomTool(schema=SCHEMA, required=tuple(SCHEMA["required"]), run=prepare)
