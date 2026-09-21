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

**And when the parser does not recognise it, the household's own model may
take the question.** Only then, only on POST, and only with the READ tools:
`llm/agent.run_agent(read_only=True)` hands the model the same catalogue of
engine calls the agent screen uses minus every tool that could leave a
proposal behind, so a figure in its answer is still a figure an engine
computed. The answer is marked `answered_by="modele"` all the way to the
screen, because "Yieldo measured this" and "your model said this" are two
different claims and only the first is one this application stands behind.

The run is PERSISTED and pointed at by `ChatMessage.agent_run_id`, which is
the one exception to the re-execute-on-read rule above -- see that model's
docstring. No model is called on a GET: reopening a thread must not cost a
completion per message, nor answer the same question differently each time.

A household with nothing configured in Réglages → Connexions sees exactly the
refusal it saw before. A model that fails is named, never swallowed: the
refusal comes back with the cause beside it.
"""

from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.common import liquid_balance_cents, recurrence_points
from app.api.goals import observed_months
from app.api.history import user_history
from app.api.portfolio import valuation_inputs
from app.config import settings as app_settings
from app.db import get_db
from app.engines import portfolio as portfolio_engine
from app.engines.answer import (
    AnswerChart,
    AnswerStep,
    ChatContext,
    PortfolioSnapshot,
    answer_query,
    trace_query,
)
from app.engines.goal import GoalInput
from app.engines.intent import UnrecognisedQuery, parse_intent
from app.llm.agent import run_agent
from app.llm.client import LlmSettingsInput
from app.models import AgentRun, AgentStep, Category, ChatMessage, Debt, Goal, LlmSettings, User
from app.schemas.chat import (
    ChatAnswerOut,
    ChatChartOut,
    ChatChartPointOut,
    ChatMessageIn,
    ChatMessageOut,
    ChatStepOut,
    ConversationOut,
)
from app.security.crypto import decrypt_secret
from app.security.deps import get_current_user

router = APIRouter(prefix="/chat", tags=["chat"])

# How many turns the model gets on a chat question. Half the agent screen's
# twelve: that screen is for an investigation a household asked for and waits
# on, this is one sentence typed into a box. A model that has not concluded in
# six reads says so, and the formulations the parser understands come back with
# it.
CHAT_MAX_STEPS = 6

# The one step every unrecognised question carries, whatever happens next.
_READING_STEP = ChatStepOut(
    tool="engines/intent",
    label="Lecture de la question",
    source="aucune intention reconnue",
    screen=None,
)

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


def _steps_out(steps: tuple[AnswerStep, ...]) -> list[ChatStepOut]:
    """The engine's trace, transcribed. Nothing is added here for the same
    reason `_chart_out` adds nothing: a step this router invented would be a
    step no engine ran."""
    return [
        ChatStepOut(tool=step.tool, label=step.label, source=step.source, screen=step.screen)
        for step in steps
    ]


def _model_steps(steps: list[AgentStep]) -> list[ChatStepOut]:
    """The model's run, in the shape the trace already reads.

    Only the RESULTS of its tool calls, plus its own reasoning when the
    endpoint sent any. The call rows are dropped because a call and its result
    are the same event twice, and the result is the half that says what came
    back. Nothing is invented here — every line is a row the loop wrote as it
    happened.
    """
    out: list[ChatStepOut] = []
    for step in steps:
        if step.kind == "tool_result":
            out.append(ChatStepOut(
                tool=step.name or "outil",
                label="Lecture demandée par le modèle",
                source=step.summary,
                screen=None,
            ))
        elif step.kind == "thought":
            out.append(ChatStepOut(
                tool="modèle", label="Raisonnement du modèle",
                source=step.summary, screen=None,
            ))
        elif step.kind == "failure":
            out.append(ChatStepOut(
                tool="modèle", label="Le modèle n'a pas répondu",
                source=step.summary, screen=None,
            ))
    return out


def _answer_from_model(
    parsed: UnrecognisedQuery, run: AgentRun, steps: list[AgentStep], model_name: str | None,
) -> ChatAnswerOut:
    """What the household's own model made of a question Yieldo could not parse.

    `recognised` stays False whatever the model said: the PARSER did not
    recognise the sentence, and that is a fact about Yieldo's engines which the
    model answering does not change. `amount_cents` stays null for the reason
    `llm/client.py` gives at length — no figure the model wrote ever reaches a
    field a screen renders as a measurement.
    """
    answered = run.state == "answered" and (run.answer or "").strip() != ""
    return ChatAnswerOut(
        recognised=False,
        query_description=None,
        text=run.answer.strip() if answered else parsed.message,
        amount_cents=None,
        # An answer from the model is not a refusal; a run that ended without
        # one leaves the parser's refusal standing, and it still is.
        is_refusal=not answered,
        # The formulations only when the model did not answer either: a
        # household that got an answer does not need to be told how to rephrase.
        supported_formulations=None if answered else list(parsed.supported_formulations),
        chart=None,
        steps=[_READING_STEP, *_model_steps(steps)],
        answered_by="modele" if answered else "engines",
        model_name=model_name,
        model_notice=run.notice,
    )


def _compute_answer(
    text: str,
    ctx: ChatContext,
    today: date,
    *,
    run: AgentRun | None = None,
    run_steps: list[AgentStep] | None = None,
    model_name: str | None = None,
) -> ChatAnswerOut:
    parsed = parse_intent(text, today)
    if isinstance(parsed, UnrecognisedQuery):
        if run is not None:
            return _answer_from_model(parsed, run, run_steps or [], model_name)
        return ChatAnswerOut(
            recognised=False, query_description=None, text=parsed.message,
            amount_cents=None, is_refusal=True,
            supported_formulations=list(parsed.supported_formulations),
            chart=None,
            # The sentence was read; that is the one step that ran, and
            # reporting it is what tells "je n'ai pas compris" apart from a
            # request that never reached an engine.
            steps=[_READING_STEP],
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
        steps=_steps_out(trace_query(parsed, ctx)),
    )


def _next_conversation_id(db: Session, user_id: int) -> int:
    """One past this account's highest. Per user, so the numbers a household
    sees start at 1 and never reveal how many other households exist."""
    highest = (
        db.query(func.max(ChatMessage.conversation_id))
        .filter(ChatMessage.user_id == user_id)
        .scalar()
    )
    return 1 if highest is None else highest + 1


def _resolve_conversation(db: Session, user_id: int, requested: int | None) -> int:
    """The thread to write into.

    `None` opens a new one. A stated id must already belong to THIS account:
    an id that does not is a 404, never a silently created thread under a
    number the client picked. This is the one place `user_id` scoping has to
    be checked against a value the client chose rather than derived from the
    session, so it is checked here and nowhere else.
    """
    if requested is None:
        return _next_conversation_id(db, user_id)
    exists = (
        db.query(ChatMessage.id)
        .filter(ChatMessage.user_id == user_id, ChatMessage.conversation_id == requested)
        .first()
    )
    if exists is None:
        raise HTTPException(status_code=404, detail="Cette conversation n'existe pas.")
    return requested


def _llm_for(db: Session, user_id: int) -> tuple[LlmSettingsInput, str, float] | None:
    """This account's model, or None when Réglages → Connexions holds nothing.

    None is not a failure and is not reported as one: a household that has
    configured no model gets the refusal it has always got, with nothing said
    about a feature it never turned on.
    """
    row = db.query(LlmSettings).filter(LlmSettings.user_id == user_id).first()
    if row is None:
        return None
    timeout = (
        float(row.timeout_seconds)
        if row.timeout_seconds is not None
        else float(app_settings.llm_timeout_seconds)
    )
    return (
        LlmSettingsInput(
            endpoint_url=row.endpoint_url,
            model_name=row.model_name,
            api_key=(
                None if row.api_key_encrypted is None else decrypt_secret(row.api_key_encrypted)
            ),
        ),
        row.model_name,
        timeout,
    )


def _ask_the_model(
    db: Session, user: User, text: str, today: date,
) -> tuple[AgentRun | None, list[AgentStep], str | None]:
    """Run the question through the household's model, reads only.

    Returns `(None, [], None)` when the question was one the parser DID
    recognise, or when no model is configured — in both cases the
    deterministic path answers alone, exactly as before.
    """
    if not isinstance(parse_intent(text, today), UnrecognisedQuery):
        return None, [], None

    configured = _llm_for(db, user.id)
    if configured is None:
        return None, [], None
    llm, model_name, timeout = configured

    run = AgentRun(user_id=user.id, question=text.strip(), state="running")
    db.add(run)
    db.flush()
    run_agent(
        db, user, run, llm,
        today=today,
        timeout=timeout,
        max_steps=CHAT_MAX_STEPS,
        # The wall: a question typed into the chat can read the ledger and can
        # never leave a proposal behind for somebody to refuse later.
        read_only=True,
    )
    db.flush()
    steps = (
        db.query(AgentStep)
        .filter(AgentStep.run_id == run.id)
        .order_by(AgentStep.position)
        .all()
    )
    return run, steps, model_name


@router.post("", response_model=ChatMessageOut, status_code=status.HTTP_201_CREATED)
def ask(
    payload: ChatMessageIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ChatMessageOut:
    """Parse, execute, answer -- then store the QUESTION, never the answer.

    The one thing stored beside the question is a pointer to the model's run,
    when there was one. See the module docstring.
    """
    today = date.today()
    ctx = _build_context(db, user, today)

    conversation_id = _resolve_conversation(db, user.id, payload.conversation_id)
    message = ChatMessage(user_id=user.id, conversation_id=conversation_id, text=payload.text)

    run, steps, model_name = _ask_the_model(db, user, payload.text, today)
    if run is not None:
        message.agent_run_id = run.id

    answer = _compute_answer(
        payload.text, ctx, today, run=run, run_steps=steps, model_name=model_name,
    )

    db.add(message)
    db.commit()
    db.refresh(message)

    return ChatMessageOut(
        id=message.id, conversation_id=message.conversation_id, text=message.text,
        created_at=message.created_at, answer=answer,
    )


@router.get("/conversations", response_model=list[ConversationOut])
def conversation_list(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[ConversationOut]:
    """Every thread this account has, newest activity first.

    Summarised WITHOUT re-executing a single question: this route answers
    "which conversations exist", and walking the ledger once per stored
    question to draw a list of titles would make opening the list cost what
    reading every thread costs. `GET /api/chat` is where answers are computed.
    """
    rows = (
        db.query(ChatMessage)
        .filter(ChatMessage.user_id == user.id)
        .order_by(ChatMessage.conversation_id, ChatMessage.id)
        .all()
    )

    threads: dict[int, list[ChatMessage]] = {}
    for row in rows:
        threads.setdefault(row.conversation_id, []).append(row)

    out = [
        ConversationOut(
            id=conversation_id,
            # The first question, which is what a reader recognises the thread
            # by. Truncation is the CLIENT's business: a title cut short here
            # could not be shown in full anywhere.
            title=messages[0].text,
            started_at=messages[0].created_at,
            last_at=messages[-1].created_at,
            message_count=len(messages),
        )
        for conversation_id, messages in threads.items()
    ]
    out.sort(key=lambda thread: thread.last_at, reverse=True)
    return out


@router.get("", response_model=list[ChatMessageOut])
def history_list(
    conversation_id: int | None = Query(default=None, ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ChatMessageOut]:
    """Every stored question, oldest first, each RE-EXECUTED against the
    current ledger -- see the module docstring. One `ChatContext` is built
    once and reused for every row, so a hundred questions cost one fetch of
    the ledger, not a hundred."""
    today = date.today()
    ctx = _build_context(db, user, today)
    query = db.query(ChatMessage).filter(ChatMessage.user_id == user.id)
    if conversation_id is not None:
        # No 404 for an unknown id here, and deliberately: a GET that filters
        # to nothing is an empty list, which is the honest answer and the same
        # one another household's thread gets. Only a WRITE has to refuse.
        query = query.filter(ChatMessage.conversation_id == conversation_id)
    rows = query.order_by(ChatMessage.id).limit(MAX_HISTORY).all()

    # The runs behind whichever of these questions a model answered, fetched in
    # one query rather than one per row — and no model is called here at all.
    run_ids = [row.agent_run_id for row in rows if row.agent_run_id is not None]
    runs: dict[int, AgentRun] = {}
    steps_by_run: dict[int, list[AgentStep]] = {}
    if run_ids:
        for run in db.query(AgentRun).filter(
            AgentRun.user_id == user.id, AgentRun.id.in_(run_ids)
        ):
            runs[run.id] = run
        for step in (
            db.query(AgentStep)
            .filter(AgentStep.run_id.in_(run_ids))
            .order_by(AgentStep.run_id, AgentStep.position)
        ):
            steps_by_run.setdefault(step.run_id, []).append(step)

    configured = _llm_for(db, user.id)
    model_name = None if configured is None else configured[1]

    return [
        ChatMessageOut(
            id=row.id, conversation_id=row.conversation_id, text=row.text,
            created_at=row.created_at,
            answer=_compute_answer(
                row.text, ctx, today,
                run=runs.get(row.agent_run_id or -1),
                run_steps=steps_by_run.get(row.agent_run_id or -1),
                model_name=model_name,
            ),
        )
        for row in rows
    ]


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def clear_history(
    conversation_id: int | None = Query(default=None, ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Forget one conversation, or every stored question of THIS user.

    A conversation is the one thing on this screen the household writes rather
    than measures, so it is the one thing it must be able to take back. The
    filter is `user_id`, like every other query in this router — which is also
    why naming another household's conversation deletes nothing rather than
    erroring: there is no row matching BOTH, and saying "that id exists"
    would answer a question about someone else's account.

    Omitting `conversation_id` still clears the lot, unchanged: "Effacer la
    conversation" meant everything before this route learned about threads,
    and a household that presses it expects everything."""
    query = db.query(ChatMessage).filter(ChatMessage.user_id == user.id)
    if conversation_id is not None:
        query = query.filter(ChatMessage.conversation_id == conversation_id)
    query.delete(synchronize_session=False)
    db.commit()
