"""Wire shapes for `/api/invest/*`.

**Reading never returns a credential.** `VenueOut` has no field that could
carry a key or a secret — not an omission at serialisation time but a shape
with nowhere to put one, exactly like `schemas/connections.ConnectionOut`.
`VenueIn` is the only schema here that ever carries a plaintext secret, and it
is a REQUEST schema.

Money is integer cents and rates are basis points everywhere, as everywhere
else in this codebase. Nothing in this module is a float.
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

# --------------------------------------------------------------------------
# Courtiers
# --------------------------------------------------------------------------

class VenueIn(BaseModel):
    venue: str
    mode: str
    label: str
    api_key: str | None = None
    api_secret: str | None = None
    base_url: str | None = None
    slippage_bps: int = Field(default=10, ge=0, le=1_000)
    price_source: str | None = None


class VenueOut(BaseModel):
    id: int
    venue: str
    label: str
    mode: str
    price_source: str
    slippage_bps: int
    enabled: bool
    # Whether credentials are on file — never what they are.
    configured: bool
    requires_credentials: bool
    sandbox_step: int
    created_at: datetime
    last_used_at: datetime | None
    last_check_at: datetime | None
    last_check_ok: bool | None
    last_check_message: str | None


class VenueCheckOut(BaseModel):
    valid: bool
    # French. The venue's own words on success, the failure's cause on refusal.
    message: str


# --------------------------------------------------------------------------
# Mandat
# --------------------------------------------------------------------------

class PolicyIn(BaseModel):
    max_position_cents: int = Field(ge=0)
    max_exposure_cents: int = Field(ge=0)
    max_order_notional_cents: int = Field(ge=0)
    max_daily_loss_cents: int = Field(ge=0)
    min_cash_buffer_cents: int = Field(ge=0)
    min_order_notional_cents: int = Field(ge=0)
    max_drawdown_bps: int = Field(ge=0, le=10_000)
    max_orders_per_day: int = Field(ge=0)
    allowed_symbols: list[str]
    allow_short: bool
    allow_leverage: bool
    allow_limit_orders: bool
    minimum_conviction: int = Field(ge=0, le=11)
    minimum_probability_bps: int = Field(ge=0, le=10_000)
    max_volatility_bps: int = Field(ge=0, le=100_000)
    full_conviction_share_bps: int = Field(ge=0, le=10_000)
    autonomy: str


class PolicyOut(PolicyIn):
    armed_until: datetime | None
    armed: bool
    halted: bool
    halted_reason: str | None
    halted_at: datetime | None
    halted_by: str | None
    orders_today: int
    realised_pnl_today_cents: int
    # The rules the model is bound by, in French — `decision/strategy.DECLARED_RULES`.
    declared_rules: list[str]
    updated_at: datetime


class ArmIn(BaseModel):
    # Typed by the household, letter for letter. The one place in this
    # application where a confirmation phrase is required, because it is the
    # one action that opens real money to software.
    confirmation: str
    minutes: int = Field(ge=1, le=1_440)


class HaltIn(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


# --------------------------------------------------------------------------
# Modèle de décision
# --------------------------------------------------------------------------

class DecisionModelIn(BaseModel):
    provider: str
    endpoint_url: str | None = None
    model_name: str | None = None
    api_key: str | None = None
    timeout_ms: int | None = Field(default=None, ge=50, le=60_000)


class DecisionModelOut(BaseModel):
    provider: str
    endpoint_url: str | None
    model_name: str | None
    timeout_ms: int
    configured: bool
    # Whether a key is on file — never the key.
    has_key: bool
    updated_at: datetime | None


class DecisionModelCheckOut(BaseModel):
    valid: bool
    message: str
    latency_ms: int | None
    # The test answer itself, when the model gave one: what it chose, and —
    # from a provider that exposes it — its whole distribution and its act
    # probability, in basis points. The screen draws the mass so a coin toss
    # looks like one on the first answer.
    choice: str | None = None
    mass_bps: dict[str, int] | None = None
    act_bps: int | None = None
    # The server's health card, from a provider that has one (Laya): the
    # checkpoint, the machine, the percentiles. None for the others.
    health: dict[str, Any] | None = None


# --------------------------------------------------------------------------
# Décisions et ordres
# --------------------------------------------------------------------------

class AnswerOut(BaseModel):
    question_key: str
    kind: str
    choice: str | None
    score_value: int | None
    probability_bps: int | None
    confidence_bps: int | None
    latency_ms: int
    raw: str


class DecisionOut(BaseModel):
    id: int
    run_id: str
    symbol: str
    mode: str
    provider: str
    model: str
    outcome: str
    rule: str | None
    message: str | None
    reference_price_cents: int | None
    latency_ms: int
    created_at: datetime
    features: dict[str, Any]
    answers: dict[str, Any]
    inputs_hash: str


class DecisionDetailOut(DecisionOut):
    """Everything the model was given and everything it answered — what the
    Salle de contrôle's detail panel prints, unsummarised."""

    windows: dict[str, Any]
    context: dict[str, Any]
    questions: list[dict[str, Any]]
    risk_verdict: dict[str, Any] | None
    order: "OrderOut | None"
    # The deterministic engine's canonical answers on the same context, when
    # the provider was a real model; None otherwise.
    second_opinion: dict[str, Any] | None = None


class OrderOut(BaseModel):
    id: int
    decision_id: int | None
    symbol: str
    mode: str
    side: str
    order_type: str
    quantity: str
    requested_quantity: str
    limit_price_cents: int | None
    reference_price_cents: int
    notional_cents: int
    status: str
    rule: str | None
    failure_reason: str | None
    external_id: str | None
    filled_quantity: str | None
    average_price_cents: int | None
    cost_cents: int
    realised_pnl_cents: int
    created_at: datetime


class PositionOut(BaseModel):
    symbol: str
    quantity: str
    average_price_cents: int
    price_cents: int | None
    market_value_cents: int | None
    unrealised_pnl_cents: int | None


class RunOut(BaseModel):
    run_id: str
    mode: str
    examined: int
    skipped: int
    held: int
    refused: int
    ordered: int
    failed: int
    summary: str
    decisions: list[DecisionOut]


class OverviewOut(BaseModel):
    mode: str
    autonomy: str
    armed: bool
    armed_until: datetime | None
    halted: bool
    halted_reason: str | None
    currency: str
    cash_cents: int
    initial_cash_cents: int
    equity_cents: int
    peak_equity_cents: int
    drawdown_bps: int
    unrealised_pnl_cents: int
    realised_pnl_today_cents: int
    realised_pnl_total_cents: int
    orders_today: int
    positions: list[PositionOut]
    # The funnel: how many instruments reached each stage, over the window.
    examined: int
    skipped: int
    held: int
    refused: int
    ordered: int
    failed: int
    # Median and worst decision latency in the window, in milliseconds. A
    # System One model is chosen for its speed; a screen that never showed it
    # would hide the one thing it was chosen for.
    latency_median_ms: int | None
    latency_worst_ms: int | None
    calibration: "CalibrationOut"
    # The model against the built-in rules, on the direction, over the window.
    second_opinion: "SecondOpinionOut"
    venue: VenueOut | None


class CalibrationBucketOut(BaseModel):
    lower_bps: int
    upper_bps: int
    count: int
    stated_bps: int
    observed_bps: int
    gap_bps: int


class CalibrationOut(BaseModel):
    observations: int
    brier_bps: int
    coin_flip_brier_bps: int
    verdict: str
    buckets: list[CalibrationBucketOut]


class DisagreementOut(BaseModel):
    decision_id: int
    symbol: str
    model_choice: str
    rules_choice: str
    created_at: datetime


class SecondOpinionOut(BaseModel):
    compared: int
    agreed: int
    agreement_bps: int
    disagreements: list[DisagreementOut]


# --------------------------------------------------------------------------
# La journée simulée
# --------------------------------------------------------------------------

class RiskProfileOut(BaseModel):
    """A ready-made mandate the screen offers to fill the form with."""

    name: str
    label: str
    summary: str
    cash_cents: int
    # The mandate body this profile proposes for `cash_cents`.
    mandate: dict[str, Any]


class SessionStartIn(BaseModel):
    steps: int = Field(default=78, ge=4, le=240)
    # The sandbox index to start at; drawn at random when absent, and echoed
    # back so the same day can be replayed under another model.
    seed: int | None = Field(default=None, ge=0, le=1_000_000)
    cash_cents: int = Field(default=1_000_000, ge=1_000, le=1_000_000_000)


class SessionPointOut(BaseModel):
    step: int
    equity_cents: int
    cash_cents: int
    exposure_cents: int
    orders: int


class SessionOut(BaseModel):
    id: int
    mode: str
    seed: int
    steps: int
    interval_minutes: int
    completed_steps: int
    status: str
    stop_requested: bool
    message: str | None
    provider: str
    model: str
    initial_cash_cents: int
    final_equity_cents: int | None
    realised_pnl_cents: int
    unrealised_pnl_cents: int
    max_drawdown_bps: int
    orders: int
    decisions: int
    started_at: datetime
    finished_at: datetime | None


class SessionDecisionOut(BaseModel):
    """A decision as the day's charts need it: where, what, how sure."""

    id: int
    step: int
    symbol: str
    outcome: str
    rule: str | None
    message: str | None
    choice: str | None
    score_value: int | None
    probability_bps: int | None
    mass_bps: dict[str, int] | None
    confidence_bps: int | None
    act_bps: int | None
    latency_ms: int
    reference_price_cents: int | None
    rules_choice: str | None
    created_at: datetime


class SessionOrderOut(BaseModel):
    id: int
    step: int | None
    symbol: str
    side: str
    status: str
    quantity: str
    notional_cents: int
    average_price_cents: int | None
    realised_pnl_cents: int
    created_at: datetime


class MassPointOut(BaseModel):
    step: int
    buy_bps: int
    sell_bps: int
    hold_bps: int


class SessionReportOut(BaseModel):
    final_equity_cents: int
    return_bps: int
    max_drawdown_bps: int
    decisions: int
    held: int
    refused: int
    ordered: int
    failed: int
    orders: int
    filled: int
    winning: int
    losing: int
    realised_pnl_cents: int
    compared: int
    agreement_bps: int
    mean_confidence_bps: int | None
    mean_act_bps: int | None
    latency_p50_ms: int | None
    mass_series: dict[str, list[MassPointOut]]


class SessionDetailOut(SessionOut):
    points: list[SessionPointOut]
    # One series per whitelisted instrument, one close per step, recomputed
    # from the seed: the market the day was played on.
    closes: dict[str, list[int]]
    symbols: list[str]
    # The rows themselves here, where the list route carries only the counts
    # (the counts are in `report`).
    decisions: list[SessionDecisionOut]  # type: ignore[assignment]
    orders: list[SessionOrderOut]  # type: ignore[assignment]
    report: SessionReportOut


# --------------------------------------------------------------------------
# Supervision
# --------------------------------------------------------------------------

class ReplayOut(BaseModel):
    decision_id: int
    # Whether the stored features and questions still hash to `inputs_hash`.
    # False means the row was edited after it was written, and nothing below
    # can be trusted.
    inputs_intact: bool
    inputs_hash_stored: str
    inputs_hash_recomputed: str
    # Whether re-running the stored inputs gives the stored answers.
    matches: bool
    stored_answers: dict[str, Any]
    replayed_answers: dict[str, Any]
    provider: str
    # French, shown verbatim: what this replay establishes and what it does not.
    verdict: str


class JournalEntryOut(BaseModel):
    sequence: int
    kind: str
    actor: str
    payload: dict[str, Any]
    entry_hash: str
    previous_hash: str
    created_at: datetime


class JournalOut(BaseModel):
    events: int
    intact: bool
    broken_at: int | None
    message: str
    next_sequence: int
    entries: list[JournalEntryOut]


DecisionDetailOut.model_rebuild()
OverviewOut.model_rebuild()
