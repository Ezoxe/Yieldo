"""POST /api/export and friends -- the filterable context export. Design §8.2.

This router does no arithmetic of its own. It assembles what
`engines/context_export.py` needs, hands it the scope the household declared,
and transcribes the document that comes back. Every figure in the result was
produced by an engine; nothing here reformats one.

**Every query filters on `user_id`**, via `get_current_user`, and the two id
lists a scope may carry are validated against this user's own rows before
anything is read: an account id belonging to somebody else is refused in
French rather than silently dropped, because silently dropping it would
produce a document narrower than the scope it prints at the top of itself.

`ValueError` from the engine -- an unknown target model, or anonymisation
asked for on a scope with no spending to be relative to -- becomes a 422 with
the engine's own French sentence, the same `except ValueError` idiom
`api/chat.py`, `api/feasibility.py` and `api/projection.py` all use.
"""

import json
from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.common import LIQUID_ACCOUNT_KINDS, recurrence_points
from app.api.goals import observed_months
from app.api.history import user_history
from app.api.portfolio import valuation_inputs
from app.db import get_db
from app.engines import portfolio as portfolio_engine
from app.engines.capacity import measure_savings_capacity
from app.engines.context_export import (
    MODULE_TITLES,
    MODULES,
    TARGET_MODELS,
    ExportAccount,
    ExportDebt,
    ExportGoal,
    ExportInputs,
    ExportPosition,
    ExportProjection,
    ExportRecurrence,
    ExportScope,
    ExportTransaction,
    build_context_export,
    build_templates,
    target_model,
)
from app.engines.recurrence import detect_recurrences
from app.engines.savings import DEFAULT_ANNUAL_RETURN_BPS, project_savings
from app.models import Account, Category, Debt, Goal, Transaction, User
from app.schemas.export import (
    ExportAccountOut,
    ExportCategoryOut,
    ExportDocumentOut,
    ExportDownloadIn,
    ExportFileOut,
    ExportModuleOut,
    ExportOptionsOut,
    ExportScopeIn,
    ExportTargetModelOut,
    ExportTemplateOut,
)
from app.security.deps import get_current_user

router = APIRouter(prefix="/export", tags=["export"])

# The horizon a template's "projections" module is built over. A declared
# convention, printed inside the document beside the figure it produced --
# never a measurement, and never silently varied per request.
PROJECTION_HORIZON_MONTHS = 120

_FORMATS = {
    "md": ("text/markdown; charset=utf-8", "md"),
    "txt": ("text/plain; charset=utf-8", "txt"),
    "json": ("application/json; charset=utf-8", "json"),
}


def _validate_modules(modules: list[str]) -> tuple[str, ...]:
    unknown = [module for module in modules if module not in MODULES]
    if unknown:
        known = ", ".join(f"« {module} »" for module in MODULES)
        raise HTTPException(
            status_code=422,
            detail=(
                f"Module inconnu : {', '.join(f'« {m} »' for m in unknown)}. "
                f"Modules disponibles : {known}."
            ),
        )
    # Ordered by `MODULES` rather than by what the caller typed, so the same
    # ticked set always produces the same document.
    return tuple(module for module in MODULES if module in modules)


def _validate_ids(
    db: Session, user_id: int, model, ids: list[int] | None, noun: str
) -> frozenset[int] | None:
    """`ids` as a set, once every one of them is proven to be this user's.

    An id that is not is REFUSED, never dropped: a scope silently narrowed
    would print a périmètre at the top of the document that the document does
    not honour, and would also answer "does this id exist?" for a row the
    household cannot see.
    """
    if ids is None:
        return None
    if not ids:
        return frozenset()
    owned = {
        row.id
        for row in db.query(model.id).filter(model.user_id == user_id, model.id.in_(ids)).all()
    }
    missing = sorted(set(ids) - owned)
    if missing:
        raise HTTPException(
            status_code=422,
            detail=(
                f"{noun} introuvable : {', '.join(str(value) for value in missing)}. "
                f"Ce périmètre ne peut être appliqué qu'à vos propres données."
            ),
        )
    return frozenset(owned)


def _scope_from(payload: ExportScopeIn, db: Session, user: User) -> ExportScope:
    return ExportScope(
        date_from=payload.date_from,
        date_to=payload.date_to,
        account_ids=_validate_ids(db, user.id, Account, payload.account_ids, "Compte"),
        category_ids=_validate_ids(db, user.id, Category, payload.category_ids, "Catégorie"),
        granularity=payload.granularity,
        modules=_validate_modules(payload.modules),
        anonymise=payload.anonymise,
    )


def _transactions(db: Session, user_id: int) -> list[ExportTransaction]:
    rows = (
        db.query(Transaction, Account.name, Category.name)
        .join(Account, Transaction.account_id == Account.id)
        .outerjoin(Category, Transaction.category_id == Category.id)
        .filter(Transaction.user_id == user_id)
        .order_by(Transaction.date, Transaction.id)
        .all()
    )
    return [
        ExportTransaction(
            id=row.id, on=row.date, amount_cents=row.amount_cents, label=row.label_raw,
            account_id=row.account_id, account_name=account_name,
            category_id=row.category_id, category_name=category_name,
            is_transfer=row.is_transfer,
        )
        for row, account_name, category_name in rows
    ]


def _account_balances(db: Session, user_id: int) -> list[ExportAccount]:
    """Every non-archived account, with its opening balance plus every movement.

    Transfers ARE counted here, unlike in the flow figures: moving money
    between two of the household's own accounts is not spending, but it does
    change what sits in each of them. Same reasoning as
    `api/common.liquid_balance_cents`, which measures one aggregate where this
    measures one row per account.
    """
    accounts = (
        db.query(Account)
        .filter(Account.user_id == user_id, Account.archived.is_(False))
        .order_by(Account.name, Account.id)
        .all()
    )
    movements: dict[int, int] = {}
    for account_id, total in (
        db.query(Transaction.account_id, Transaction.amount_cents)
        .filter(Transaction.user_id == user_id)
        .all()
    ):
        movements[account_id] = movements.get(account_id, 0) + total
    return [
        ExportAccount(
            id=account.id, name=account.name, kind=account.kind,
            balance_cents=account.opening_balance_cents + movements.get(account.id, 0),
        )
        for account in accounts
    ]


def _net_worth_cents(accounts: list[ExportAccount], portfolio_cents: int) -> int | None:
    """Liquid balances plus what the portfolio could be valued at.

    `None` when the household holds no account at all: there is then nothing
    to net, and a 0 € net worth would be a measurement nobody made.
    """
    if not accounts:
        return None
    liquid = sum(
        account.balance_cents for account in accounts
        if account.kind in LIQUID_ACCOUNT_KINDS
    )
    return liquid + portfolio_cents


def _positions(db: Session, user: User) -> tuple[list[ExportPosition], int, int]:
    """This user's positions, the total that could be valued, and how many
    could not. The two counts travel with the figure, like everywhere else."""
    inputs = valuation_inputs(db, user, datetime.now(UTC),
                              portfolio_engine.DEFAULT_REPORTING_CURRENCY)
    valuation = portfolio_engine.value_portfolio(
        inputs, portfolio_engine.DEFAULT_REPORTING_CURRENCY
    )
    positions = [
        ExportPosition(
            symbol=item.symbol, name=item.name, asset_class=item.asset_class,
            quantity=item.quantity,
            market_value_cents=item.market_value_reporting_cents,
        )
        for item in valuation.positions
    ]
    return positions, valuation.total.market_value_cents, valuation.total.positions_valued


def _projection(
    portfolio_cents: int, positions_valued: int, months, today: date
) -> tuple[ExportProjection | None, str | None]:
    """A savings projection, or the reason there is none.

    Both branches name a real cause: an empty portfolio and an unmeasurable
    capacity are two different situations with two different remedies, and
    collapsing them into one sentence is the "French sentence naming the wrong
    cause" defect this project keeps paying for.
    """
    capacity = measure_savings_capacity(months)
    if positions_valued == 0 and capacity is None:
        return None, (
            "Aucune projection : vous ne détenez aucune position valorisée et votre "
            "capacité d'épargne n'est pas mesurable. Importez des relevés complets et "
            "déclarez vos positions sur l'écran Patrimoine."
        )
    if capacity is None:
        return None, (
            "Aucune projection : la capacité d'épargne n'est pas mesurable, faute de "
            "mois complets de relevés. Importez les relevés manquants."
        )
    projection = project_savings(
        portfolio_cents, capacity.median_cents, DEFAULT_ANNUAL_RETURN_BPS,
        PROJECTION_HORIZON_MONTHS,
    )
    return ExportProjection(
        horizon_months=PROJECTION_HORIZON_MONTHS,
        annual_rate_bps=DEFAULT_ANNUAL_RETURN_BPS,
        monthly_contribution_cents=capacity.median_cents,
        initial_cents=portfolio_cents,
        final_cents=projection.final_cents,
    ), None


def _build_inputs(db: Session, user: User, today: date) -> ExportInputs:
    accounts = _account_balances(db, user.id)
    positions, portfolio_cents, positions_valued = _positions(db, user)
    months = observed_months(db, user.id)
    projection, projection_reason = _projection(
        portfolio_cents, positions_valued, months, today
    )

    history = user_history(db, user.id)
    anchor = today if history is None else history.date_to
    report = detect_recurrences(recurrence_points(db, user.id), anchor)

    debts = (
        db.query(Debt)
        .filter(Debt.user_id == user.id, Debt.archived.is_(False))
        .order_by(Debt.id).all()
    )
    goals = (
        db.query(Goal)
        .filter(Goal.user_id == user.id, Goal.archived.is_(False))
        .order_by(Goal.priority, Goal.id).all()
    )

    return ExportInputs(
        reporting_currency=portfolio_engine.DEFAULT_REPORTING_CURRENCY,
        transactions=_transactions(db, user.id),
        accounts=accounts,
        categories={
            row.id: row.name
            for row in db.query(Category).filter(Category.user_id == user.id).all()
        },
        debts=[
            ExportDebt(name=row.name, principal_cents=row.principal_cents,
                       annual_rate_bps=row.annual_rate_bps,
                       minimum_payment_cents=row.minimum_payment_cents)
            for row in debts
        ],
        goals=[
            ExportGoal(name=row.name, target_cents=row.target_cents,
                       saved_cents=row.saved_cents, due_on=row.due_on)
            for row in goals
        ],
        positions=positions,
        recurrences=[
            ExportRecurrence(label=item.label, amount_cents=item.amount_cents,
                             periodicity=item.periodicity, annual_cents=item.annual_cents,
                             status=item.status)
            for item in report.recurrences
        ],
        net_worth_cents=_net_worth_cents(accounts, portfolio_cents),
        projection=projection,
        projection_unavailable_reason=projection_reason,
        # Yieldo prices a cession from the portfolio's own envelopes, which
        # `/api/projection` computes. Nothing is duplicated here: when there
        # is no valued position there is no gain to tax, and that is the whole
        # of what this export can say without re-running that route's engine.
        tax=None,
        tax_unavailable_reason=(
            "Aucune plus-value latente à imposer : aucune position valorisée. "
            "Le détail par enveloppe est sur l'écran Projection."
            if positions_valued == 0
            else "Fiscalité non incluse dans l'export : le détail par enveloppe, avec "
                 "son régime et son article du CGI, est sur l'écran Projection."
        ),
    )


def _document(payload: ExportScopeIn, db: Session, user: User):
    scope = _scope_from(payload, db, user)
    today = date.today()
    try:
        target = None if payload.target_model is None else target_model(payload.target_model)
        return scope, build_context_export(_build_inputs(db, user, today), scope, target, today)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/options", response_model=ExportOptionsOut)
def options(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ExportOptionsOut:
    """What the scope panel may offer -- this user's own accounts and
    categories, the ten modules, and the declared context windows."""
    history = user_history(db, user.id)
    accounts = (
        db.query(Account)
        .filter(Account.user_id == user.id, Account.archived.is_(False))
        .order_by(Account.name, Account.id).all()
    )
    categories = (
        db.query(Category).filter(Category.user_id == user.id)
        .order_by(Category.name, Category.id).all()
    )
    return ExportOptionsOut(
        accounts=[
            ExportAccountOut(id=row.id, name=row.name, kind=row.kind) for row in accounts
        ],
        categories=[ExportCategoryOut(id=row.id, name=row.name) for row in categories],
        modules=[
            ExportModuleOut(key=module, label=MODULE_TITLES[module]) for module in MODULES
        ],
        target_models=[
            ExportTargetModelOut(key=model.key, label=model.label,
                                 context_tokens=model.context_tokens)
            for model in TARGET_MODELS
        ],
        ledger_date_from=None if history is None else history.date_from,
        ledger_date_to=None if history is None else history.date_to,
    )


@router.get("/templates", response_model=list[ExportTemplateOut])
def templates(user: User = Depends(get_current_user)) -> list[ExportTemplateOut]:
    """The five design §8.2 names, each with the scope it pre-selects and the
    question it carries. Resolved against today's date, never stored."""
    return [
        ExportTemplateOut(
            key=template.key, label=template.label, summary=template.summary,
            question=template.question,
            date_from=template.scope.date_from, date_to=template.scope.date_to,
            granularity=template.scope.granularity,
            modules=list(template.scope.modules), anonymise=template.scope.anonymise,
        )
        for template in build_templates(date.today())
    ]


@router.post("", response_model=ExportDocumentOut)
def build(
    payload: ExportScopeIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ExportDocumentOut:
    _, document = _document(payload, db, user)
    return ExportDocumentOut(
        markdown=document.markdown,
        estimated_tokens=document.estimated_tokens,
        warning=document.warning,
        transaction_count=document.transaction_count,
        excluded_transfer_count=document.excluded_transfer_count,
        date_from=document.date_from,
        date_to=document.date_to,
        sections=list(document.sections),
    )


@router.post("/download", response_model=ExportFileOut)
def download(
    payload: ExportDownloadIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ExportFileOut:
    """The same document, as a file the browser can save.

    `.md` and `.txt` carry the identical bytes under two media types --
    Markdown IS plain text, and pretending otherwise by stripping the syntax
    would hand the model a worse document than the one on screen. `.json`
    carries the document AND the scope that produced it, so a file found six
    months later still says what it covers.
    """
    scope, document = _document(payload, db, user)
    content_type, suffix = _FORMATS[payload.format]
    stamp = f"{document.date_from.isoformat()}_{document.date_to.isoformat()}"
    filename = f"yieldo-contexte-{stamp}.{suffix}"

    if payload.format == "json":
        content = json.dumps(
            {
                "markdown": document.markdown,
                "estimated_tokens": document.estimated_tokens,
                "warning": document.warning,
                "transaction_count": document.transaction_count,
                "excluded_transfer_count": document.excluded_transfer_count,
                "sections": list(document.sections),
                "scope": {
                    "date_from": document.date_from.isoformat(),
                    "date_to": document.date_to.isoformat(),
                    "account_ids": None if scope.account_ids is None
                    else sorted(scope.account_ids),
                    "category_ids": None if scope.category_ids is None
                    else sorted(scope.category_ids),
                    "granularity": scope.granularity,
                    "modules": list(scope.modules),
                    "anonymise": scope.anonymise,
                },
            },
            ensure_ascii=False, indent=2,
        )
    else:
        content = document.markdown

    return ExportFileOut(filename=filename, content_type=content_type, content=content)
