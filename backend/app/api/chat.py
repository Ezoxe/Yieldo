"""POST /api/chat and GET /api/chat -- the deterministic assistant. Design §8.1.

**A stored question is re-executed on read, never replayed from a cached
answer.** `models.ChatMessage` holds only the text the user typed; every read
here re-parses it with `engines/intent.py` and re-runs it through
`engines/answer.py` against the ledger AS IT STANDS NOW. This is the same
staleness contract `api/feasibility.py`'s saved scenarios keep -- see that
router's module docstring, and `models.Scenario`'s -- for the identical
reason: a figure computed last winter must not read as though it were
current months later.

Every query below filters on `user_id`, via `get_current_user` for
`ChatMessage` itself and via the same user-scoped helpers (`api/common.py`,
`api/goals.py`, `api/portfolio.py`) every other analytics router already
uses to assemble a `ChatContext`.

**An unparseable question is a 200, not a 422.** Not recognising a sentence
is not a malformed request; it is itself a complete, French answer that
names the formulations the parser does understand (design §8.1). `422` is
reserved for a question that DID parse but names a value an engine refuses
outright (a horizon past fifty years, for instance) -- the same
`except ValueError: raise HTTPException(422, ...)` idiom every other router
in this codebase uses.
"""

from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.common import liquid_balance_cents, recurrence_points
from app.api.goals import observed_months
from app.api.history import user_history
from app.api.portfolio import valuation_inputs
from app.db import get_db
from app.engines import portfolio as portfolio_engine
from app.engines.answer import AnswerChart, ChatContext, PortfolioSnapshot, answer_query
from app.engines.goal import GoalInput
from app.engines.intent import UnrecognisedQuery, parse_intent
from app.models import Category, ChatMessage, Debt, Goal, User
from app.schemas.chat import (
    ChatAnswerOut,
    ChatChartOut,
    ChatChartPointOut,
    ChatMessageIn,
    ChatMessageOut,
)
from app.security.deps import get_current_user

router = APIRouter(prefix="/chat", tags=["chat"])

# Every read recomputes each stored question's answer, which walks the
# ledger once per question -- the same reasoning `api/feasibility.py` bounds
# its saved scenarios for. A chat history is a running conversation, not a
# handful of saved comparisons, so the bound here is generous rather than
# tight; it exists only to keep one page load from being unbounded.
MAX_HISTORY = 200


def _existing_debt_payments_cents(db: Session, user_id: int) -> int:
    return sum(
        row.minimum_payment_cents
        for row in db.query(Debt).filter(Debt.user_id == user_id, Debt.archived.is_(False)).all()
    )


def _category_names(db: Session, user_id: int) -> dict[int, str]:
    return {c.id: c.name for c in db.query(Category).filter(Category.user_id == user_id).all()}


def _goal_inputs(db: Session, user_id: int) -> list[GoalInput]:
    rows = (
        db.query(Goal)
        .filter(Goal.user_id == user_id, Goal.archived.is_(False))
        .order_by(Goal.priority, Goal.id)
        .all()
    )
    return [
        GoalInput(id=row.id, name=row.name, target_cents=row.target_cents,
                 saved_cents=row.saved_cents, due_on=row.due_on, priority=row.priority)
        for row in rows
    ]


def _portfolio_snapshot(db: Session, user: User, now: datetime) -> PortfolioSnapshot:
    reporting_currency = portfolio_engine.DEFAULT_REPORTING_CURRENCY
    inputs = valuation_inputs(db, user, now, reporting_currency)
    total = portfolio_engine.value_portfolio(inputs, reporting_currency).total
    return PortfolioSnapshot(
        market_value_cents=total.market_value_cents,
        positions_total=total.positions_total, positions_valued=total.positions_valued,
    )


def _build_context(db: Session, user: User, today: date) -> ChatContext:
    """Every primitive `engines/answer.py` might need, fetched once per
    request -- one context, reused across every stored question on a
    `GET /api/chat`, exactly as `api/engagement.py` fetches its own inputs
    once and reuses them across four engines."""
    history = user_history(db, user.id)
    return ChatContext(
        ledger_start=None if history is None else history.date_from,
        ledger_end=None if history is None else history.date_to,
        transactions=recurrence_points(db, user.id),
        categories=_category_names(db, user.id),
        months=observed_months(db, user.id),
        # The ledger's own last transaction, never the real clock -- the same
        # reasoning `api/engagement.py` gives for `detect_recurrences`'s anchor.
        recurrence_anchor=today if history is None else history.date_to,
        balance_cents=liquid_balance_cents(db, user.id),
        existing_debt_payments_cents=_existing_debt_payments_cents(db, user.id),
        goals=_goal_inputs(db, user.id),
        portfolio=_portfolio_snapshot(db, user, datetime.now(UTC)),
    )


def _chart_out(chart: AnswerChart | None) -> ChatChartOut | None:
    """The engine's chart, transcribed. Nothing is computed here -- a figure
    the API invented would be a figure no engine produced."""
    if chart is None:
        return None
    return ChatChartOut(
        kind=chart.kind, title=chart.title,
        points=[
            ChatChartPointOut(label=point.label, amount_cents=point.amount_cents)
            for point in chart.points
        ],
    )


def _compute_answer(text: str, ctx: ChatContext, today: date) -> ChatAnswerOut:
    parsed = parse_intent(text, today)
    if isinstance(parsed, UnrecognisedQuery):
        return ChatAnswerOut(
            recognised=False, query_description=None, text=parsed.message,
            amount_cents=None, is_refusal=True,
            supported_formulations=list(parsed.supported_formulations),
            chart=None,
        )
    try:
        answer = answer_query(parsed, ctx, today)
    except ValueError as exc:
        # The engines raise in French already -- the same catch-and-forward
        # idiom `api/feasibility.py` and `api/projection.py` use.
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return ChatAnswerOut(
        recognised=True, query_description=answer.query_description, text=answer.text,
        amount_cents=answer.amount_cents, is_refusal=answer.is_refusal,
        supported_formulations=None, chart=_chart_out(answer.chart),
    )


@router.post("", response_model=ChatMessageOut, status_code=status.HTTP_201_CREATED)
def ask(
    payload: ChatMessageIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ChatMessageOut:
    """Parse, execute, answer -- then store the QUESTION, never the answer."""
    today = date.today()
    ctx = _build_context(db, user, today)
    answer = _compute_answer(payload.text, ctx, today)

    message = ChatMessage(user_id=user.id, text=payload.text)
    db.add(message)
    db.commit()
    db.refresh(message)

    return ChatMessageOut(
        id=message.id, text=message.text, created_at=message.created_at, answer=answer
    )


@router.get("", response_model=list[ChatMessageOut])
def history_list(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[ChatMessageOut]:
    """Every stored question, oldest first, each RE-EXECUTED against the
    current ledger -- see the module docstring. One `ChatContext` is built
    once and reused for every row, so a hundred questions cost one fetch of
    the ledger, not a hundred."""
    today = date.today()
    ctx = _build_context(db, user, today)
    rows = (
        db.query(ChatMessage)
        .filter(ChatMessage.user_id == user.id)
        .order_by(ChatMessage.id)
        .limit(MAX_HISTORY)
        .all()
    )
    return [
        ChatMessageOut(id=row.id, text=row.text, created_at=row.created_at,
                       answer=_compute_answer(row.text, ctx, today))
        for row in rows
    ]


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def clear_history(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> None:
    """Forget every stored question of THIS user, and only this user's.

    A conversation is the one thing on this screen the household writes rather
    than measures, so it is the one thing it must be able to take back. The
    filter is `user_id`, like every other query in this router."""
    db.query(ChatMessage).filter(ChatMessage.user_id == user.id).delete(
        synchronize_session=False
    )
    db.commit()
