"""GET/POST/DELETE /api/invest/venues — the brokers, and the wall around them.

**Every route here takes `get_session_user`, never `get_current_user`.** This
screen holds credentials that can move real money at a service outside this
machine. An agent access key opens the ledger; it does not add a broker, it
does not switch one to `live`, and it does not delete one. That is the boundary
`security/deps.py` draws for Réglages → Connexions, applied where crossing it
costs money rather than privacy.

**Storing credentials validates them with one real call**, exactly as
`api/connections.py` does for a market key: a key that was never tried is a
key nobody knows is wrong until the first order fails. The call is made before
the row is committed, and its result — the venue's own words — is stored on
the row so the screen can show a connection that WAS working and stopped.

**`internal` is always paper, and `live` always starts from a separate
decision.** A venue is created in the mode asked for, and moving an existing
one is not possible at all: `live` and `paper` are different rows (unique on
`(user, venue, mode)`), so "switching to live" means creating a live
connection with its own credentials. There is no toggle that turns a rehearsal
into the real thing.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import PRICE_SOURCES, TRADING_VENUES, VENUE_MODES, TradingVenue, User
from app.schemas.invest import VenueCheckOut, VenueIn, VenueOut
from app.security.crypto import encrypt_secret
from app.security.deps import get_session_user
from app.trading import audit
from app.trading.venues import factory
from app.trading.venues.base import VenueError

router = APIRouter(prefix="/invest/venues", tags=["invest"])

# Which venues need credentials at all. `internal` reaches nothing and
# authenticates against nothing.
REQUIRES_CREDENTIALS = ("alpaca", "kraken", "binance")


def _out(row: TradingVenue) -> VenueOut:
    return VenueOut(
        id=row.id, venue=row.venue, label=row.label, mode=row.mode,
        price_source=row.price_source, slippage_bps=row.slippage_bps, enabled=row.enabled,
        configured=bool(row.api_key_encrypted) or row.venue == "internal",
        requires_credentials=row.venue in REQUIRES_CREDENTIALS,
        sandbox_step=row.sandbox_step, created_at=row.created_at,
        last_used_at=row.last_used_at, last_check_at=row.last_check_at,
        last_check_ok=row.last_check_ok, last_check_message=row.last_check_message,
    )


@router.get("", response_model=list[VenueOut])
def list_venues(
    user: User = Depends(get_session_user), db: Session = Depends(get_db)
) -> list[VenueOut]:
    rows = (
        db.query(TradingVenue)
        .filter(TradingVenue.user_id == user.id)
        .order_by(TradingVenue.mode.asc(), TradingVenue.venue.asc())
        .all()
    )
    return [_out(row) for row in rows]


@router.post("", response_model=VenueCheckOut, status_code=status.HTTP_201_CREATED)
def add_venue(
    payload: VenueIn,
    user: User = Depends(get_session_user),
    db: Session = Depends(get_db),
) -> VenueCheckOut:
    if payload.venue not in TRADING_VENUES:
        raise HTTPException(status_code=404, detail="Place de marché inconnue.")
    if payload.mode not in VENUE_MODES:
        raise HTTPException(
            status_code=422,
            detail="Le mode doit être « paper » (simulé) ou « live » (argent réel).",
        )
    if payload.venue == "internal" and payload.mode != "paper":
        raise HTTPException(
            status_code=422,
            detail="Le carnet simulé de Yieldo n'existe qu'en mode papier : il ne transmet "
                   "aucun ordre à l'extérieur.",
        )
    if payload.venue in REQUIRES_CREDENTIALS and not (payload.api_key and payload.api_secret):
        raise HTTPException(
            status_code=422,
            detail=f"Une clé et un secret sont nécessaires pour {payload.label or payload.venue}.",
        )

    price_source = payload.price_source or (
        "synthetic" if payload.venue == "internal" else "venue"
    )
    if price_source not in PRICE_SOURCES:
        raise HTTPException(status_code=422, detail="Source de cours inconnue.")

    existing = (
        db.query(TradingVenue)
        .filter(
            TradingVenue.user_id == user.id,
            TradingVenue.venue == payload.venue,
            TradingVenue.mode == payload.mode,
        )
        .first()
    )
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail="Cette place de marché est déjà connectée dans ce mode. Supprimez la "
                   "connexion existante avant d'en enregistrer une autre.",
        )

    row = TradingVenue(
        user_id=user.id, venue=payload.venue, mode=payload.mode,
        label=payload.label or payload.venue,
        api_key_encrypted=encrypt_secret(payload.api_key) if payload.api_key else None,
        api_secret_encrypted=(
            encrypt_secret(payload.api_secret) if payload.api_secret else None
        ),
        base_url=payload.base_url, slippage_bps=payload.slippage_bps,
        price_source=price_source,
    )

    # One real call before the row is kept — the credentials are proved, not
    # assumed. A refusal names its cause and nothing is stored.
    now = datetime.now(UTC)
    try:
        message = factory.build(row).check()
    except VenueError as exc:
        return VenueCheckOut(valid=False, message=exc.message)

    row.last_check_at = now
    row.last_check_ok = True
    row.last_check_message = message
    db.add(row)
    db.flush()
    audit.append(
        db, user, kind="venue_added", actor="session",
        payload={"venue_id": row.id, "venue": row.venue, "mode": row.mode,
                 "price_source": row.price_source},
    )
    db.commit()
    return VenueCheckOut(valid=True, message=message)


@router.post("/{venue_id}/verifier", response_model=VenueCheckOut)
def check_venue(
    venue_id: int,
    user: User = Depends(get_session_user),
    db: Session = Depends(get_db),
) -> VenueCheckOut:
    row = _venue_or_404(db, user, venue_id)
    now = datetime.now(UTC)
    try:
        message = factory.build(row).check()
    except VenueError as exc:
        row.last_check_at = now
        row.last_check_ok = False
        row.last_check_message = exc.message
        db.commit()
        return VenueCheckOut(valid=False, message=exc.message)
    row.last_check_at = now
    row.last_check_ok = True
    row.last_check_message = message
    db.commit()
    return VenueCheckOut(valid=True, message=message)


@router.delete("/{venue_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_venue(
    venue_id: int,
    user: User = Depends(get_session_user),
    db: Session = Depends(get_db),
) -> None:
    row = _venue_or_404(db, user, venue_id)
    audit.append(
        db, user, kind="venue_removed", actor="session",
        payload={"venue_id": row.id, "venue": row.venue, "mode": row.mode},
    )
    db.delete(row)
    db.commit()


def _venue_or_404(db: Session, user: User, venue_id: int) -> TradingVenue:
    row = (
        db.query(TradingVenue)
        .filter(TradingVenue.id == venue_id, TradingVenue.user_id == user.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Connexion introuvable.")
    return row
