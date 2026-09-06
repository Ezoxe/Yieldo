"""`/api/agent` — the model working as an agent, and the queue it writes into.

Two halves, one feature:

* `POST /api/agent/run` puts a question to the model with the tool catalogue in
  `llm/tools.py`, runs the bounded loop in `llm/agent.py`, and returns the
  answer together with the whole trace and whatever it proposed;
* `/api/agent/proposals` is the queue. Nothing the model asked for has
  happened; `POST .../apply` is the only code in this application that turns a
  proposal into data, and it runs when a human clicks.

**Applying goes through the same service functions the ordinary routes use.**
Never raw SQL: a proposal must not be able to reach a state the application's
own rules would have refused — a category that is not the household's, an
envelope with no category, a budget on someone else's row. Where a route owns
a rule, the applier calls it.

**Every proposal records what it overwrote.** `before` is filled at apply time,
not at propose time, because the world may have moved between the two — and
because an applied change a household cannot describe afterwards is a change
it cannot undo.

The run is synchronous on purpose. A background task would need its own
session and its own failure story, and the honest thing to show while a model
thinks is that one query is running — which is exactly what the front end says,
never a simulated progress bar through phases it cannot observe.
"""

from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.transactions import _owned_category
from app.config import settings as app_settings
from app.db import get_db
from app.llm.agent import DEFAULT_MAX_STEPS, not_configured_error, run_agent
from app.llm.client import LlmSettingsInput
from app.models import (
    AgentProposal,
    AgentRun,
    AgentStep,
    CategoryRule,
    Debt,
    Goal,
    LlmSettings,
    PlanLine,
    Transaction,
    User,
)
from app.schemas.agent import (
    AgentQueryIn,
    AgentRunOut,
    AgentStepOut,
    ProposalDecisionIn,
    ProposalOut,
)
from app.security.crypto import decrypt_secret
from app.security.deps import get_current_user

router = APIRouter(prefix="/agent", tags=["agent"])


def _llm_settings(db: Session, user_id: int) -> LlmSettingsInput:
    row = db.query(LlmSettings).filter(LlmSettings.user_id == user_id).first()
    if row is None:
        raise HTTPException(status_code=422, detail=not_configured_error().message)
    return LlmSettingsInput(
        endpoint_url=row.endpoint_url,
        model_name=row.model_name,
        api_key=None if row.api_key_encrypted is None else decrypt_secret(row.api_key_encrypted),
    )


def _timeout(db: Session, user_id: int) -> float:
    row = db.query(LlmSettings).filter(LlmSettings.user_id == user_id).first()
    if row is None or row.timeout_seconds is None:
        return float(app_settings.llm_timeout_seconds)
    return float(row.timeout_seconds)


def _run_out(db: Session, run: AgentRun) -> AgentRunOut:
    steps = (
        db.query(AgentStep)
        .filter(AgentStep.run_id == run.id)
        .order_by(AgentStep.position)
        .all()
    )
    proposals = (
        db.query(AgentProposal)
        .filter(AgentProposal.run_id == run.id)
        .order_by(AgentProposal.id)
        .all()
    )
    return AgentRunOut(
        id=run.id, question=run.question, state=run.state, answer=run.answer,
        notice=run.notice, steps_used=run.steps_used, created_at=run.created_at,
        finished_at=run.finished_at,
        steps=[AgentStepOut.model_validate(step) for step in steps],
        proposals=[ProposalOut.model_validate(item) for item in proposals],
    )


@router.post("/run", response_model=AgentRunOut)
def start_run(
    payload: AgentQueryIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AgentRunOut:
    llm = _llm_settings(db, user.id)
    run = AgentRun(user_id=user.id, question=payload.question.strip(), state="running")
    db.add(run)
    db.flush()

    run_agent(
        db, user, run, llm,
        today=date.today(),
        timeout=_timeout(db, user.id),
        max_steps=payload.max_steps or DEFAULT_MAX_STEPS,
    )
    db.commit()
    db.refresh(run)
    return _run_out(db, run)


@router.get("/runs", response_model=list[AgentRunOut])
def list_runs(
    limit: int = 10,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[AgentRunOut]:
    runs = (
        db.query(AgentRun)
        .filter(AgentRun.user_id == user.id)
        .order_by(AgentRun.id.desc())
        .limit(max(1, min(limit, 50)))
        .all()
    )
    return [_run_out(db, run) for run in runs]


@router.get("/proposals", response_model=list[ProposalOut])
def list_proposals(
    state: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[AgentProposal]:
    query = db.query(AgentProposal).filter(AgentProposal.user_id == user.id)
    if state is not None:
        query = query.filter(AgentProposal.state == state)
    return query.order_by(AgentProposal.id.desc()).all()


def _owned_proposal(db: Session, user: User, proposal_id: int) -> AgentProposal:
    proposal = (
        db.query(AgentProposal)
        .filter(AgentProposal.id == proposal_id, AgentProposal.user_id == user.id)
        .first()
    )
    if proposal is None:
        raise HTTPException(status_code=404, detail="Proposition introuvable")
    return proposal


# --- the appliers ---------------------------------------------------------
#
# One per proposal kind, each returning the French sentence describing what it
# actually did and the number of rows it touched. `before` is written by the
# caller from what each applier reads, so an applied change can be described in
# terms of what it replaced.


def _apply_recategorize(db: Session, user: User, payload: dict) -> tuple[str, int, dict]:
    category = _owned_category(db, user, int(payload["category_id"]))
    ids = [int(value) for value in payload.get("transaction_ids", [])]
    rows = (
        db.query(Transaction)
        .filter(Transaction.user_id == user.id, Transaction.id.in_(ids))
        .all()
    )
    if not rows:
        raise HTTPException(status_code=422, detail="Aucune de ces opérations n'existe plus")
    before = {str(row.id): row.category_id for row in rows}
    for row in rows:
        row.category_id = category.id
        row.category_source = "manual"
    return (
        f"{len(rows)} opérations reclassées en « {category.name} »", len(rows), before,
    )


def _apply_rule(db: Session, user: User, payload: dict) -> tuple[str, int, dict]:
    category = _owned_category(db, user, int(payload["category_id"]))
    pattern = str(payload.get("pattern", "")).strip()
    if not pattern:
        raise HTTPException(status_code=422, detail="La règle n'a pas de motif")
    existing = (
        db.query(CategoryRule)
        .filter(
            CategoryRule.user_id == user.id,
            CategoryRule.pattern == pattern,
            CategoryRule.category_id == category.id,
        )
        .first()
    )
    if existing is not None:
        return (f"La règle « {pattern} » existait déjà", 0, {"rule_id": existing.id})
    rule = CategoryRule(
        user_id=user.id, pattern=pattern, category_id=category.id,
        priority=300, origin="manual",
    )
    db.add(rule)
    db.flush()
    return (f"Règle « {pattern} » → « {category.name} » créée", 1, {})


def _apply_plan_line(db: Session, user: User, payload: dict) -> tuple[str, int, dict]:
    # Validated through the plan's own schema rather than trusted: an envelope
    # with no category is refused here exactly as it is on POST /api/plan.
    from app.schemas.plan import PlanLineIn

    try:
        parsed = PlanLineIn.model_validate(payload)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    if parsed.category_id is not None:
        _owned_category(db, user, parsed.category_id)
    line = PlanLine(user_id=user.id, origin="agent", **parsed.model_dump())
    db.add(line)
    db.flush()
    return (f"Ligne de plan « {parsed.label} » ajoutée", 1, {})


def _apply_alert_note(db: Session, user: User, payload: dict) -> tuple[str, int, dict]:
    """A constat has nothing to write: it IS the proposal.

    Approving it marks it read and keeps it in the list as an accepted finding.
    Deliberately not turned into an `Alert` row: alerts are raised by
    `engines/alert.py` from measured conditions, and a model-written sentence
    joining them would make the alerts screen a mix of two different kinds of
    claim with nothing on screen telling them apart.
    """
    return (f"Constat retenu : {payload.get('title', '')}".strip(), 0, {})


def _apply_budget(db: Session, user: User, payload: dict) -> tuple[str, int, dict]:
    category = _owned_category(db, user, int(payload["category_id"]))
    amount = int(payload["monthly_budget_cents"])
    if amount <= 0:
        raise HTTPException(status_code=422, detail="Un budget mensuel est un montant positif")
    before = {"monthly_budget_cents": category.monthly_budget_cents}
    category.monthly_budget_cents = amount
    return (f"Budget de « {category.name} » fixé", 1, before)


def _apply_goal(db: Session, user: User, payload: dict) -> tuple[str, int, dict]:
    name = str(payload.get("name", "")).strip()
    target = int(payload["target_cents"])
    if not name or target <= 0:
        raise HTTPException(status_code=422, detail="Un objectif a un intitulé et un montant visé")
    due = payload.get("due_on")
    goal = Goal(
        user_id=user.id, name=name, target_cents=target,
        due_on=date.fromisoformat(due) if isinstance(due, str) and due else None,
    )
    db.add(goal)
    db.flush()
    return (f"Objectif « {name} » créé", 1, {})


def _apply_debt_strategy(db: Session, user: User, payload: dict) -> tuple[str, int, dict]:
    """A repayment recommendation has nothing to write, and that is deliberate.

    `Debt` carries the contractual minimum, not a chosen extra effort — the
    payoff engine takes the extra as a parameter of a simulation, never as a
    stored fact about the debt. Approving this therefore records that the
    household accepted the recommendation; acting on it is a run of the
    snowball simulator with that figure, which is theirs to do. Inventing a
    column so this button had something to change would be putting a model's
    suggestion into the debt's own record as though it were a term of the loan.
    """
    debt = (
        db.query(Debt)
        .filter(Debt.id == int(payload["debt_id"]), Debt.user_id == user.id)
        .first()
    )
    if debt is None:
        raise HTTPException(status_code=404, detail="Dette introuvable")
    extra = int(payload.get("extra_monthly_cents", 0) or 0)
    return (
        f"Recommandation retenue pour « {debt.name} »"
        + (f" : {extra / 100:.2f} € de plus par mois, à simuler dans Dettes." if extra > 0 else ""),
        0,
        {},
    )


def _apply_correct_transaction(db: Session, user: User, payload: dict) -> tuple[str, int, dict]:
    """A date, an amount or a label put right on one row.

    Validated through `TransactionPatch` and applied through the same helpers
    `api/transactions.patch_transaction` uses -- `normalize_label` for the
    search index and `_free_fingerprint` for the dedup hash -- so an approved
    proposal can never reach a state the ordinary route would have refused, and
    can never leave a fingerprint describing a transaction that no longer
    exists.
    """
    from app.api.transactions import _free_fingerprint, _owned_transaction
    from app.importers.dedup import compute_dedup_hash, normalize_label
    from app.schemas.transactions import TransactionPatch

    transaction = _owned_transaction(db, user, int(payload["transaction_id"]))
    fields = {key: value for key, value in payload.items() if key != "transaction_id"}
    if not fields:
        raise HTTPException(status_code=422, detail="La correction ne change rien")
    try:
        parsed = TransactionPatch.model_validate(fields)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    changes = parsed.model_dump(exclude_unset=True)
    before = {field: getattr(transaction, field) for field in changes}
    for field in ("date", "amount_cents"):
        if field in changes:
            setattr(transaction, field, changes[field])
    if "label_raw" in changes:
        transaction.label_raw = changes["label_raw"]
        transaction.label_clean = normalize_label(changes["label_raw"])
    transaction.dedup_hash = _free_fingerprint(
        db, user.id,
        compute_dedup_hash(user.id, transaction.account_id, transaction.date,
                           transaction.amount_cents, transaction.label_raw),
        exclude_id=transaction.id,
    )
    return (f"Opération #{transaction.id} corrigée", 1, {"fields": _isoformat(before)})


def _apply_mark_transfer(db: Session, user: User, payload: dict) -> tuple[str, int, dict]:
    """Both legs of an internal transfer, marked together.

    The measured rates drop every flagged row while the balance keeps them, so a
    receipt flagged without its emission is counted as income that was never
    spent. The tool's description tells the model to propose the two legs
    together; this applier does not check that they pair, because a household
    moving money to an account Yieldo does not hold has exactly one leg and is
    right to flag it.
    """
    ids = [int(value) for value in payload.get("transaction_ids", [])]
    flag = bool(payload.get("is_transfer", True))
    if not ids:
        raise HTTPException(status_code=422, detail="Aucune opération à marquer")
    rows = (
        db.query(Transaction)
        .filter(Transaction.user_id == user.id, Transaction.id.in_(ids))
        .all()
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Aucune de ces opérations n'existe")
    before = {str(row.id): row.is_transfer for row in rows}
    for row in rows:
        row.is_transfer = flag
    verb = "marquées comme virements internes" if flag else "démarquées"
    return (f"{len(rows)} opérations {verb}", len(rows), {"is_transfer": before})


def _apply_declared_value(db: Session, user: User, payload: dict) -> tuple[str, int, dict]:
    from app.models import InvestmentAccount
    from app.schemas.portfolio import InvestmentAccountPatch

    account = (
        db.query(InvestmentAccount)
        .filter(
            InvestmentAccount.id == int(payload["investment_account_id"]),
            InvestmentAccount.user_id == user.id,
        )
        .first()
    )
    if account is None:
        raise HTTPException(status_code=404, detail="Compte d'investissement introuvable")
    fields = {key: value for key, value in payload.items() if key != "investment_account_id"}
    try:
        parsed = InvestmentAccountPatch.model_validate(fields)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    changes = parsed.model_dump(exclude_unset=True)
    before = {field: getattr(account, field) for field in changes}
    for field, value in changes.items():
        setattr(account, field, value)
    return (f"Montant déclaré sur « {account.name} »", 1, {"fields": _isoformat(before)})


def _apply_opening_balance(db: Session, user: User, payload: dict) -> tuple[str, int, dict]:
    """The figure under every solde the application prints.

    Kept behind the same approval as everything else, and it is the one write
    here where that matters most: an opening balance is not a line in a list, it
    shifts every balance, every runway and every forecast at once.
    """
    from app.models import Account

    account = (
        db.query(Account)
        .filter(Account.id == int(payload["account_id"]), Account.user_id == user.id)
        .first()
    )
    if account is None:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    before = {"opening_balance_cents": account.opening_balance_cents}
    account.opening_balance_cents = int(payload["opening_balance_cents"])
    return (f"Solde initial de « {account.name} » corrigé", 1, before)


def _isoformat(values: dict) -> dict:
    """Dates as ISO strings: `before` is stored in a JSON column, and a
    `datetime.date` would fail to serialise on the way in."""
    return {
        key: value.isoformat() if isinstance(value, date) else value
        for key, value in values.items()
    }


_APPLIERS = {
    "recategorize": _apply_recategorize,
    "category_rule": _apply_rule,
    "plan_line": _apply_plan_line,
    "alert_note": _apply_alert_note,
    "category_budget": _apply_budget,
    "goal": _apply_goal,
    "debt_strategy": _apply_debt_strategy,
    "correct_transaction": _apply_correct_transaction,
    "mark_transfer": _apply_mark_transfer,
    "declared_value": _apply_declared_value,
    "opening_balance": _apply_opening_balance,
}


@router.post("/proposals/{proposal_id}/apply", response_model=ProposalOut)
def apply_proposal(
    proposal_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AgentProposal:
    """Turns one proposal into data. The ONLY place in the application that
    does — see this module's docstring and `llm/tools.py`'s."""
    proposal = _owned_proposal(db, user, proposal_id)
    if proposal.state != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"Cette proposition a déjà été traitée ({proposal.state}).",
        )
    applier = _APPLIERS.get(proposal.kind)
    if applier is None:
        raise HTTPException(
            status_code=422,
            detail=f"Yieldo ne sait pas appliquer une proposition de type « {proposal.kind} ».",
        )

    summary, affected, before = applier(db, user, proposal.payload)
    proposal.state = "applied"
    proposal.applied_summary = summary
    proposal.affected = affected
    proposal.before = before
    proposal.decided_at = datetime.now(UTC)
    db.commit()
    db.refresh(proposal)
    return proposal


@router.post("/proposals/{proposal_id}/refuse", response_model=ProposalOut)
def refuse_proposal(
    proposal_id: int,
    payload: ProposalDecisionIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AgentProposal:
    """Refuses it, and keeps the row.

    A refused proposal is not deleted: the same suggestion coming back a third
    time is only visible as such if the first two are still there, and the
    reason a household gave is the most useful thing in this table.
    """
    proposal = _owned_proposal(db, user, proposal_id)
    if proposal.state != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"Cette proposition a déjà été traitée ({proposal.state}).",
        )
    proposal.state = "refused"
    proposal.decision_note = payload.note
    proposal.decided_at = datetime.now(UTC)
    db.commit()
    db.refresh(proposal)
    return proposal


@router.delete("/proposals/{proposal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_proposal(
    proposal_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Removes a decided proposal from the list.

    A pending one cannot be deleted: the way to make a suggestion go away
    without acting on it is to refuse it, which records that a person looked
    at it. Deleting it would leave no trace that it was ever made.
    """
    proposal = _owned_proposal(db, user, proposal_id)
    if proposal.state == "pending":
        raise HTTPException(
            status_code=409,
            detail="Refusez la proposition plutôt que de la supprimer : "
                   "une proposition en attente doit avoir été vue par quelqu'un.",
        )
    db.delete(proposal)
    db.commit()
