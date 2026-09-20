"""The append-only journal, and the hash chain that makes an edit visible.

Three functions and one invariant: **nothing in this application updates or
deletes a `TradeAuditEvent`.** `append` is the only writer, `verify_chain` is
the only reader that judges, and `inputs_digest` is the same hash applied to a
decision's inputs so a replay can tell "the model answers differently now"
from "the stored question is not the one that was asked".

The chain is deliberately modest about what it proves. Yieldo is self-hosted:
whoever runs it owns the database file and could rewrite the whole chain from
row one. What the chain defeats is the realistic threat, which is not a
determined forger with shell access -- it is a partial edit. An agent access
key handed to a third-party program, a supervising model with write access
somewhere it should not have, a script that "cleaned up" a row: each of those
changes a payload and leaves every later hash wrong. `verify_chain` names the
first row where the arithmetic stops working, and an audit that can say
*where* it was broken is worth far more than one that can only say it was not.

**Canonical JSON, or the hash means nothing.** `sort_keys`, no whitespace,
`ensure_ascii=False` so a French sentence hashes as itself rather than as
escape sequences. Two serialisations of the same payload must produce the same
bytes or a chain breaks on a Python upgrade.
"""

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import TradeAuditEvent, User

# The first row of a user's chain has no predecessor. An empty string rather
# than NULL, so row 1's hash is computed over a defined value exactly like
# every other row's -- see `models/trade_audit.py`.
GENESIS = ""


def canonical_json(payload: Any) -> str:
    """The one serialisation every hash in this module is computed over."""
    return json.dumps(
        payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str
    )


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def entry_hash(
    *, previous_hash: str, sequence: int, kind: str, actor: str, payload: Any
) -> str:
    """This row's hash, over its predecessor and its own content.

    `sequence` is inside the hash on purpose: without it, two identical events
    could be reordered, or one deleted and the gap closed, without any hash
    changing.
    """
    return _sha256(
        canonical_json(
            {
                "previous_hash": previous_hash,
                "sequence": sequence,
                "kind": kind,
                "actor": actor,
                "payload": payload,
            }
        )
    )


def inputs_digest(features: dict[str, Any], questions: list[dict[str, Any]]) -> str:
    """What `TradeDecision.inputs_hash` holds.

    Features and questions only -- never the answers. The point is to detect a
    stored question or a stored indicator changing after the fact, which is
    exactly what would make a replay silently meaningless.
    """
    return _sha256(canonical_json({"features": features, "questions": questions}))


def append(
    db: Session, user: User, *, kind: str, payload: Any, actor: str
) -> TradeAuditEvent:
    """One more link. Reads the user's last row, chains onto it, flushes.

    Does not commit: the caller's transaction decides. An audit event that
    survived a rolled-back action would be a record of something that did not
    happen, which is worse than no record at all.
    """
    last = (
        db.query(TradeAuditEvent)
        .filter(TradeAuditEvent.user_id == user.id)
        .order_by(TradeAuditEvent.sequence.desc())
        .first()
    )
    sequence = 1 if last is None else last.sequence + 1
    previous = GENESIS if last is None else last.entry_hash
    event = TradeAuditEvent(
        user_id=user.id,
        sequence=sequence,
        kind=kind,
        payload=payload,
        actor=actor,
        previous_hash=previous,
        entry_hash=entry_hash(
            previous_hash=previous, sequence=sequence, kind=kind, actor=actor, payload=payload
        ),
    )
    db.add(event)
    db.flush()
    return event


@dataclass(frozen=True)
class ChainReport:
    events: int
    intact: bool
    # The sequence of the first row whose hash does not match, or None.
    broken_at: int | None
    # French, shown verbatim.
    message: str


def verify_chain(db: Session, user: User) -> ChainReport:
    """Walk the whole chain and say whether it still adds up."""
    rows = (
        db.query(TradeAuditEvent)
        .filter(TradeAuditEvent.user_id == user.id)
        .order_by(TradeAuditEvent.sequence.asc())
        .all()
    )
    if not rows:
        return ChainReport(
            events=0, intact=True, broken_at=None,
            message="Le journal est vide : rien n'a encore été enregistré.",
        )

    previous = GENESIS
    for index, row in enumerate(rows, start=1):
        if row.sequence != index:
            return ChainReport(
                events=len(rows), intact=False, broken_at=row.sequence,
                message=(
                    f"Le journal saute de l'entrée {index - 1} à l'entrée {row.sequence} : "
                    "une entrée a été supprimée."
                ),
            )
        if row.previous_hash != previous:
            return ChainReport(
                events=len(rows), intact=False, broken_at=row.sequence,
                message=(
                    f"L'entrée {row.sequence} ne s'enchaîne pas sur la précédente : "
                    "le journal a été modifié après coup."
                ),
            )
        expected = entry_hash(
            previous_hash=row.previous_hash, sequence=row.sequence, kind=row.kind,
            actor=row.actor, payload=row.payload,
        )
        if expected != row.entry_hash:
            return ChainReport(
                events=len(rows), intact=False, broken_at=row.sequence,
                message=(
                    f"Le contenu de l'entrée {row.sequence} ne correspond plus à son "
                    "empreinte : il a été modifié après son enregistrement."
                ),
            )
        previous = row.entry_hash

    return ChainReport(
        events=len(rows), intact=True, broken_at=None,
        message=(
            f"Les {len(rows)} entrées du journal s'enchaînent correctement : aucune n'a été "
            "modifiée ni supprimée depuis son enregistrement."
        ),
    )


def next_sequence(db: Session, user: User) -> int:
    """What `append` would use next. Read by the oversight API so a supervising
    agent can tell whether anything happened since it last looked."""
    highest = (
        db.query(func.max(TradeAuditEvent.sequence))
        .filter(TradeAuditEvent.user_id == user.id)
        .scalar()
    )
    return 1 if highest is None else highest + 1
