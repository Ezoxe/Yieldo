"""A simulated day, step by step: the runner over the sandbox with the
deterministic provider, so the whole thing takes a second."""

from datetime import UTC, date, datetime

import pytest

from app.decision.contract import Decision, DecisionFailureCause, decision_error
from app.decision.replay import ReplayProvider
from app.models import (
    TradeAuditEvent,
    TradeDecision,
    TradeOrder,
    TradingAccount,
    TradingPolicy,
    TradingPosition,
    TradingSession,
    TradingVenue,
    User,
)
from app.security.passwords import hash_password
from app.trading import session as day

TODAY = date(2026, 9, 21)
NOW = datetime(2026, 9, 21, 9, 0, tzinfo=UTC)
SEED = 520


@pytest.fixture
def household(db):
    user = User(email="max@example.com", name="Max",
                password_hash=hash_password("motdepasse123"))
    db.add(user)
    db.flush()
    policy = TradingPolicy(
        user_id=user.id,
        max_position_cents=200_000, max_exposure_cents=1_000_000,
        max_order_notional_cents=200_000, max_daily_loss_cents=50_000,
        min_cash_buffer_cents=0, min_order_notional_cents=1_000,
        max_drawdown_bps=2_000, max_orders_per_day=50,
        allowed_symbols="AAPL,BTC-EUR",
        minimum_conviction=0, minimum_probability_bps=0, max_volatility_bps=10_000,
        full_conviction_share_bps=10_000, autonomy="paper",
    )
    venue = TradingVenue(
        user_id=user.id, venue="internal", mode="paper", label="Bac à sable",
        slippage_bps=10, price_source="synthetic", sandbox_step=3,
    )
    # A stale position and a stale balance: a day starts from a clean sandbox.
    balance = TradingAccount(
        user_id=user.id, mode="paper", currency="EUR",
        cash_cents=12, initial_cash_cents=12, peak_equity_cents=12, counters_on=TODAY,
    )
    db.add_all([policy, venue, balance])
    db.flush()
    db.add(TradingPosition(user_id=user.id, mode="paper", symbol="AAPL",
                           quantity="3", average_price_cents=1_000))
    db.commit()
    return user, policy, venue


def start(db, household, **overrides):
    user, policy, venue = household
    kwargs = {"steps": 8, "seed": SEED, "cash_cents": 1_000_000, "provider_name": "replay",
              "model": "yieldo-regles-1", "now": NOW}
    kwargs.update(overrides)
    return day.start_session(db, user, venue_row=venue, **kwargs)


def test_a_day_starts_from_a_clean_sandbox_at_its_seed(db, household):
    user, _, venue = household
    row = start(db, household)
    db.commit()
    assert row.status == "running"
    assert row.seed == SEED
    assert venue.sandbox_step == SEED
    account = db.query(TradingAccount).filter_by(user_id=user.id, mode="paper").one()
    assert account.cash_cents == 1_000_000
    assert db.query(TradingPosition).filter_by(user_id=user.id).count() == 0
    kinds = [row.kind for row in db.query(TradeAuditEvent).order_by(TradeAuditEvent.id)]
    assert kinds[-1] == "session_started"


def test_a_day_runs_every_step_and_records_one_point_per_step(db, household):
    user, _, venue = household
    row = start(db, household)
    db.commit()
    day.run_session(db, user, row, provider=ReplayProvider(), today=TODAY)

    assert row.status == "finished"
    assert row.completed_steps == 8
    assert [point["step"] for point in row.points] == list(range(1, 9))
    assert venue.sandbox_step == SEED + 8
    assert row.finished_at is not None
    assert row.final_equity_cents == row.points[-1]["equity_cents"]
    assert row.decisions == db.query(TradeDecision).filter_by(session_id=row.id).count()
    assert row.decisions == 16
    steps = sorted({d.session_step for d in db.query(TradeDecision).filter_by(session_id=row.id)})
    assert steps == list(range(1, 9))
    # Decisions carry the day's virtual clock: five minutes per step.
    first = db.query(TradeDecision).filter_by(session_id=row.id, session_step=1).first()
    last = db.query(TradeDecision).filter_by(session_id=row.id, session_step=8).first()
    assert (last.created_at - first.created_at).total_seconds() == 7 * 5 * 60
    assert row.orders == db.query(TradeOrder).filter_by(user_id=user.id).count()
    kinds = [event.kind for event in db.query(TradeAuditEvent).order_by(TradeAuditEvent.id)]
    assert kinds[-1] == "session_finished"


def test_the_capital_curve_is_cash_plus_positions_at_the_step_price(db, household):
    user, _, _ = household
    row = start(db, household, steps=6)
    db.commit()
    day.run_session(db, user, row, provider=ReplayProvider(), today=TODAY)
    for point in row.points:
        assert point["equity_cents"] == point["cash_cents"] + point["exposure_cents"]
        assert point["exposure_cents"] >= 0
    assert row.max_drawdown_bps >= 0


def test_a_stop_requested_between_two_steps_ends_the_day_as_stopped(db, household):
    user, _, _ = household
    row = start(db, household)
    db.commit()

    class StopsAfterThree:
        name = "replay"

        def __init__(self):
            self.inner = ReplayProvider()
            self.calls = 0

        def decide(self, question, context):
            self.calls += 1
            # Two instruments a step: the fourth direction question is step 2.
            if question.key == "direction" and self.calls >= 5:
                row.stop_requested = True
            return self.inner.decide(question, context)

    day.run_session(db, user, row, provider=StopsAfterThree(), today=TODAY)
    assert row.status == "stopped"
    assert 0 < row.completed_steps < 8
    assert len(row.points) == row.completed_steps


def test_a_model_that_fails_every_time_ends_the_day_as_failed_naming_the_cause(db, household):
    user, _, _ = household
    row = start(db, household, steps=5)
    db.commit()

    class Down:
        name = "laya"

        def decide(self, question, context):
            raise decision_error(DecisionFailureCause.SERVICE_UNREACHABLE, "laya", "refusé")

    day.run_session(db, user, row, provider=Down(), today=TODAY)
    assert row.status == "failed"
    assert row.message is not None
    assert "laya" in row.message.lower()
    # It gave up after the failure streak, not after all five steps.
    assert row.completed_steps < 5


def test_a_real_model_keeps_the_rules_second_opinion_inside_a_day(db, household):
    user, _, _ = household
    row = start(db, household, steps=2, provider_name="laya", model="test")

    class AlwaysHold:
        name = "laya"

        def decide(self, question, context):
            return Decision(question_key="direction", kind="choice", choice="ne rien faire",
                            score_value=None, probability_bps=None, latency_ms=1,
                            provider="laya", model="test", raw="{}")

    db.commit()
    day.run_session(db, user, row, provider=AlwaysHold(), today=TODAY)
    decisions = db.query(TradeDecision).filter_by(session_id=row.id).all()
    assert decisions
    assert all(d.second_opinion is not None for d in decisions)


def test_a_seed_replays_the_same_prices(db, household):
    user, _, venue = household
    first = start(db, household, steps=4)
    db.commit()
    day.run_session(db, user, first, provider=ReplayProvider(), today=TODAY)
    prices_first = [
        d.reference_price_cents
        for d in db.query(TradeDecision).filter_by(session_id=first.id).order_by(TradeDecision.id)
    ]
    venue.sandbox_step = 9_999
    second = start(db, household, steps=4)
    db.commit()
    day.run_session(db, user, second, provider=ReplayProvider(), today=TODAY)
    prices_second = [
        d.reference_price_cents
        for d in db.query(TradeDecision).filter_by(session_id=second.id).order_by(TradeDecision.id)
    ]
    assert prices_first == prices_second


def test_only_one_day_runs_at_a_time(db, household):
    start(db, household)
    db.commit()
    with pytest.raises(day.DayAlreadyRunning):
        start(db, household)
    assert db.query(TradingSession).count() == 1
