"""/api/invest/oversight — what a supervising program may see, and the one
thing it may do.

This router exists so an external agent -- Claude, or any program holding an
agent access key -- can audit the trading pipeline without being able to run
it. `security/deps.get_current_user` accepts both the browser's JWT and a
`yld_…` key, so everything here is reachable by both. The asymmetry is
deliberate and is the whole design:

* **It may read everything.** The state, the decisions with the exact figures
  the model was shown, the mandate's verdicts, the orders, the P&L, the
  calibration, and the journal with its integrity check.
* **It may replay a decision** -- re-run the stored inputs through the
  configured model and report whether the answer still matches.
* **It may stop the machine.** `POST /oversight/halt` takes `get_current_user`,
  so a key can pull the cord.
* **It may not start it, arm it, widen the mandate, add a broker, or resume
  after a halt.** Every one of those takes `get_session_user`, on
  `api/invest_policy.py` and `api/invest_venues.py`.

A supervisor that can stop but not start is the correct shape for this: the
failure it exists to catch is the machine doing too much, and the remedy for
that is never "do more".

**The contract endpoint (`GET /oversight/contrat`) is what makes supervision
possible at all.** An agent handed a decision feed and no rules can only say
whether it finds the trades agreeable. Handed the declared rules, the risk rule
catalogue and the exact questions the model is asked, it can check the pipeline
against its own stated behaviour -- which is a fact, not an opinion.
"""

from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.api.invest_common import actor_of
from app.api.invest_policy import ARM_PHRASE, policy_for
from app.api.invest_run import calibration_observations
from app.db import get_db
from app.decision.contract import DecisionError, question_from_payload
from app.decision.registry import build_provider
from app.decision.strategy import DECLARED_RULES
from app.engines.calibration import evaluate_calibration
from app.engines.signals import FeatureWindows
from app.engines.trading_risk import RISK_RULES
from app.models import (
    AUDIT_KINDS,
    DECISION_OUTCOMES,
    ORDER_STATES,
    DecisionSettings,
    TradeAuditEvent,
    TradeDecision,
    TradeOrder,
    User,
)
from app.schemas.invest import (
    HaltIn,
    JournalEntryOut,
    JournalOut,
    ReplayOut,
)
from app.security.deps import get_current_user
from app.trading import audit, service

router = APIRouter(prefix="/invest/oversight", tags=["invest"])


@router.get("/contrat")
def contract(user: User = Depends(get_current_user)) -> dict:
    """What the pipeline claims to do, so a supervisor can check that it does.

    Static: no household data, no figures. It is the vocabulary an external
    agent needs to read everything else on this router.
    """
    return {
        "regles_declarees": list(DECLARED_RULES),
        "regles_de_risque": list(RISK_RULES),
        "issues_de_decision": list(DECISION_OUTCOMES),
        "etats_d_ordre": list(ORDER_STATES),
        "evenements_journalises": list(AUDIT_KINDS),
        "fenetres_d_indicateurs": {
            "court": FeatureWindows().short, "long": FeatureWindows().long,
            "rsi": FeatureWindows().rsi, "momentum": FeatureWindows().momentum,
            "volatilite": FeatureWindows().volatility,
        },
        "phrase_d_armement": ARM_PHRASE,
        "ce_qu_une_cle_d_acces_peut_faire": [
            "lire l'état, les décisions, les ordres et le journal",
            "rejouer une décision enregistrée",
            "arrêter le pilotage",
        ],
        "ce_qu_une_cle_d_acces_ne_peut_pas_faire": [
            "modifier le mandat",
            "armer l'exécution réelle",
            "lancer un tour en exécution réelle",
            "connecter ou supprimer un courtier",
            "relancer le pilotage après un arrêt",
            "remettre le bac à sable à zéro",
        ],
    }


@router.get("/etat")
def state(
    window: int = Query(default=200, ge=1, le=1_000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Everything a supervisor needs, in one call.

    One call rather than six because a supervisor comparing a mandate against
    the orders it allowed must see both as they were at the same instant; six
    calls interleaved with a running cycle would let it reason about a state
    that never existed.
    """
    now = datetime.now(UTC)
    policy = policy_for(db, user)
    mode = "live" if policy.autonomy == "live" else "paper"
    account = service.account_for(db, user, mode, date.today())
    positions = service.positions_of(db, user, mode)
    rows = (
        db.query(TradeDecision)
        .filter(TradeDecision.user_id == user.id, TradeDecision.mode == mode)
        .order_by(TradeDecision.id.desc())
        .limit(window)
        .all()
    )
    orders = (
        db.query(TradeOrder)
        .filter(TradeOrder.user_id == user.id, TradeOrder.mode == mode)
        .order_by(TradeOrder.id.desc())
        .limit(window)
        .all()
    )
    chain = audit.verify_chain(db, user)
    report = evaluate_calibration(calibration_observations(rows))
    settings_row = (
        db.query(DecisionSettings).filter(DecisionSettings.user_id == user.id).first()
    )

    return {
        "horodatage": now.isoformat(),
        "mode": mode,
        "pilotage": {
            "autonomie": policy.autonomy,
            "arme": service.armed(policy, now),
            "arme_jusqu_a": policy.armed_until.isoformat() if policy.armed_until else None,
            "a_l_arret": policy.halted,
            "raison_de_l_arret": policy.halted_reason,
            "arrete_par": policy.halted_by,
        },
        "mandat": {
            "instruments_autorises": list(service.symbols_of(policy)),
            "plafond_par_position_centimes": policy.max_position_cents,
            "plafond_d_exposition_centimes": policy.max_exposure_cents,
            "plafond_par_ordre_centimes": policy.max_order_notional_cents,
            "montant_minimal_par_ordre_centimes": policy.min_order_notional_cents,
            "perte_maximale_du_jour_centimes": policy.max_daily_loss_cents,
            "reserve_de_liquidites_centimes": policy.min_cash_buffer_cents,
            "repli_maximal_points_de_base": policy.max_drawdown_bps,
            "ordres_maximum_par_jour": policy.max_orders_per_day,
            "vente_a_decouvert_autorisee": policy.allow_short,
            "effet_de_levier_autorise": policy.allow_leverage,
            "conviction_minimale": policy.minimum_conviction,
            "probabilite_minimale_points_de_base": policy.minimum_probability_bps,
            "volatilite_maximale_points_de_base": policy.max_volatility_bps,
        },
        "modele": {
            "fournisseur": settings_row.provider if settings_row else None,
            "nom": settings_row.model_name if settings_row else None,
            "delai_ms": settings_row.timeout_ms if settings_row else None,
        },
        "compte": {
            "devise": account.currency,
            "liquidites_centimes": account.cash_cents,
            "liquidites_initiales_centimes": account.initial_cash_cents,
            "plus_haut_centimes": account.peak_equity_cents,
            "resultat_realise_du_jour_centimes": account.realised_pnl_today_cents,
            "resultat_realise_total_centimes": account.realised_pnl_total_cents,
            "ordres_du_jour": account.orders_today,
            "positions": [
                {"instrument": symbol, "quantite": row.quantity,
                 "prix_de_revient_centimes": row.average_price_cents}
                for symbol, row in sorted(positions.items())
            ],
        },
        "entonnoir": {
            "examinees": len(rows),
            "ecartees_avant_le_modele": sum(1 for r in rows if r.outcome == "skipped"),
            "sans_action": sum(1 for r in rows if r.outcome == "held"),
            "refusees_par_le_mandat": sum(1 for r in rows if r.outcome == "refused"),
            "ordres_transmis": sum(1 for r in rows if r.outcome == "ordered"),
            "en_echec": sum(1 for r in rows if r.outcome == "failed"),
        },
        "calibration": {
            "observations": report.observations,
            "brier_points_de_base": report.brier_bps,
            "reference_pile_ou_face_points_de_base": report.coin_flip_brier_bps,
            "lecture": report.verdict,
        },
        "journal": {
            "entrees": chain.events,
            "intact": chain.intact,
            "rompu_a": chain.broken_at,
            "lecture": chain.message,
            "prochaine_sequence": audit.next_sequence(db, user),
        },
        "decisions": [
            {
                "id": row.id, "instrument": row.symbol, "issue": row.outcome,
                "regle": row.rule, "message": row.message,
                "cours_de_reference_centimes": row.reference_price_cents,
                "latence_ms": row.latency_ms, "empreinte_des_entrees": row.inputs_hash,
                "indicateurs": row.features, "reponses": row.answers,
                "verdict_du_mandat": row.risk_verdict,
                "horodatage": row.created_at.isoformat(),
            }
            for row in rows[:50]
        ],
        "ordres": [
            {
                "id": row.id, "decision_id": row.decision_id, "instrument": row.symbol,
                "sens": row.side, "quantite": row.quantity,
                "quantite_demandee": row.requested_quantity, "etat": row.status,
                "regle": row.rule, "motif": row.failure_reason,
                "montant_centimes": row.notional_cents,
                "resultat_realise_centimes": row.realised_pnl_cents,
                "horodatage": row.created_at.isoformat(),
            }
            for row in orders[:50]
        ],
    }


@router.get("/journal", response_model=JournalOut)
def journal(
    since: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=1_000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> JournalOut:
    """The chain, and whether it still adds up.

    `since` lets a supervisor read only what happened after the last sequence
    it saw, which is how it can watch continuously without re-reading
    everything. The integrity check always runs over the WHOLE chain, never
    over the page: an intact page of a broken chain would be a reassuring lie.
    """
    chain = audit.verify_chain(db, user)
    rows = (
        db.query(TradeAuditEvent)
        .filter(TradeAuditEvent.user_id == user.id, TradeAuditEvent.sequence > since)
        .order_by(TradeAuditEvent.sequence.asc())
        .limit(limit)
        .all()
    )
    return JournalOut(
        events=chain.events, intact=chain.intact, broken_at=chain.broken_at,
        message=chain.message, next_sequence=audit.next_sequence(db, user),
        entries=[
            JournalEntryOut(
                sequence=row.sequence, kind=row.kind, actor=row.actor, payload=row.payload,
                entry_hash=row.entry_hash, previous_hash=row.previous_hash,
                created_at=row.created_at,
            )
            for row in rows
        ],
    )


@router.post("/replay/{decision_id}", response_model=ReplayOut)
def replay(
    decision_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ReplayOut:
    """Re-run a stored decision through the configured model.

    Two independent checks, and conflating them would make both useless:

    1. **Are the stored inputs still the ones that were asked about?**
       `inputs_hash` is recomputed from the stored features and questions. A
       mismatch means the row was edited after it was written, and nothing
       below it can be trusted -- which is reported rather than worked around.
    2. **Does the model still answer the same way?** The stored context is put
       to the model again, question by question, and the answers compared.

    A mismatch is NOT by itself evidence of wrongdoing, and the verdict says
    so: a different provider is configured now, a model was updated, or a
    provider samples. What a mismatch does establish is that the decision on
    file cannot be reproduced, which is exactly what a supervisor needs to know
    before trusting the rest of the feed.
    """
    row = (
        db.query(TradeDecision)
        .filter(TradeDecision.id == decision_id, TradeDecision.user_id == user.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Décision introuvable.")

    recomputed = audit.inputs_digest(row.features, row.questions)
    intact = recomputed == row.inputs_hash

    settings_row = (
        db.query(DecisionSettings).filter(DecisionSettings.user_id == user.id).first()
    )
    try:
        provider = build_provider(settings_row)
    except DecisionError as exc:
        raise HTTPException(status_code=409, detail=exc.message) from exc

    provider_name = getattr(provider, "name", "inconnu")
    replayed: dict[str, dict] = {}
    for payload in row.questions:
        key = payload.get("key")
        if key not in (row.answers or {}):
            # A question the original run never reached (a HOLD stops after the
            # first). Replaying it would compare an answer against nothing.
            continue
        try:
            question = question_from_payload(payload)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        try:
            decision = provider.decide(question, row.context)
        except DecisionError as exc:
            raise HTTPException(status_code=502, detail=exc.message) from exc
        replayed[str(key)] = dict(decision.canonical())

    stored = {
        key: {
            "question_key": value.get("question_key", key),
            "kind": value.get("kind"),
            "choice": value.get("choice"),
            "score_value": value.get("score_value"),
            "probability_bps": value.get("probability_bps"),
        }
        for key, value in (row.answers or {}).items()
    }
    matches = stored == replayed

    if not intact:
        verdict = (
            "Les indicateurs ou les questions enregistrés ne correspondent plus à leur "
            "empreinte : cette ligne a été modifiée après son enregistrement. Le rejeu "
            "ci-dessous ne prouve rien tant que ce point n'est pas éclairci."
        )
    elif matches and provider_name == row.provider:
        verdict = (
            "Rejeu conforme : les entrées enregistrées sont intactes et le modèle configuré "
            "redonne exactement les mêmes réponses. La décision du "
            f"{row.created_at.date().isoformat()} est reproductible."
        )
    elif matches:
        verdict = (
            f"Rejeu conforme, mais avec un autre fournisseur que celui d'origine "
            f"(« {row.provider} » à l'époque, « {provider_name} » maintenant) : les réponses "
            "coïncident tout de même."
        )
    else:
        verdict = (
            "Les réponses diffèrent de celles enregistrées. Cela ne prouve pas une "
            "irrégularité : le fournisseur configuré a pu changer, le modèle a pu être mis "
            "à jour, ou il échantillonne. Cela établit que cette décision n'est pas "
            "reproductible en l'état."
        )

    return ReplayOut(
        decision_id=row.id, inputs_intact=intact, inputs_hash_stored=row.inputs_hash,
        inputs_hash_recomputed=recomputed, matches=matches and intact,
        stored_answers=stored, replayed_answers=replayed, provider=provider_name,
        verdict=verdict,
    )


@router.post("/halt")
def halt(
    payload: HaltIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Stop everything. **Open to an agent access key, by design.**

    A supervising program that spots something wrong must be able to pull the
    cord even though it could never have started the engine. Restarting takes a
    session (`POST /api/invest/policy/resume`), because a decision about risk
    belongs to the person whose money it is.

    Idempotent: halting an already-halted pipeline keeps the first reason, so a
    second supervisor cannot overwrite the record of why it stopped.
    """
    policy = policy_for(db, user)
    actor = actor_of(request)
    if policy.halted:
        return {
            "halted": True,
            "raison": policy.halted_reason,
            "arrete_par": policy.halted_by,
            "message": "Le pilotage était déjà à l'arrêt : la première raison est conservée.",
        }

    now = datetime.now(UTC)
    policy.halted = True
    policy.halted_reason = payload.reason.strip()
    policy.halted_at = now
    policy.halted_by = "supervision" if actor == "agent" else "household"
    # A halt disarms: a live arming that outlived the cord being pulled would be
    # an open door behind a closed one.
    policy.armed_until = None
    audit.append(
        db, user, kind="halted", actor=actor,
        payload={"reason": policy.halted_reason, "by": policy.halted_by},
    )
    db.commit()
    return {
        "halted": True,
        "raison": policy.halted_reason,
        "arrete_par": policy.halted_by,
        "message": (
            "Le pilotage est arrêté et l'exécution réelle est désarmée. Aucun ordre ne "
            "sera transmis. Seule une session Yieldo peut le relancer."
        ),
    }
