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
from app.decision.strategy import BUY, DIRECTION, HOLD
from app.engines.logistic import fit, vector_of
from app.engines.model_eval import compare_windows, evaluate
from app.engines.signals import FeatureWindows, PriceSeries, compute_features
from app.models import DecisionSettings, User
from app.schemas.invest import (
    DecisionModelCheckOut,
    DecisionModelIn,
    DecisionModelOut,
    TrainingIn,
    TrainingOut,
    WindowVerdictOut,
)
from app.security.crypto import encrypt_secret
from app.security.deps import get_session_user
from app.trading import audit, sandbox

router = APIRouter(prefix="/invest/model", tags=["invest"])

# Les deux fenêtres d'examen, fixes et lointaines. Elles ne bougent pas :
# deux modèles ne se comparent que jugés sur le même terrain.
VALIDATION_FIRST = 300_000
VALIDATION_SECOND = 700_000
VALIDATION_STATES = 200

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
        has_learned_model=bool(row.learned_model),
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


# --------------------------------------------------------------------------
# Apprendre un modèle, sur le processeur du foyer
# --------------------------------------------------------------------------

def _samples(symbols, start, count, horizon, windows):
    """(vecteur, mouvement à l'horizon) sur le marché synthétique."""
    out = []
    for symbol in symbols:
        for step in range(count):
            index = start + step
            closes = sandbox.closes(symbol, end_index=index, count=120)
            features = compute_features(PriceSeries(symbol=symbol, closes=closes), windows)
            now = closes[-1]
            later = sandbox.close_cents(symbol, index + horizon)
            out.append((vector_of(features), round((later - now) * 10_000 / now)))
    return out


def _judge(model, threshold, symbols, start, count, horizon, windows, dead_band):
    """Un verdict sur une fenêtre que l'entraînement n'a jamais vue."""
    rows = _samples(symbols, start, count, horizon, windows)
    answers, labels, moves = [], [], []
    for vector, move in rows:
        probability = model.probability(vector)
        answers.append(BUY if probability >= threshold else HOLD)
        labels.append(BUY if move > dead_band else HOLD)
        moves.append(move)
    return evaluate(answers, labels, moves)


def _window_out(verdict) -> WindowVerdictOut:
    return WindowVerdictOut(
        states=verdict.states, accuracy_bps=verdict.accuracy_bps,
        chance_accuracy_bps=verdict.chance_accuracy_bps, p_value_bps=verdict.p_value_bps,
        buys=verdict.buys, edge_bps=verdict.edge_bps, net_edge_bps=verdict.net_edge_bps,
    )


@router.post("/apprendre", response_model=TrainingOut)
def train_model(
    payload: TrainingIn,
    user: User = Depends(get_session_user),
    db: Session = Depends(get_db),
) -> TrainingOut:
    """Entraîner un modèle sur le marché du bac à sable, et le juger ailleurs.

    Quelques secondes de processeur, aucune carte graphique, aucun réseau :
    sept poids sur les indicateurs que Yieldo calcule déjà. Les deux fenêtres
    de validation sont très loin de celle d'entraînement -- un avantage
    mesuré là où le modèle a appris ne veut rien dire.

    Le modèle est enregistré et devient le fournisseur courant ; il reste
    soumis au garde-fou d'armement comme tous les autres.
    """
    symbols = ("AAPL", "BTC-EUR", "ETH-EUR")
    windows = FeatureWindows()
    threshold = payload.threshold_bps / 10_000

    samples = _samples(symbols, payload.start_index, payload.samples_per_symbol,
                       payload.horizon, windows)
    model = fit(samples, dead_band_bps=payload.dead_band_bps)

    # Deux fenêtres lointaines, fixes : la comparaison entre deux modèles
    # n'aurait aucun sens si chacun choisissait son terrain d'examen.
    first = _judge(model, threshold, symbols, VALIDATION_FIRST, VALIDATION_STATES,
                   payload.horizon, windows, payload.dead_band_bps)
    second = _judge(model, threshold, symbols, VALIDATION_SECOND, VALIDATION_STATES,
                    payload.horizon, windows, payload.dead_band_bps)
    holds, verdict = compare_windows(first, second)

    row = db.query(DecisionSettings).filter(DecisionSettings.user_id == user.id).first()
    if row is None:
        row = DecisionSettings(user_id=user.id, provider="learned")
        db.add(row)
    row.provider = "learned"
    row.model_name = f"logistique-{len(model.weights)}"
    row.learned_model = model.canonical()
    row.updated_at = datetime.now(UTC)
    audit.append(
        db, user, kind="model_changed", actor="session",
        payload={"provider": "learned", "trained_on": model.trained_on,
                 "holds": holds},
    )
    db.commit()

    return TrainingOut(
        provider="learned", trained_on=model.trained_on,
        dead_band_bps=payload.dead_band_bps, threshold_bps=payload.threshold_bps,
        first_window=_window_out(first), second_window=_window_out(second),
        holds=holds, verdict=verdict,
    )
