"""GET/PUT /api/invest/policy — the mandate, the arming, and the cord.

Three different authorities meet on this router, and telling them apart is the
whole point of it:

* **Changing the mandate** and **arming live execution** take
  `get_session_user`. An agent access key must never be able to widen the
  limits it is measured against, nor open real money to itself.
* **Stopping** takes `get_current_user`, so an agent key CAN pull the cord.
  A supervising model that spots something wrong must be able to stop the
  machine even though it could never have started it. That asymmetry is
  deliberate and is the reason `halt` lives on `api/invest_oversight.py`
  rather than here.

**The arming is a timestamp, never a flag.** `POST /policy/arm` takes a
confirmation phrase typed letter for letter and a duration in minutes, and
writes `armed_until`. It expires by itself. A boolean would be left true by
someone who meant to try something for an afternoon.
"""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.decision.strategy import DECLARED_RULES
from app.models import AUTONOMY_MODES, TradingPolicy, User
from app.schemas.invest import ArmIn, PolicyIn, PolicyOut
from app.security.deps import get_session_user
from app.trading import audit, service

router = APIRouter(prefix="/invest/policy", tags=["invest"])

# Typed letter for letter before live execution opens. Deliberately without
# accents: a household copying it from the screen on any keyboard must be able
# to reproduce it exactly, and a confirmation that fails on a diacritic teaches
# people to paste rather than to read.
ARM_PHRASE = "JE CONFIRME L'EXECUTION REELLE"


def policy_for(db: Session, user: User) -> TradingPolicy:
    """The household's mandate, created empty on first read.

    Empty means **nothing is authorised**: no symbol, every ceiling at zero,
    `autonomy="observer"`. A mandate that appeared permissive by default would
    be the single worst defect this feature could ship.
    """
    row = db.query(TradingPolicy).filter(TradingPolicy.user_id == user.id).first()
    if row is None:
        row = TradingPolicy(user_id=user.id)
        db.add(row)
        db.commit()
    return row


def _out(row: TradingPolicy, now: datetime) -> PolicyOut:
    return PolicyOut(
        max_position_cents=row.max_position_cents,
        max_exposure_cents=row.max_exposure_cents,
        max_order_notional_cents=row.max_order_notional_cents,
        max_daily_loss_cents=row.max_daily_loss_cents,
        min_cash_buffer_cents=row.min_cash_buffer_cents,
        min_order_notional_cents=row.min_order_notional_cents,
        max_drawdown_bps=row.max_drawdown_bps,
        max_orders_per_day=row.max_orders_per_day,
        allowed_symbols=list(service.symbols_of(row)),
        allow_short=row.allow_short, allow_leverage=row.allow_leverage,
        allow_limit_orders=row.allow_limit_orders,
        minimum_conviction=row.minimum_conviction,
        minimum_probability_bps=row.minimum_probability_bps,
        max_volatility_bps=row.max_volatility_bps,
        full_conviction_share_bps=row.full_conviction_share_bps,
        autonomy=row.autonomy, armed_until=row.armed_until,
        armed=service.armed(row, now),
        halted=row.halted, halted_reason=row.halted_reason, halted_at=row.halted_at,
        halted_by=row.halted_by, orders_today=row.orders_today,
        realised_pnl_today_cents=row.realised_pnl_today_cents,
        declared_rules=list(DECLARED_RULES),
        updated_at=row.updated_at,
    )


@router.get("", response_model=PolicyOut)
def read_policy(
    user: User = Depends(get_session_user), db: Session = Depends(get_db)
) -> PolicyOut:
    return _out(policy_for(db, user), datetime.now(UTC))


@router.put("", response_model=PolicyOut)
def write_policy(
    payload: PolicyIn,
    user: User = Depends(get_session_user),
    db: Session = Depends(get_db),
) -> PolicyOut:
    if payload.autonomy not in AUTONOMY_MODES:
        raise HTTPException(
            status_code=422,
            detail="Le mode de pilotage doit être « observer », « paper » ou « live ».",
        )
    row = policy_for(db, user)

    before = _out(row, datetime.now(UTC)).model_dump(mode="json")

    row.max_position_cents = payload.max_position_cents
    row.max_exposure_cents = payload.max_exposure_cents
    row.max_order_notional_cents = payload.max_order_notional_cents
    row.max_daily_loss_cents = payload.max_daily_loss_cents
    row.min_cash_buffer_cents = payload.min_cash_buffer_cents
    row.min_order_notional_cents = payload.min_order_notional_cents
    row.max_drawdown_bps = payload.max_drawdown_bps
    row.max_orders_per_day = payload.max_orders_per_day
    row.allowed_symbols = ",".join(
        sorted({symbol.strip().upper() for symbol in payload.allowed_symbols if symbol.strip()})
    )
    row.allow_short = payload.allow_short
    row.allow_leverage = payload.allow_leverage
    row.allow_limit_orders = payload.allow_limit_orders
    row.minimum_conviction = payload.minimum_conviction
    row.minimum_probability_bps = payload.minimum_probability_bps
    row.max_volatility_bps = payload.max_volatility_bps
    row.full_conviction_share_bps = payload.full_conviction_share_bps

    # Moving the autonomy to `live` never arms it. Arming is its own route,
    # with its own phrase and its own expiry: a household that widened a
    # ceiling has not thereby agreed to trade real money.
    if payload.autonomy == "live" and row.autonomy != "live":
        row.armed_until = None
    row.autonomy = payload.autonomy

    now = datetime.now(UTC)
    after = _out(row, now).model_dump(mode="json")
    changed = {
        key: {"avant": before[key], "après": after[key]}
        for key in after
        if key not in ("updated_at", "declared_rules") and before[key] != after[key]
    }
    audit.append(db, user, kind="policy_changed", actor="session", payload=changed)
    db.commit()
    return _out(row, now)


@router.post("/arm", response_model=PolicyOut)
def arm(
    payload: ArmIn,
    user: User = Depends(get_session_user),
    db: Session = Depends(get_db),
) -> PolicyOut:
    """Open live execution, for a bounded time, against a typed phrase."""
    row = policy_for(db, user)
    if row.autonomy != "live":
        raise HTTPException(
            status_code=422,
            detail="Le pilotage n'est pas en mode réel : l'armement n'aurait aucun effet. "
                   "Passez d'abord le mode sur « réel » dans le mandat.",
        )
    if payload.confirmation.strip() != ARM_PHRASE:
        raise HTTPException(
            status_code=422,
            detail=f"La phrase de confirmation ne correspond pas. Tapez exactement : "
                   f"« {ARM_PHRASE} ».",
        )
    if row.halted:
        raise HTTPException(
            status_code=409,
            detail="Le pilotage est à l'arrêt : relancez-le avant d'armer l'exécution réelle.",
        )
    if not service.symbols_of(row):
        raise HTTPException(
            status_code=422,
            detail="Le mandat n'autorise aucun instrument : armer l'exécution réelle "
                   "n'ouvrirait rien. Ajoutez au moins un instrument.",
        )

    now = datetime.now(UTC)
    row.armed_until = now + timedelta(minutes=payload.minutes)
    audit.append(
        db, user, kind="armed", actor="session",
        payload={"minutes": payload.minutes, "armed_until": row.armed_until.isoformat()},
    )
    db.commit()
    return _out(row, now)


@router.post("/disarm", response_model=PolicyOut)
def disarm(
    user: User = Depends(get_session_user), db: Session = Depends(get_db)
) -> PolicyOut:
    row = policy_for(db, user)
    row.armed_until = None
    audit.append(db, user, kind="disarmed", actor="session", payload={})
    db.commit()
    return _out(row, datetime.now(UTC))


@router.post("/resume", response_model=PolicyOut, status_code=status.HTTP_200_OK)
def resume(
    user: User = Depends(get_session_user), db: Session = Depends(get_db)
) -> PolicyOut:
    """Lift a halt. **Session only.**

    An agent access key can stop the machine (`/invest/oversight/halt`) and
    cannot restart it. Restarting is a decision about risk, and a decision
    about risk belongs to the person whose money it is.
    """
    row = policy_for(db, user)
    if not row.halted:
        return _out(row, datetime.now(UTC))
    # A resume never re-arms: an arming that was live when the cord was pulled
    # has to be given again, deliberately.
    row.halted = False
    row.halted_reason = None
    row.halted_at = None
    row.halted_by = None
    row.armed_until = None
    audit.append(db, user, kind="resumed", actor="session", payload={})
    db.commit()
    return _out(row, datetime.now(UTC))
