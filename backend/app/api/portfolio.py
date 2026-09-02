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
from sqlalchemy.orm import Session

from app.db import get_db
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
    InstrumentIn,
    InstrumentOut,
    InvestmentAccountIn,
    InvestmentAccountOut,
    InvestmentAccountPatch,
    LotIn,
    LotOut,
    LotPatch,
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
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[InvestmentAccount]:
    return (
        db.query(InvestmentAccount)
        .filter(InvestmentAccount.user_id == user.id, InvestmentAccount.archived.is_(False))
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


@router.get("/valuation", response_model=PortfolioValuationOut)
def get_valuation(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> portfolio_engine.PortfolioValuation:
    now = datetime.now(UTC)
    reporting_currency = portfolio_engine.DEFAULT_REPORTING_CURRENCY

    rows = (
        db.query(Position, InvestmentAccount, Instrument)
        .join(InvestmentAccount, Position.investment_account_id == InvestmentAccount.id)
        .join(Instrument, Position.instrument_id == Instrument.id)
        .filter(Position.user_id == user.id)
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

    db.commit()
    return portfolio_engine.value_portfolio(inputs, reporting_currency)
