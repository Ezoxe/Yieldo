"""GET/PUT /api/invest/model — which decision model answers.

`get_session_user` throughout, like `api/connections.py` and for the same
reason: the row holds a credential to a service outside this machine, and an
agent access key must not be able to walk off with it or to point the pipeline
at a model of its own choosing.

**Storing settings validates them with one real question.** The model is asked
the strategy's own `direction` question against a fixed, obviously synthetic
context, and the answer must come back inside the contract. A model that
cannot answer one typed question is a model that would fail on the first
instrument of the first cycle, and finding that out here costs nothing.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.decision.contract import PROVIDERS, DecisionError
from app.decision.registry import DEFAULT_TIMEOUT_MS, build_provider
from app.decision.strategy import DIRECTION
from app.models import DecisionSettings, User
from app.schemas.invest import DecisionModelCheckOut, DecisionModelIn, DecisionModelOut
from app.security.crypto import encrypt_secret
from app.security.deps import get_session_user
from app.trading import audit

router = APIRouter(prefix="/invest/model", tags=["invest"])

# What the validation question is asked about. Deliberately a made-up
# instrument with round figures: it is a check that the model answers in the
# contract, not a measurement of anything, and a real symbol here would put a
# meaningless decision in front of someone reading the screen.
PROBE_CONTEXT = {
    "instrument": "TEST-VERIFICATION",
    "dernier_cours_centimes": 10_000,
    "moyenne_courte_centimes": 10_200,
    "moyenne_longue_centimes": 9_800,
    "tendance_points_de_base": 408,
    "momentum_points_de_base": 250,
    "rsi_points_de_base": 6_200,
    "volatilite_points_de_base": 120,
    "repli_depuis_le_plus_haut_points_de_base": 80,
    "position_dans_le_canal_points_de_base": 7_400,
    "cours_observes": 120,
    "position_detenue": None,
}


def _out(row: DecisionSettings | None) -> DecisionModelOut:
    if row is None:
        return DecisionModelOut(
            provider="local", endpoint_url=None, model_name=None,
            timeout_ms=DEFAULT_TIMEOUT_MS, configured=False, has_key=False,
            updated_at=None,
        )
    return DecisionModelOut(
        provider=row.provider, endpoint_url=row.endpoint_url, model_name=row.model_name,
        timeout_ms=row.timeout_ms or DEFAULT_TIMEOUT_MS, configured=True,
        has_key=bool(row.api_key_encrypted), updated_at=row.updated_at,
    )


@router.get("", response_model=DecisionModelOut)
def read_model(
    user: User = Depends(get_session_user), db: Session = Depends(get_db)
) -> DecisionModelOut:
    row = db.query(DecisionSettings).filter(DecisionSettings.user_id == user.id).first()
    return _out(row)


@router.put("", response_model=DecisionModelCheckOut)
def write_model(
    payload: DecisionModelIn,
    user: User = Depends(get_session_user),
    db: Session = Depends(get_db),
) -> DecisionModelCheckOut:
    if payload.provider not in PROVIDERS:
        raise HTTPException(
            status_code=404,
            detail="Fournisseur de décision inconnu. Les choix sont : modèle auto-hébergé, "
                   "Jev, Laya, ou le moteur déterministe intégré.",
        )
    if payload.provider == "local" and not payload.endpoint_url:
        raise HTTPException(
            status_code=422,
            detail="Un modèle auto-hébergé a besoin de l'adresse de son point d'accès "
                   "(par exemple http://192.168.1.20:8000/v1).",
        )
    if payload.provider == "laya" and not payload.endpoint_url:
        raise HTTPException(
            status_code=422,
            detail="Laya a besoin de l'adresse de son serveur "
                   "(par exemple http://192.168.1.172:8100).",
        )

    row = db.query(DecisionSettings).filter(DecisionSettings.user_id == user.id).first()
    if row is None:
        row = DecisionSettings(user_id=user.id, provider=payload.provider)
        db.add(row)

    row.provider = payload.provider
    row.endpoint_url = payload.endpoint_url
    row.model_name = payload.model_name
    row.timeout_ms = payload.timeout_ms
    # A key left out keeps the one already stored: a household editing the
    # model name should not have to retype a secret it cannot read back.
    if payload.api_key:
        row.api_key_encrypted = encrypt_secret(payload.api_key)
    row.updated_at = datetime.now(UTC)
    db.flush()

    # One real question, inside the contract.
    try:
        provider = build_provider(row)
        decision = provider.decide(DIRECTION, PROBE_CONTEXT)
        # A provider with a health card (Laya) shows it beside the answer.
        health = provider.probe() if hasattr(provider, "probe") else None
    except DecisionError as exc:
        db.rollback()
        return DecisionModelCheckOut(valid=False, message=exc.message, latency_ms=None)

    audit.append(
        db, user, kind="model_changed", actor="session",
        payload={"provider": row.provider, "model": row.model_name,
                 "endpoint": row.endpoint_url},
    )
    db.commit()
    checkpoint = f" ({health['checkpoint']})" if health and health.get("checkpoint") else ""
    return DecisionModelCheckOut(
        valid=True,
        message=(
            f"Le modèle{checkpoint} a répondu « {decision.choice} » en {decision.latency_ms} ms, "
            "dans le type attendu. La question posée est celle du pilotage, sur un instrument "
            "de test."
        ),
        latency_ms=decision.latency_ms,
        choice=decision.choice, mass_bps=decision.mass_bps, act_bps=decision.act_bps,
        health=health,
    )


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def remove_model(
    user: User = Depends(get_session_user), db: Session = Depends(get_db)
) -> None:
    row = db.query(DecisionSettings).filter(DecisionSettings.user_id == user.id).first()
    if row is not None:
        db.delete(row)
        audit.append(db, user, kind="model_changed", actor="session", payload={"removed": True})
        db.commit()
