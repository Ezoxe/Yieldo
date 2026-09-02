"""GET/POST/DELETE /api/connections.

Design §9, "Réglages → Connexions", and the phase 3 plan's Task 6. The
whole rule this router exists to enforce: **storing a key validates it with
one real call and says plainly whether it worked; reading never returns a
key -- only whether one is set, when it was last used, and the quota
window's state; deleting removes it.**

The clock is read here, once per request, as the real `datetime.now(UTC)`
-- exactly like `/api/goals` reads the real `date.today()` for the same
reason: nothing pure this router calls classifies anything by staleness,
and "is the quota window still current" must be answered against now, not
against whenever a statement was last imported.

**The quota pool is consulted BEFORE the real call, not after.** A POST
that would exceed the pre-emptive 80% ceiling never reaches
`PROVIDERS[provider].validate_key` at all -- `market/quota.py`'s own
words, "an answer with its own French sentence, not an exception," apply
here exactly as they will to Task 9's valuation client. The real call,
when it IS made, counts against the pool either way: a rejected key still
cost the provider a request.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.market import quota
from app.market.client import MarketError
from app.market.providers import PROVIDERS
from app.models import MARKET_PROVIDERS, ApiKey, QuotaWindow, User
from app.schemas.connections import ApiKeyIn, ConnectionOut, ConnectionValidationOut, QuotaStateOut
from app.security.crypto import encrypt_secret
from app.security.deps import get_current_user

router = APIRouter(prefix="/connections", tags=["connections"])


def _provider_or_404(provider: str) -> str:
    if provider not in MARKET_PROVIDERS:
        raise HTTPException(status_code=404, detail="Fournisseur de données de marché inconnu.")
    return provider


def _fetch_key(db: Session, user: User, provider: str) -> ApiKey | None:
    return db.query(ApiKey).filter(
        ApiKey.user_id == user.id, ApiKey.provider == provider
    ).first()


def _fetch_window(db: Session, user: User, provider: str) -> QuotaWindow | None:
    return db.query(QuotaWindow).filter(
        QuotaWindow.user_id == user.id, QuotaWindow.provider == provider
    ).first()


def _quota_state(window_row: QuotaWindow | None) -> quota.WindowState | None:
    if window_row is None:
        return None
    # SQLite (used both in tests and by install.sh's default deployment)
    # does not actually persist a UTC offset on a `DateTime(timezone=True)`
    # column -- a value read back is naive, even though every write in this
    # application is `datetime.now(UTC)`. Restoring that offset here, once,
    # is what lets `quota.evaluate`'s comparison against an aware `now`
    # work at all; every OTHER timestamp column in this app is read but
    # never compared against an aware value, which is why this is the
    # first place the gap surfaces.
    started_at = window_row.window_started_at
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=UTC)
    return quota.WindowState(window_started_at=started_at, used=window_row.used)


def _quota_state_out(decision: quota.QuotaDecision) -> QuotaStateOut:
    return QuotaStateOut(
        used=decision.used, limit=decision.limit, ceiling=decision.ceiling,
        remaining=decision.remaining, reset_at=decision.reset_at, can_call=decision.allowed,
    )


def _connection_out(
    provider: str, key_row: ApiKey | None, decision: quota.QuotaDecision
) -> ConnectionOut:
    return ConnectionOut(
        provider=provider,
        configured=key_row is not None,
        requires_key=PROVIDERS[provider].requires_key,
        last_used_at=None if key_row is None else key_row.last_used_at,
        quota=_quota_state_out(decision),
    )


@router.get("", response_model=list[ConnectionOut])
def list_connections(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[ConnectionOut]:
    now = datetime.now(UTC)
    out = []
    for provider in MARKET_PROVIDERS:
        window_row = _fetch_window(db, user, provider)
        decision = quota.evaluate(provider, _quota_state(window_row), now)
        out.append(_connection_out(provider, _fetch_key(db, user, provider), decision))
    return out


@router.post("/{provider}", response_model=ConnectionValidationOut)
def set_connection(
    provider: str, payload: ApiKeyIn,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
) -> ConnectionValidationOut:
    provider = _provider_or_404(provider)
    now = datetime.now(UTC)

    window_row = _fetch_window(db, user, provider)
    quota_state = _quota_state(window_row)
    decision = quota.evaluate(provider, quota_state, now)

    key_row = _fetch_key(db, user, provider)

    if not decision.allowed:
        # The pool is spent -- refused before the provider is ever called,
        # so this attempt never draws on it a second time.
        out = _connection_out(provider, key_row, decision)
        return ConnectionValidationOut(**out.model_dump(), valid=False,
                                       reason=decision.refusal_reason)

    try:
        PROVIDERS[provider].validate_key(payload.api_key)
        valid, reason = True, None
    except MarketError as exc:
        valid, reason = False, exc.message

    # The real call was made either way -- it drew on the provider's own
    # budget whether the key turned out to be good or not.
    new_state = quota.record_call(provider, quota_state, now)
    if window_row is None:
        window_row = QuotaWindow(
            user_id=user.id, provider=provider,
            window_started_at=new_state.window_started_at, used=new_state.used,
        )
        db.add(window_row)
    else:
        window_row.window_started_at = new_state.window_started_at
        window_row.used = new_state.used

    if valid:
        ciphertext = encrypt_secret(payload.api_key)
        if key_row is None:
            key_row = ApiKey(user_id=user.id, provider=provider, value=ciphertext,
                             last_used_at=now)
            db.add(key_row)
        else:
            key_row.value = ciphertext
            key_row.last_used_at = now

    db.commit()
    db.refresh(window_row)
    if key_row is not None:
        db.refresh(key_row)

    # key_row was fetched before the try/except and only ever mutated on
    # the `valid` branch above, so it already reflects the outcome here.
    final_decision = quota.evaluate(provider, _quota_state(window_row), now)
    out = _connection_out(provider, key_row, final_decision)
    return ConnectionValidationOut(**out.model_dump(), valid=valid, reason=reason)


@router.delete("/{provider}", status_code=status.HTTP_204_NO_CONTENT)
def delete_connection(
    provider: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> None:
    provider = _provider_or_404(provider)
    key_row = _fetch_key(db, user, provider)
    if key_row is None:
        raise HTTPException(
            status_code=404, detail="Aucune clé n'est enregistrée pour ce fournisseur."
        )
    db.delete(key_row)
    db.commit()
