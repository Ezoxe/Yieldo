"""GET /api/invest/avoirs -- what the household really holds at its brokers.

Read only, and on demand. Each connected broker (the simulated book aside) is
asked for its cash and positions with the credentials already on file; no
order route is called, and nothing is stored: the screen shows what the
broker answered when it was asked, with the moment it was asked.

`get_current_user`, so the connector and an agent key can read it too, like
every other figure of the investment pipeline (`api/invest_oversight.py`).
Reading what is held changes nothing; connecting, arming and trading stay
behind the session wall.

A broker that cannot be read is a refusal on its own card, in its own words
(`VenueError`), never a missing card or an empty portfolio.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import TradingVenue, User
from app.schemas.invest import CashBalanceOut, HeldAssetOut, VenueHoldingsOut
from app.security.deps import get_current_user
from app.trading.venues import factory
from app.trading.venues.base import VenueError

router = APIRouter(prefix="/invest/avoirs", tags=["invest"])


@router.get("", response_model=list[VenueHoldingsOut])
def read_holdings(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[VenueHoldingsOut]:
    rows = (
        db.query(TradingVenue)
        .filter(
            TradingVenue.user_id == user.id,
            TradingVenue.enabled.is_(True),
            TradingVenue.venue != "internal",
        )
        .order_by(TradingVenue.mode.desc(), TradingVenue.label)
        .all()
    )
    out = []
    for row in rows:
        fetched_at = datetime.now(UTC)
        common = {"venue_id": row.id, "venue": row.venue, "label": row.label, "mode": row.mode,
                  "fetched_at": fetched_at}
        try:
            held = factory.build(row).holdings()
        except VenueError as exc:
            out.append(
                VenueHoldingsOut(**common, ok=False, message=exc.message, cash=[], assets=[])
            )
            continue
        out.append(VenueHoldingsOut(
            **common, ok=True, message=None,
            cash=[
                CashBalanceOut(currency=c.currency, amount_cents=c.amount_cents)
                for c in held.cash
            ],
            assets=[
                HeldAssetOut(symbol=a.symbol, quantity=a.quantity, value_cents=a.value_cents,
                             currency=a.currency)
                for a in held.assets
            ],
        ))
    return out
