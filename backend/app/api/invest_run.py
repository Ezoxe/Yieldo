"""POST /api/invest/run, and everything the Salle de contrôle reads.

The clock is read here, once per request, as the real `date.today()` and
`datetime.now(UTC)` -- and passed down. `trading/service.run_cycle` takes both
as parameters and no engine below it reads a clock at all, so a test turns the
day over by passing a different date rather than by mocking time.

**A live cycle cannot be started by an agent access key.** Reading is open to
one, stopping is open to one (`api/invest_oversight.halt`), and starting real
execution is not. A supervising program should be able to watch and to
intervene against risk; it should not be able to open a position.

**Nothing here decides anything.** Every figure returned was computed by an
engine, and the funnel counts are counts of rows.
"""

from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.invest_common import actor_of, adapters, mark_used, venue_for
from app.api.invest_policy import policy_for
from app.db import get_db
from app.decision.contract import DecisionError
from app.decision.registry import build_provider
from app.engines.calibration import Observation, evaluate_calibration
from app.engines.quantity import parse as parse_quantity
from app.engines.quantity import value_cents
from app.engines.second_opinion import Opinion, compare
from app.models import (
    DecisionSettings,
    TradeDecision,
    TradeOrder,
    TradingVenue,
    User,
)
from app.schemas.invest import (
    CalibrationBucketOut,
    CalibrationOut,
    DecisionDetailOut,
    DecisionOut,
    DisagreementOut,
    OrderOut,
    OverviewOut,
    PositionOut,
    RunOut,
    SecondOpinionOut,
)
from app.security.deps import get_current_user, get_session_user
from app.trading import audit, service
from app.trading.venues.base import VenueError

router = APIRouter(prefix="/invest", tags=["invest"])

# How much history the overview's funnel and calibration read. A window rather
# than everything: a calibration computed over a strategy's whole life mixes
# the thresholds it has since changed.
DEFAULT_WINDOW = 200


def _decision_out(row: TradeDecision) -> DecisionOut:
    return DecisionOut(
        id=row.id, run_id=row.run_id, symbol=row.symbol, mode=row.mode,
        provider=row.provider, model=row.model, outcome=row.outcome, rule=row.rule,
        message=row.message, reference_price_cents=row.reference_price_cents,
        latency_ms=row.latency_ms, created_at=row.created_at, features=row.features,
        answers=row.answers, inputs_hash=row.inputs_hash,
    )


def _order_out(row: TradeOrder) -> OrderOut:
    return OrderOut(
        id=row.id, decision_id=row.decision_id, symbol=row.symbol, mode=row.mode,
        side=row.side, order_type=row.order_type, quantity=row.quantity,
        requested_quantity=row.requested_quantity, limit_price_cents=row.limit_price_cents,
        reference_price_cents=row.reference_price_cents, notional_cents=row.notional_cents,
        status=row.status, rule=row.rule, failure_reason=row.failure_reason,
        external_id=row.external_id, filled_quantity=row.filled_quantity,
        average_price_cents=row.average_price_cents, cost_cents=row.cost_cents,
        realised_pnl_cents=row.realised_pnl_cents, created_at=row.created_at,
    )


@router.post("/run", response_model=RunOut)
def run(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RunOut:
    """One cycle over every whitelisted instrument."""
    policy = policy_for(db, user)
    if policy.halted:
        why = policy.halted_reason or "sans raison enregistrée"
        raise HTTPException(
            status_code=409,
            detail=f"Le pilotage est à l'arrêt : {why}. Relancez-le depuis la Salle de "
                   "contrôle.",
        )
    mode = "live" if policy.autonomy == "live" else "paper"

    if mode == "live" and actor_of(request) == "agent":
        raise HTTPException(
            status_code=403,
            detail="Une clé d'accès peut lire le pilotage et l'arrêter, pas lancer un tour "
                   "en exécution réelle. Lancez-le depuis Yieldo.",
        )

    settings_row = (
        db.query(DecisionSettings).filter(DecisionSettings.user_id == user.id).first()
    )
    try:
        provider = build_provider(settings_row)
    except DecisionError as exc:
        raise HTTPException(status_code=409, detail=exc.message) from exc

    venue_row = venue_for(db, user, mode)
    try:
        quoting, execution = adapters(db, user, venue_row)
    except VenueError as exc:
        raise HTTPException(status_code=409, detail=exc.message) from exc

    now = datetime.now(UTC)
    report = service.run_cycle(
        db, user, policy=policy, venue_row=venue_row, quoting=quoting,
        execution=execution, provider=provider, today=date.today(), now=now,
    )
    mark_used(venue_row, now)
    db.commit()

    return RunOut(
        run_id=report.run_id, mode=report.mode, examined=report.examined,
        skipped=report.skipped, held=report.held, refused=report.refused,
        ordered=report.ordered, failed=report.failed, summary=report.summary,
        decisions=[_decision_out(outcome.decision) for outcome in report.outcomes],
    )


@router.get("/decisions", response_model=list[DecisionOut])
def list_decisions(
    mode: str | None = Query(default=None),
    outcome: str | None = Query(default=None),
    symbol: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[DecisionOut]:
    query = db.query(TradeDecision).filter(TradeDecision.user_id == user.id)
    if mode:
        query = query.filter(TradeDecision.mode == mode)
    if outcome:
        query = query.filter(TradeDecision.outcome == outcome)
    if symbol:
        query = query.filter(TradeDecision.symbol == symbol.upper())
    rows = query.order_by(TradeDecision.id.desc()).limit(limit).all()
    return [_decision_out(row) for row in rows]


@router.get("/decisions/{decision_id}", response_model=DecisionDetailOut)
def read_decision(
    decision_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DecisionDetailOut:
    row = (
        db.query(TradeDecision)
        .filter(TradeDecision.id == decision_id, TradeDecision.user_id == user.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Décision introuvable.")
    order = (
        db.query(TradeOrder)
        .filter(TradeOrder.decision_id == row.id, TradeOrder.user_id == user.id)
        .first()
    )
    base = _decision_out(row).model_dump()
    return DecisionDetailOut(
        **base, windows=row.windows, context=row.context, questions=row.questions,
        risk_verdict=row.risk_verdict, second_opinion=row.second_opinion,
        order=None if order is None else _order_out(order),
    )


@router.get("/orders", response_model=list[OrderOut])
def list_orders(
    mode: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[OrderOut]:
    query = db.query(TradeOrder).filter(TradeOrder.user_id == user.id)
    if mode:
        query = query.filter(TradeOrder.mode == mode)
    if status_filter:
        query = query.filter(TradeOrder.status == status_filter)
    rows = query.order_by(TradeOrder.id.desc()).limit(limit).all()
    return [_order_out(row) for row in rows]


def second_opinions(rows: list[TradeDecision]) -> tuple[Opinion, ...]:
    """What the model chose and what the rules would have, per decision. A
    missing side is None and the engine leaves it out of the comparison."""
    out = []
    for row in rows:
        model = (row.answers or {}).get("direction") or {}
        rules = (row.second_opinion or {}).get("direction") or {}
        out.append(Opinion(
            decision_id=row.id, symbol=row.symbol, created_at=row.created_at,
            model_choice=model.get("choice"), rules_choice=rules.get("choice"),
        ))
    return tuple(out)


def calibration_observations(rows: list[TradeDecision]) -> tuple[Observation, ...]:
    """Turn stored decisions into (stated probability, what happened).

    **The definition, stated plainly, because a calibration figure means
    nothing without it.** The model answered a probability that "the move
    described by these indicators continues on the next period". A decision is
    counted as having *happened* when the NEXT decision on the same instrument,
    in the same mode, carries a reference price that moved in the direction the
    model chose: higher after « acheter », lower after « vendre ».

    Three consequences a reader is owed:

    * only decisions where the model chose a direction AND gave a probability
      are counted -- a « ne rien faire » has nothing to be right or wrong about;
    * the most recent decision on each instrument is never counted, because
      nothing has happened after it yet;
    * "the next decision" is the next cycle, whenever that was. A household
      that runs a cycle a minute and one that runs one a day are measuring
      different horizons, and the horizon is theirs to choose.
    """
    by_symbol: dict[tuple[str, str], list[TradeDecision]] = {}
    for row in sorted(rows, key=lambda decision: decision.id):
        by_symbol.setdefault((row.symbol, row.mode), []).append(row)

    out: list[Observation] = []
    for series in by_symbol.values():
        for current, following in zip(series, series[1:], strict=False):
            answers = current.answers or {}
            direction = (answers.get("direction") or {}).get("choice")
            probability = (answers.get("continuation") or {}).get("probability_bps")
            if probability is None or direction not in ("acheter", "vendre"):
                continue
            before = current.reference_price_cents
            after = following.reference_price_cents
            if before is None or after is None:
                continue
            moved_up = after > before
            happened = moved_up if direction == "acheter" else after < before
            out.append(Observation(probability_bps=probability, happened=happened))
    return tuple(out)


@router.get("/overview", response_model=OverviewOut)
def overview(
    window: int = Query(default=DEFAULT_WINDOW, ge=1, le=1_000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OverviewOut:
    from app.api.invest_venues import _out as venue_out  # local: one screen needs it

    policy = policy_for(db, user)
    mode = "live" if policy.autonomy == "live" else "paper"
    now = datetime.now(UTC)
    account = service.account_for(db, user, mode, date.today())
    positions = service.positions_of(db, user, mode)

    venue_row = (
        db.query(TradingVenue)
        .filter(TradingVenue.user_id == user.id, TradingVenue.mode == mode)
        .order_by(TradingVenue.id.asc())
        .first()
    )

    prices: dict[str, int] = {}
    if venue_row is not None and positions:
        try:
            quoting, _ = adapters(db, user, venue_row)
            for symbol in positions:
                try:
                    prices[symbol] = quoting.quote(symbol).mid_cents
                except VenueError:
                    # A position whose price could not be read is shown WITHOUT
                    # a value rather than with a stale one -- the screen says
                    # "cours indisponible" beside it.
                    continue
        except VenueError:
            prices = {}

    rows = (
        db.query(TradeDecision)
        .filter(TradeDecision.user_id == user.id, TradeDecision.mode == mode)
        .order_by(TradeDecision.id.desc())
        .limit(window)
        .all()
    )
    # Zeros included: a constrained small model really can answer inside a
    # millisecond, and reporting « — » for the fastest possible model would
    # hide the one property a System One model is chosen for.
    latencies = sorted(row.latency_ms for row in rows)
    report = evaluate_calibration(calibration_observations(rows))
    agreement = compare(second_opinions(rows))

    equity = service.equity_cents(account, positions, prices)
    drawdown_bps = (
        0 if account.peak_equity_cents <= 0
        else max(
            0,
            (account.peak_equity_cents - equity) * 10_000 // account.peak_equity_cents,
        )
    )

    return OverviewOut(
        mode=mode, autonomy=policy.autonomy, armed=service.armed(policy, now),
        armed_until=policy.armed_until, halted=policy.halted,
        halted_reason=policy.halted_reason, currency=account.currency,
        cash_cents=account.cash_cents, initial_cash_cents=account.initial_cash_cents,
        equity_cents=equity, peak_equity_cents=account.peak_equity_cents,
        drawdown_bps=drawdown_bps,
        unrealised_pnl_cents=service.unrealised_cents(positions, prices),
        realised_pnl_today_cents=account.realised_pnl_today_cents,
        realised_pnl_total_cents=account.realised_pnl_total_cents,
        orders_today=account.orders_today,
        positions=[
            PositionOut(
                symbol=symbol, quantity=row.quantity,
                average_price_cents=row.average_price_cents,
                price_cents=prices.get(symbol),
                market_value_cents=(
                    None if symbol not in prices
                    else value_cents(parse_quantity(row.quantity), prices[symbol])
                ),
                unrealised_pnl_cents=(
                    None if symbol not in prices
                    else value_cents(parse_quantity(row.quantity), prices[symbol])
                    - value_cents(parse_quantity(row.quantity), row.average_price_cents)
                ),
            )
            for symbol, row in sorted(positions.items())
        ],
        examined=len(rows),
        skipped=sum(1 for row in rows if row.outcome == "skipped"),
        held=sum(1 for row in rows if row.outcome == "held"),
        refused=sum(1 for row in rows if row.outcome == "refused"),
        ordered=sum(1 for row in rows if row.outcome == "ordered"),
        failed=sum(1 for row in rows if row.outcome == "failed"),
        latency_median_ms=latencies[len(latencies) // 2] if latencies else None,
        latency_worst_ms=latencies[-1] if latencies else None,
        calibration=CalibrationOut(
            observations=report.observations, brier_bps=report.brier_bps,
            coin_flip_brier_bps=report.coin_flip_brier_bps, verdict=report.verdict,
            buckets=[
                CalibrationBucketOut(
                    lower_bps=bucket.lower_bps, upper_bps=bucket.upper_bps,
                    count=bucket.count, stated_bps=bucket.stated_bps,
                    observed_bps=bucket.observed_bps, gap_bps=bucket.gap_bps,
                )
                for bucket in report.buckets
            ],
        ),
        second_opinion=SecondOpinionOut(
            compared=agreement.compared, agreed=agreement.agreed,
            agreement_bps=agreement.agreement_bps,
            disagreements=[
                DisagreementOut(
                    decision_id=row.decision_id, symbol=row.symbol,
                    model_choice=row.model_choice, rules_choice=row.rules_choice,
                    created_at=row.created_at,
                )
                for row in agreement.disagreements
            ],
        ),
        venue=None if venue_row is None else venue_out(venue_row),
    )


@router.post("/sandbox/reset", status_code=status.HTTP_204_NO_CONTENT)
def reset_sandbox(
    cash_cents: int = Query(default=1_000_000, ge=0),
    user: User = Depends(get_session_user),
    db: Session = Depends(get_db),
) -> None:
    """Put the paper account back to its starting cash and clear its positions.

    **Paper only.** There is no route in this application that resets a live
    account, because there is nothing to reset: the money is at the broker.
    `get_session_user`, so an agent key cannot erase the record its own
    decisions are judged on.
    """
    service.reset_sandbox(db, user, cash_cents=cash_cents, today=date.today())
    audit.append(
        db, user, kind="sandbox_reset", actor="session",
        payload={"cash_cents": cash_cents},
    )
    db.commit()


__all__ = ["DEFAULT_WINDOW", "calibration_observations", "router"]
