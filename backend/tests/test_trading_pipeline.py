"""The whole cycle, end to end, against the simulated book.

No network: the venue is `internal` on synthetic prices and the model is the
deterministic provider. That is deliberate — an integration test whose result
depended on a live endpoint would tell you about the endpoint, not about the
pipeline.
"""

from datetime import UTC, date, datetime, timedelta

import pytest

from app.decision.contract import Decision, DecisionError, DecisionFailureCause
from app.decision.replay import ReplayProvider
from app.decision.strategy import BUY, HOLD
from app.models import (
    TradeAuditEvent,
    TradeDecision,
    TradeOrder,
    TradingAccount,
    TradingPolicy,
    TradingPosition,
    TradingVenue,
    User,
)
from app.security.passwords import hash_password
from app.trading import audit, service
from app.trading.venues import factory

TODAY = date(2026, 9, 20)
NOW = datetime(2026, 9, 20, 10, 30, tzinfo=UTC)


@pytest.fixture
def account(db):
    user = User(email="max@example.com", name="Max",
                password_hash=hash_password("motdepasse123"))
    db.add(user)
    db.flush()

    policy = TradingPolicy(
        user_id=user.id,
        max_position_cents=200_000, max_exposure_cents=1_000_000,
        max_order_notional_cents=200_000, max_daily_loss_cents=50_000,
        min_cash_buffer_cents=0, min_order_notional_cents=1_000,
        max_drawdown_bps=2_000, max_orders_per_day=20,
        allowed_symbols="AAPL,BTC-EUR",
        minimum_conviction=0, minimum_probability_bps=0, max_volatility_bps=10_000,
        full_conviction_share_bps=10_000, autonomy="paper",
    )
    venue = TradingVenue(
        user_id=user.id, venue="internal", mode="paper", label="Bac à sable",
        slippage_bps=10, price_source="synthetic", sandbox_step=500,
    )
    balance = TradingAccount(
        user_id=user.id, mode="paper", currency="EUR",
        cash_cents=1_000_000, initial_cash_cents=1_000_000, peak_equity_cents=1_000_000,
        counters_on=TODAY,
    )
    db.add_all([policy, venue, balance])
    db.commit()
    return user, policy, venue, balance


def run(db, account, *, provider=None, policy_changes=None, now=NOW):
    user, policy, venue, _ = account
    for key, value in (policy_changes or {}).items():
        setattr(policy, key, value)
    quoting = factory.build(venue)
    return service.run_cycle(
        db, user, policy=policy, venue_row=venue, quoting=quoting,
        execution=factory.execution_adapter(venue, quoting),
        provider=provider or ReplayProvider(), today=TODAY, now=now,
    )


# --- the happy path -------------------------------------------------------

def test_a_cycle_examines_every_whitelisted_instrument(db, account):
    report = run(db, account)
    db.commit()
    assert report.examined == 2
    assert {outcome.symbol for outcome in report.outcomes} == {"AAPL", "BTC-EUR"}
    assert db.query(TradeDecision).count() == 2


def test_every_decision_stores_the_features_it_actually_saw(db, account):
    run(db, account)
    db.commit()
    for row in db.query(TradeDecision).all():
        assert row.features["symbol"] == row.symbol
        assert row.inputs_hash == audit.inputs_digest(row.features, row.questions)


def test_a_decision_that_produced_an_order_carries_the_risk_verdict(db, account):
    report = run(db, account)
    db.commit()
    ordered = [o for o in report.outcomes if o.order is not None]
    assert ordered, "aucun ordre n'a été dimensionné"
    for outcome in ordered:
        assert outcome.decision.risk_verdict is not None
        assert outcome.decision.risk_verdict["decision"] in ("allowed", "reduced", "refused")


def test_a_filled_order_moves_the_cash_and_creates_the_position(db, account):
    _, _, _, balance = account
    before = balance.cash_cents
    report = run(db, account)
    db.commit()
    filled = [o.order for o in report.outcomes if o.order and o.order.status == "filled"]
    if not filled:
        pytest.skip("le marché synthétique n'a produit aucun achat à cette étape")
    assert balance.cash_cents < before
    assert db.query(TradingPosition).count() == len(filled)


# --- the whitelist is the gate --------------------------------------------

def test_an_empty_whitelist_examines_nothing(db, account):
    report = run(db, account, policy_changes={"allowed_symbols": ""})
    db.commit()
    assert report.examined == 0
    assert db.query(TradeDecision).count() == 0


def test_an_instrument_off_the_whitelist_is_never_put_to_the_model(db, account):
    """The prefilter runs before the model, so a refused instrument costs
    nothing and cannot be argued with."""
    report = run(db, account, policy_changes={"allowed_symbols": "AAPL"})
    db.commit()
    assert report.examined == 1
    assert report.outcomes[0].symbol == "AAPL"


# --- the mandate is never bypassed ----------------------------------------

def test_a_halt_stops_every_order_in_the_cycle(db, account):
    report = run(db, account, policy_changes={
        "halted": True, "halted_reason": "arrêt demandé par la supervision",
    })
    db.commit()
    assert report.ordered == 0
    for order in db.query(TradeOrder).all():
        assert order.status == "refused"
        assert order.rule == "halted"


def test_observation_mode_sizes_the_order_and_sends_nothing(db, account):
    """The counterfactual is the point: a household sees exactly what would
    have been sent."""
    report = run(db, account, policy_changes={"autonomy": "observer"})
    db.commit()
    assert report.ordered == 0
    orders = db.query(TradeOrder).all()
    if orders:
        for order in orders:
            assert order.status == "refused"
            assert order.rule == "observer_mode"
            assert order.quantity != "0"


def test_a_position_ceiling_reduces_rather_than_refuses(db, account):
    report = run(db, account, policy_changes={"max_position_cents": 20_000})
    db.commit()
    reduced = [
        o.order for o in report.outcomes
        if o.order and o.order.requested_quantity != o.order.quantity
    ]
    for order in reduced:
        assert order.notional_cents <= 20_000


def test_live_autonomy_without_an_arming_refuses_every_order(db, account):
    report = run(db, account, policy_changes={"autonomy": "live", "armed_until": None})
    db.commit()
    assert report.ordered == 0
    for order in db.query(TradeOrder).all():
        assert order.rule == "not_armed"


def test_an_expired_arming_is_not_an_arming(db, account):
    report = run(db, account, policy_changes={
        "autonomy": "live", "armed_until": NOW - timedelta(minutes=1),
    })
    db.commit()
    assert report.ordered == 0
    assert {o.rule for o in db.query(TradeOrder).all()} == {"not_armed"}


def test_armed_returns_true_only_while_the_arming_holds(db, account):
    _, policy, _, _ = account
    policy.armed_until = NOW + timedelta(minutes=30)
    assert service.armed(policy, NOW) is True
    assert service.armed(policy, NOW + timedelta(minutes=31)) is False
    policy.armed_until = None
    assert service.armed(policy, NOW) is False


# --- thresholds -----------------------------------------------------------

def test_a_conviction_threshold_above_the_scale_stops_every_order(db, account):
    report = run(db, account, policy_changes={"minimum_conviction": 11})
    db.commit()
    assert report.ordered == 0
    assert report.refused == 0
    assert report.held == 2
    for row in db.query(TradeDecision).all():
        assert row.outcome == "held"
        assert row.rule in ("conviction_threshold", "hold")


def test_a_volatility_ceiling_of_zero_skips_before_the_model(db, account):
    report = run(db, account, policy_changes={"max_volatility_bps": 0})
    db.commit()
    assert report.skipped == 2
    for row in db.query(TradeDecision).all():
        assert row.outcome == "skipped"
        assert row.rule == "volatility_ceiling"
        assert row.answers == {}  # the model was never consulted


# --- failures are recorded, never swallowed --------------------------------

class FailingProvider:
    name = "local"

    def decide(self, question, context):
        raise DecisionError(
            DecisionFailureCause.SERVICE_UNREACHABLE,
            "Le modèle auto-hébergé est injoignable (connexion refusée).",
        )


def test_a_model_failure_ends_the_instruments_turn_with_the_cause_named(db, account):
    report = run(db, account, provider=FailingProvider())
    db.commit()
    assert report.failed == 2
    assert report.ordered == 0
    for row in db.query(TradeDecision).all():
        assert row.outcome == "failed"
        assert row.rule == "service_unreachable"
        assert "injoignable" in row.message


class OffContractProvider:
    name = "local"

    def decide(self, question, context):
        return Decision(
            question_key=question.key, kind=question.kind, choice="acheter tout de suite",
            score_value=None, probability_bps=None, latency_ms=1, provider="local",
            model="fake", raw="{}",
        )


def test_an_off_contract_choice_never_becomes_an_order(db, account):
    """Even a provider that bypassed `parse_answer` cannot produce a trade:
    `size_intent` only acts on a choice it recognises."""
    report = run(db, account, provider=OffContractProvider())
    db.commit()
    assert report.ordered == 0
    assert db.query(TradeOrder).filter(TradeOrder.status != "refused").count() == 0


# --- the audit trail -------------------------------------------------------

def test_every_decision_appends_to_the_journal(db, account):
    user, _, _, _ = account
    run(db, account)
    db.commit()
    kinds = [row.kind for row in db.query(TradeAuditEvent).all()]
    assert kinds.count("decision") == 2
    assert audit.verify_chain(db, user).intact is True


def test_the_journal_survives_a_whole_cycle_intact(db, account):
    user, _, _, _ = account
    run(db, account)
    run(db, account)
    db.commit()
    report = audit.verify_chain(db, user)
    assert report.intact is True
    assert report.events >= 4


# --- the synthetic market advances ----------------------------------------

def test_the_sandbox_clock_advances_one_step_per_cycle(db, account):
    _, _, venue, _ = account
    before = venue.sandbox_step
    run(db, account)
    db.commit()
    assert venue.sandbox_step == before + 1


def test_two_cycles_at_the_same_step_see_the_same_market(db, account):
    """Determinism: the difference between two runs is the mandate, never the
    market."""
    _, _, venue, _ = account
    venue.sandbox_step = 400
    first = run(db, account)
    venue.sandbox_step = 400
    second = run(db, account)
    db.commit()
    first_features = [o.decision.features for o in first.outcomes]
    second_features = [o.decision.features for o in second.outcomes]
    assert first_features == second_features


# --- isolation -------------------------------------------------------------

def test_one_households_cycle_never_touches_anothers_rows(db, account):
    user, policy, venue, _ = account
    other = User(email="autre@example.com", name="Autre",
                 password_hash=hash_password("motdepasse123"))
    db.add(other)
    db.commit()
    run(db, account)
    db.commit()
    assert db.query(TradeDecision).filter(TradeDecision.user_id == other.id).count() == 0
    assert db.query(TradeAuditEvent).filter(TradeAuditEvent.user_id == other.id).count() == 0


# --- helpers ---------------------------------------------------------------

def test_the_counters_reset_when_the_day_turns(db, account):
    user, _, _, balance = account
    balance.orders_today = 7
    balance.realised_pnl_today_cents = -3_000
    db.commit()
    refreshed = service.account_for(db, user, "paper", TODAY + timedelta(days=1))
    assert refreshed.orders_today == 0
    assert refreshed.realised_pnl_today_cents == 0


def test_symbols_are_read_upper_cased_and_trimmed(db, account):
    _, policy, _, _ = account
    policy.allowed_symbols = " aapl , btc-eur ,, "
    assert service.symbols_of(policy) == ("AAPL", "BTC-EUR")


def test_equity_excludes_a_position_whose_price_is_unknown(db, account):
    user, _, _, balance = account
    db.add(TradingPosition(user_id=user.id, mode="paper", symbol="AAPL",
                           quantity="10", average_price_cents=10_000))
    db.commit()
    positions = service.positions_of(db, user, "paper")
    assert service.equity_cents(balance, positions, {"AAPL": 11_000}) == 1_110_000
    assert service.equity_cents(balance, positions, {}) == 1_000_000


def test_a_hold_costs_one_model_call_rather_than_three(db, account):
    class CountingProvider:
        name = "replay"

        def __init__(self):
            self.calls = 0
            self.inner = ReplayProvider()

        def decide(self, question, context):
            self.calls += 1
            decision = self.inner.decide(question, context)
            if question.key == "direction":
                return Decision(
                    question_key=decision.question_key, kind=decision.kind, choice=HOLD,
                    score_value=None, probability_bps=None, latency_ms=0,
                    provider="replay", model="test", raw="{}",
                )
            return decision

    provider = CountingProvider()
    run(db, account, provider=provider, policy_changes={"allowed_symbols": "AAPL"})
    db.commit()
    assert provider.calls == 1


def test_a_buy_is_never_larger_than_the_verdict_allowed(db, account):
    """The quantity sent is the mandate's, never the one the model asked for."""
    report = run(db, account, policy_changes={"max_position_cents": 30_000})
    db.commit()
    for outcome in report.outcomes:
        order = outcome.order
        if order is None or order.status == "refused":
            continue
        verdict = outcome.decision.risk_verdict
        assert order.quantity == verdict["quantity"]


def test_the_direction_options_are_the_ones_the_strategy_declares():
    from app.decision.strategy import DIRECTION
    assert DIRECTION.options == (BUY, "vendre", HOLD)
