"""A simulated trading day: consecutive sandbox steps, one model, one curve.

`start_session` writes the row and puts the sandbox in its starting state --
the paper account back to the chosen cash, no position, the synthetic market
at `seed`. `run_session` then plays `steps` ordinary cycles through
`service.run_cycle`, exactly as « Lancer un tour » would, tagging every
decision with the day and its step, taking one point of the capital curve
after each step, and committing each step so the screen can watch.

**A day is a sequence of ordinary tours.** Nothing here sizes an order or
touches the mandate: the same `run_cycle`, the same second opinion, the same
sealed journal. The only thing this module adds is the clock -- decisions
inside a day carry a virtual time, `started_at + step × interval`, so a
6 h 30 session read back looks like one rather than like ten real minutes.

**It stops for two reasons and says which.** `stop_requested`, read from the
row between two steps, ends the day `stopped` with the points it has. A
model that fails on every instrument for `FAILURE_STREAK` consecutive steps
ends it `failed` with the provider's own French sentence -- a day of
seventy-eight « en échec » is not a result, it is an outage, and the screen
must say so rather than draw a flat line.
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from app.decision.contract import DecisionProvider
from app.engines.session_report import max_drawdown_bps
from app.models import (
    TradingPolicy,
    TradingPosition,
    TradingSession,
    TradingVenue,
    User,
)
from app.models.trading_session import DEFAULT_INTERVAL_MINUTES
from app.trading import audit, service
from app.trading.venues import factory
from app.trading.venues.base import VenueError

# How many consecutive steps with every instrument « en échec » end the day.
FAILURE_STREAK = 3


class DayAlreadyRunning(Exception):
    """A second day cannot start while one is running on the same sandbox."""


@dataclass(frozen=True)
class StepPoint:
    step: int
    equity_cents: int
    cash_cents: int
    exposure_cents: int
    orders: int

    def canonical(self) -> dict[str, int]:
        return {
            "step": self.step, "equity_cents": self.equity_cents,
            "cash_cents": self.cash_cents, "exposure_cents": self.exposure_cents,
            "orders": self.orders,
        }


def running_day(db: Session, user: User) -> TradingSession | None:
    return (
        db.query(TradingSession)
        .filter(TradingSession.user_id == user.id, TradingSession.status == "running")
        .order_by(TradingSession.id.desc())
        .first()
    )


def start_session(
    db: Session, user: User, *, venue_row: TradingVenue, steps: int, seed: int,
    cash_cents: int, provider_name: str, model: str, now: datetime,
    interval_minutes: int = DEFAULT_INTERVAL_MINUTES,
) -> TradingSession:
    """The row, the clean sandbox, the market at its seed. Flushes, does not
    commit: the caller decides when the day is visible."""
    if running_day(db, user) is not None:
        raise DayAlreadyRunning()

    service.reset_sandbox(db, user, cash_cents=cash_cents, today=now.date())
    venue_row.sandbox_step = seed

    row = TradingSession(
        user_id=user.id, venue_id=venue_row.id, mode="paper", seed=seed, steps=steps,
        interval_minutes=interval_minutes, completed_steps=0, status="running",
        stop_requested=False, provider=provider_name, model=model,
        initial_cash_cents=cash_cents, points=[], started_at=now,
    )
    db.add(row)
    db.flush()
    audit.append(
        db, user, kind="session_started", actor="session",
        payload={"session_id": row.id, "seed": seed, "steps": steps,
                 "cash_cents": cash_cents, "provider": provider_name},
    )
    return row


def _prices_of(quoting, positions: dict[str, TradingPosition]) -> dict[str, int]:
    prices: dict[str, int] = {}
    for symbol in positions:
        prices[symbol] = quoting.quote(symbol).mid_cents
    return prices


def run_session(
    db: Session, user: User, row: TradingSession, *, provider: DecisionProvider, today: date,
) -> TradingSession:
    """Play the day. Commits after every step. Returns the same row, ended."""
    policy = db.query(TradingPolicy).filter(TradingPolicy.user_id == user.id).one()
    venue_row = db.get(TradingVenue, row.venue_id)
    quoting = factory.build(venue_row)
    execution = factory.execution_adapter(venue_row, quoting)
    points: list[dict[str, int]] = list(row.points or [])
    failure_streak = 0
    orders_total = 0
    decisions_total = 0

    try:
        for step in range(row.completed_steps + 1, row.steps + 1):
            db.refresh(row, attribute_names=["stop_requested"])
            if row.stop_requested:
                row.status = "stopped"
                break

            at = row.started_at + timedelta(minutes=row.interval_minutes * (step - 1))
            report = service.run_cycle(
                db, user, policy=policy, venue_row=venue_row, quoting=quoting,
                execution=execution, provider=provider, today=today, now=at,
            )
            for outcome in report.outcomes:
                outcome.decision.session_id = row.id
                outcome.decision.session_step = step
            step_orders = sum(1 for outcome in report.outcomes if outcome.order is not None)
            orders_total += step_orders
            decisions_total += len(report.outcomes)

            account = service.account_for(db, user, "paper", today)
            positions = service.positions_of(db, user, "paper")
            prices = _prices_of(quoting, positions)
            equity = service.equity_cents(account, positions, prices)
            point = StepPoint(
                step=step, equity_cents=equity, cash_cents=account.cash_cents,
                exposure_cents=equity - account.cash_cents, orders=step_orders,
            )
            points.append(point.canonical())
            row.points = list(points)
            row.completed_steps = step
            row.orders = orders_total
            row.decisions = decisions_total
            db.commit()

            if report.examined > 0 and report.failed == report.examined:
                failure_streak += 1
                if failure_streak >= FAILURE_STREAK:
                    row.status = "failed"
                    row.message = (
                        f"Le modèle a échoué sur chaque instrument pendant {FAILURE_STREAK} pas "
                        f"de suite ; la journée s'arrête au pas {step}. Dernière cause : "
                        f"{report.outcomes[-1].decision.message}"
                    )
                    break
            else:
                failure_streak = 0
        else:
            row.status = "finished"
    except VenueError as exc:
        row.status = "failed"
        row.message = exc.message

    _close(db, user, row, points, today)
    return row


def _close(
    db: Session, user: User, row: TradingSession, points: list[dict[str, int]], today: date,
) -> None:
    account = service.account_for(db, user, "paper", today)
    final = points[-1]["equity_cents"] if points else row.initial_cash_cents
    row.final_equity_cents = final
    row.realised_pnl_cents = account.realised_pnl_total_cents
    row.unrealised_pnl_cents = final - account.cash_cents - sum(
        service.value_cents(service.parse_quantity(p.quantity), p.average_price_cents)
        for p in service.positions_of(db, user, "paper").values()
    )
    row.max_drawdown_bps = max_drawdown_bps(
        [row.initial_cash_cents, *(p["equity_cents"] for p in points)]
    )
    row.finished_at = datetime.now(row.started_at.tzinfo)
    audit.append(
        db, user, kind="session_finished", actor="system",
        payload={"session_id": row.id, "status": row.status,
                 "completed_steps": row.completed_steps,
                 "final_equity_cents": final, "orders": row.orders},
    )
    db.commit()
