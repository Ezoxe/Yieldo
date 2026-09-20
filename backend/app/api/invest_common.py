"""What the investment routers share: who is asking, and which venue answers.

`actor_of` is the one place this feature tells a browser session from an agent
access key. It matters twice: the audit trail records which of the two caused
an event, and `POST /invest/run` refuses to start a LIVE cycle for a key.

The distinction is made exactly as `security/deps.get_current_user` makes it --
by the token's own prefix, with no second header -- so there is one rule for
what an agent key is, not two that could drift apart.
"""

from datetime import date, datetime

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from app.models import TradingAccount, TradingVenue, User
from app.security import agent_keys
from app.trading import service
from app.trading.venues import factory
from app.trading.venues.base import VenueAdapter


def actor_of(request: Request) -> str:
    """`"agent"` when the bearer is an access key, `"session"` otherwise."""
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() == "bearer" and token and agent_keys.looks_like_agent_key(token):
        return "agent"
    return "session"


def venue_for(db: Session, user: User, mode: str) -> TradingVenue:
    """The enabled venue this mode runs on.

    A mode with no venue is a refusal naming the screen that fixes it, never a
    silent no-op: a household that pressed « Lancer un tour » and saw nothing
    happen has been told nothing.
    """
    row = (
        db.query(TradingVenue)
        .filter(
            TradingVenue.user_id == user.id,
            TradingVenue.mode == mode,
            TradingVenue.enabled.is_(True),
        )
        .order_by(TradingVenue.id.asc())
        .first()
    )
    if row is None:
        where = "réel" if mode == "live" else "papier"
        raise HTTPException(
            status_code=409,
            detail=f"Aucun courtier n'est connecté en mode {where}. Ouvrez "
                   "Investissement → Courtiers pour en connecter un.",
        )
    return row


def adapters(db: Session, user: User, row: TradingVenue) -> tuple[VenueAdapter, VenueAdapter]:
    """(quoting, execution). They differ only for a paper venue with no paper
    environment of its own -- see `trading/venues/factory.execution_adapter`."""
    quoting = factory.build(row)
    return quoting, factory.execution_adapter(row, quoting)


def account_for(db: Session, user: User, mode: str, today: date) -> TradingAccount:
    return service.account_for(db, user, mode, today)


def mark_used(row: TradingVenue, now: datetime) -> None:
    row.last_used_at = now
