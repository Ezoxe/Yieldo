"""`/api/portfolio`: CRUD on investment accounts, positions and lots, plus
`GET /api/portfolio/valuation`.

Phase 3 plan Task 9. The CRUD routes follow the idiom every other router in
this codebase already uses (`api/debts.py`, `api/goals.py`): `_owned_*`
helpers filter on `user_id` before anything is read, patched, archived or
deleted, and `InvestmentAccount.archived` gets the same soft-delete
treatment `Debt.archived`/`Goal.archived` already do. `Position` and `Lot`
carry no `archived` column -- removing either is a real delete, and a
deleted position cascades its own lots at the database level
(`Position`'s own `ondelete="CASCADE"` on `Lot.position_id`).

`POST /api/portfolio/instruments` is the one departure from plain CRUD: a
find-or-create keyed on `(symbol, asset_class)`, never an update of an
existing row -- see `schemas.portfolio`'s own module docstring for why.

**Valuation** assembles `engines.portfolio.value_portfolio`'s input for
every one of this user's positions, then hands the result straight back
through `schemas.portfolio.PortfolioValuationOut` (`from_attributes=True`
validates directly off `engines.portfolio`'s own dataclasses -- one shape,
named once). Fetching a price or an FX rate goes through the SAME
quota-aware path `/api/connections` (Task 6) already established: the pool
is consulted BEFORE a real call, the call -- when made -- is recorded either
way, and any `MarketError` becomes that position's OWN
`price_unavailable_reason`/`fx_unavailable_reason`, never a 500 and never
silently dropped. `_QuotaTracker` exists because ONE valuation call can
price several positions through the SAME provider in a single request: the
pool has to be consulted and decremented in memory across that whole loop,
not re-read from the database (still uncommitted) on every position.

**A price is cached in `price_points` (Task 2's own table) and reused while
fresh, exactly per `market.cache`'s TTL** -- past it, a cache hit still
answers, labelled stale, rather than forcing a fresh call the quota pool
might refuse. **An FX rate has no such table**: this phase fetches it fresh
on every valuation call (still behind the SAME quota check), a deliberate
scope decision -- there are far fewer distinct foreign currencies than
priced positions in any real portfolio, so the quota pressure this leaves
unmitigated is small.

**Provider selection is fixed, not user-configurable, in this phase**:
CoinGecko for `crypto`, Finnhub for everything else that needs a real quote,
and `cash` needs no provider at all -- a cash holding is valued at par
(100 cents to the unit) without ever touching the network or the quota
pool, because a `cash` position's own quantity already IS the amount held.
FX conversion always goes through Frankfurter, the one unauthenticated,
unlimited provider among Task 5's five.

**A position with a total quantity of zero skips price and FX resolution
entirely** -- `engines.portfolio.value_portfolio` already values it at 0
unconditionally (see that module), so fetching a price for it would only
spend quota this valuation call has no need of.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.engines import allocation as allocation_engine
from app.engines import portfolio as portfolio_engine
from app.engines import quantity
from app.market import quota
from app.market.cache import CacheEntry, MarketDataKind
from app.market.cache import evaluate as cache_evaluate
from app.market.client import MarketError, Quote
from app.market.providers import PROVIDERS
from app.models import (
    INSTRUMENT_ASSET_CLASSES,
    INVESTMENT_ACCOUNT_KINDS,
    AllocationTarget,
    ApiKey,
    Instrument,
    InvestmentAccount,
    Lot,
    Position,
    PricePoint,
    QuotaWindow,
    User,
)
from app.schemas.portfolio import (
    AllocationReportOut,
    AllocationTargetOut,
    AllocationTargetsIn,
    InstrumentIn,
    InstrumentOut,
    InvestmentAccountIn,
    InvestmentAccountOut,
    InvestmentAccountPatch,
    LotIn,
    LotOut,
    LotPatch,
    PortfolioAllocationOut,
    PortfolioValuationOut,
    PositionIn,
    PositionOut,
)
from app.security.crypto import decrypt_secret
from app.security.deps import get_current_user

router = APIRouter(prefix="/portfolio", tags=["portfolio"])

# One deterministic provider per asset class needing a real quote -- see the
# module docstring. `cash` is handled separately, before this map is even
# consulted (`_resolve_quote`).
_QUOTE_PROVIDER_BY_ASSET_CLASS: dict[str, str] = {"crypto": "coingecko"}
_DEFAULT_QUOTE_PROVIDER = "finnhub"
_FX_PROVIDER = "frankfurter"

# A cash holding's own quantity already IS the amount held, in the
# instrument's own currency -- 1 unit is worth exactly 1,00 of it.
_CASH_PRICE_CENTS = 100
_CASH_SOURCE = "par"


# --- Ownership helpers, the same shape as api/debts.py's and api/goals.py's.


def _owned_account(db: Session, user: User, account_id: int) -> InvestmentAccount:
    account = db.query(InvestmentAccount).filter(
        InvestmentAccount.id == account_id, InvestmentAccount.user_id == user.id
    ).first()
    if account is None:
        raise HTTPException(status_code=404, detail="Compte d'investissement introuvable.")
    return account


def _owned_position(db: Session, user: User, position_id: int) -> Position:
    position = db.query(Position).filter(
        Position.id == position_id, Position.user_id == user.id
    ).first()
    if position is None:
        raise HTTPException(status_code=404, detail="Position introuvable.")
    return position


def _owned_lot(db: Session, user: User, lot_id: int) -> Lot:
    lot = db.query(Lot).filter(Lot.id == lot_id, Lot.user_id == user.id).first()
    if lot is None:
        raise HTTPException(status_code=404, detail="Lot introuvable.")
    return lot


def _check_account_kind(kind: str | None) -> None:
    if kind is not None and kind not in INVESTMENT_ACCOUNT_KINDS:
        raise HTTPException(
            status_code=422, detail=f"Type de compte d'investissement inconnu : {kind}"
        )


def _check_asset_class(asset_class: str) -> None:
    if asset_class not in INSTRUMENT_ASSET_CLASSES:
        raise HTTPException(status_code=422, detail=f"Classe d'actifs inconnue : {asset_class}")


# --- Instruments: read, and find-or-create.


@router.get("/instruments", response_model=list[InstrumentOut])
def list_instruments(
    symbol: str | None = Query(default=None),
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
) -> list[Instrument]:
    q = db.query(Instrument)
    if symbol:
        q = q.filter(Instrument.symbol.ilike(f"%{symbol}%"))
    return q.order_by(Instrument.symbol).all()


@router.post("/instruments", response_model=InstrumentOut)
def create_instrument(
    payload: InstrumentIn, user: User = Depends(get_current_user), db: Session = Depends(get_db),
) -> Instrument:
    """Find-or-create by `(symbol, asset_class)` -- see the module docstring.
    Always answers 200, whether the row already existed or was just
    created: this is an idempotent lookup-or-register, not a creation a
    caller needs to distinguish from a hit."""
    _check_asset_class(payload.asset_class)
    existing = db.query(Instrument).filter(
        Instrument.symbol == payload.symbol, Instrument.asset_class == payload.asset_class
    ).first()
    if existing is not None:
        return existing
    instrument = Instrument(**payload.model_dump())
    db.add(instrument)
    db.commit()
    db.refresh(instrument)
    return instrument


# --- Investment accounts.


@router.get("/accounts", response_model=list[InvestmentAccountOut])
def list_accounts(
    archived: bool = Query(default=False),
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
) -> list[InvestmentAccount]:
    """Active envelopes by default. `?archived=true` lists the archived ones
    instead -- the un-archive path: `InvestmentAccountPatch.archived` already
    accepts `false` and restores one, but that PATCH needs the account's id,
    and an archived account is otherwise invisible through this API. Without
    this, archiving would be one-way by accident."""
    return (
        db.query(InvestmentAccount)
        .filter(InvestmentAccount.user_id == user.id, InvestmentAccount.archived.is_(archived))
        .order_by(InvestmentAccount.id)
        .all()
    )


@router.post("/accounts", response_model=InvestmentAccountOut, status_code=status.HTTP_201_CREATED)
def create_account(
    payload: InvestmentAccountIn, user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InvestmentAccount:
    _check_account_kind(payload.kind)
    account = InvestmentAccount(user_id=user.id, **payload.model_dump())
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


@router.patch("/accounts/{account_id}", response_model=InvestmentAccountOut)
def patch_account(
    account_id: int, payload: InvestmentAccountPatch,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
) -> InvestmentAccount:
    account = _owned_account(db, user, account_id)
    _check_account_kind(payload.kind)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(account, field, value)
    db.commit()
    db.refresh(account)
    return account


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    account_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> None:
    """Archiving, not deleting: matches `Debt`/`Goal` -- a closed account is
    still part of the household's history."""
    account = _owned_account(db, user, account_id)
    account.archived = True
    db.commit()


# --- Positions.


@router.get("/positions", response_model=list[PositionOut])
def list_positions(
    account_id: int | None = Query(default=None),
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
) -> list[Position]:
    q = db.query(Position).filter(Position.user_id == user.id)
    if account_id is not None:
        q = q.filter(Position.investment_account_id == account_id)
    return q.order_by(Position.id).all()


@router.post("/positions", response_model=PositionOut, status_code=status.HTTP_201_CREATED)
def create_position(
    payload: PositionIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Position:
    _owned_account(db, user, payload.investment_account_id)
    if db.get(Instrument, payload.instrument_id) is None:
        raise HTTPException(status_code=404, detail="Instrument introuvable.")
    existing = db.query(Position).filter(
        Position.investment_account_id == payload.investment_account_id,
        Position.instrument_id == payload.instrument_id,
    ).first()
    if existing is not None:
        raise HTTPException(
            status_code=422,
            detail="Une position existe déjà pour cet instrument dans ce compte.",
        )
    position = Position(
        user_id=user.id, investment_account_id=payload.investment_account_id,
        instrument_id=payload.instrument_id,
    )
    db.add(position)
    db.commit()
    db.refresh(position)
    return position


@router.delete("/positions/{position_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_position(
    position_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> None:
    """A real delete -- Position has no archived column, and its lots
    cascade with it at the database level."""
    position = _owned_position(db, user, position_id)
    db.delete(position)
    db.commit()


# --- Lots.


@router.get("/lots", response_model=list[LotOut])
def list_lots(
    position_id: int | None = Query(default=None),
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
) -> list[Lot]:
    if position_id is not None:
        _owned_position(db, user, position_id)
    q = db.query(Lot).filter(Lot.user_id == user.id)
    if position_id is not None:
        q = q.filter(Lot.position_id == position_id)
    return q.order_by(Lot.id).all()


@router.post("/lots", response_model=LotOut, status_code=status.HTTP_201_CREATED)
def create_lot(
    payload: LotIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Lot:
    _owned_position(db, user, payload.position_id)
    lot = Lot(user_id=user.id, **payload.model_dump())
    db.add(lot)
    db.commit()
    db.refresh(lot)
    return lot


@router.patch("/lots/{lot_id}", response_model=LotOut)
def patch_lot(
    lot_id: int, payload: LotPatch,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
) -> Lot:
    lot = _owned_lot(db, user, lot_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(lot, field, value)
    db.commit()
    db.refresh(lot)
    return lot


@router.delete("/lots/{lot_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lot(
    lot_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> None:
    lot = _owned_lot(db, user, lot_id)
    db.delete(lot)
    db.commit()


# --- Valuation.


def _aware(value: datetime) -> datetime:
    """SQLite (tests, and install.sh's default deployment) does not persist
    a UTC offset on a `DateTime(timezone=True)` column -- a value read back
    is naive even though every write here is `datetime.now(UTC)`. Restores
    it, the same fix `api/connections.py` already applies for the identical
    reason."""
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


class _QuotaTracker:
    """In-memory quota state for ONE valuation request, across however many
    positions it prices through the same provider. Reading `QuotaWindow`
    fresh from the database on every position would miss every earlier call
    THIS SAME request already made but has not committed yet -- so state is
    loaded once per provider and updated in memory as each real call is
    recorded, exactly mirroring what `record_call` would compute if it were
    re-read from a freshly committed row."""

    def __init__(self, db: Session, user: User, now: datetime) -> None:
        self._db = db
        self._user = user
        self._now = now
        self._rows: dict[str, QuotaWindow | None] = {}
        self._states: dict[str, quota.WindowState | None] = {}

    def _load(self, provider: str) -> quota.WindowState | None:
        if provider not in self._states:
            row = self._db.query(QuotaWindow).filter(
                QuotaWindow.user_id == self._user.id, QuotaWindow.provider == provider
            ).first()
            self._rows[provider] = row
            self._states[provider] = (
                None if row is None
                else quota.WindowState(
                    window_started_at=_aware(row.window_started_at), used=row.used
                )
            )
        return self._states[provider]

    def decision(self, provider: str) -> quota.QuotaDecision:
        return quota.evaluate(provider, self._load(provider), self._now)

    def record(self, provider: str) -> None:
        new_state = quota.record_call(provider, self._states.get(provider), self._now)
        self._states[provider] = new_state
        row = self._rows.get(provider)
        if row is None:
            row = QuotaWindow(
                user_id=self._user.id, provider=provider,
                window_started_at=new_state.window_started_at, used=new_state.used,
            )
            self._db.add(row)
            self._rows[provider] = row
        else:
            row.window_started_at = new_state.window_started_at
            row.used = new_state.used


def _decrypt_key(db: Session, user: User, provider: str) -> str | None:
    row = db.query(ApiKey).filter(ApiKey.user_id == user.id, ApiKey.provider == provider).first()
    return None if row is None else decrypt_secret(row.value)


def _quote_from_row(row: PricePoint, is_stale: bool) -> portfolio_engine.PriceQuote:
    return portfolio_engine.PriceQuote(
        price_cents=row.price_cents, as_of=row.as_of, fetched_at=_aware(row.fetched_at),
        source=row.source, is_stale=is_stale,
    )


def _upsert_price_point(db: Session, instrument_id: int, quote_row: Quote) -> None:
    row = db.query(PricePoint).filter(
        PricePoint.instrument_id == instrument_id, PricePoint.as_of == quote_row.as_of
    ).first()
    if row is None:
        db.add(PricePoint(
            instrument_id=instrument_id, as_of=quote_row.as_of, price_cents=quote_row.price_cents,
            source=quote_row.source, fetched_at=quote_row.fetched_at,
        ))
    else:
        row.price_cents = quote_row.price_cents
        row.source = quote_row.source
        row.fetched_at = quote_row.fetched_at


def _resolve_quote(
    db: Session, tracker: _QuotaTracker, user: User, instrument: Instrument, now: datetime
) -> tuple[portfolio_engine.PriceQuote | None, str | None]:
    if instrument.asset_class == "cash":
        return portfolio_engine.PriceQuote(
            price_cents=_CASH_PRICE_CENTS, as_of=now.date(), fetched_at=now,
            source=_CASH_SOURCE, is_stale=False,
        ), None

    provider = _QUOTE_PROVIDER_BY_ASSET_CLASS.get(instrument.asset_class, _DEFAULT_QUOTE_PROVIDER)

    cached_row = (
        db.query(PricePoint)
        .filter(PricePoint.instrument_id == instrument.id)
        .order_by(PricePoint.fetched_at.desc())
        .first()
    )
    lookup = cache_evaluate(
        None if cached_row is None
        else CacheEntry(value=cached_row, fetched_at=_aware(cached_row.fetched_at)),
        MarketDataKind.QUOTE, now,
    )
    if lookup.value is not None and not lookup.is_stale:
        return _quote_from_row(lookup.value, False), None

    decision = tracker.decision(provider)
    if not decision.allowed:
        if lookup.value is not None:
            return _quote_from_row(lookup.value, True), None
        return None, decision.refusal_reason

    api_key = _decrypt_key(db, user, provider)
    try:
        fresh = PROVIDERS[provider].fetch_quote(instrument.symbol, api_key, now=now)
    except MarketError as exc:
        tracker.record(provider)
        if lookup.value is not None:
            return _quote_from_row(lookup.value, True), None
        return None, exc.message

    tracker.record(provider)
    _upsert_price_point(db, instrument.id, fresh)
    return portfolio_engine.PriceQuote(
        price_cents=fresh.price_cents, as_of=fresh.as_of, fetched_at=fresh.fetched_at,
        source=fresh.source, is_stale=False,
    ), None


def _resolve_fx(
    tracker: _QuotaTracker, base_currency: str, reporting_currency: str, now: datetime
) -> tuple[str | None, str | None]:
    decision = tracker.decision(_FX_PROVIDER)
    if not decision.allowed:
        return None, decision.refusal_reason
    try:
        rate = PROVIDERS[_FX_PROVIDER].fetch_rate(base_currency, reporting_currency, None, now=now)
    except MarketError as exc:
        tracker.record(_FX_PROVIDER)
        return None, exc.message
    tracker.record(_FX_PROVIDER)
    return rate.rate, None


def valuation_inputs(
    db: Session, user: User, now: datetime, reporting_currency: str
) -> list[portfolio_engine.PositionInput]:
    """Every one of this user's positions, with its price and FX rate already
    resolved -- the single assembly step both `GET /valuation` and `GET
    /allocation` run.

    Extracted rather than duplicated: the two routes must answer from the
    SAME prices, the same quota decisions and the same cached price points,
    or a household would see a portfolio total on one panel that the drift
    on the panel beside it could not be derived from. It commits, because
    resolving a price writes both a `PricePoint` and the `QuotaWindow` row
    that records the call was made.
    """
    rows = (
        db.query(Position, InvestmentAccount, Instrument)
        .join(InvestmentAccount, Position.investment_account_id == InvestmentAccount.id)
        .join(Instrument, Position.instrument_id == Instrument.id)
        .filter(
            Position.user_id == user.id,
            # An archived envelope is how the operator says it is no longer
            # part of his patrimoine -- see the module docstring's Task 9
            # note and `list_accounts`. Counting it here would inflate every
            # total and every weight on the screen for something already
            # declared gone; `GET /accounts` alone excluding it is not
            # enough, since this query never reads that route's result.
            InvestmentAccount.archived.is_(False),
        )
        .order_by(Position.id)
        .all()
    )

    lots_by_position: dict[int, list[Lot]] = {}
    for lot in db.query(Lot).filter(Lot.user_id == user.id).all():
        lots_by_position.setdefault(lot.position_id, []).append(lot)

    tracker = _QuotaTracker(db, user, now)
    price_cache: dict[int, tuple[portfolio_engine.PriceQuote | None, str | None]] = {}
    fx_cache: dict[str, tuple[str | None, str | None]] = {}

    inputs: list[portfolio_engine.PositionInput] = []
    for position, account, instrument in rows:
        lot_holdings = [
            portfolio_engine.LotHolding(
                quantity=quantity.parse(lot.quantity), unit_cost_cents=lot.unit_cost_cents
            )
            for lot in lots_by_position.get(position.id, [])
        ]
        total_quantity = quantity.parse("0")
        for holding in lot_holdings:
            total_quantity = total_quantity + holding.quantity

        if total_quantity.value == 0:
            # Nothing to price -- value_portfolio values this at 0
            # unconditionally regardless of what is passed here (see its
            # own docstring), so resolving a price/FX rate would only
            # spend quota this valuation call has no need of.
            price, price_reason = None, None
            fx_rate, fx_reason = None, None
        else:
            if instrument.id not in price_cache:
                price_cache[instrument.id] = _resolve_quote(db, tracker, user, instrument, now)
            price, price_reason = price_cache[instrument.id]

            fx_rate, fx_reason = None, None
            if instrument.currency != reporting_currency:
                if instrument.currency not in fx_cache:
                    fx_cache[instrument.currency] = _resolve_fx(
                        tracker, instrument.currency, reporting_currency, now
                    )
                fx_rate, fx_reason = fx_cache[instrument.currency]

        inputs.append(portfolio_engine.PositionInput(
            position_id=position.id, account_id=account.id, symbol=instrument.symbol,
            name=instrument.name, asset_class=instrument.asset_class, currency=instrument.currency,
            is_fractionable=instrument.is_fractionable, lots=lot_holdings, price=price,
            price_unavailable_reason=price_reason, fx_rate_to_reporting=fx_rate,
            fx_unavailable_reason=fx_reason,
        ))

    try:
        db.commit()
    except IntegrityError:
        # A concurrent request from the SAME user resolved the same prices and
        # inserted the same rows first -- `quota_windows` is unique on
        # `(user_id, provider)` and `price_points` on `(instrument_id, as_of)`,
        # so the second writer collides. Reproduced 5 times out of 5 on a
        # cold database by loading `/patrimoine`, which reads two routes that
        # both go through here.
        #
        # **This is not a swallowed failure, and nothing is invented.** The
        # answer being returned was computed in full BEFORE any write: every
        # price above was either resolved or has its own French cause attached.
        # What lost the race is only the persistence of a cache row and a call
        # counter, and the writer that won wrote the identical facts -- so
        # rolling back leaves the database in exactly the state this request
        # would have produced.
        #
        # The one real cost is bounded and deliberate: our own increment of the
        # call counter is dropped, so a provider call may go uncounted. The
        # pool's ceiling is pre-emptively 20 % below the published limit
        # (`market/quota.py`), which is far more headroom than the occasional
        # lost increment a genuine race can cost.
        db.rollback()
    return inputs


@router.get("/valuation", response_model=PortfolioValuationOut)
def get_valuation(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> portfolio_engine.PortfolioValuation:
    now = datetime.now(UTC)
    reporting_currency = portfolio_engine.DEFAULT_REPORTING_CURRENCY
    inputs = valuation_inputs(db, user, now, reporting_currency)
    return portfolio_engine.value_portfolio(inputs, reporting_currency)


# --- Target allocation, drift and the trades that would close it.


def _owned_targets(db: Session, user: User) -> list[AllocationTarget]:
    return (
        db.query(AllocationTarget)
        .filter(AllocationTarget.user_id == user.id)
        .order_by(AllocationTarget.asset_class)
        .all()
    )


@router.get("/targets", response_model=list[AllocationTargetOut])
def list_targets(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[AllocationTarget]:
    return _owned_targets(db, user)


@router.put("/targets", response_model=list[AllocationTargetOut])
def replace_targets(
    payload: AllocationTargetsIn,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
) -> list[AllocationTarget]:
    """The WHOLE set, replaced in one call -- never a per-row edit.

    `engines.allocation.validate_targets` refuses a set that does not sum to
    exactly 100 %, an invariant that spans rows: patching one target could
    only ever leave the stored set in a state `GET /allocation` would refuse
    to read back. So the set is validated BEFORE anything is written and the
    replacement happens inside one commit -- a refused payload leaves the
    previously stored targets exactly as they were, rather than half-landing.

    An empty list is deliberately accepted and skips the engine's guard: it
    means "I have declared no target allocation", which is where every
    household starts and is not the same thing as a set that sums wrong.
    """
    for target in payload.targets:
        # Checked here, against the same tuple `weight_by_asset_class` groups
        # on, so a target can never key on a vocabulary the valuation does
        # not use. The engine has no opinion on which classes exist.
        _check_asset_class(target.asset_class)

    engine_targets = [
        allocation_engine.AllocationTarget(
            asset_class=target.asset_class, target_bps=target.target_bps
        )
        for target in payload.targets
    ]
    if engine_targets:
        try:
            allocation_engine.validate_targets(engine_targets)
        except ValueError as exc:
            # The engine raises in French already -- the same catch-and-forward
            # idiom `api/feasibility.py` uses for its own engines' guards.
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    db.query(AllocationTarget).filter(AllocationTarget.user_id == user.id).delete()
    for target in payload.targets:
        db.add(AllocationTarget(
            user_id=user.id, asset_class=target.asset_class, target_bps=target.target_bps
        ))
    db.commit()
    return _owned_targets(db, user)


NO_TARGETS_REASON = (
    "Aucune allocation cible n'est définie : déclarez la répartition visée par classe "
    "d'actifs (leur somme doit faire 100 %) pour que Yieldo puisse mesurer l'écart avec "
    "votre répartition actuelle."
)


def _holding_inputs(
    inputs: list[portfolio_engine.PositionInput],
    valuation: portfolio_engine.PortfolioValuation,
    reporting_currency: str,
) -> list[allocation_engine.HoldingInput]:
    """`engines.allocation`'s own input shape, built from the valuation that
    was just computed and the resolved inputs it came from.

    **One holding per POSITION, not per instrument.** A symbol held in two
    accounts appears twice, and the trade the engine proposes is sized
    against whichever of the two is larger. That keeps `holdings_total` and
    `holdings_valued` numerically identical to the valuation's own
    `positions_total`/`positions_valued`, so the two panels on `/patrimoine`
    can never print counts that contradict each other.

    `price_reporting_cents` is the price of ONE unit expressed in the
    reporting currency -- `convert_cents` applied to the position's own
    native price through the SAME rate its market value went through.
    Sizing a trade against the native price would propose the wrong quantity
    for every foreign-currency holding.

    It is `None` where no price was resolved at all, and -- the one case
    where it is None while the market value is still known -- for a position
    whose lots sum to zero units: `engines.portfolio` values that at a real
    0 without ever consulting a price, so the value is known and the unit
    price genuinely is not. The engine already filters trade candidates on a
    known, positive price, so such a holding contributes its (zero) value to
    its class and is never proposed as a trade.
    """
    by_id = {position.position_id: position for position in inputs}
    holdings: list[allocation_engine.HoldingInput] = []
    for valued in valuation.positions:
        source = by_id[valued.position_id]
        price_reporting = (
            None if valued.price is None
            else portfolio_engine.convert_cents(
                valued.price.price_cents, valued.currency, reporting_currency,
                source.fx_rate_to_reporting,
            )
        )
        holdings.append(allocation_engine.HoldingInput(
            symbol=valued.symbol, name=valued.name, asset_class=valued.asset_class,
            is_fractionable=source.is_fractionable,
            quantity=quantity.parse(valued.quantity),
            price_reporting_cents=price_reporting,
            market_value_reporting_cents=valued.market_value_reporting_cents,
        ))
    return holdings


@router.get("/allocation", response_model=PortfolioAllocationOut)
def get_allocation(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> PortfolioAllocationOut:
    """Target allocation, current drift, and the trades that would close it.

    A household that has declared no targets gets a 200 carrying the French
    sentence saying so, never an error and never an all-zero report: there
    is no drift from a target nobody set, and a report full of zeroes would
    be a measurement nobody made.

    The valuation is recomputed here rather than read from `GET /valuation`:
    both routes go through `valuation_inputs`, so the prices, the quota
    decisions and the cache are the same either way -- but a screen that
    called both would otherwise depend on the ORDER it called them in.
    """
    now = datetime.now(UTC)
    reporting_currency = portfolio_engine.DEFAULT_REPORTING_CURRENCY
    rows = _owned_targets(db, user)
    targets_out = [AllocationTargetOut.model_validate(row) for row in rows]

    if not rows:
        return PortfolioAllocationOut(
            reporting_currency=reporting_currency, targets=targets_out,
            report=None, unavailable_reason=NO_TARGETS_REASON,
        )

    inputs = valuation_inputs(db, user, now, reporting_currency)
    valuation = portfolio_engine.value_portfolio(inputs, reporting_currency)
    holdings = _holding_inputs(inputs, valuation, reporting_currency)

    try:
        report = allocation_engine.evaluate_allocation(
            holdings,
            [
                allocation_engine.AllocationTarget(
                    asset_class=row.asset_class, target_bps=row.target_bps
                )
                for row in rows
            ],
            reporting_currency,
        )
    except ValueError as exc:
        # `PUT /targets` validates before storing, so a stored set that no
        # longer passes means the rows were edited outside this API. Surfaced
        # in the engine's own French rather than swallowed into a blank panel.
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return PortfolioAllocationOut(
        reporting_currency=reporting_currency, targets=targets_out,
        report=AllocationReportOut.model_validate(report), unavailable_reason=None,
    )
