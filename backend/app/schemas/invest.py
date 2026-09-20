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
