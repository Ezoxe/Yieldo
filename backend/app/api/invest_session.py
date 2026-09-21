"""`/api/invest/sessions` -- the simulated trading day.

`POST` starts one and answers 202 at once: the day itself runs in a
background task with its own database session, one commit per step, and the
screen polls `GET /{id}` to watch it fill. `POST /{id}/stop` raises a flag
the runner reads between two steps. Starting and stopping take
`get_session_user`: a day resets the paper account, and an access key may
watch the pilot, never reset what it is judged on.

The prices are not stored. `GET /{id}` recomputes every instrument's closes
from the seed through `trading/sandbox.py`, so the chart is the very market
the decisions were taken on, at no storage cost.
"""

import secrets
from collections.abc import Callable
from datetime import UTC, date, datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.invest_common import venue_for
from app.api.invest_policy import policy_for
from app.db import SessionLocal, get_db
from app.decision.contract import DecisionError
from app.decision.registry import build_provider
from app.engines.session_report import DecisionSummary, OrderSummary, Point, report
from app.models import (
    DecisionSettings,
    TradeDecision,
    TradeOrder,
    TradingSession,
    User,
)
from app.schemas.invest import (
    MassPointOut,
    SessionDecisionOut,
    SessionDetailOut,
    SessionOrderOut,
    SessionOut,
    SessionPointOut,
    SessionReportOut,
    SessionStartIn,
)
from app.security.deps import get_current_user, get_session_user
from app.trading import sandbox, service
from app.trading import session as day

router = APIRouter(prefix="/invest/sessions", tags=["invest"])

# The seed is drawn below this: wide enough that two days rarely collide,
# small enough to read and retype.
SEED_SPACE = 100_000
LISTED = 20


def session_factory() -> Callable[[], Session]:
    """How the background task opens its own database session. A dependency
    so the tests can hand it the in-memory one."""
    return SessionLocal


def _out(row: TradingSession) -> SessionOut:
    return SessionOut(
        id=row.id, mode=row.mode, seed=row.seed, steps=row.steps,
        interval_minutes=row.interval_minutes, completed_steps=row.completed_steps,
        status=row.status, stop_requested=row.stop_requested, message=row.message,
        provider=row.provider, model=row.model, initial_cash_cents=row.initial_cash_cents,
        final_equity_cents=row.final_equity_cents, realised_pnl_cents=row.realised_pnl_cents,
        unrealised_pnl_cents=row.unrealised_pnl_cents, max_drawdown_bps=row.max_drawdown_bps,
        orders=row.orders, decisions=row.decisions, started_at=row.started_at,
        finished_at=row.finished_at,
    )


def _play(factory: Callable[[], Session], session_id: int, user_id: int) -> None:
    """The background task: its own session, the day, then close."""
    db = factory()
    try:
        row = db.get(TradingSession, session_id)
        user = db.get(User, user_id)
        if row is None or user is None:
            return
        settings_row = (
            db.query(DecisionSettings).filter(DecisionSettings.user_id == user.id).first()
        )
        try:
            provider = build_provider(settings_row)
        except DecisionError as exc:
            row.status = "failed"
            row.message = exc.message
            row.finished_at = datetime.now(UTC)
            db.commit()
            return
        day.run_session(db, user, row, provider=provider, today=date.today())
    finally:
        db.close()


@router.post("", response_model=SessionOut, status_code=status.HTTP_202_ACCEPTED)
def start(
    payload: SessionStartIn,
    background: BackgroundTasks,
    factory: Callable[[], Session] = Depends(session_factory),
    user: User = Depends(get_session_user),
    db: Session = Depends(get_db),
) -> SessionOut:
    policy = policy_for(db, user)
    if policy.halted:
        why = policy.halted_reason or "sans raison enregistrée"
        raise HTTPException(
            status_code=409,
            detail=f"Le pilotage est à l'arrêt : {why}. Relancez-le depuis la Salle de "
                   "contrôle avant de simuler une journée.",
        )
    settings_row = db.query(DecisionSettings).filter(DecisionSettings.user_id == user.id).first()
    try:
        provider = build_provider(settings_row)
    except DecisionError as exc:
        raise HTTPException(status_code=409, detail=exc.message) from exc
    venue_row = venue_for(db, user, "paper")
    if venue_row.price_source != "synthetic":
        raise HTTPException(
            status_code=409,
            detail="Une journée simulée se joue sur le marché synthétique du carnet simulé "
                   "de Yieldo. Le courtier papier connecté lit d'autres cours : connectez le "
                   "carnet simulé dans Investissement → Courtiers.",
        )

    seed = payload.seed if payload.seed is not None else secrets.randbelow(SEED_SPACE)
    try:
        row = day.start_session(
            db, user, venue_row=venue_row, steps=payload.steps, seed=seed,
            cash_cents=payload.cash_cents, provider_name=getattr(provider, "name", "inconnu"),
            model=settings_row.model_name or "" if settings_row else "",
            now=datetime.now(UTC),
        )
    except day.DayAlreadyRunning as exc:
        raise HTTPException(
            status_code=409,
            detail="Une journée est déjà en cours. Attendez sa fin ou arrêtez-la depuis "
                   "La journée.",
        ) from exc
    db.commit()
    background.add_task(_play, factory, row.id, user.id)
    return _out(row)


@router.get("", response_model=list[SessionOut])
def list_days(
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
) -> list[SessionOut]:
    rows = (
        db.query(TradingSession)
        .filter(TradingSession.user_id == user.id)
        .order_by(TradingSession.id.desc())
        .limit(LISTED)
        .all()
    )
    return [_out(row) for row in rows]


def _row_for(db: Session, user: User, session_id: int) -> TradingSession:
    row = (
        db.query(TradingSession)
        .filter(TradingSession.id == session_id, TradingSession.user_id == user.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Journée introuvable.")
    return row


@router.get("/{session_id}", response_model=SessionDetailOut)
def read_day(
    session_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SessionDetailOut:
    row = _row_for(db, user, session_id)
    decisions = (
        db.query(TradeDecision)
        .filter(TradeDecision.user_id == user.id, TradeDecision.session_id == row.id)
        .order_by(TradeDecision.id.asc())
        .all()
    )
    decision_ids = [d.id for d in decisions]
    orders = (
        db.query(TradeOrder)
        .filter(TradeOrder.user_id == user.id, TradeOrder.decision_id.in_(decision_ids))
        .order_by(TradeOrder.id.asc())
        .all()
        if decision_ids else []
    )
    step_of = {d.id: d.session_step or 0 for d in decisions}

    policy = policy_for(db, user)
    symbols = sorted({d.symbol for d in decisions} | set(service.symbols_of(policy)))
    # Step k was decided on index seed + k - 1: the runner reads the market
    # at `sandbox_step` and only then advances it.
    played = row.completed_steps
    closes = {
        symbol: list(sandbox.closes(symbol, end_index=row.seed + played - 1, count=played))
        if played else []
        for symbol in symbols
    }

    summaries = []
    out_decisions = []
    for d in decisions:
        direction = (d.answers or {}).get("direction") or {}
        conviction = (d.answers or {}).get("conviction") or {}
        continuation = (d.answers or {}).get("continuation") or {}
        rules = ((d.second_opinion or {}).get("direction") or {}).get("choice")
        summaries.append(DecisionSummary(
            step=d.session_step or 0, symbol=d.symbol, outcome=d.outcome,
            choice=direction.get("choice"), mass_bps=direction.get("mass_bps"),
            confidence_bps=direction.get("confidence_bps"), act_bps=direction.get("act_bps"),
            latency_ms=d.latency_ms, rules_choice=rules,
        ))
        out_decisions.append(SessionDecisionOut(
            id=d.id, step=d.session_step or 0, symbol=d.symbol, outcome=d.outcome,
            rule=d.rule, message=d.message, choice=direction.get("choice"),
            score_value=conviction.get("score_value"),
            probability_bps=continuation.get("probability_bps"),
            mass_bps=direction.get("mass_bps"), confidence_bps=direction.get("confidence_bps"),
            act_bps=direction.get("act_bps"), latency_ms=d.latency_ms,
            reference_price_cents=d.reference_price_cents, rules_choice=rules,
            created_at=d.created_at,
        ))
    order_summaries = [
        OrderSummary(step=step_of.get(o.decision_id, 0), symbol=o.symbol, side=o.side,
                     status=o.status, realised_pnl_cents=o.realised_pnl_cents)
        for o in orders
    ]
    out_orders = [
        SessionOrderOut(
            id=o.id, step=step_of.get(o.decision_id), symbol=o.symbol, side=o.side,
            status=o.status, quantity=o.quantity, notional_cents=o.notional_cents,
            average_price_cents=o.average_price_cents, realised_pnl_cents=o.realised_pnl_cents,
            created_at=o.created_at,
        )
        for o in orders
    ]
    sheet = report(
        [Point(**point) for point in (row.points or [])], summaries, order_summaries,
        initial_cash_cents=row.initial_cash_cents,
    )
    base = _out(row).model_dump()
    base.pop("decisions")
    base.pop("orders")
    return SessionDetailOut(
        **base,
        points=[SessionPointOut(**point) for point in (row.points or [])],
        closes=closes, symbols=symbols, decisions=out_decisions, orders=out_orders,
        report=SessionReportOut(
            final_equity_cents=sheet.final_equity_cents, return_bps=sheet.return_bps,
            max_drawdown_bps=sheet.max_drawdown_bps, decisions=sheet.decisions,
            held=sheet.held, refused=sheet.refused, ordered=sheet.ordered, failed=sheet.failed,
            orders=sheet.orders, filled=sheet.filled, winning=sheet.winning,
            losing=sheet.losing, realised_pnl_cents=sheet.realised_pnl_cents,
            compared=sheet.compared, agreement_bps=sheet.agreement_bps,
            mean_confidence_bps=sheet.mean_confidence_bps, mean_act_bps=sheet.mean_act_bps,
            latency_p50_ms=sheet.latency_p50_ms,
            mass_series={
                symbol: [MassPointOut(step=p.step, buy_bps=p.buy_bps, sell_bps=p.sell_bps,
                                      hold_bps=p.hold_bps) for p in series]
                for symbol, series in sheet.mass_series.items()
            },
        ),
    )


@router.post("/{session_id}/stop", response_model=SessionOut)
def stop_day(
    session_id: int,
    user: User = Depends(get_session_user),
    db: Session = Depends(get_db),
) -> SessionOut:
    row = _row_for(db, user, session_id)
    if row.status != "running":
        raise HTTPException(
            status_code=409, detail="Cette journée est déjà terminée ; rien à arrêter.",
        )
    row.stop_requested = True
    db.commit()
    return _out(row)
