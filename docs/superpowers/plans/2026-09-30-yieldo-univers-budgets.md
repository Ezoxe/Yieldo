# Budget universes — foundation and car universe: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every category of the Budgets screen opens `/budgets/:id`, a page that
says what the category cost this month and in an ordinary month over the years,
and — for the Transport family — shows the validated car universe: a realistic
white GT with X-ray lenses on the fuel tank, the engine, the roll cage and the
toll badge.

**Architecture:** A pure engine (`engines/category_history.py`) builds the
month-by-month series of one category subtree over the ledger's complete months;
`GET /budgets/{category_id}/detail` assembles it with the month, the budget
reading (the Budgets screen's own rollup) and the same figures per child and per
sibling. The front end maps a category to a universe with a pure registry,
turns the payload into scene readings with pure functions, and renders
`UniversePage` (head, scene, four panels). The scene is an SVG whose colours
live in its stylesheet.

**Tech Stack:** FastAPI, SQLAlchemy, pytest; React 19, react-router 7,
@tanstack/react-query (`useApiQuery`), ECharts 6, vitest + Testing Library.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-30-yieldo-univers-budgets-design.md`. Validated car mockup (geometry source): `docs/superpowers/specs/assets/2026-09-30-voiture-maquette.html`.
- Amounts are integer cents everywhere, negative for an outflow; means are integer cents rounded half away from zero.
- Engines are pure: no session, no network, no implicit clock.
- Every query filters on `user_id`; another household's category is a 404 « Catégorie introuvable ».
- User-facing text in French with « », non-breaking spaces before `:` `;` `?` `!` and `€` after the figure; code, comments, commits in English.
- No hex colour in a component: UI text uses the `--yd-*` tokens; scene colours are CSS custom properties / classes in the scene stylesheet.
- Light and dark themes, 1440 px and 390 px; nothing scrolls the page horizontally.
- Motion: only the tank level and the gauge needle carry a figure, and both end on the true value; everything stops under `prefers-reduced-motion` and `:root[data-motion="off"]`.
- Test first; `./.venv/Scripts/pytest.exe -q`, `npm test`, `npm run lint`, `npm run build` green at every commit.
- Branch `feat/budget-universes`, one Conventional Commit per task; nothing is pushed until the operator has validated every universe.

## File map

| File | Responsibility |
|---|---|
| `backend/app/engines/category_history.py` | subtree, month series, complete months, averages, years (pure) |
| `backend/app/schemas/budgets.py` | `BudgetDetailOut` and its parts |
| `backend/app/api/budgets.py` | `GET /budgets/{category_id}/detail` |
| `frontend/src/lib/types.ts` | `BudgetDetail` wire types |
| `frontend/src/features/budgets/universe/registry.ts` | category → universe and part (pure) |
| `frontend/src/features/budgets/universe/readings.ts` | gauge, part levels, focus (pure) |
| `frontend/src/charts/CategoryMonthsChart.tsx` | « Mois par mois » bars + average line |
| `frontend/src/features/budgets/MonthNav.tsx` | month arrows shared by Budgets and the universe page |
| `frontend/src/features/budgets/universe/scenes/car/*` | the car scene (geometry, wheels, lenses, stylesheet) |
| `frontend/src/features/budgets/universe/SceneLabels.tsx` | HTML labels: on the scene from 640 px, a list below it under |
| `frontend/src/features/budgets/universe/UniversePage.tsx` (+ panels, CSS) | the page |
| `frontend/src/dev/mockApi.ts` | `?apercu=1` answer for the new route |
| `e2e/seed_demo_household.py` | real car expenses and a Transport budget in the demo household |

---

### Task 1: The category history engine

**Files:**
- Create: `backend/app/engines/category_history.py`
- Test: `backend/tests/test_category_history.py`

**Interfaces:**
- Consumes: `app.engines.aggregate.TxPoint(on, amount_cents, category_id, account_id, is_transfer)`.
- Produces:
  - `CategoryNode(id: int, parent_id: int | None)`
  - `MonthSpend(key: str, spent_cents: int, count: int, complete: bool)`
  - `Average(average_cents: int | None, months_counted: int)`
  - `YearSpend(year: int, spent_cents: int, months_counted: int, monthly_average_cents: int | None)`
  - `MIN_MONTHS_FOR_AVERAGE = 3`
  - `subtree_ids(nodes, root_id) -> frozenset[int]`
  - `is_complete(key, covered_from, covered_to) -> bool`
  - `spend(points, ids) -> tuple[int, int]`
  - `monthly_series(points, ids, covered_from, covered_to) -> list[MonthSpend]`
  - `mean_cents(total_cents, count) -> int`, `average_ticket(total_cents, count) -> int | None`
  - `monthly_average(months) -> Average`, `yearly(months) -> list[YearSpend]`

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_category_history.py`:

```python
from datetime import date

import pytest

from app.engines.aggregate import TxPoint
from app.engines.category_history import (
    Average,
    CategoryNode,
    MonthSpend,
    YearSpend,
    average_ticket,
    is_complete,
    mean_cents,
    monthly_average,
    monthly_series,
    spend,
    subtree_ids,
    yearly,
)


def _pt(on: date, cents: int, category: int = 1, transfer: bool = False) -> TxPoint:
    return TxPoint(on=on, amount_cents=cents, category_id=category, account_id=1,
                   is_transfer=transfer)


def test_the_subtree_holds_the_category_and_every_descendant():
    nodes = [CategoryNode(1, None), CategoryNode(2, 1), CategoryNode(3, 2), CategoryNode(4, None)]
    assert subtree_ids(nodes, 1) == frozenset({1, 2, 3})


def test_the_subtree_survives_a_cycle():
    assert subtree_ids([CategoryNode(1, 2), CategoryNode(2, 1)], 1) == frozenset({1, 2})


def test_a_month_is_complete_only_when_the_ledger_covers_both_ends():
    assert is_complete("2026-02", date(2026, 2, 1), date(2026, 2, 28))
    assert not is_complete("2026-02", date(2026, 2, 2), date(2026, 3, 31))
    assert not is_complete("2026-09", date(2025, 1, 1), date(2026, 9, 24))


def test_the_series_covers_every_month_and_counts_outflows_of_the_subtree_only():
    points = [
        _pt(date(2026, 1, 5), -5000),
        _pt(date(2026, 1, 20), -2500),
        _pt(date(2026, 1, 21), 1200),                  # a refund is not a spend
        _pt(date(2026, 3, 2), -4000),
        _pt(date(2026, 3, 3), -900, category=9),        # another category
        _pt(date(2026, 3, 4), -3000, transfer=True),    # an internal transfer
    ]
    series = monthly_series(points, frozenset({1}), date(2026, 1, 1), date(2026, 3, 31))
    assert [m.key for m in series] == ["2026-01", "2026-02", "2026-03"]
    assert [m.spent_cents for m in series] == [-7500, 0, -4000]
    assert [m.count for m in series] == [2, 0, 1]
    assert all(m.complete for m in series)


def test_a_covered_month_with_nothing_spent_counts_as_zero():
    series = [MonthSpend("2026-01", -9000, 3, True), MonthSpend("2026-02", 0, 0, True),
              MonthSpend("2026-03", -6000, 2, True)]
    assert monthly_average(series) == Average(average_cents=-5000, months_counted=3)


def test_incomplete_months_stay_out_of_the_average():
    series = [MonthSpend("2025-12", -100000, 9, False),
              MonthSpend("2026-01", -3000, 1, True), MonthSpend("2026-02", -3000, 1, True),
              MonthSpend("2026-03", -3000, 1, True), MonthSpend("2026-04", -500, 1, False)]
    assert monthly_average(series) == Average(average_cents=-3000, months_counted=3)


def test_fewer_than_three_complete_months_give_no_average():
    series = [MonthSpend("2026-01", -3000, 1, True), MonthSpend("2026-02", -3000, 1, True)]
    assert monthly_average(series) == Average(average_cents=None, months_counted=2)


def test_means_are_integer_cents_rounded_half_away_from_zero():
    assert mean_cents(-5, 2) == -3
    assert mean_cents(-4, 3) == -1
    assert mean_cents(0, 4) == 0
    with pytest.raises(ValueError):
        mean_cents(-100, 0)


def test_each_year_is_summed_over_its_complete_months():
    series = [MonthSpend(f"2025-{m:02d}", -1000, 1, True) for m in (10, 11, 12)]
    series += [MonthSpend("2026-01", -4000, 2, True), MonthSpend("2026-02", -2000, 1, False)]
    assert yearly(series) == [YearSpend(2025, -3000, 3, -1000), YearSpend(2026, -4000, 1, None)]


def test_the_average_ticket_needs_an_operation():
    assert average_ticket(0, 0) is None
    assert average_ticket(-11800, 2) == -5900


def test_spend_sums_the_outflows_of_the_subtree():
    points = [_pt(date(2026, 9, 1), -5000, category=2), _pt(date(2026, 9, 2), -1000, category=3),
              _pt(date(2026, 9, 3), -700, category=7)]
    assert spend(points, frozenset({2, 3})) == (-6000, 2)
```

- [ ] **Step 2: Run to verify it fails** — `cd backend && ./.venv/Scripts/pytest.exe tests/test_category_history.py -q` → FAIL, `ModuleNotFoundError: app.engines.category_history`.

- [ ] **Step 3: Implement** — `backend/app/engines/category_history.py`:

```python
"""What one category cost, month by month, over the household's whole ledger.

The universe page of a budget answers two questions the Budgets screen cannot:
what did this cost THIS month, and what does it cost in an ordinary month --
« en moyenne durant ces années ». The second is only honest over months the
ledger covers from the first day to the last:

* a month the statements only half cover (the first import started on the
  12th, or the month in progress) would pull the mean down with spending that
  is simply not in the file yet, so it is kept out of every mean;
* a covered month with nothing spent is a real zero and is counted: not
  buying fuel in August is part of what fuel costs a year;
* under three covered months there is no mean at all -- one or two months are
  an anecdote, not a habit.

An outflow is negative, and so is every total and mean built from outflows.
Means are integer cents rounded half away from zero; money never passes
through a float here.

Pure: no session, no clock. The ledger's span is a parameter.
"""

import calendar
from dataclasses import dataclass
from datetime import date

from app.engines.aggregate import TxPoint

MIN_MONTHS_FOR_AVERAGE = 3


@dataclass(frozen=True)
class CategoryNode:
    id: int
    parent_id: int | None


@dataclass(frozen=True)
class MonthSpend:
    key: str
    spent_cents: int
    count: int
    complete: bool


@dataclass(frozen=True)
class Average:
    average_cents: int | None
    months_counted: int


@dataclass(frozen=True)
class YearSpend:
    year: int
    spent_cents: int
    months_counted: int
    monthly_average_cents: int | None


def subtree_ids(nodes: list[CategoryNode], root_id: int) -> frozenset[int]:
    """The category and every descendant. A cycle in the tree ends the walk
    instead of hanging it, like `api.common.budget_owner`."""
    children: dict[int, list[int]] = {}
    for node in nodes:
        if node.parent_id is not None:
            children.setdefault(node.parent_id, []).append(node.id)
    seen: set[int] = set()
    stack = [root_id]
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        stack.extend(children.get(current, ()))
    return frozenset(seen)


def _month_key(on: date) -> str:
    return f"{on.year}-{on.month:02d}"


def _month_keys(first: date, last: date) -> list[str]:
    keys: list[str] = []
    year, month = first.year, first.month
    while (year, month) <= (last.year, last.month):
        keys.append(f"{year}-{month:02d}")
        month += 1
        if month == 13:
            year, month = year + 1, 1
    return keys


def is_complete(key: str, covered_from: date, covered_to: date) -> bool:
    """Whether the ledger covers the month `key` from its first day to its last."""
    year, month = (int(part) for part in key.split("-"))
    first = date(year, month, 1)
    last = date(year, month, calendar.monthrange(year, month)[1])
    return covered_from <= first and last <= covered_to


def _outflows(points: list[TxPoint], ids: frozenset[int]) -> list[TxPoint]:
    # The Budgets screen's own reading (`aggregate_by_category`): outflows
    # only, internal transfers excluded.
    return [p for p in points
            if not p.is_transfer and p.amount_cents < 0 and p.category_id in ids]


def spend(points: list[TxPoint], ids: frozenset[int]) -> tuple[int, int]:
    """What the subtree `ids` spent over `points`, and in how many operations."""
    rows = _outflows(points, ids)
    return sum(p.amount_cents for p in rows), len(rows)


def monthly_series(
    points: list[TxPoint], ids: frozenset[int], covered_from: date, covered_to: date
) -> list[MonthSpend]:
    """One entry per month of the ledger's span, oldest first, empty months included."""
    totals: dict[str, tuple[int, int]] = {}
    for point in _outflows(points, ids):
        key = _month_key(point.on)
        cents, count = totals.get(key, (0, 0))
        totals[key] = (cents + point.amount_cents, count + 1)
    series: list[MonthSpend] = []
    for key in _month_keys(covered_from, covered_to):
        cents, count = totals.get(key, (0, 0))
        series.append(MonthSpend(key=key, spent_cents=cents, count=count,
                                 complete=is_complete(key, covered_from, covered_to)))
    return series


def mean_cents(total_cents: int, count: int) -> int:
    """`total_cents / count` in integer cents, rounded half away from zero."""
    if count <= 0:
        raise ValueError("Une moyenne demande au moins une valeur")
    magnitude = (abs(total_cents) * 2 + count) // (2 * count)
    return -magnitude if total_cents < 0 else magnitude


def average_ticket(total_cents: int, count: int) -> int | None:
    """What one operation cost on average; None when there was none."""
    return mean_cents(total_cents, count) if count > 0 else None


def monthly_average(months: list[MonthSpend]) -> Average:
    """The mean over the complete months, or None under `MIN_MONTHS_FOR_AVERAGE`."""
    complete = [m for m in months if m.complete]
    if len(complete) < MIN_MONTHS_FOR_AVERAGE:
        return Average(average_cents=None, months_counted=len(complete))
    total = sum(m.spent_cents for m in complete)
    return Average(average_cents=mean_cents(total, len(complete)), months_counted=len(complete))


def yearly(months: list[MonthSpend]) -> list[YearSpend]:
    """Each calendar year over its complete months, oldest first."""
    by_year: dict[int, list[MonthSpend]] = {}
    for month in months:
        if month.complete:
            by_year.setdefault(int(month.key[:4]), []).append(month)
    years: list[YearSpend] = []
    for year in sorted(by_year):
        rows = by_year[year]
        total = sum(m.spent_cents for m in rows)
        years.append(YearSpend(
            year=year, spent_cents=total, months_counted=len(rows),
            monthly_average_cents=(mean_cents(total, len(rows))
                                   if len(rows) >= MIN_MONTHS_FOR_AVERAGE else None),
        ))
    return years
```

- [ ] **Step 4: Run** — `./.venv/Scripts/pytest.exe tests/test_category_history.py -q` → all pass; `./.venv/Scripts/ruff.exe check app tests` clean.
- [ ] **Step 5: Commit** — `feat(budgets): what one category cost, month by month`.

---

### Task 2: `GET /budgets/{category_id}/detail`

**Files:**
- Modify: `backend/app/schemas/budgets.py` (append the detail models)
- Modify: `backend/app/api/budgets.py` (new route)
- Test: `backend/tests/test_budget_detail_api.py`

**Interfaces:**
- Consumes: Task 1; `api.common.tx_points`, `rolled_budget_spend`; `engines.budget.evaluate_budgets`, `BudgetEntry`, `days_in_month`, `elapsed_days`; `api.budgets.resolve_month`; `api.history.user_history`.
- Produces the JSON shape of the spec (« API »), with `budget.spent_cents` = what the Budgets screen counts against that ceiling.

- [ ] **Step 1: Failing tests** — `backend/tests/test_budget_detail_api.py`:

```python
def _register(client, email: str = "max@example.com") -> dict[str, str]:
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def _categories(client, headers) -> dict[str, int]:
    flat: dict[str, int] = {}

    def walk(rows):
        for row in rows:
            flat[row["slug"]] = row["id"]
            walk(row.get("children", []))

    walk(client.get("/api/categories", headers=headers).json())
    return flat


def _account(client, headers) -> int:
    return client.post("/api/accounts", headers=headers, json={
        "name": "Compte courant", "kind": "checking"}).json()["id"]


def _tx(client, headers, account_id: int, category_id: int, on: str, cents: int,
        label: str = "CB TEST") -> None:
    response = client.post("/api/transactions", headers=headers, json={
        "account_id": account_id, "date": on, "amount_cents": cents,
        "label_raw": label, "category_id": category_id})
    assert response.status_code == 201, response.text


def _detail(client, headers, category_id: int, month: str) -> dict:
    response = client.get(f"/api/budgets/{category_id}/detail?month={month}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_a_family_sums_its_children_and_lists_them(client):
    headers = _register(client)
    account, cats = _account(client, headers), _categories(client, headers)
    _tx(client, headers, account, cats["transport-carburant"], "2026-08-03", -6000)
    _tx(client, headers, account, cats["transport-carburant"], "2026-08-19", -5800)
    _tx(client, headers, account, cats["transport-peage"], "2026-08-10", -3400)

    body = _detail(client, headers, cats["transport"], "2026-08")
    assert body["category"]["slug"] == "transport"
    assert body["category"]["parent"] is None
    assert (body["spent_cents"], body["count"]) == (-15200, 3)
    fuel = next(p for p in body["parts"] if p["slug"] == "transport-carburant")
    assert (fuel["spent_cents"], fuel["count"], fuel["average_ticket_cents"]) == (-11800, 2, -5900)
    assert {"transport-carburant", "transport-entretien", "transport-assurance",
            "transport-peage"} <= {p["slug"] for p in body["parts"]}
    assert body["siblings"] == []


def test_a_child_names_its_parent_and_its_siblings(client):
    headers = _register(client)
    account, cats = _account(client, headers), _categories(client, headers)
    _tx(client, headers, account, cats["transport-carburant"], "2026-08-03", -6000)

    body = _detail(client, headers, cats["transport-carburant"], "2026-08")
    assert body["category"]["parent"] == {"id": cats["transport"], "name": "Transport",
                                          "slug": "transport"}
    assert body["parts"] == []
    siblings = {s["slug"]: s for s in body["siblings"]}
    assert siblings["transport-carburant"]["spent_cents"] == -6000
    assert "transport-peage" in siblings


def test_the_average_runs_over_complete_months_only(client):
    headers = _register(client)
    account, cats = _account(client, headers), _categories(client, headers)
    fuel = cats["transport-carburant"]
    # The ledger runs from 2026-01-01 to 2026-04-15: January to March are
    # complete, April is not.
    _tx(client, headers, account, fuel, "2026-01-01", -9000)
    _tx(client, headers, account, fuel, "2026-03-10", -6000)
    _tx(client, headers, account, fuel, "2026-04-15", -50000)

    body = _detail(client, headers, fuel, "2026-04")
    assert body["spent_cents"] == -50000
    assert (body["average_cents"], body["months_counted"]) == (-5000, 3)
    assert [m["month"] for m in body["series"]] == ["2026-01", "2026-02", "2026-03", "2026-04"]
    assert [m["complete"] for m in body["series"]] == [True, True, True, False]
    assert body["years"] == [{"year": 2026, "spent_cents": -15000, "months_counted": 3,
                              "monthly_average_cents": -5000}]


def test_the_budget_reading_is_the_budgets_screen_line(client):
    headers = _register(client)
    account, cats = _account(client, headers), _categories(client, headers)
    client.patch(f"/api/categories/{cats['transport']}", headers=headers,
                 json={"monthly_budget_cents": 35_000})
    _tx(client, headers, account, cats["transport-carburant"], "2026-08-03", -11800)
    _tx(client, headers, account, cats["transport-peage"], "2026-08-10", -3400)

    detail = _detail(client, headers, cats["transport"], "2026-08")
    report = client.get("/api/budgets?month=2026-08", headers=headers).json()
    line = next(line for line in report["lines"] if line["category_id"] == cats["transport"])
    assert detail["budget"]["budget_cents"] == 35_000
    assert detail["budget"]["spent_cents"] == line["spent_cents"]
    assert detail["budget"]["remaining_cents"] == line["remaining_cents"]
    assert detail["budget"]["status"] == line["status"]
    fuel = next(p for p in detail["parts"] if p["slug"] == "transport-carburant")
    assert fuel["budget"] is None


def test_another_households_category_is_not_found(client):
    owner = _register(client, "a@example.com")
    cats = _categories(client, owner)
    stranger = _register(client, "b@example.com")
    response = client.get(f"/api/budgets/{cats['transport']}/detail", headers=stranger)
    assert response.status_code == 404
    assert response.json()["detail"] == "Catégorie introuvable"


def test_a_malformed_month_is_refused_in_french(client):
    headers = _register(client)
    cats = _categories(client, headers)
    response = client.get(f"/api/budgets/{cats['transport']}/detail?month=aout",
                          headers=headers)
    assert response.status_code == 422
    assert "AAAA-MM" in response.json()["detail"]


def test_a_household_without_statements_gets_an_empty_page(client):
    headers = _register(client)
    cats = _categories(client, headers)
    response = client.get(f"/api/budgets/{cats['transport']}/detail", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["history"] is None
    assert body["series"] == [] and body["years"] == []
    assert (body["spent_cents"], body["average_cents"]) == (0, None)
```

- [ ] **Step 2: Run** → FAIL (404 on the route).

- [ ] **Step 3: Schemas** — append to `backend/app/schemas/budgets.py`:

```python
# --- GET /budgets/{category_id}/detail: the universe page of one category -----


class BudgetReadingOut(BaseModel):
    budget_cents: int
    # What the Budgets screen counts against this ceiling: the category and
    # the descendants that carry no budget of their own (`rolled_budget_spend`).
    spent_cents: int
    remaining_cents: int
    consumed_ratio: float
    projected_cents: int | None
    status: BudgetStatus


class CategoryRefOut(BaseModel):
    id: int
    name: str
    slug: str


class DetailCategoryOut(BaseModel):
    id: int
    name: str
    slug: str
    color: str
    is_essential: bool
    parent: CategoryRefOut | None


class DetailPartOut(BaseModel):
    category_id: int
    name: str
    slug: str
    color: str
    spent_cents: int
    count: int
    average_ticket_cents: int | None
    average_cents: int | None
    months_counted: int
    budget: BudgetReadingOut | None


class DetailMonthOut(BaseModel):
    month: str
    spent_cents: int
    count: int
    # The ledger covers the whole month; only complete months enter a mean.
    complete: bool


class DetailYearOut(BaseModel):
    year: int
    spent_cents: int
    months_counted: int
    monthly_average_cents: int | None


class BudgetDetailOut(BaseModel):
    category: DetailCategoryOut
    month: str
    month_start: date
    month_end: date
    days_elapsed: int
    days_in_month: int
    is_current_month: bool
    # The category and ALL its descendants: what the family cost.
    spent_cents: int
    count: int
    average_ticket_cents: int | None
    budget: BudgetReadingOut | None
    average_cents: int | None
    months_counted: int
    years: list[DetailYearOut]
    series: list[DetailMonthOut]
    parts: list[DetailPartOut]
    siblings: list[DetailPartOut]
    history: HistoryOut | None
```

- [ ] **Step 4: Route** — in `backend/app/api/budgets.py`, import `HTTPException` (already), `rolled_budget_spend` (already), `evaluate_budgets`/`BudgetEntry` (already), plus `from app.engines.category_history import CategoryNode, average_ticket, monthly_average, monthly_series, spend, subtree_ids, yearly` and the new schemas; add after `budget_history`:

```python
@router.get("/{category_id}/detail", response_model=BudgetDetailOut)
def budget_detail(
    category_id: int,
    month: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BudgetDetailOut:
    """The universe page of one category: the month, the mean over the
    ledger's complete months, year by year and month by month, and the same
    figures for each child -- and for each sibling, on a child's page, so the
    scene can show the rest of the family around it.

    The month's spend and every ceiling are read exactly as `/budgets` reads
    them (`tx_points`, `rolled_budget_spend`): the page and the Budgets screen
    can never disagree about one month."""
    today = date.today()
    categories = (
        db.query(Category)
        .filter(Category.user_id == user.id)
        .order_by(Category.position, Category.name)
        .all()
    )
    by_id = {category.id: category for category in categories}
    category = by_id.get(category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="Catégorie introuvable")

    history = user_history(db, user.id)
    month_start = resolve_month(month, history, today)
    total_days = days_in_month(month_start)
    month_end = date(month_start.year, month_start.month, total_days)
    month_points = tx_points(db, user.id, month_start, month_end)
    ledger_points = tx_points(db, user.id, history.date_from, history.date_to) if history else []

    nodes = [CategoryNode(id=c.id, parent_id=c.parent_id) for c in categories]
    budgeted_ids = {c.id for c in categories
                    if c.monthly_budget_cents and c.monthly_budget_cents > 0}
    spent_by_category = {
        total.category_id: total.total_cents for total in aggregate_by_category(month_points)
    }
    rolled = rolled_budget_spend(spent_by_category, categories, budgeted_ids)

    def reading(node: Category) -> BudgetReadingOut | None:
        if node.id not in budgeted_ids:
            return None
        line = evaluate_budgets(
            [BudgetEntry(category_id=node.id, budget_cents=node.monthly_budget_cents,
                         spent_cents=rolled[node.id])],
            month_start, today,
        )[0]
        return BudgetReadingOut(
            budget_cents=line.budget_cents, spent_cents=line.spent_cents,
            remaining_cents=line.remaining_cents, consumed_ratio=line.consumed_ratio,
            projected_cents=line.projected_cents, status=line.status,
        )

    def series_of(ids: frozenset[int]):
        if history is None:
            return []
        return monthly_series(ledger_points, ids, history.date_from, history.date_to)

    def part(node: Category) -> DetailPartOut:
        ids = subtree_ids(nodes, node.id)
        spent, count = spend(month_points, ids)
        average = monthly_average(series_of(ids))
        return DetailPartOut(
            category_id=node.id, name=node.name, slug=node.slug, color=node.color,
            spent_cents=spent, count=count, average_ticket_cents=average_ticket(spent, count),
            average_cents=average.average_cents, months_counted=average.months_counted,
            budget=reading(node),
        )

    def children_of(parent_id: int) -> list[Category]:
        return [c for c in categories if c.parent_id == parent_id]

    ids = subtree_ids(nodes, category.id)
    spent, count = spend(month_points, ids)
    series = series_of(ids)
    average = monthly_average(series)
    parent = by_id.get(category.parent_id) if category.parent_id is not None else None

    return BudgetDetailOut(
        category=DetailCategoryOut(
            id=category.id, name=category.name, slug=category.slug, color=category.color,
            is_essential=category.is_essential,
            parent=(CategoryRefOut(id=parent.id, name=parent.name, slug=parent.slug)
                    if parent else None),
        ),
        month=f"{month_start.year}-{month_start.month:02d}",
        month_start=month_start,
        month_end=month_end,
        days_elapsed=elapsed_days(month_start, today),
        days_in_month=total_days,
        is_current_month=(month_start.year, month_start.month) == (today.year, today.month),
        spent_cents=spent,
        count=count,
        average_ticket_cents=average_ticket(spent, count),
        budget=reading(category),
        average_cents=average.average_cents,
        months_counted=average.months_counted,
        years=[DetailYearOut(year=y.year, spent_cents=y.spent_cents,
                             months_counted=y.months_counted,
                             monthly_average_cents=y.monthly_average_cents)
               for y in yearly(series)],
        series=[DetailMonthOut(month=m.key, spent_cents=m.spent_cents, count=m.count,
                               complete=m.complete) for m in series],
        parts=[part(child) for child in children_of(category.id)],
        siblings=[part(sibling) for sibling in children_of(parent.id)] if parent else [],
        history=history,
    )
```

- [ ] **Step 5: Run** the new file, then the budget files (`tests/test_budgets_api.py tests/test_budget_rollup_api.py`), then ruff → green.
- [ ] **Step 6: Commit** — `feat(budgets): the detail of one category, month by month`.

---

### Task 3: Wire types, universe registry, readings

**Files:**
- Modify: `frontend/src/lib/types.ts` (after `BudgetReport`)
- Create: `frontend/src/features/budgets/universe/registry.ts`, `registry.test.ts`
- Create: `frontend/src/features/budgets/universe/readings.ts`, `readings.test.ts`

**Interfaces — Produces:**

```ts
// lib/types.ts
export interface BudgetReading { budget_cents: number; spent_cents: number; remaining_cents: number; consumed_ratio: number; projected_cents: number | null; status: BudgetStatus }
export interface CategoryRef { id: number; name: string; slug: string }
export interface BudgetDetailCategory { id: number; name: string; slug: string; color: string; is_essential: boolean; parent: CategoryRef | null }
export interface BudgetDetailPart { category_id: number; name: string; slug: string; color: string; spent_cents: number; count: number; average_ticket_cents: number | null; average_cents: number | null; months_counted: number; budget: BudgetReading | null }
export interface BudgetDetailMonth { month: string; spent_cents: number; count: number; complete: boolean }
export interface BudgetDetailYear { year: number; spent_cents: number; months_counted: number; monthly_average_cents: number | null }
export interface BudgetDetail { category: BudgetDetailCategory; month: string; month_start: string; month_end: string; days_elapsed: number; days_in_month: number; is_current_month: boolean; spent_cents: number; count: number; average_ticket_cents: number | null; budget: BudgetReading | null; average_cents: number | null; months_counted: number; years: BudgetDetailYear[]; series: BudgetDetailMonth[]; parts: BudgetDetailPart[]; siblings: BudgetDetailPart[]; history: History | null }

// registry.ts
export type UniverseId = "car";
export type PartId = "fuel" | "engine" | "cage" | "toll";
export interface Named { slug: string; name: string }
export interface UniverseMatch { universe: UniverseId; focus: PartId | null }
export function partFor(universe: UniverseId, category: Named): PartId | null
export function universeFor(category: Named & { parent: Named | null }): UniverseMatch | null

// readings.ts
export interface Gauge { remainingCents: number; budgetCents: number; share: number; status: BudgetStatus }
export type LevelBasis = "budget" | "average";
export interface Level { share: number; basis: LevelBasis; referenceCents: number }
export interface PartReading { categoryId: number; name: string; part: PartId; spentCents: number; level: Level | null; budget: BudgetReading | null; averageCents: number | null; status: BudgetStatus | null; focused: boolean; dimmed: boolean }
export function gaugeFor(budget: BudgetReading | null): Gauge | null
export function levelFor(part: BudgetDetailPart): Level | null
export function partReadings(detail: BudgetDetail, match: UniverseMatch): PartReading[]
```

Rules (from the spec): a universe root is matched by slug (`transport`) or by `/\b(voiture|auto|automobile|véhicule|vehicule|moto)\b/i`; a child of a matched root takes that universe with `focus = partFor(child)` — a child with no part (Transports en commun) gets `null` (no scene); a ROOT category with no match is tried against the parts' *strong* words only (carburant, essence, gazole, diesel, péage, autoroute, garage, pneu, contrôle technique), never « assurance » or « entretien » alone. Part slugs: `transport-carburant`→fuel, `transport-entretien`→engine, `transport-assurance`→cage, `transport-peage`→toll; part words (under a car root): fuel `/carburant|essence|gazole|diesel|plein|recharge|borne/i`, engine `/entretien|garage|révision|revision|pneu|réparation|reparation|contrôle technique|controle technique/i`, cage `/assurance/i`, toll `/péage|peage|parking|stationnement|autoroute/i`.

`levelFor`: budget → `share = clamp(remaining/budget, 0, 1)`, basis `budget`, reference `budget_cents`; else a non-null non-zero average → `share = clamp(1 - |spent|/|average|, 0, 1)`, basis `average`, reference `|average|`; else `null`. `gaugeFor`: `share = clamp(remaining/budget, 0, 1)`. `partReadings`: on a root page the source is `detail.parts`; on a child page `detail.siblings`; on a root page whose own match is a part (`focus !== null`, no parent) the source is the page itself as one part. Unmapped parts are skipped; `focused` = the page's own category; `dimmed` = a focus exists and this part is not it.

- [ ] Step 1: tests (registry: slugs, words, child focus, « Transports en commun » → null, « Assurance habitation » at root → null, « Essence » at root → `{car, fuel}`; readings: each rule above, including clamping of an overspent budget to 0).
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: `npx vitest run src/features/budgets/universe` → PASS.
- [ ] Step 5: Commit — `feat(budgets): which universe a category lives in, and its readings`.

---

### Task 4: « Mois par mois » chart

**Files:** Create `frontend/src/charts/CategoryMonthsChart.tsx`, `CategoryMonthsChart.test.tsx`.

**Interfaces — Produces:** `buildCategoryMonthsOption(series: BudgetDetailMonth[], current: string, averageCents: number | null, theme: Resolved): EChartsOption` and `<CategoryMonthsChart series current averageCents />`.

One bar per month (magnitude in cents, formatter `formatCents`), the month on screen in `accentStrong`, the others in `accent` at 55 % opacity, incomplete months in `muted`; a dashed `markLine` at `|averageCents|` labelled « Moyenne 287,00 € » when the average exists, none otherwise. Tooltip: « septembre 2026 : 262,00 € · 9 opérations » (+ « mois incomplet » when not complete). `ariaLabel` = « Dépense de la catégorie, mois par mois ». Export rows `{Mois, Dépense}`.

- [ ] Tests: bar count equals series length; the current month's colour differs; markLine present iff average; tooltip mentions « mois incomplet » for an incomplete month. Implement, run, commit — `feat(charts): one category month by month`.

---

### Task 5: Shared month navigation

**Files:** Create `frontend/src/features/budgets/MonthNav.tsx` (+ `MonthNav.css` holding the rules moved from `BudgetsPage.css` `.yd-budgets__month-nav`, `__month`, `__arrow*`), modify `BudgetsPage.tsx` to use it.

**Interfaces — Produces:** `<MonthNav current: string; onChange(key: string): void />` with the same buttons (« Mois précédent » / « Mois suivant », `aria-live` month label, disabled when `current` is empty).

- [ ] `BudgetsPage.test.tsx` passes unchanged (it already drives the arrows by name). Commit — `refactor(budgets): one month navigation for both screens`.

---

### Task 6: The car scene

**Files:** Create under `frontend/src/features/budgets/universe/scenes/car/`: `geometry.ts` (body, windows, arches, wheel centres/radii, spokes, lens centres/radii, label anchors — every coordinate from the validated mockup), `CarBody.tsx` (stage, road, shadows, paint, windows, trims, lights, wing), `Wheel.tsx`, `lenses.tsx` (`FuelLens`, `EngineLens`, `CageLens`, `TollLens`, and the shared `LensFrame`), `CarScene.tsx`, `CarScene.css`, `CarScene.test.tsx`; create `frontend/src/features/budgets/universe/SceneLabels.tsx` (+ CSS).

**Porting rules (from `docs/superpowers/specs/assets/2026-09-30-voiture-maquette.html`):**
- ViewBox `0 0 640 242`; the mockup's HUD title block is dropped (the page head carries it); the dial stays top-left.
- Every colour moves to `CarScene.css` as a class rule or a `--car-*` custom property on `.yd-car`; gradient stops get classes (`stop-color` in CSS); gradient ids are prefixed with `useId()` and referenced as `url(#…)` attributes.
- `:root[data-theme="light"] .yd-car` swaps the studio, road, shadows and the body's hairline for a light stage; the lenses stay dark.
- Animations are the mockup's keyframes, renamed `yd-car-*`; the base style of the fuel liquid is `translateY(var(--drop))` and of the needle `rotate(var(--needle))`, so a stopped animation shows the true value; `@media (prefers-reduced-motion: reduce)` and `:root[data-motion="off"] .yd-car` set `animation: none`.
- A lens is drawn only for a part present in `parts`; the fuel lens draws liquid only when `level` is not null (`--drop = (1 - share) × 24` units), with the warning glow when `status` is `at_risk`/`over` or, on an average basis, when the share is under 25 %.
- Lenses are `aria-hidden` pointer shortcuts; the accessible controls are the labels.

**`SceneLabels`**: one `<ul>` of buttons (dot, name, amount, second line), each carrying `--x`/`--y` (percent of the viewBox) — absolutely positioned on the scene from 640 px, a plain list under it below 640 px, the SVG leaders hidden there too. Each button's accessible name: « Carburant : 118,00 € ce mois, reste 32,00 € sur 150,00 € — ouvrir » (or « moyenne 104,00 € »). The gauge label (« Reste 88,00 € sur 350,00 € ») is the list's first item and is not a button.

**Interfaces — Produces:** `<CarScene gauge: Gauge | null; parts: PartReading[]; onSelect(categoryId: number): void />`.

- [ ] Tests: one lens and one label per part; no dial without gauge; clicking a label calls `onSelect(id)`; the fuel lens exposes `--drop` for its share; the focused part's label is marked `aria-current="true"`, dimmed ones carry the dimmed class. Implement, run, commit — `feat(budgets): the car universe`.

---

### Task 7: The universe page

**Files:** Create `frontend/src/features/budgets/universe/UniversePage.tsx`, `UniversePage.css`, `panels.tsx` (`ThisMonthPanel`, `AveragePanel`, `MonthsPanel`, `PartsPanel`), `UniversePage.test.tsx`; modify `frontend/src/app/routes.tsx` (lazy route `budgets/:categoryId`).

Behaviour: `useParams().categoryId`, `?mois=`; `useApiQuery<BudgetDetail>(`/budgets/${id}/detail`, { month })`; `PageHead` (icon `BudgetsIcon`, title = category name, lead = « 262,00 € en septembre 2026 · 287,00 € par mois en moyenne depuis mars 2025 » or « … · pas encore de moyenne (moins de trois mois complets) », actions = `MonthNav` + a « Budgets » back link keeping `?mois=`); the scene when `universeFor` matches (`onSelect` navigates to `/budgets/:id?mois=`); the four panels in a `BentoGrid` (`ThisMonthPanel` and `AveragePanel` side by side from 1200 px, `MonthsPanel` and `PartsPanel` full width); loading skeletons on the same cells; an API error in French in a `role="alert"`; a category with no statement at all says so with the import link (`EmptyState`, `historySentence`).

- [ ] Tests (fetch mocked like `BudgetsPage.test.tsx`): title and lead figures; car scene for `transport`, none for an unmatched category; parts list rows with count and mean ticket; a 404 detail printed verbatim; the month arrows change `?mois=`. Implement, run, commit — `feat(budgets): the universe page`.

---

### Task 8: Every category opens its universe

**Files:** Modify `BudgetBar.tsx` (optional `detailHref`, the name becomes a `Link`), `BudgetsPage.tsx` (pass `detailHref`; « Où va l'argent » rows and « Sans budget » names become links; uncategorised stays plain), tests in `BudgetBar.test.tsx` / `BudgetsPage.test.tsx`.

- [ ] Test: each link points at `/budgets/<id>?mois=<month>`. Commit — `feat(budgets): every category opens its universe`.

---

### Task 9: Preview stub and demo household

**Files:** `frontend/src/dev/mockApi.ts` (regex route `/api/budgets/(\d+)/detail` answering a Transport family over 18 months built from the stub's categories), `e2e/seed_demo_household.py` (car insurance under a label the transport rule matches, tolls and parking most months, two garage visits a year, a technical inspection; after import, budgets on Transport 350 € and Carburant 150 €).

- [ ] Run the seed against the dev database, open the page on the real backend. Commit — `chore(dev): the car universe in the preview and in the demo household`.

---

### Task 10: Judge it in the browser, and document

- [ ] Real backend + demo household: `/budgets/<transport id>` and `/budgets/<carburant id>` at 1440 and 390, light and dark, motion on and off; fix what looks wrong (one commit per fix).
- [ ] `CLAUDE.md`: a « Budget universes » section (registry, readings, scene contract, colours in the scene stylesheet, how to add a universe).
- [ ] Full suites green; commit — `docs: budget universes in CLAUDE.md`.
