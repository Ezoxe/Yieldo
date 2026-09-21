"""One cycle: indicators, three questions, the mandate, and an order — or a
recorded reason there was none.

Orchestration, not calculation. Every figure this module writes was produced by
a pure engine (`engines/signals`, `engines/trading_risk`,
`engines/paper_book`), every decision by a provider behind
`decision/contract`, and every credential by `trading/venues/factory`. What
lives here is the ORDER those are called in, the persistence, and the audit —
which is exactly the split `importers/service.py` and `categorization/*` use.

**The order of the pipeline is the safety argument, so it is written once:**

1.  `prefilter` — rules that answer without the model. Cheapest, and
    unarguable.
2.  the model answers `direction`. A « ne rien faire » stops here, one call
    spent instead of three.
3.  `conviction` and `continuation`, then the thresholds.
4.  `size_intent` — arithmetic, no model.
5.  `evaluate_order` — the mandate. **No branch in this module skips it.**
6.  the venue, and only if step 5 allowed it and the autonomy mode sends.

**Everything is persisted as it goes**, like `llm/agent.py`'s `AgentStep`
rows: a `TradeDecision` per instrument examined, including the ones that were
skipped, and a `TradeOrder` per order — including the refused ones, which are
the whole point of having a mandate at all.

**The clock is read at the route boundary** and passed in as `today` and `now`,
like every other clock reading in this codebase. Nothing here calls
`date.today()`.

**Nothing is retried.** A venue failure ends that instrument's turn with the
cause named. See `trading/venues/base.py` for why sending an order twice is
the one failure mode worth designing the whole module around.
"""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.decision.contract import Decision, DecisionError, DecisionProvider
from app.decision.replay import ReplayProvider
from app.decision.strategy import (
    CONTINUATION,
    CONVICTION,
    DIRECTION,
    HOLD,
    Bundle,
    PositionSnapshot,
    Skip,
    StrategySettings,
    build_context,
    prefilter,
    size_intent,
)
from app.engines.paper_book import PositionState, apply_fill, unrealised_pnl_cents
from app.engines.quantity import Quantity, value_cents
from app.engines.quantity import parse as parse_quantity
from app.engines.signals import FeatureWindows, MarketFeatures, PriceSeries, compute_features
from app.engines.trading_risk import (
    AccountState,
    Mandate,
    OrderIntent,
    RiskVerdict,
    evaluate_order,
    with_quantity,
)
from app.french import counted
from app.models import (
    TradeDecision,
    TradeOrder,
    TradingAccount,
    TradingPolicy,
    TradingPosition,
    TradingVenue,
    User,
)
from app.trading import audit
from app.trading.venues.base import VenueAdapter, VenueError

# Enough closes for the default windows with room to spare, and few enough that
# a venue's bars endpoint answers in one page.
HISTORY_LENGTH = 120

ZERO = parse_quantity("0")


# --------------------------------------------------------------------------
# Reading the mandate and the account
# --------------------------------------------------------------------------

def symbols_of(policy: TradingPolicy) -> tuple[str, ...]:
    """The whitelist, as a tuple. Empty means nothing is tradable — see
    `models/trading_policy.TradingPolicy`."""
    return tuple(
        part.strip().upper() for part in (policy.allowed_symbols or "").split(",")
        if part.strip()
    )


def mandate_of(policy: TradingPolicy) -> Mandate:
    order_types = ("market", "limit") if policy.allow_limit_orders else ("market",)
    return Mandate(
        max_position_cents=policy.max_position_cents,
        max_exposure_cents=policy.max_exposure_cents,
        max_order_notional_cents=policy.max_order_notional_cents,
        max_daily_loss_cents=policy.max_daily_loss_cents,
        max_drawdown_bps=policy.max_drawdown_bps,
        max_orders_per_day=policy.max_orders_per_day,
        min_cash_buffer_cents=policy.min_cash_buffer_cents,
        min_order_notional_cents=policy.min_order_notional_cents,
        allowed_symbols=symbols_of(policy),
        allowed_sides=("buy", "sell"),
        allowed_order_types=order_types,
        allow_short=policy.allow_short,
        allow_leverage=policy.allow_leverage,
    )


def strategy_of(policy: TradingPolicy) -> StrategySettings:
    return StrategySettings(
        minimum_conviction=policy.minimum_conviction,
        minimum_probability_bps=policy.minimum_probability_bps,
        max_volatility_bps=policy.max_volatility_bps,
        full_conviction_share_bps=policy.full_conviction_share_bps,
    )


def armed(policy: TradingPolicy, now: datetime) -> bool:
    """Whether live execution is open right now.

    An arming that has expired is not an arming. Read against `now` from the
    route rather than against the wall clock, so a test can watch one expire.
    """
    if policy.armed_until is None:
        return False
    until = policy.armed_until
    # SQLite does not persist the offset on a `DateTime(timezone=True)`
    # column — the same gap `api/connections.py` documents, met here for the
    # same reason and fixed the same way.
    if until.tzinfo is None:
        until = until.replace(tzinfo=UTC)
    return until > now


def account_for(db: Session, user: User, mode: str, today: date) -> TradingAccount:
    """The account for this mode, with its daily counters reset if the day has
    turned. The comparison is against `today`, passed in from the route."""
    row = (
        db.query(TradingAccount)
        .filter(TradingAccount.user_id == user.id, TradingAccount.mode == mode)
        .first()
    )
    if row is None:
        row = TradingAccount(
            user_id=user.id, mode=mode, currency="EUR",
            cash_cents=0, initial_cash_cents=0, peak_equity_cents=0,
            counters_on=today, orders_today=0, realised_pnl_today_cents=0,
            realised_pnl_total_cents=0,
        )
        db.add(row)
        db.flush()
        return row
    if row.counters_on != today:
        row.counters_on = today
        row.orders_today = 0
        row.realised_pnl_today_cents = 0
    return row


def reset_sandbox(db: Session, user: User, *, cash_cents: int, today: date) -> TradingAccount:
    """The paper account back to `cash_cents`, no position, counters at zero.
    Paper only: there is nothing to reset on a live account, the money is at
    the broker. Flushes; the caller commits and writes the journal entry."""
    account = account_for(db, user, "paper", today)
    account.cash_cents = cash_cents
    account.initial_cash_cents = cash_cents
    account.peak_equity_cents = cash_cents
    account.orders_today = 0
    account.realised_pnl_today_cents = 0
    account.realised_pnl_total_cents = 0
    db.query(TradingPosition).filter(
        TradingPosition.user_id == user.id, TradingPosition.mode == "paper"
    ).delete()
    db.flush()
    return account


def positions_of(db: Session, user: User, mode: str) -> dict[str, TradingPosition]:
    rows = (
        db.query(TradingPosition)
        .filter(TradingPosition.user_id == user.id, TradingPosition.mode == mode)
        .all()
    )
    return {row.symbol: row for row in rows}


def _position_state(row: TradingPosition | None) -> PositionState:
    if row is None:
        return PositionState.empty()
    return PositionState(
        quantity=parse_quantity(row.quantity), average_price_cents=row.average_price_cents
    )


# --------------------------------------------------------------------------
# One cycle
# --------------------------------------------------------------------------

@dataclass
class SymbolOutcome:
    symbol: str
    decision: TradeDecision
    order: TradeOrder | None = None


@dataclass
class CycleReport:
    run_id: str
    mode: str
    examined: int = 0
    skipped: int = 0
    held: int = 0
    refused: int = 0
    ordered: int = 0
    failed: int = 0
    outcomes: list[SymbolOutcome] = field(default_factory=list)
    # French, one sentence, built at the end from the counters above.
    summary: str = ""


def _decision_payload(decision: Decision) -> dict[str, Any]:
    payload = dict(decision.canonical())
    payload["raw"] = decision.raw
    payload["latency_ms"] = decision.latency_ms
    payload["confidence_bps"] = decision.confidence_bps
    payload["mass_bps"] = decision.mass_bps
    payload["act_bps"] = decision.act_bps
    payload["provider"] = decision.provider
    payload["model"] = decision.model
    return payload


def _questions_payload() -> list[dict[str, Any]]:
    return [
        {"key": DIRECTION.key, "kind": "choice", "prompt": DIRECTION.prompt,
         "options": list(DIRECTION.options)},
        {"key": CONVICTION.key, "kind": "score", "prompt": CONVICTION.prompt,
         "minimum": CONVICTION.minimum, "maximum": CONVICTION.maximum},
        {"key": CONTINUATION.key, "kind": "probability", "statement": CONTINUATION.statement},
    ]


def _windows_payload(windows: FeatureWindows) -> dict[str, int]:
    return {
        "short": windows.short, "long": windows.long, "rsi": windows.rsi,
        "momentum": windows.momentum, "volatility": windows.volatility,
    }


def _record(
    db: Session, user: User, *, run_id: str, mode: str, venue: TradingVenue,
    symbol: str, features: MarketFeatures | None, windows: FeatureWindows,
    context: dict[str, Any], answers: dict[str, Any], provider: str, model: str,
    outcome: str, rule: str | None, message: str | None,
    risk_verdict: RiskVerdict | None, latency_ms: int, now: datetime,
    second_opinion: dict[str, Any] | None = None,
) -> TradeDecision:
    canonical = features.canonical() if features is not None else {"symbol": symbol}
    questions = _questions_payload()
    row = TradeDecision(
        user_id=user.id, run_id=run_id, symbol=symbol, mode=mode, venue_id=venue.id,
        provider=provider, model=model,
        features=canonical, windows=_windows_payload(windows), context=context,
        questions=questions, answers=answers,
        reference_price_cents=None if features is None else features.last_price_cents,
        latency_ms=latency_ms, outcome=outcome, rule=rule, message=message,
        risk_verdict=None if risk_verdict is None else risk_verdict.canonical(),
        second_opinion=second_opinion,
        inputs_hash=audit.inputs_digest(canonical, questions),
        created_at=now,
    )
    db.add(row)
    db.flush()
    audit.append(
        db, user, kind="decision", actor="system",
        payload={
            "decision_id": row.id, "run_id": run_id, "symbol": symbol, "mode": mode,
            "outcome": outcome, "rule": rule, "inputs_hash": row.inputs_hash,
        },
    )
    return row


def _ask(provider: DecisionProvider, question: Any, context: dict[str, Any]) -> Decision:
    return provider.decide(question, context)


def _second_opinion(context: dict[str, Any]) -> dict[str, Any]:
    """The deterministic engine's answers on the same context, canonical only
    -- no raw, no latency. Asked in the same order and with the same
    short-circuit as the model, so the two are compared like for like. Never
    sized, never sent to the mandate: a yardstick beside the model."""
    rules = ReplayProvider()
    out = {DIRECTION.key: rules.decide(DIRECTION, context).canonical()}
    if out[DIRECTION.key]["choice"] != HOLD:
        out[CONVICTION.key] = rules.decide(CONVICTION, context).canonical()
        out[CONTINUATION.key] = rules.decide(CONTINUATION, context).canonical()
    return out


def run_cycle(
    db: Session,
    user: User,
    *,
    policy: TradingPolicy,
    venue_row: TradingVenue,
    quoting: VenueAdapter,
    execution: VenueAdapter,
    provider: DecisionProvider,
    today: date,
    now: datetime,
    windows: FeatureWindows | None = None,
) -> CycleReport:
    """Every whitelisted instrument, once. Returns what happened to each."""
    windows = windows or FeatureWindows()
    mode = "live" if policy.autonomy == "live" else "paper"
    run_id = uuid.uuid4().hex
    report = CycleReport(run_id=run_id, mode=mode)

    mandate = mandate_of(policy)
    settings = strategy_of(policy)
    account = account_for(db, user, mode, today)
    positions = positions_of(db, user, mode)

    provider_name = getattr(provider, "name", "inconnu")

    for symbol in symbols_of(policy):
        report.examined += 1
        position_row = positions.get(symbol)
        state = _position_state(position_row)

        # --- indicators -------------------------------------------------
        try:
            closes = quoting.closes(symbol, HISTORY_LENGTH)
            features = compute_features(PriceSeries(symbol=symbol, closes=closes), windows)
        except (VenueError, ValueError) as exc:
            message = exc.message if isinstance(exc, VenueError) else str(exc)
            rule = exc.cause.value if isinstance(exc, VenueError) else "insufficient_history"
            report.failed += 1
            report.outcomes.append(SymbolOutcome(symbol, _record(
                db, user, run_id=run_id, mode=mode, venue=venue_row, symbol=symbol,
                features=None, windows=windows, context={}, answers={},
                provider=provider_name, model="", outcome="failed", rule=rule,
                message=message, risk_verdict=None, latency_ms=0, now=now,
            )))
            continue

        snapshot = None
        if state.quantity.value > 0:
            market_value = value_cents(state.quantity, features.last_price_cents)
            basis = value_cents(state.quantity, state.average_price_cents)
            snapshot = PositionSnapshot(
                quantity=state.quantity,
                average_price_cents=state.average_price_cents,
                market_value_cents=market_value,
                unrealised_pnl_bps=(
                    0 if basis == 0
                    else int(Decimal(market_value - basis) * 10_000 / Decimal(basis))
                ),
            )

        # --- rules that answer without the model -------------------------
        blocked = prefilter(features, mandate, settings)
        if blocked is not None:
            report.skipped += 1
            report.outcomes.append(SymbolOutcome(symbol, _record(
                db, user, run_id=run_id, mode=mode, venue=venue_row, symbol=symbol,
                features=features, windows=windows, context={}, answers={},
                provider=provider_name, model="", outcome="skipped", rule=blocked.rule,
                message=blocked.message, risk_verdict=None, latency_ms=0, now=now,
            )))
            continue

        context = build_context(features, snapshot)
        answers: dict[str, Any] = {}
        latency = 0

        # --- the three questions -----------------------------------------
        try:
            direction = _ask(provider, DIRECTION, context)
            answers[DIRECTION.key] = _decision_payload(direction)
            latency += direction.latency_ms

            conviction = None
            continuation = None
            if direction.choice != HOLD:
                conviction = _ask(provider, CONVICTION, context)
                answers[CONVICTION.key] = _decision_payload(conviction)
                latency += conviction.latency_ms
                continuation = _ask(provider, CONTINUATION, context)
                answers[CONTINUATION.key] = _decision_payload(continuation)
                latency += continuation.latency_ms
            # A real model gets the rules' opinion stored beside it; the rules
            # do not get compared to themselves.
            second_opinion = None if provider_name == "replay" else _second_opinion(context)
        except DecisionError as exc:
            report.failed += 1
            report.outcomes.append(SymbolOutcome(symbol, _record(
                db, user, run_id=run_id, mode=mode, venue=venue_row, symbol=symbol,
                features=features, windows=windows, context=context, answers=answers,
                provider=provider_name, model="", outcome="failed", rule=exc.cause.value,
                message=exc.message, risk_verdict=None, latency_ms=latency, now=now,
            )))
            continue

        model_name = direction.model
        bundle = Bundle(direction=direction, conviction=conviction, continuation=continuation)

        # --- from an answer to a size -------------------------------------
        sized = size_intent(
            features=features, bundle=bundle, mandate=mandate, settings=settings,
            position=snapshot,
        )
        if isinstance(sized, Skip):
            report.held += 1
            report.outcomes.append(SymbolOutcome(symbol, _record(
                db, user, run_id=run_id, mode=mode, venue=venue_row, symbol=symbol,
                features=features, windows=windows, context=context, answers=answers,
                provider=provider_name, model=model_name, outcome="held", rule=sized.rule,
                message=sized.message, risk_verdict=None, latency_ms=latency, now=now,
                second_opinion=second_opinion,
            )))
            continue

        # --- the mandate ---------------------------------------------------
        exposure = sum(
            value_cents(parse_quantity(row.quantity), row.average_price_cents)
            for row in positions.values()
        )
        equity = account.cash_cents + exposure
        account.peak_equity_cents = max(account.peak_equity_cents, equity)
        account_state = AccountState(
            equity_cents=equity,
            cash_cents=account.cash_cents,
            peak_equity_cents=account.peak_equity_cents,
            exposure_cents=exposure,
            position_cents=value_cents(state.quantity, features.last_price_cents),
            position_quantity=state.quantity,
            realised_pnl_today_cents=account.realised_pnl_today_cents,
            orders_today=account.orders_today,
            halted=policy.halted,
            halted_reason=policy.halted_reason,
            armed=True if mode == "paper" else armed(policy, now),
        )
        verdict = evaluate_order(mandate, account_state, sized)

        decision_row = _record(
            db, user, run_id=run_id, mode=mode, venue=venue_row, symbol=symbol,
            features=features, windows=windows, context=context, answers=answers,
            provider=provider_name, model=model_name,
            outcome="refused" if not verdict.allowed else "ordered",
            rule=verdict.breaches[0].rule if verdict.breaches else None,
            message=verdict.breaches[0].message if verdict.breaches else None,
            risk_verdict=verdict, latency_ms=latency, now=now,
            second_opinion=second_opinion,
        )

        order = _place(
            db, user, policy=policy, venue_row=venue_row, execution=execution,
            decision=decision_row, intent=sized, verdict=verdict, mode=mode,
            account=account, positions=positions, now=now,
        )
        if order.status == "refused":
            report.refused += 1
            decision_row.outcome = "refused"
            decision_row.rule = order.rule
            decision_row.message = order.failure_reason
        elif order.status == "failed":
            report.failed += 1
            decision_row.outcome = "failed"
            decision_row.rule = order.rule
            decision_row.message = order.failure_reason
        else:
            report.ordered += 1
        report.outcomes.append(SymbolOutcome(symbol, decision_row, order))

    # The synthetic market moves one step per cycle — see
    # `models/trading_venue.sandbox_step`.
    if venue_row.price_source == "synthetic":
        venue_row.sandbox_step += 1

    report.summary = (
        f"{counted(report.examined, 'instrument examiné', 'instruments examinés')} : "
        f"{counted(report.skipped, 'écarté', 'écartés')} avant le modèle, "
        f"{report.held} sans action, "
        f"{counted(report.refused, 'refusé', 'refusés')} par le mandat, "
        f"{counted(report.ordered, 'ordre transmis', 'ordres transmis')}, "
        f"{report.failed} en échec."
    )
    return report


def _place(
    db: Session,
    user: User,
    *,
    policy: TradingPolicy,
    venue_row: TradingVenue,
    execution: VenueAdapter,
    decision: TradeDecision,
    intent: OrderIntent,
    verdict: RiskVerdict,
    mode: str,
    account: TradingAccount,
    positions: dict[str, TradingPosition],
    now: datetime,
) -> TradeOrder:
    """Record the order, and send it only if the mandate and the autonomy mode
    both allow. Always returns a row — including for what was not sent."""
    # 18 hex characters: 72 bits of collision resistance, and short enough that
    # Kraken's own 18-character limit truncates nothing.
    idempotency_key = uuid.uuid4().hex[:18]
    order = TradeOrder(
        user_id=user.id, decision_id=decision.id, venue_id=venue_row.id, mode=mode,
        symbol=intent.symbol, side=intent.side, order_type=intent.order_type,
        quantity=str(verdict.quantity), requested_quantity=str(intent.quantity),
        limit_price_cents=intent.limit_price_cents,
        reference_price_cents=intent.reference_price_cents,
        notional_cents=verdict.notional_cents, status="refused",
        idempotency_key=idempotency_key, created_at=now, updated_at=now,
    )

    if not verdict.allowed:
        breach = verdict.breaches[0] if verdict.breaches else None
        order.rule = breach.rule if breach else "refused"
        order.failure_reason = breach.message if breach else "Refusé par le mandat."
        db.add(order)
        db.flush()
        audit.append(
            db, user, kind="order_refused", actor="system",
            payload={"order_id": order.id, "decision_id": decision.id,
                     "symbol": order.symbol, "rule": order.rule},
        )
        return order

    if policy.autonomy == "observer":
        order.rule = "observer_mode"
        order.failure_reason = (
            "Le pilotage est en mode observation : l'ordre a été dimensionné et validé par "
            "le mandat, mais rien n'a été transmis. Passez en mode papier ou réel dans "
            "Investissement → Mandat."
        )
        db.add(order)
        db.flush()
        audit.append(
            db, user, kind="order_refused", actor="system",
            payload={"order_id": order.id, "decision_id": decision.id,
                     "symbol": order.symbol, "rule": order.rule},
        )
        return order

    allowed = with_quantity(intent, verdict.quantity)
    db.add(order)
    db.flush()
    audit.append(
        db, user, kind="order_sent", actor="system",
        payload={"order_id": order.id, "decision_id": decision.id, "symbol": order.symbol,
                 "side": order.side, "quantity": order.quantity, "mode": mode,
                 "idempotency_key": idempotency_key},
    )

    try:
        result = execution.place_order(
            symbol=allowed.symbol, side=allowed.side, quantity=allowed.quantity,
            order_type=allowed.order_type, limit_price_cents=allowed.limit_price_cents,
            idempotency_key=idempotency_key,
        )
    except VenueError as exc:
        order.status = "failed"
        order.rule = exc.cause.value
        order.failure_reason = exc.message
        order.updated_at = now
        audit.append(
            db, user, kind="order_failed", actor="system",
            payload={"order_id": order.id, "rule": order.rule},
        )
        return order

    order.status = result.state
    order.external_id = result.external_id
    order.filled_quantity = str(result.filled_quantity)
    order.average_price_cents = result.average_price_cents or None
    order.cost_cents = result.cost_cents
    order.failure_reason = result.reason
    order.updated_at = now
    account.orders_today += 1

    if result.state == "filled" and result.filled_quantity.value > 0:
        _settle(db, user, order=order, result_quantity=result.filled_quantity,
                price_cents=result.average_price_cents, cost_cents=result.cost_cents,
                mode=mode, account=account, positions=positions, now=now)
    return order


def _settle(
    db: Session,
    user: User,
    *,
    order: TradeOrder,
    result_quantity: Quantity,
    price_cents: int,
    cost_cents: int,
    mode: str,
    account: TradingAccount,
    positions: dict[str, TradingPosition],
    now: datetime,
) -> None:
    """Fold a fill into the position, the cash and the counters.

    `engines/paper_book.apply_fill` does the arithmetic for a live fill exactly
    as it does for a simulated one — see that module on why a sandbox that
    counted money differently would teach the wrong lesson.
    """
    from app.engines.paper_book import Fill  # local: only this function needs it

    row = positions.get(order.symbol)
    before = _position_state(row)
    outcome = apply_fill(
        position=before, cash_cents=account.cash_cents, side=order.side,
        fill=Fill(state="filled", quantity=result_quantity, price_cents=price_cents,
                  cost_cents=cost_cents),
    )

    if row is None:
        row = TradingPosition(
            user_id=user.id, mode=mode, symbol=order.symbol,
            quantity=str(outcome.position.quantity),
            average_price_cents=outcome.position.average_price_cents,
            updated_at=now,
        )
        db.add(row)
        positions[order.symbol] = row
    else:
        row.quantity = str(outcome.position.quantity)
        row.average_price_cents = outcome.position.average_price_cents
        row.updated_at = now

    account.cash_cents = outcome.cash_cents
    account.realised_pnl_today_cents += outcome.realised_pnl_cents
    account.realised_pnl_total_cents += outcome.realised_pnl_cents
    order.realised_pnl_cents = outcome.realised_pnl_cents

    audit.append(
        db, user, kind="order_filled", actor="system",
        payload={"order_id": order.id, "symbol": order.symbol, "side": order.side,
                 "quantity": str(result_quantity), "price_cents": price_cents,
                 "realised_pnl_cents": outcome.realised_pnl_cents},
    )


def equity_cents(
    account: TradingAccount, positions: dict[str, TradingPosition],
    prices: dict[str, int],
) -> int:
    """Cash plus positions at the prices given. `prices` is passed in rather
    than fetched: valuing a portfolio is not this function's job, and a
    silently stale price inside an equity figure is how a drawdown ceiling
    stops working."""
    held = 0
    for symbol, row in positions.items():
        price = prices.get(symbol)
        if price is None:
            # A position with no known price is excluded, exactly as
            # `engines/allocation.py` excludes a holding it could not value.
            continue
        held += value_cents(parse_quantity(row.quantity), price)
    return account.cash_cents + held


def unrealised_cents(
    positions: dict[str, TradingPosition], prices: dict[str, int]
) -> int:
    total = 0
    for symbol, row in positions.items():
        price = prices.get(symbol)
        if price is None:
            continue
        total += unrealised_pnl_cents(_position_state(row), price)
    return total


__all__ = [
    "ZERO", "CycleReport", "SymbolOutcome", "account_for", "armed", "equity_cents",
    "mandate_of", "positions_of", "run_cycle", "strategy_of", "symbols_of",
    "unrealised_cents",
]
