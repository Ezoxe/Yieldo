# Audit du 26 septembre — chantier S (sécurité) : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the ten security defects S1–S10 of spec
`docs/superpowers/specs/2026-09-26-yieldo-avenir-securite-design.md`.

**Architecture:** Backend guards live in `app/security/` (throttle, headers,
secret guard) and are wired in `app/api/auth.py` / `app/main.py`; schema changes
are Alembic migrations with a `tests/test_migrations.py` case; the frontend fix
for S1 is one shared `charts/escapeHtml.ts` applied in every tooltip formatter
that interpolates data.

**Tech Stack:** FastAPI, Starlette ASGI middleware, SQLAlchemy 2, Alembic,
PyJWT, pytest; React 19, vitest + Testing Library, ECharts 5.

## Global Constraints

- Amounts are integer cents; dates ISO in JSON.
- Every business query filters on `user_id`.
- User-facing text French with « », non-breaking spaces before `: ; ? !`; code, comments, commits English.
- No bare `except: pass`; every refusal names its cause and remedy in French.
- Tests first (red), then code; one commit per task, Conventional Commits, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer.
- Backend: `cd backend && ./.venv/Scripts/pytest.exe -q` and `./.venv/Scripts/ruff.exe check app tests` (the 17 pre-existing ruff errors are chantier Q; add none).
- Frontend: `cd frontend && npm test && npm run build`.
- Screens touched (Réglages, Connexion, Inscription, every chart) are opened in the browser at 1440 and 390 px, both themes, before the chantier is called done.

---

### Task S1: Escape every data string in chart tooltips

**Files:**
- Create: `frontend/src/charts/escapeHtml.ts`
- Create: `frontend/src/charts/escapeHtml.test.ts`
- Create: `frontend/src/charts/tooltipSafety.test.ts`
- Modify: `frontend/src/charts/SpendingDonut.tsx` (tooltip formatter)
- Modify: `frontend/src/charts/WaterfallChart.tsx` (tooltip formatter)
- Modify: `frontend/src/charts/AnswerChart.tsx` (tooltip formatter)
- Modify: `frontend/src/charts/DebtPayoffChart.tsx` (tooltip formatter)
- Modify: `frontend/src/charts/CashflowChart.tsx` (tooltip formatter)
- Modify: `frontend/src/charts/CategoryTreemap.tsx` (extract `treemapTooltip`)
- Modify: `frontend/src/features/invest/SessionCharts.tsx` (`marketOption` tooltip)
- Modify: `frontend/src/features/invest/SessionCharts.test.tsx`

**Interfaces:**
- Produces: `escapeHtml(value: string): string` in `charts/escapeHtml.ts`;
  `treemapTooltip(params: { name?: string; value?: number }): string` exported
  from `charts/CategoryTreemap.tsx`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/charts/escapeHtml.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { escapeHtml } from "./escapeHtml";

describe("escapeHtml", () => {
  it("neutralises the five characters HTML gives a meaning to", () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">&`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;",
    );
  });

  it("leaves an ordinary French label exactly as it is", () => {
    expect(escapeHtml("Épargne et investissement — été 2026")).toBe(
      "Épargne et investissement — été 2026",
    );
  });

  it("returns the empty string for the empty string", () => {
    expect(escapeHtml("")).toBe("");
  });
});
```

`frontend/src/charts/tooltipSafety.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { CategoryBreakdown, Summary } from "../lib/types";
import { buildAnswerOption } from "./AnswerChart";
import { treemapTooltip } from "./CategoryTreemap";
import { buildPayoffOption } from "./DebtPayoffChart";
import { buildDonutOption } from "./SpendingDonut";
import { chartTokens, seriesColors } from "./theme";
import { buildWaterfallOption } from "./WaterfallChart";

// ECharts writes a tooltip formatter's return value with innerHTML. A category,
// a label or a debt is typed by the household -- or by an agent holding a
// ledger key -- so any of them can be markup. None may reach the DOM as markup.
const HOSTILE = `<img src=x onerror="alert(1)">`;

type Formatter = (params: unknown) => string;

function formatterOf(option: unknown): Formatter {
  return (option as { tooltip: { formatter: Formatter } }).tooltip.formatter;
}

function assertInert(html: string) {
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;img");
}

describe("chart tooltips never render data as markup", () => {
  it("the spending donut", () => {
    const { option } = buildDonutOption(
      [{ categoryId: 1, name: HOSTILE, amountCents: 1_000, color: null }],
      1_000,
      chartTokens("dark"),
      seriesColors("dark"),
    );
    assertInert(formatterOf(option)({ name: HOSTILE, value: 1_000, percent: 100 }));
  });

  it("the treemap", () => {
    assertInert(treemapTooltip({ name: HOSTILE, value: 1_000 }));
  });

  it("the waterfall", () => {
    const summary: Summary = {
      date_from: "2026-03-01", date_to: "2026-03-31",
      inflow_cents: 300_000, outflow_cents: -1_000, net_cents: 299_000,
      transaction_count: 2, savings_rate: 0.99, set_aside_cents: 0, set_aside_gap_cents: 0,
      previous: null,
      comparison: null,
      history: { date_from: "2026-01-01", date_to: "2026-03-31", transaction_count: 2 },
    } as unknown as Summary;
    const categories: CategoryBreakdown[] = [
      { category_id: 1, name: HOSTILE, color: "#ffffff", total_cents: -1_000, count: 1, share: 1 },
    ];
    const { option, steps } = buildWaterfallOption(summary, categories, chartTokens("dark"));
    const index = steps.findIndex((step) => step.name === HOSTILE);
    expect(index).toBeGreaterThanOrEqual(0);
    assertInert(formatterOf(option)({ dataIndex: index }));
  });

  it("the assistant's answer chart", () => {
    const option = buildAnswerOption(
      { kind: "bars", title: "Dépenses", points: [{ label: HOSTILE, amount_cents: -1_000 }] },
      "dark",
    );
    assertInert(formatterOf(option)([{ dataIndex: 0 }]));
  });

  it("the debt payoff chart", () => {
    const option = buildPayoffOption(
      [{ month: 1, on: "2026-10-01", balances_cents: { "7": 1_000 }, total_cents: 1_000 }],
      new Map([[7, HOSTILE]]),
      "dark",
    );
    assertInert(formatterOf(option)([{ dataIndex: 0 }]));
  });
});
```

Append to `frontend/src/features/invest/SessionCharts.test.tsx` (inside the
file, after the existing `describe` blocks; `day()` is the fixture already
defined at the top of that file):

```ts
describe("marketOption tooltip", () => {
  it("prints a model's words as text, never as markup", () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    const source = day();
    source.decisions[0] = {
      ...source.decisions[0],
      choice: hostile,
      rules_choice: hostile,
      message: hostile,
      mass_bps: { [hostile]: 10_000 },
    };
    const option = marketOption(source, "AAPL", "dark");
    const html = (option as { tooltip: { formatter: (p: unknown) => string } })
      .tooltip.formatter([{ dataIndex: 0 }]);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/charts/escapeHtml.test.ts src/charts/tooltipSafety.test.ts src/features/invest/SessionCharts.test.tsx`
Expected: FAIL — `escapeHtml` module not found, `treemapTooltip` not exported,
and every other case finds `<img` in the tooltip.

- [ ] **Step 3: Implement**

`frontend/src/charts/escapeHtml.ts`:

```ts
/**
 * Text, made safe to put inside HTML.
 *
 * ECharts renders a tooltip formatter's return value with `innerHTML`. Every
 * string that comes from the household's data -- a category, a label, a debt,
 * a symbol, a model's message -- goes through this before it is interpolated,
 * or a category named `<img onerror=…>` runs in the owner's session. Figures
 * formatted by `formatCents` and dates formatted by `frenchDate` are the
 * application's own output and need not pass through it.
 */
const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ENTITIES[char]);
}
```

`SpendingDonut.tsx` — add `import { escapeHtml } from "./escapeHtml";` and
change the formatter's return to:

```ts
        return `${escapeHtml(point.name ?? "")} : <strong>${formatCents(-(point.value ?? 0))}</strong><br/>${(point.percent ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % du total`;
```

`WaterfallChart.tsx` — add the import and change the formatter's return to:

```ts
        return `${escapeHtml(step.name)} : <strong>${formatCents(step.delta, { signed: true })}</strong>`;
```

`AnswerChart.tsx` — add the import and change the formatter's return to:

```ts
        return `<strong>${escapeHtml(point.label)}</strong><br/>${formatCents(point.amount_cents, {
          signed: true,
        })}`;
```

`DebtPayoffChart.tsx` — add the import and change the per-debt line to:

```ts
            (id) => `${escapeHtml(debtName(names, id))} : ${formatCents(point.balances_cents[id] ?? 0)}`,
```

`CashflowChart.tsx` — add the import and change the two interpolations:

```ts
        const header = escapeHtml(rows[0]?.axisValueLabel ?? "");
        const lines = rows.map(
          (row) => `${row.marker ?? ""}${escapeHtml(row.seriesName ?? "")} : <strong>${formatCents(row.value ?? 0)}</strong>`,
        );
```

`CategoryTreemap.tsx` — add the import, add this exported function above the
component, and make the option's `tooltip` read `{ formatter: (params) =>
treemapTooltip(params as { name?: string; value?: number }) }`:

```ts
/** The treemap's tooltip: a category's name and what it cost. The name is the
 *  household's own text, so it is escaped -- see `escapeHtml`. */
export function treemapTooltip(params: { name?: string; value?: number }): string {
  return `${escapeHtml(params.name ?? "")} : <strong>${formatCents(-(params.value ?? 0))}</strong>`;
}
```

`SessionCharts.tsx` — add `import { escapeHtml } from "../../charts/escapeHtml";`
and, in `marketOption`'s formatter, escape every model-supplied string:

```ts
        if (decision) {
          text += `<br/>Le modèle : ${escapeHtml(decision.choice ?? "—")}`;
          if (decision.mass_bps) {
            text += ` (${Object.entries(decision.mass_bps)
              .map(([k, v]) => `${escapeHtml(k)} ${formatProbability(v)}`).join(" · ")})`;
          }
          if (decision.score_value !== null) text += `<br/>Conviction : ${decision.score_value}/10`;
          if (decision.rules_choice) text += `<br/>Les règles : ${escapeHtml(decision.rules_choice)}`;
          if (decision.message) text += `<br/>${escapeHtml(decision.message)}`;
        }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/charts src/features/invest/SessionCharts.test.tsx`
Expected: PASS, including every pre-existing chart test.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/charts frontend/src/features/invest/SessionCharts.tsx frontend/src/features/invest/SessionCharts.test.tsx
git commit -m "fix(security): chart tooltips print the household's words as text, never as markup"
```

---

### Task S2: Throttle failed logins

**Files:**
- Create: `backend/app/security/throttle.py`
- Create: `backend/tests/test_login_throttle.py`
- Modify: `backend/app/api/auth.py` (`login`)
- Modify: `backend/tests/conftest.py` (fresh throttle per test)

**Interfaces:**
- Produces: `app.security.throttle.LoginThrottle` with
  `retry_after(address: str, email: str) -> int | None`,
  `record_failure(address: str, email: str) -> None`,
  `record_success(address: str, email: str) -> None`; module attribute
  `login_throttle`; `wait_message(seconds: int) -> str`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_login_throttle.py`:

```python
"""Five wrong passwords for one account, fifty from one address, then a wait."""

from app.security import throttle
from app.security.throttle import (
    MAX_FAILURES_PER_ACCOUNT,
    MAX_FAILURES_PER_ADDRESS,
    WINDOW_SECONDS,
    LoginThrottle,
    wait_message,
)


class Clock:
    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now


def test_an_account_is_let_through_until_its_fifth_failure():
    clock = Clock()
    gate = LoginThrottle(clock=clock)
    for _ in range(MAX_FAILURES_PER_ACCOUNT - 1):
        gate.record_failure("10.0.0.1", "max@example.com")
    assert gate.retry_after("10.0.0.1", "max@example.com") is None
    gate.record_failure("10.0.0.1", "max@example.com")
    assert gate.retry_after("10.0.0.1", "max@example.com") == WINDOW_SECONDS


def test_the_wait_ends_when_the_oldest_failure_leaves_the_window():
    clock = Clock()
    gate = LoginThrottle(clock=clock)
    for _ in range(MAX_FAILURES_PER_ACCOUNT):
        gate.record_failure("10.0.0.1", "max@example.com")
    clock.now += WINDOW_SECONDS - 60
    assert gate.retry_after("10.0.0.1", "max@example.com") == 60
    clock.now += 60
    assert gate.retry_after("10.0.0.1", "max@example.com") is None


def test_a_success_forgets_the_account_failures():
    gate = LoginThrottle(clock=Clock())
    for _ in range(MAX_FAILURES_PER_ACCOUNT - 1):
        gate.record_failure("10.0.0.1", "max@example.com")
    gate.record_success("10.0.0.1", "max@example.com")
    gate.record_failure("10.0.0.1", "max@example.com")
    assert gate.retry_after("10.0.0.1", "max@example.com") is None


def test_one_address_walking_many_accounts_is_stopped_at_fifty():
    gate = LoginThrottle(clock=Clock())
    for index in range(MAX_FAILURES_PER_ADDRESS):
        gate.record_failure("10.0.0.9", f"victime{index}@example.com")
    assert gate.retry_after("10.0.0.9", "autre@example.com") == WINDOW_SECONDS
    assert gate.retry_after("10.0.0.10", "autre@example.com") is None


def test_the_wait_is_said_in_whole_minutes():
    assert wait_message(30) == "Trop de tentatives de connexion. Réessayez dans 1 minute."
    assert wait_message(900) == "Trop de tentatives de connexion. Réessayez dans 15 minutes."


def _register(client):
    client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"})


def test_the_sixth_attempt_is_refused_even_with_the_right_password(client):
    _register(client)
    for _ in range(MAX_FAILURES_PER_ACCOUNT):
        assert client.post("/api/auth/login", json={
            "email": "max@example.com", "password": "mauvais"}).status_code == 401

    response = client.post("/api/auth/login", json={
        "email": "max@example.com", "password": "motdepasse123"})

    assert response.status_code == 429
    assert response.json()["detail"] == (
        "Trop de tentatives de connexion. Réessayez dans 15 minutes.")
    assert response.headers["Retry-After"] == str(WINDOW_SECONDS)


def test_the_email_is_counted_case_insensitively(client):
    _register(client)
    for _ in range(MAX_FAILURES_PER_ACCOUNT):
        client.post("/api/auth/login", json={"email": "MAX@example.com", "password": "x"})
    assert client.post("/api/auth/login", json={
        "email": "max@example.com", "password": "motdepasse123"}).status_code == 429


def test_the_throttle_is_fresh_for_every_test():
    assert throttle.login_throttle.retry_after("testclient", "max@example.com") is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && ./.venv/Scripts/pytest.exe tests/test_login_throttle.py -q`
Expected: FAIL — `ModuleNotFoundError: app.security.throttle`.

- [ ] **Step 3: Implement**

`backend/app/security/throttle.py`:

```python
"""How many wrong passwords a door takes before it makes the caller wait.

In memory, and that is enough for this deployment: one uvicorn process serves
the household (`docker/Dockerfile` starts no worker pool), so a counter in this
process sees every attempt. A restart forgets them, which gives an attacker
nothing they did not already have.

Two keys, because the two attacks are different:

* (address, email) -- someone guessing ONE account's password. Five failures in
  fifteen minutes is more than a human mistyping ever needs;
* address alone -- someone walking a list of accounts. Fifty.

A success forgets the (address, email) failures and nothing else: the owner
signing in does not reset the counter an attacker built against other accounts
from the same address.

The clock is injected so the tests can move it; the application uses
`time.monotonic`, which a change of system time cannot rewind.
"""

import math
import time
from collections import deque
from collections.abc import Callable, Hashable
from dataclasses import dataclass, field

WINDOW_SECONDS = 15 * 60
MAX_FAILURES_PER_ACCOUNT = 5
MAX_FAILURES_PER_ADDRESS = 50
# Past this many remembered keys the empty ones are swept, so a caller trying
# a million different emails cannot grow this process's memory for ever.
MAX_KEYS = 10_000


@dataclass
class LoginThrottle:
    clock: Callable[[], float] = time.monotonic
    _by_account: dict[tuple[str, str], deque[float]] = field(default_factory=dict)
    _by_address: dict[str, deque[float]] = field(default_factory=dict)

    def _recent(self, bucket: dict, key: Hashable) -> deque[float]:
        now = self.clock()
        stamps = bucket.get(key)
        if stamps is None:
            stamps = deque()
            bucket[key] = stamps
        while stamps and now - stamps[0] >= WINDOW_SECONDS:
            stamps.popleft()
        return stamps

    def retry_after(self, address: str, email: str) -> int | None:
        """Seconds the caller must wait before trying again, or None."""
        now = self.clock()
        waits: list[float] = []
        account = self._recent(self._by_account, (address, email))
        if len(account) >= MAX_FAILURES_PER_ACCOUNT:
            waits.append(account[0] + WINDOW_SECONDS - now)
        from_address = self._recent(self._by_address, address)
        if len(from_address) >= MAX_FAILURES_PER_ADDRESS:
            waits.append(from_address[0] + WINDOW_SECONDS - now)
        if not waits:
            return None
        return max(1, math.ceil(max(waits)))

    def record_failure(self, address: str, email: str) -> None:
        now = self.clock()
        self._recent(self._by_account, (address, email)).append(now)
        self._recent(self._by_address, address).append(now)
        if len(self._by_account) + len(self._by_address) > MAX_KEYS:
            self._sweep()

    def record_success(self, address: str, email: str) -> None:
        self._by_account.pop((address, email), None)

    def _sweep(self) -> None:
        for bucket in (self._by_account, self._by_address):
            for key in list(bucket):
                if not self._recent(bucket, key):
                    del bucket[key]


def wait_message(seconds: int) -> str:
    minutes = max(1, math.ceil(seconds / 60))
    unit = "minute" if minutes == 1 else "minutes"
    return f"Trop de tentatives de connexion. Réessayez dans {minutes} {unit}."


login_throttle = LoginThrottle()
```

In `backend/app/api/auth.py`, add `from app.security import throttle` and
replace `login` with:

```python
@router.post("/login", response_model=TokenOut)
def login(
    payload: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)
) -> TokenOut:
    email = payload.email.strip().lower()
    # The address as uvicorn resolved it: behind a reverse proxy it is the
    # client's only when the proxy is trusted (FORWARDED_ALLOW_IPS).
    address = request.client.host if request.client is not None else "inconnue"
    wait = throttle.login_throttle.retry_after(address, email)
    if wait is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=throttle.wait_message(wait),
            headers={"Retry-After": str(wait)},
        )

    user = db.query(User).filter(User.email == email).first()
    # Exactly one Argon2 verification on every path, against a precomputed dummy
    # when the account does not exist, so the two failures are indistinguishable
    # from the outside.
    stored_hash = user.password_hash if user else _DUMMY_HASH
    password_ok = verify_password(payload.password, stored_hash)
    if user is None or not user.is_active or not password_ok:
        throttle.login_throttle.record_failure(address, email)
        raise _invalid_credentials()

    throttle.login_throttle.record_success(address, email)
    _set_refresh_cookie(response, user.id)
    return TokenOut(access_token=create_access_token(user.id), user=UserOut.model_validate(user))
```

In `backend/tests/conftest.py`, add after the imports:

```python
from app.security import throttle


@pytest.fixture(autouse=True)
def fresh_login_throttle(monkeypatch):
    """The throttle is module state; a test must never inherit another's failures."""
    monkeypatch.setattr(throttle, "login_throttle", throttle.LoginThrottle())
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && ./.venv/Scripts/pytest.exe tests/test_login_throttle.py tests/test_auth_api.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/security/throttle.py backend/app/api/auth.py backend/tests/conftest.py backend/tests/test_login_throttle.py
git commit -m "fix(security): five wrong passwords make the next attempt wait"
```

---

### Task S3: A password change ends every other session

**Files:**
- Create: `backend/alembic/versions/a3c5e7f9b1d2_session_version.py`
- Create: `backend/tests/test_session_revocation.py`
- Modify: `backend/app/models/user.py`
- Modify: `backend/app/security/tokens.py`
- Modify: `backend/app/security/deps.py` (`_session_user`)
- Modify: `backend/app/api/auth.py` (`_set_refresh_cookie`, `register`, `login`, `refresh`, `change_password`, new `revoke_other_sessions`)
- Modify: `backend/tests/test_auth_api.py` (`test_password_change_replaces_the_password`: 204 → 200)
- Modify: `backend/tests/test_migrations.py`
- Modify: `frontend/src/features/auth/session.ts` (export `applySession`)
- Modify: `frontend/src/features/settings/PasswordForm.tsx`
- Create: `frontend/src/features/settings/SessionsPanel.tsx`
- Create: `frontend/src/features/settings/SessionsPanel.test.tsx`
- Modify: `frontend/src/features/settings/SettingsPage.tsx` (the « Fin de session » cell)
- Modify: `frontend/src/dev/mockApi.ts` (`POST /api/auth/password`, `POST /api/auth/sessions/revoke-others`)

**Interfaces:**
- Produces: `User.session_version: int`; `tokens.TokenClaims(user_id: int,
  session_version: int)`; `tokens.decode_claims(token: str, expected_type: str)
  -> TokenClaims`; `create_access_token(user_id: int, session_version: int = 0)`,
  `create_refresh_token(user_id: int, session_version: int = 0)`;
  `decode_token` keeps returning the user id (int). `POST /auth/password` and
  `POST /auth/sessions/revoke-others` return `TokenOut` (200) and set the
  refresh cookie. Frontend: `applySession(session: { access_token: string; user: User })`
  exported from `features/auth/session.ts`.

- [ ] **Step 1: Write the failing backend tests**

`backend/tests/test_session_revocation.py`:

```python
"""A new password, or « Déconnecter les autres appareils », ends every session
opened before it -- except the one that asked."""

import jwt

from app.config import settings
from app.models import AgentKey, User


def _register(client):
    response = client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"})
    return response.json()["access_token"]


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_a_password_change_hands_back_a_session_that_works(client):
    old = _register(client)

    response = client.post("/api/auth/password", headers=_bearer(old), json={
        "current_password": "motdepasse123", "new_password": "nouveaumotdepasse"})

    assert response.status_code == 200
    fresh = response.json()["access_token"]
    assert client.get("/api/auth/me", headers=_bearer(fresh)).status_code == 200
    assert "yieldo_refresh" in response.cookies


def test_a_password_change_ends_the_old_access_token(client):
    old = _register(client)
    client.post("/api/auth/password", headers=_bearer(old), json={
        "current_password": "motdepasse123", "new_password": "nouveaumotdepasse"})

    assert client.get("/api/auth/me", headers=_bearer(old)).status_code == 401


def test_a_password_change_ends_the_old_refresh_cookie(client):
    old = _register(client)
    stolen = client.cookies.get("yieldo_refresh")
    client.post("/api/auth/password", headers=_bearer(old), json={
        "current_password": "motdepasse123", "new_password": "nouveaumotdepasse"})

    client.cookies.clear()
    client.cookies.set("yieldo_refresh", stolen)
    assert client.post("/api/auth/refresh").status_code == 401


def test_a_password_change_ends_the_agent_key(client, db):
    token = _register(client)
    client.post("/api/access-key", headers=_bearer(token))
    client.post("/api/auth/password", headers=_bearer(token), json={
        "current_password": "motdepasse123", "new_password": "nouveaumotdepasse"})

    assert db.query(AgentKey).count() == 0


def test_revoking_the_other_sessions_keeps_the_one_that_asked(client, db):
    old = _register(client)

    response = client.post("/api/auth/sessions/revoke-others", headers=_bearer(old))

    assert response.status_code == 200
    fresh = response.json()["access_token"]
    assert client.get("/api/auth/me", headers=_bearer(fresh)).status_code == 200
    assert client.get("/api/auth/me", headers=_bearer(old)).status_code == 401
    assert db.query(User).one().session_version == 1


def test_an_agent_key_cannot_revoke_sessions(client):
    token = _register(client)
    key = client.post("/api/access-key", headers=_bearer(token)).json()["token"]

    response = client.post("/api/auth/sessions/revoke-others", headers=_bearer(key))

    assert response.status_code == 401
    assert "session" in response.json()["detail"].lower()


def test_a_token_issued_before_versions_existed_still_opens_version_zero(client, db):
    _register(client)
    user = db.query(User).one()
    legacy = jwt.encode(
        {"sub": str(user.id), "type": "access", "iat": 1, "exp": 9_999_999_999},
        settings.secret_key, algorithm="HS256")

    assert client.get("/api/auth/me", headers=_bearer(legacy)).status_code == 200
```

Before writing the agent-key assertions, check the key route and the JSON field
that carries the token: `grep -n "@router" backend/app/api/agent_keys.py` and
`grep -n "token" backend/app/schemas/agent_keys.py`. If the route path or the
field name differs from `POST /api/access-key` / `"token"`, use the real ones in
the two tests above.

In `backend/tests/test_auth_api.py`, change the assertion in
`test_password_change_replaces_the_password` from `== 204` to `== 200`.

Append to `backend/tests/test_migrations.py` (module constants sit at the top
of the file beside `LEARNED_MODEL_REVISION`):

```python
SESSION_VERSION_REVISION = "a3c5e7f9b1d2"


def test_the_session_version_lands_as_zero_on_existing_users_and_downgrades(migration_db):
    command.upgrade(migration_db.config, LEARNED_MODEL_REVISION)
    conn = _connect(migration_db)
    conn.execute(
        "INSERT INTO users (email, name, password_hash, role, is_active, created_at) "
        "VALUES ('ancien@example.com', 'Ancien', 'x', 'admin', 1, '2026-01-01')")
    conn.commit()
    conn.close()

    command.upgrade(migration_db.config, SESSION_VERSION_REVISION)
    conn = _connect(migration_db)
    version = conn.execute(
        "SELECT session_version FROM users WHERE email = 'ancien@example.com'").fetchone()[0]
    columns = _table_columns(conn, "users")
    conn.close()
    assert version == 0
    reference, _ = _reference_schema("users")
    assert columns == reference

    command.downgrade(migration_db.config, LEARNED_MODEL_REVISION)
    conn = _connect(migration_db)
    names = {row[1] for row in conn.execute("PRAGMA table_info(users)")}
    conn.close()
    assert "session_version" not in names
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && ./.venv/Scripts/pytest.exe tests/test_session_revocation.py tests/test_migrations.py -k "session" -q`
Expected: FAIL — `/api/auth/password` answers 204, `session_version` does not
exist, `/api/auth/sessions/revoke-others` is 404.

- [ ] **Step 3: Implement the backend**

`backend/app/models/user.py` — import `Integer, text` from sqlalchemy and add
after `is_active`:

```python
    # Bumped by a password change and by « Déconnecter les autres appareils ».
    # Every token carries the version it was issued under (`sv`), and one that
    # does not match is refused: that is how a session ends without a table of
    # revoked tokens.
    session_version: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
```

`backend/alembic/versions/a3c5e7f9b1d2_session_version.py`:

```python
"""a session version on every user

Revision ID: a3c5e7f9b1d2
Revises: e9f0a1b2c3d4
Create Date: 2026-09-26 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a3c5e7f9b1d2'
down_revision: Union[str, Sequence[str], None] = 'e9f0a1b2c3d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Zero for every existing user: the tokens already in their browsers
    carry no version and read as zero, so nobody is signed out by the upgrade."""
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column(
            "session_version", sa.Integer(), server_default=sa.text("0"), nullable=False))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("session_version")
```

`backend/app/security/tokens.py` — replace the module body with:

```python
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt

from app.config import settings

_ALGORITHM = "HS256"


class TokenError(Exception):
    """Raised when a token is missing, malformed, expired, or of the wrong type."""


@dataclass(frozen=True)
class TokenClaims:
    user_id: int
    # The `User.session_version` the token was issued under. A token minted
    # before versions existed carries none and reads as 0.
    session_version: int


def _create(user_id: int, session_version: int, token_type: str, lifetime: timedelta) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "type": token_type,
        "sv": session_version,
        "iat": int(now.timestamp()),
        "exp": int((now + lifetime).timestamp()),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=_ALGORITHM)


def create_access_token(user_id: int, session_version: int = 0) -> str:
    return _create(user_id, session_version, "access",
                   timedelta(minutes=settings.access_token_minutes))


def create_refresh_token(user_id: int, session_version: int = 0) -> str:
    return _create(user_id, session_version, "refresh",
                   timedelta(days=settings.refresh_token_days))


def decode_claims(token: str, expected_type: str) -> TokenClaims:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise TokenError("Jeton invalide ou expiré") from exc
    if payload.get("type") != expected_type:
        raise TokenError("Type de jeton inattendu")
    try:
        user_id = int(payload["sub"])
    except (KeyError, TypeError, ValueError) as exc:
        raise TokenError("Jeton sans identifiant utilisateur exploitable") from exc
    version = payload.get("sv", 0)
    if not isinstance(version, int) or isinstance(version, bool):
        raise TokenError("Jeton sans version de session exploitable")
    return TokenClaims(user_id=user_id, session_version=version)


def decode_token(token: str, expected_type: str) -> int:
    """The user id alone, for callers that do not check the session version."""
    return decode_claims(token, expected_type).user_id
```

`backend/app/security/deps.py` — import `decode_claims` instead of
`decode_token` and replace `_session_user` with:

```python
def _session_user(token: str, db: Session) -> User:
    try:
        claims = decode_claims(token, expected_type="access")
    except TokenError as exc:
        raise _unauthorized() from exc
    user = db.get(User, claims.user_id)
    # A version behind the user's own means a password changed, or the owner
    # signed every other device out, after this token was issued.
    if user is None or not user.is_active or claims.session_version != user.session_version:
        raise _unauthorized()
    return user
```

`backend/app/api/auth.py`:

1. Imports: `from app.models import AgentKey, User` and
   `from app.security.tokens import TokenError, create_access_token, create_refresh_token, decode_claims`.
2. Replace `_set_refresh_cookie` and add `_issue_session` and `_end_other_sessions`:

```python
def _set_refresh_cookie(response: Response, user: User) -> None:
    response.set_cookie(
        REFRESH_COOKIE,
        create_refresh_token(user.id, user.session_version),
        httponly=True,
        samesite="strict",
        secure=False,  # self-hosted deployments often run behind plain HTTP on a LAN
        max_age=settings.refresh_token_days * 86400,
        path="/api/auth",
    )


def _issue_session(response: Response, user: User) -> TokenOut:
    """A fresh access token and refresh cookie, under the user's current version."""
    _set_refresh_cookie(response, user)
    return TokenOut(
        access_token=create_access_token(user.id, user.session_version),
        user=UserOut.model_validate(user),
    )


def _end_other_sessions(db: Session, user: User) -> None:
    """Every token issued before now stops working, and so does the agent key.

    The key goes too: whoever changes their password because they fear someone
    else holds it must not leave a second way in open for 24 hours. The next
    visit to Réglages issues a new key, as it does after any expiry.
    """
    user.session_version += 1
    db.query(AgentKey).filter(AgentKey.user_id == user.id).delete()
    db.commit()
    db.refresh(user)
```

3. In `register`, `login` and `refresh`, replace the last two lines
   (`_set_refresh_cookie(response, user.id)` and `return TokenOut(...)`) with
   `return _issue_session(response, user)`.
4. In `refresh`, replace the decode block with:

```python
    try:
        claims = decode_claims(token, expected_type="refresh")
    except TokenError as exc:
        raise _invalid_credentials() from exc
    user = db.get(User, claims.user_id)
    if user is None or not user.is_active or claims.session_version != user.session_version:
        raise _invalid_credentials()
```

5. Replace `change_password`'s decorator and tail:

```python
@router.post("/password", response_model=TokenOut)
def change_password(
    payload: PasswordChangeIn,
    response: Response,
    # A session, never an agent key. See `get_session_user`.
    user: User = Depends(get_session_user),
    db: Session = Depends(get_db),
) -> TokenOut:
```

Keep its two refusals unchanged; replace its docstring paragraph beginning
"The refresh cookie is deliberately left alone" with:

```
    Every OTHER session ends here: the version the tokens carry is bumped and
    the agent key is deleted. This session does not end -- the response carries
    a fresh access token and cookie under the new version, which the screen
    applies, so the operator is not signed out of the tab they are using.
```

and replace its last two lines with:

```python
    user.password_hash = hash_password(payload.new_password)
    _end_other_sessions(db, user)
    return _issue_session(response, user)
```

6. Add the new route after `change_password`:

```python
@router.post("/sessions/revoke-others", response_model=TokenOut)
def revoke_other_sessions(
    response: Response,
    user: User = Depends(get_session_user),
    db: Session = Depends(get_db),
) -> TokenOut:
    """« Déconnecter les autres appareils » : every other browser and the agent
    key lose access; this tab carries on with the session returned here."""
    _end_other_sessions(db, user)
    return _issue_session(response, user)
```

- [ ] **Step 4: Run the backend tests**

Run: `cd backend && ./.venv/Scripts/pytest.exe tests/test_session_revocation.py tests/test_auth_api.py tests/test_agent_key_api.py tests/test_security.py tests/test_migrations.py -q`
Expected: PASS.

- [ ] **Step 5: Write the failing frontend test**

`frontend/src/features/settings/SessionsPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSession } from "../auth/session";
import { SessionsPanel } from "./SessionsPanel";

const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("SessionsPanel", () => {
  it("signs the other devices out and keeps this one", async () => {
    const user = { id: 1, email: "max@example.com", name: "Max", role: "admin" };
    fetchMock.mockResolvedValue(json({ access_token: "neuf", token_type: "bearer", user }));
    render(<SessionsPanel />);

    await userEvent.click(screen.getByRole("button", { name: "Déconnecter les autres appareils" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Les autres appareils sont déconnectés.",
    );
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/sessions/revoke-others");
    expect(useSession.getState().accessToken).toBe("neuf");
  });

  it("prints the backend's refusal", async () => {
    fetchMock.mockResolvedValue(json({ detail: "Authentification requise" }, 403));
    render(<SessionsPanel />);

    await userEvent.click(screen.getByRole("button", { name: "Déconnecter les autres appareils" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Authentification requise");
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/features/settings/SessionsPanel.test.tsx`
Expected: FAIL — module `./SessionsPanel` not found.

- [ ] **Step 7: Implement the frontend**

`frontend/src/features/auth/session.ts` — change `function applySession(` to
`export function applySession(`.

`frontend/src/features/settings/SessionsPanel.tsx`:

```tsx
import { useState } from "react";

import { SignOutIcon } from "../../design/icons";
import { ApiError, api } from "../../lib/api";
import type { User } from "../../lib/types";
import { applySession } from "../auth/session";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

/**
 * Ends every session but this one: other browsers, forgotten tabs, and the
 * agent key. The backend bumps the session version and hands this tab a
 * fresh session, applied here so the reader stays signed in.
 */
export function SessionsPanel() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function revoke() {
    setError(null);
    setDone(false);
    setBusy(true);
    try {
      const session = await api.post<{ access_token: string; user: User }>(
        "/auth/sessions/revoke-others",
      );
      applySession(session);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="yd-settings__sessions">
      <p className="yd-settings__note">
        Un appareil oublié, un navigateur prêté&nbsp;: ce bouton ferme toutes les sessions sauf
        celle-ci, et retire la clé d'accès de l'agent. Une nouvelle clé s'affiche à votre prochaine
        visite de Réglages.
      </p>
      {error !== null ? <p role="alert" className="yd-account__error">{error}</p> : null}
      {done ? (
        <p role="status" className="yd-account__saved">Les autres appareils sont déconnectés.</p>
      ) : null}
      <button type="button" className="yd-settings__logout" onClick={revoke} disabled={busy}>
        <SignOutIcon />
        {busy ? "Déconnexion…" : "Déconnecter les autres appareils"}
      </button>
    </div>
  );
}
```

`frontend/src/features/settings/SettingsPage.tsx` — import `SessionsPanel` and
render `<SessionsPanel />` inside the « Fin de session » cell, after the
« Se déconnecter » button.

`frontend/src/features/settings/PasswordForm.tsx`:

- import `User` from `../../lib/types` and `applySession` from `../auth/session`;
- replace the `await api.post("/auth/password", …)` line with:

```tsx
      const session = await api.post<{ access_token: string; user: User }>("/auth/password", {
        current_password: current,
        new_password: next,
      });
      // The backend ended every other session and handed this tab a new one.
      applySession(session);
```

- replace the note paragraph's text with:

```tsx
        Au moins {MIN_LENGTH} caractères. Changer de mot de passe déconnecte vos autres appareils
        et retire la clé d'accès de l'agent&nbsp;; cet onglet reste connecté.
```

`frontend/src/dev/mockApi.ts` — make `"POST /api/auth/password"` answer 200
with `{ access_token: "apercu", token_type: "bearer", user: MUTABLE_USER }`
on success, and add:

```ts
  "POST /api/auth/sessions/revoke-others": () =>
    new Response(JSON.stringify({ access_token: "apercu", token_type: "bearer", user: MUTABLE_USER }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
```

- [ ] **Step 8: Run the frontend tests**

Run: `cd frontend && npx vitest run src/features/settings src/features/auth`
Expected: PASS. If `AccountForms.test.tsx` asserts on the old note text or
on a 204 password answer, update those assertions to the new text and a 200
session answer.

- [ ] **Step 9: Commit**

```bash
git add backend frontend
git commit -m "fix(security): a new password ends every other session and the agent key"
```

---

### Task S4: Security headers on every response

**Files:**
- Create: `backend/app/security/headers.py`
- Create: `backend/tests/test_security_headers.py`
- Modify: `backend/app/main.py` (register the middleware)

**Interfaces:**
- Produces: `SecurityHeadersMiddleware` (pure ASGI), `headers_for(path: str) -> dict[str, str]`, `INTERFACE_POLICY: str`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_security_headers.py`:

```python
"""Headers every response carries, and the policy the interface runs under."""

from app import main
from app.security.headers import INTERFACE_POLICY, headers_for


def test_an_api_answer_carries_the_base_headers_and_no_policy(client):
    response = client.get("/api/health")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "same-origin"
    assert response.headers["Permissions-Policy"] == "camera=(), microphone=(), geolocation=()"
    assert "Content-Security-Policy" not in response.headers


def test_an_api_error_carries_them_too(client):
    response = client.get("/api/nulle-part")
    assert response.status_code == 404
    assert response.headers["X-Content-Type-Options"] == "nosniff"


def test_the_interface_runs_under_the_policy(client, tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<!doctype html><title>Yieldo</title>")
    monkeypatch.setattr(main, "STATIC_DIR", tmp_path)

    response = client.get("/transactions")

    assert response.status_code == 200
    assert response.headers["Content-Security-Policy"] == INTERFACE_POLICY
    assert "frame-ancestors 'none'" in INTERFACE_POLICY
    assert "script-src 'self'" in INTERFACE_POLICY


def test_the_policy_is_decided_by_the_path():
    assert "Content-Security-Policy" not in headers_for("/api/transactions")
    assert "Content-Security-Policy" not in headers_for("/api")
    assert headers_for("/")["Content-Security-Policy"] == INTERFACE_POLICY
    assert headers_for("/apiculture")["Content-Security-Policy"] == INTERFACE_POLICY
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && ./.venv/Scripts/pytest.exe tests/test_security_headers.py -q`
Expected: FAIL — `ModuleNotFoundError: app.security.headers`.

- [ ] **Step 3: Implement**

`backend/app/security/headers.py`:

```python
"""Headers every response carries, and the policy the interface runs under.

Pure ASGI rather than Starlette's `BaseHTTPMiddleware`, which buffers
streaming responses and changes how exceptions propagate; this only adds
headers to the response-start message and touches nothing else.

The Content-Security-Policy goes on the INTERFACE only -- everything outside
`/api`, which `main.serve_spa` answers. The JSON routes have no document to
protect, and `/api/docs` loads Swagger from a CDN that the policy would block.

What the policy allows, and why each exception exists:

* `style-src 'unsafe-inline'` -- ECharts and the motion library set element
  styles at run time; a nonce cannot follow them there;
* `img-src data: blob:` and `worker-src blob:` -- chart exports and canvases;
* `font-src data:` -- a bundled font inlined by the build.

Everything else is `'self'`: no script, style, frame or connection to any
other origin.
"""

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

BASE_HEADERS: dict[str, str] = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}

INTERFACE_POLICY = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])


def headers_for(path: str) -> dict[str, str]:
    headers = dict(BASE_HEADERS)
    if not (path == "/api" or path.startswith("/api/")):
        headers["Content-Security-Policy"] = INTERFACE_POLICY
    return headers


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        extra = headers_for(scope["path"])

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in extra.items():
                    headers.setdefault(name, value)
            await send(message)

        await self.app(scope, receive, send_with_headers)
```

`backend/app/main.py` — add `from app.security.headers import SecurityHeadersMiddleware`
and, right after the `CORSMiddleware` registration:

```python
app.add_middleware(SecurityHeadersMiddleware)
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && ./.venv/Scripts/pytest.exe tests/test_security_headers.py tests/test_spa_serving.py -q`
(if `test_spa_serving.py` does not exist, run `./.venv/Scripts/pytest.exe -q -k spa`)
Expected: PASS.

- [ ] **Step 5: Verify the policy in the browser**

1. `cd frontend && npm run build`
2. Add to `.claude/launch.json` a configuration `yieldo-built` identical to
   `yieldo-backend` but on port 8001 with `"env": {"YIELDO_STATIC_DIR": "../frontend/dist"}`
   (if the preview tool ignores `env`, start it from Bash in the background with
   `YIELDO_STATIC_DIR=../frontend/dist ./.venv/Scripts/uvicorn.exe app.main:app --port 8001`
   from `backend/`).
3. Open `http://localhost:8001/` (landing, three.js hero), `/connexion`, then
   sign in with the demo account of the dev database and open Vue d'ensemble,
   Analyse, Dettes, Projection, Patrimoine, Assistant.
4. `read_console_messages` with pattern `Content Security Policy`: expected
   none. Fix the policy (never by adding `'unsafe-eval'` or a wildcard) if a
   screen reports one, and add the case to the module docstring.

- [ ] **Step 6: Commit**

```bash
git add backend/app/security/headers.py backend/app/main.py backend/tests/test_security_headers.py .claude/launch.json
git commit -m "fix(security): every answer carries nosniff and no-frame, the interface a content policy"
```

---

### Task S5: The email changes only with the current password

**Files:**
- Modify: `backend/app/schemas/auth.py` (`ProfileIn.current_password`)
- Modify: `backend/app/api/auth.py` (`update_profile`)
- Modify: `backend/tests/test_auth_api.py`
- Modify: `frontend/src/features/settings/ProfileForm.tsx`
- Modify: `frontend/src/features/settings/AccountForms.test.tsx`
- Modify: `frontend/src/dev/mockApi.ts` (`PATCH /api/auth/me`)

- [ ] **Step 1: Write the failing backend tests** (append to `test_auth_api.py`)

```python
def test_an_email_change_needs_the_current_password(client):
    headers = _registered(client)

    response = client.patch("/api/auth/me", json={"email": "nouveau@example.com"},
                            headers=headers)

    assert response.status_code == 422
    assert response.json()["detail"] == (
        "Confirmez votre mot de passe actuel pour changer d'email")


def test_an_email_change_refuses_a_wrong_password(client):
    headers = _registered(client)

    response = client.patch("/api/auth/me", json={
        "email": "nouveau@example.com", "current_password": "paslebon"}, headers=headers)

    assert response.status_code == 403
    assert response.json()["detail"] == "Le mot de passe actuel est incorrect"


def test_an_email_change_with_the_password_goes_through(client):
    headers = _registered(client)

    response = client.patch("/api/auth/me", json={
        "email": "Nouveau@Example.com", "current_password": "motdepasse123"}, headers=headers)

    assert response.status_code == 200
    assert response.json()["email"] == "nouveau@example.com"


def test_a_name_change_needs_no_password(client):
    headers = _registered(client)

    response = client.patch("/api/auth/me", json={"name": "Maxime"}, headers=headers)

    assert response.status_code == 200
    assert response.json()["name"] == "Maxime"


def test_resending_the_same_email_needs_no_password(client):
    headers = _registered(client)

    response = client.patch("/api/auth/me", json={"email": "max@example.com"}, headers=headers)

    assert response.status_code == 200
```

Then update every pre-existing test in `test_auth_api.py` that PATCHes a NEW
email (search `"email":` inside `client.patch("/api/auth/me"`) to also send
`"current_password": "motdepasse123"`.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && ./.venv/Scripts/pytest.exe tests/test_auth_api.py -q -k email`
Expected: FAIL — the change goes through without a password.

- [ ] **Step 3: Implement**

`backend/app/schemas/auth.py` — add to `ProfileIn`:

```python
    # Required only when `email` changes: the address is the login key, and a
    # session left open must not be enough to move the account elsewhere.
    current_password: str | None = None
```

`backend/app/api/auth.py` — in `update_profile`, replace the email branch with:

```python
    if payload.email is not None:
        email = payload.email.strip().lower()
        if email != user.email:
            if not payload.current_password:
                raise HTTPException(
                    status_code=422,
                    detail="Confirmez votre mot de passe actuel pour changer d'email",
                )
            if not verify_password(payload.current_password, user.password_hash):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                    detail="Le mot de passe actuel est incorrect")
            taken = (
                db.query(User)
                .filter(User.email == email, User.id != user.id)
                .first()
            )
            if taken is not None:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                    detail="Un compte avec cet email existe déjà")
            user.email = email
```

- [ ] **Step 4: Run the backend tests**

Run: `cd backend && ./.venv/Scripts/pytest.exe tests/test_auth_api.py tests/test_agent_key_api.py -q`
Expected: PASS.

- [ ] **Step 5: Write the failing frontend test** (append to `AccountForms.test.tsx`, reusing its `USER`, `jsonResponse` and render helpers)

```tsx
  it("asks for the current password only when the email changes, and sends it", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse({ ...USER, email: "nouveau@example.com" }));
    renderProfile();

    expect(screen.queryByLabelText("Mot de passe actuel")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Adresse email"));
    await user.type(screen.getByLabelText("Adresse email"), "nouveau@example.com");
    await user.type(screen.getByLabelText("Mot de passe actuel"), "motdepasse123");
    await user.click(screen.getByRole("button", { name: "Enregistrer le profil" }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ email: "nouveau@example.com", current_password: "motdepasse123" });
  });
```

Use the file's existing profile-render helper in place of `renderProfile()` if
it is named differently.

- [ ] **Step 6: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/features/settings/AccountForms.test.tsx`
Expected: FAIL — no « Mot de passe actuel » field.

- [ ] **Step 7: Implement `ProfileForm.tsx`**

- add `const [password, setPassword] = useState("");`
- add `const emailChanged = email.trim().toLowerCase() !== (user?.email ?? "");`
- in `handleSubmit`, type the patch as
  `const patch: { name?: string; email?: string; current_password?: string } = {};`
  and after the email line add
  `if (emailChanged) patch.current_password = password;`
- after a successful save add `setPassword("");`
- render, right after the email field:

```tsx
      {emailChanged ? (
        <label className="yd-account__field">
          <span>Mot de passe actuel</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            required
            onChange={(event) => {
              setPassword(event.target.value);
              setSaved(false);
            }}
          />
        </label>
      ) : null}
```

- the submit button is disabled when `saving || !dirty || (emailChanged && password === "")`.
- note text becomes: « L'adresse email est aussi votre identifiant de
  connexion&nbsp;: la changer demande votre mot de passe actuel, et c'est la
  nouvelle qu'il faudra saisir pour vous reconnecter. »

`mockApi.ts` — in `"PATCH /api/auth/me"`, before applying an email, answer 403
`{ detail: "Le mot de passe actuel est incorrect" }` when
`typeof body.email === "string" && body.email !== MUTABLE_USER.email && body.current_password !== "apercu"`.

- [ ] **Step 8: Run the frontend tests**

Run: `cd frontend && npx vitest run src/features/settings`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend frontend
git commit -m "fix(security): moving the login email asks for the current password"
```

---

### Task S6: A goal never reads another household's account

**Files:**
- Modify: `backend/app/api/goals.py` (`_balance_cents`, `patch_goal`)
- Modify: `backend/tests/test_goals_api.py`

- [ ] **Step 1: Write the failing test** (append to `test_goals_api.py`)

```python
def test_a_goal_never_names_another_households_account(client, db):
    owner = _register(client, "proprietaire@example.fr")
    account = client.post("/api/accounts", headers=owner, json={
        "name": "Livret secret de Léa", "kind": "savings"}).json()
    intruder = _register(client, "intrus@example.fr")
    goal = _create(client, intruder).json()

    response = client.patch(f"/api/goals/{goal['id']}", headers=intruder, json={
        "saved_cents": 100, "account_id": account["id"]})

    assert response.status_code == 404
    assert response.json()["detail"] == "Compte introuvable"
    assert "Léa" not in response.text
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && ./.venv/Scripts/pytest.exe tests/test_goals_api.py -q -k another_households`
Expected: FAIL — 422 whose detail contains « Livret secret de Léa ».

- [ ] **Step 3: Implement**

In `patch_goal`, move the ownership check BEFORE the `saved_cents` refusal and
read the account's name through a user-filtered query:

```python
    backed_after = changes.get("account_id", goal.account_id)
    # Ownership first: nothing below may read an account this household does
    # not own, not even its name for an error message.
    if changes.get("account_id") is not None:
        _check_account(db, user, changes["account_id"], goal.id)
    if "saved_cents" in changes and backed_after is not None:
        account = (
            db.query(Account)
            .filter(Account.user_id == user.id, Account.id == backed_after)
            .first()
        )
        name = account.name if account is not None else "ce compte"
        raise HTTPException(
            status_code=422,
            detail=(
                f"Ce montant est mesuré sur « {name} » et ne se saisit pas : détachez le "
                "compte pour déclarer un montant vous-même."
            ),
        )
```

(and delete the later `if changes.get("account_id") is not None: _check_account(...)`
block, now redundant). In `_balance_cents`, replace `db.get(Account, account_id)`
with:

```python
    account = (
        db.query(Account)
        .filter(Account.user_id == user_id, Account.id == account_id)
        .first()
    )
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && ./.venv/Scripts/pytest.exe tests/test_goals_api.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/goals.py backend/tests/test_goals_api.py
git commit -m "fix(security): a goal's error message never names another household's account"
```

---

### Task S7: The CSV export writes text, never formulas

**Files:**
- Modify: `backend/app/api/transactions.py` (`export_transactions`)
- Modify: `backend/tests/test_transactions_api.py`

- [ ] **Step 1: Write the failing test** (append to `test_transactions_api.py`)

```python
def test_export_never_writes_a_cell_a_spreadsheet_would_execute(client, imported):
    headers, account_id = imported
    created = client.post("/api/transactions", headers=headers, json={
        "account_id": account_id, "date": "2025-03-20", "amount_cents": -1_000,
        "label_raw": '=HYPERLINK("http://example.com","clic")', "notes": "@SUM(A1)",
    })
    assert created.status_code == 201

    body = client.get("/api/transactions/export.csv", headers=headers).content
    text = body.decode("utf-8-sig")

    assert "'=HYPERLINK" in text
    assert "'@SUM(A1)" in text
    # Amounts keep their sign: only text cells are neutralised.
    assert ";-10,00;" in text
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && ./.venv/Scripts/pytest.exe tests/test_transactions_api.py -q -k execute`
Expected: FAIL — the label is written as `=HYPERLINK…`.

- [ ] **Step 3: Implement**

In `backend/app/api/transactions.py`, above `export_transactions`:

```python
# A cell starting with one of these is a formula to Excel and LibreOffice, and a
# formula can reach the network (`=HYPERLINK`, `=WEBSERVICE`). The OWASP remedy:
# an apostrophe in front, which the spreadsheet shows as nothing and reads as
# "this is text".
_FORMULA_TRIGGERS = ("=", "+", "-", "@", "\t", "\r")


def _csv_safe(text: str) -> str:
    return f"'{text}" if text.startswith(_FORMULA_TRIGGERS) else text
```

and write the row as:

```python
        writer.writerow([
            row.date.isoformat(),
            _csv_safe(row.label_raw),
            f"{sign}{cents // 100},{cents % 100:02d}",
            _csv_safe(categories.get(row.category_id, "")) if row.category_id is not None else "",
            _csv_safe(accounts.get(row.account_id, "")),
            _csv_safe(row.notes or ""),
        ])
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && ./.venv/Scripts/pytest.exe tests/test_transactions_api.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/transactions.py backend/tests/test_transactions_api.py
git commit -m "fix(security): the CSV export neutralises cells a spreadsheet would execute"
```

---

### Task S8: A Secure cookie behind HTTPS, and no default secret in production

**Files:**
- Create: `backend/app/security/secret_guard.py`
- Create: `backend/tests/test_secret_guard.py`
- Modify: `backend/app/api/auth.py` (`_set_refresh_cookie`, `_issue_session` and their callers take `request`)
- Modify: `backend/app/main.py` (call the guard)
- Modify: `backend/app/config.py` (default secret from the guard's constant)
- Modify: `backend/tests/test_auth_api.py`
- Modify: `docker-compose.yml`, `README.md`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_secret_guard.py`:

```python
import logging

import pytest

from app.security.secret_guard import DEFAULT_SECRET, check_secret, secret_problem

GOOD = "0123456789abcdef" * 4


def test_a_generated_secret_passes():
    assert secret_problem(GOOD) is None


def test_the_default_and_a_short_secret_are_problems():
    assert secret_problem(DEFAULT_SECRET) is not None
    assert secret_problem("court") is not None


def test_an_instance_serving_the_interface_refuses_to_start_without_a_secret():
    with pytest.raises(RuntimeError, match="lancez ./install.sh install"):
        check_secret(DEFAULT_SECRET, serves_interface=True)


def test_a_development_server_only_warns(caplog):
    with caplog.at_level(logging.WARNING):
        check_secret(DEFAULT_SECRET, serves_interface=False)
    assert "install.sh" in caplog.text
```

Append to `backend/tests/test_auth_api.py`:

```python
def test_the_refresh_cookie_is_not_secure_over_plain_http(client):
    response = client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"})
    assert "secure" not in response.headers["set-cookie"].lower()


def test_the_refresh_cookie_is_secure_over_https(client):
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app, base_url="https://testserver") as secure_client:
        response = secure_client.post("/api/auth/register", json={
            "name": "Max", "email": "max@example.com", "password": "motdepasse123"})
    assert "secure" in response.headers["set-cookie"].lower()
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && ./.venv/Scripts/pytest.exe tests/test_secret_guard.py tests/test_auth_api.py -q -k "secret or secure"`
Expected: FAIL — module missing; the HTTPS cookie is not `Secure`.

- [ ] **Step 3: Implement**

`backend/app/security/secret_guard.py`:

```python
"""The one secret everything else is derived from, checked at startup.

`SECRET_KEY` signs every session token and derives the Fernet key every stored
credential is encrypted with. The default below is public -- it is in this
repository -- so an instance running on it has forgeable sessions and readable
broker keys. `install.sh` generates 64 hex characters once; this module makes
sure a deployed instance never runs without it.

"Deployed" is read from what the process does rather than from a flag nobody
remembers to set: an instance that serves the built interface is one people
use. A development server (Vite serves the interface) only gets a warning.
"""

import logging

logger = logging.getLogger(__name__)

DEFAULT_SECRET = "dev-insecure-key-change-me"
MIN_SECRET_LENGTH = 32

_MESSAGE = (
    "Clé secrète absente ou trop courte : lancez ./install.sh install, qui en "
    "génère une et la garde dans .env."
)


def secret_problem(secret: str) -> str | None:
    if secret == DEFAULT_SECRET or len(secret) < MIN_SECRET_LENGTH:
        return _MESSAGE
    return None


def check_secret(secret: str, *, serves_interface: bool) -> None:
    problem = secret_problem(secret)
    if problem is None:
        return
    if serves_interface:
        raise RuntimeError(problem)
    logger.warning(problem)
```

`backend/app/config.py` — `from app.security.secret_guard import DEFAULT_SECRET`
is NOT possible (import cycle via `app.security` importing config); instead
leave `secret_key: str = "dev-insecure-key-change-me"` and add the comment
`# Must equal secret_guard.DEFAULT_SECRET; test_secret_guard pins it.` plus
this test in `test_secret_guard.py`:

```python
def test_the_guard_knows_the_configured_default():
    from app.config import Settings

    assert Settings.model_fields["secret_key"].default == DEFAULT_SECRET
```

`backend/app/main.py` — after `STATIC_DIR = …`:

```python
check_secret(settings.secret_key, serves_interface=STATIC_DIR.is_dir())
```

with `from app.security.secret_guard import check_secret` in the imports.

`backend/app/api/auth.py` — `_set_refresh_cookie(response: Response, request: Request, user: User)`
sets `secure=request.url.scheme == "https"` (comment: « uvicorn rewrites the
scheme from X-Forwarded-Proto when the proxy is in FORWARDED_ALLOW_IPS »);
`_issue_session(response, request, user)` forwards it; `register`, `login`,
`refresh`, `change_password` and `revoke_other_sessions` gain a
`request: Request` parameter and pass it.

`docker-compose.yml` — under `environment:` add:

```yaml
      # Addresses of the reverse proxies whose X-Forwarded-* headers uvicorn
      # believes: the HTTPS scheme (Secure cookie) and the client address (login
      # throttle) come from them. "*" when the proxy's address is not fixed.
      FORWARDED_ALLOW_IPS: ${YIELDO_TRUSTED_PROXIES:-127.0.0.1}
```

`README.md` — add under the deployment section, in French:

```markdown
### Derrière un proxy HTTPS

Si Yieldo est servi derrière un proxy (Caddy, Traefik, Nginx) qui termine le
HTTPS, indiquez son adresse dans `.env` : `YIELDO_TRUSTED_PROXIES=172.18.0.1`
(ou `*` si elle varie). Yieldo sait alors que la connexion est chiffrée — le
cookie de session devient `Secure` — et voit l'adresse réelle des visiteurs,
dont dépend la limite de tentatives de connexion.
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && ./.venv/Scripts/pytest.exe tests/test_secret_guard.py tests/test_auth_api.py tests/test_session_revocation.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend docker-compose.yml README.md
git commit -m "fix(security): Secure cookie behind HTTPS, and no public secret in production"
```

---

### Task S9: An unreadable import setting is a 422, in French

**Files:**
- Modify: `backend/app/api/imports.py` (`analyze`)
- Modify: `backend/tests/test_import_api.py`

- [ ] **Step 1: Write the failing tests** (append to `test_import_api.py`; `FIXTURES`, `auth`, `account_id` exist in that file)

```python
UNREADABLE = "Le paramétrage de l'import est illisible : relancez l'analyse."


def _analyze_with(client, auth, account_id, **extra):
    with (FIXTURES / "boursorama.csv").open("rb") as handle:
        return client.post("/api/imports/analyze", headers=auth,
                           files={"file": ("boursorama.csv", handle, "text/csv")},
                           data={"account_id": str(account_id), **extra})


def test_analyze_refuses_a_broken_dialect_in_french(client, auth, account_id):
    response = _analyze_with(client, auth, account_id, dialect="{pas du json")
    assert response.status_code == 422
    assert response.json()["detail"] == UNREADABLE


def test_analyze_refuses_a_dialect_with_an_unknown_key(client, auth, account_id):
    response = _analyze_with(client, auth, account_id, dialect='{"inconnu": 1}')
    assert response.status_code == 422
    assert response.json()["detail"] == UNREADABLE


def test_analyze_refuses_a_mapping_that_is_not_an_object(client, auth, account_id):
    response = _analyze_with(client, auth, account_id, mapping='["date"]')
    assert response.status_code == 422
    assert response.json()["detail"] == UNREADABLE
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && ./.venv/Scripts/pytest.exe tests/test_import_api.py -q -k refuses_a`
Expected: FAIL — 500 (JSONDecodeError / TypeError).

- [ ] **Step 3: Implement**

In `backend/app/api/imports.py`, above `analyze`:

```python
_UNREADABLE_SETTINGS = "Le paramétrage de l'import est illisible : relancez l'analyse."


def _parse_dialect(raw: str | None) -> CsvDialect | None:
    """The dialect the screen sends back after the reader adjusted it."""
    if not raw:
        return None
    try:
        return CsvDialect(**json.loads(raw))
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=_UNREADABLE_SETTINGS) from exc


def _parse_mapping(raw: str | None) -> dict[int, str] | None:
    """The column roles the reader confirmed, keyed by column index."""
    if not raw:
        return None
    try:
        loaded = json.loads(raw)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=_UNREADABLE_SETTINGS) from exc
    if not isinstance(loaded, dict):
        raise HTTPException(status_code=422, detail=_UNREADABLE_SETTINGS)
    return _int_keys(loaded)
```

and in `analyze` replace the two parsing lines with:

```python
    parsed_dialect = _parse_dialect(dialect)
    parsed_mapping = _parse_mapping(mapping)
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && ./.venv/Scripts/pytest.exe tests/test_import_api.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/imports.py backend/tests/test_import_api.py
git commit -m "fix(import): an unreadable dialect or mapping is refused in French, not a 500"
```

---

### Task S10: Registration closes after the first account; the admin can reopen it

**Files:**
- Create: `backend/app/models/instance_settings.py`
- Create: `backend/alembic/versions/b4d6f8a0c2e4_instance_settings.py`
- Create: `backend/app/api/admin.py`
- Create: `backend/app/schemas/admin.py`
- Create: `backend/tests/test_registration_api.py`
- Modify: `backend/app/models/__init__.py` (export `InstanceSettings`)
- Modify: `backend/app/config.py` (`registration_open: bool = False`)
- Modify: `backend/app/security/deps.py` (`require_session_admin`)
- Modify: `backend/app/api/auth.py` (`register`, new `registration_status`)
- Modify: `backend/app/main.py` (include the admin router)
- Modify: `backend/tests/conftest.py` (registration open in tests by default)
- Modify: `backend/tests/test_migrations.py`
- Modify: `docker-compose.yml`, `install.sh`, `README.md`
- Create: `frontend/src/features/auth/registration.ts`
- Create: `frontend/src/features/auth/RegisterPage.test.tsx`
- Modify: `frontend/src/features/auth/RegisterPage.tsx`, `LoginPage.tsx`, `LoginPage.test.tsx`
- Create: `frontend/src/features/settings/InstancePanel.tsx`, `InstancePanel.test.tsx`
- Modify: `frontend/src/features/settings/SettingsPage.tsx`
- Modify: `frontend/src/lib/types.ts`, `frontend/src/dev/mockApi.ts`

**Interfaces:**
- Produces: `GET /api/auth/registration` → `{ open: bool, first_account: bool }`;
  `GET /api/admin/settings` → `{ registration_open: bool, source: "instance" | "environment" }`;
  `PATCH /api/admin/settings` with `{ registration_open: bool }`;
  `app.api.admin.registration_open(db: Session) -> bool`;
  `deps.require_session_admin`. Frontend: `useRegistrationStatus(): "loading" | "open" | "closed" | "unknown"`.

- [ ] **Step 1: Write the failing backend tests**

`backend/tests/test_registration_api.py`:

```python
"""Registration closes after the first account unless the admin opens it."""

import pytest

from app.config import settings


@pytest.fixture
def closed(monkeypatch):
    monkeypatch.setattr(settings, "registration_open", False)


def _register(client, email):
    return client.post("/api/auth/register", json={
        "name": "X", "email": email, "password": "motdepasse123"})


def _bearer(response):
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_the_first_account_is_always_possible(client, closed):
    assert _register(client, "admin@example.com").status_code == 201


def test_a_second_account_is_refused_by_default(client, closed):
    _register(client, "admin@example.com")
    response = _register(client, "autre@example.com")
    assert response.status_code == 403
    assert response.json()["detail"] == "Les inscriptions sont fermées"


def test_the_status_says_so_before_anyone_tries(client, closed):
    assert client.get("/api/auth/registration").json() == {"open": True, "first_account": True}
    _register(client, "admin@example.com")
    assert client.get("/api/auth/registration").json() == {"open": False, "first_account": False}


def test_the_admin_opens_registration(client, closed):
    admin = _bearer(_register(client, "admin@example.com"))

    response = client.patch("/api/admin/settings", headers=admin, json={"registration_open": True})

    assert response.status_code == 200
    assert response.json() == {"registration_open": True, "source": "instance"}
    assert _register(client, "autre@example.com").status_code == 201


def test_the_setting_follows_the_environment_until_the_admin_decides(client, closed):
    admin = _bearer(_register(client, "admin@example.com"))
    assert client.get("/api/admin/settings", headers=admin).json() == {
        "registration_open": False, "source": "environment"}


def test_a_member_cannot_open_registration(client, closed, monkeypatch):
    _register(client, "admin@example.com")
    monkeypatch.setattr(settings, "registration_open", True)
    member = _bearer(_register(client, "membre@example.com"))

    response = client.patch("/api/admin/settings", headers=member, json={"registration_open": True})

    assert response.status_code == 403
    assert response.json()["detail"] == "Droits administrateur requis"


def test_an_agent_key_cannot_open_registration(client, closed):
    admin = _bearer(_register(client, "admin@example.com"))
    key = client.post("/api/access-key", headers=admin).json()["token"]

    response = client.patch("/api/admin/settings",
                            headers={"Authorization": f"Bearer {key}"},
                            json={"registration_open": True})

    assert response.status_code == 401
```

(Use the real agent-key route and field names, as checked in Task S3.)

In `backend/tests/conftest.py`, add:

```python
@pytest.fixture(autouse=True)
def registration_open_for_tests(monkeypatch):
    """Most tests register several households to prove isolation. Registration
    is closed by default in production; tests about that set it back to False."""
    monkeypatch.setattr(settings, "registration_open", True)
```

Append to `backend/tests/test_migrations.py`:

```python
INSTANCE_SETTINGS_REVISION = "b4d6f8a0c2e4"


def test_the_instance_settings_table_matches_the_model_and_downgrades(migration_db):
    command.upgrade(migration_db.config, INSTANCE_SETTINGS_REVISION)
    conn = _connect(migration_db)
    columns = _table_columns(conn, "instance_settings")
    conn.close()
    reference, _ = _reference_schema("instance_settings")
    assert columns == reference

    command.downgrade(migration_db.config, SESSION_VERSION_REVISION)
    conn = _connect(migration_db)
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    conn.close()
    assert "instance_settings" not in tables
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && ./.venv/Scripts/pytest.exe tests/test_registration_api.py tests/test_migrations.py -q -k "registration or instance"`
Expected: FAIL — `/api/auth/registration` and `/api/admin/settings` are 404.

- [ ] **Step 3: Implement the backend**

`backend/app/models/instance_settings.py`:

```python
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class InstanceSettings(Base):
    """What the installation's administrator decided, one row (id 1) at most.

    `registration_open` is NULL until the administrator first chooses; NULL
    means "follow YIELDO_REGISTRATION_OPEN", so an operator who set the
    variable in .env is never overridden by a row nobody wrote.
    """

    __tablename__ = "instance_settings"

    registration_open: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
```

Export it from `backend/app/models/__init__.py` (import line and `__all__`).

`backend/alembic/versions/b4d6f8a0c2e4_instance_settings.py`:

```python
"""the installation's own settings

Revision ID: b4d6f8a0c2e4
Revises: a3c5e7f9b1d2
Create Date: 2026-09-26 00:00:01.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b4d6f8a0c2e4'
down_revision: Union[str, Sequence[str], None] = 'a3c5e7f9b1d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "instance_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("registration_open", sa.Boolean(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("instance_settings")
```

Compare the created columns with what `Base` declares for `id` (see
`backend/app/db.py`) and mirror it exactly, so the migration test's
column-for-column comparison holds.

`backend/app/config.py` — `registration_open: bool = False`, with the comment:
`# Closed by default: the first account is always possible, every later one needs`
`# the administrator (Réglages → Compte) or YIELDO_REGISTRATION_OPEN=true.`

`backend/app/security/deps.py` — add:

```python
def require_session_admin(user: User = Depends(get_session_user)) -> User:
    """The installation's administrator, proved by a session. A key never
    administers the installation, whoever it belongs to."""
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Droits administrateur requis")
    return user
```

`backend/app/schemas/admin.py`:

```python
from typing import Literal

from pydantic import BaseModel


class InstanceSettingsOut(BaseModel):
    registration_open: bool
    source: Literal["instance", "environment"]


class InstanceSettingsPatch(BaseModel):
    registration_open: bool


class RegistrationStatusOut(BaseModel):
    open: bool
    first_account: bool
```

`backend/app/api/admin.py`:

```python
"""The installation's own settings, which only its administrator changes."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import InstanceSettings, User
from app.schemas.admin import InstanceSettingsOut, InstanceSettingsPatch
from app.security.deps import require_session_admin

router = APIRouter(prefix="/admin", tags=["admin"])

_ROW_ID = 1


def registration_open(db: Session) -> bool:
    """Whether a new household may create an account (the first one always may)."""
    row = db.get(InstanceSettings, _ROW_ID)
    if row is None or row.registration_open is None:
        return settings.registration_open
    return row.registration_open


def _out(db: Session) -> InstanceSettingsOut:
    row = db.get(InstanceSettings, _ROW_ID)
    decided = row is not None and row.registration_open is not None
    return InstanceSettingsOut(
        registration_open=registration_open(db),
        source="instance" if decided else "environment",
    )


@router.get("/settings", response_model=InstanceSettingsOut)
def read_settings(
    _: User = Depends(require_session_admin), db: Session = Depends(get_db)
) -> InstanceSettingsOut:
    return _out(db)


@router.patch("/settings", response_model=InstanceSettingsOut)
def update_settings(
    payload: InstanceSettingsPatch,
    _: User = Depends(require_session_admin),
    db: Session = Depends(get_db),
) -> InstanceSettingsOut:
    row = db.get(InstanceSettings, _ROW_ID)
    if row is None:
        row = InstanceSettings(id=_ROW_ID)
        db.add(row)
    row.registration_open = payload.registration_open
    row.updated_at = datetime.now(UTC)
    db.commit()
    return _out(db)
```

`backend/app/main.py` — `from app.api import admin as admin_routes` and
`api.include_router(admin_routes.router)` after the auth router.

`backend/app/api/auth.py`:
- `from app.api.admin import registration_open` and
  `from app.schemas.admin import RegistrationStatusOut`;
- in `register`, replace `not settings.registration_open` with
  `not registration_open(db)`;
- add:

```python
@router.get("/registration", response_model=RegistrationStatusOut)
def registration_status(db: Session = Depends(get_db)) -> RegistrationStatusOut:
    """Public: the sign-in screen asks before offering « Créer un compte »."""
    first = db.query(User).count() == 0
    return RegistrationStatusOut(open=first or registration_open(db), first_account=first)
```

`docker-compose.yml` — `YIELDO_REGISTRATION_OPEN: ${YIELDO_REGISTRATION_OPEN:-false}`.
`install.sh` — in `ensure_env`, `registration=false` instead of `registration=true`.
`README.md` — replace the sentence about open registration with (French):
« Les inscriptions sont fermées dès que le premier compte existe. Pour
accueillir un autre membre du foyer, l'administrateur les ouvre dans
Réglages → Compte, le temps de la création. »

- [ ] **Step 4: Run the backend tests**

Run: `cd backend && ./.venv/Scripts/pytest.exe -q`
Expected: PASS (whole suite: the conftest fixture keeps every multi-household test working).

- [ ] **Step 5: Write the failing frontend tests**

`frontend/src/features/auth/RegisterPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RegisterPage } from "./RegisterPage";

const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function renderPage() {
  return render(<MemoryRouter><RegisterPage /></MemoryRouter>);
}

describe("RegisterPage", () => {
  it("says registration is closed instead of offering a form that will be refused", async () => {
    fetchMock.mockResolvedValue(json({ open: false, first_account: false }));
    renderPage();

    expect(await screen.findByText(
      "Les inscriptions sont fermées : demandez à l'administrateur de cette installation de les ouvrir.",
    )).toBeInTheDocument();
    expect(screen.queryByLabelText("Mot de passe")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Se connecter" })).toHaveAttribute("href", "/connexion");
  });

  it("shows the form when registration is open", async () => {
    fetchMock.mockResolvedValue(json({ open: true, first_account: true }));
    renderPage();

    expect(await screen.findByLabelText("Mot de passe")).toBeInTheDocument();
  });

  it("shows the form when the status cannot be read: the server still decides", async () => {
    fetchMock.mockRejectedValue(new TypeError("réseau"));
    renderPage();

    expect(await screen.findByLabelText("Mot de passe")).toBeInTheDocument();
  });
});
```

`frontend/src/features/auth/LoginPage.test.tsx` — replace the `beforeEach` with
one that routes the registration status, and add a test:

```tsx
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}

let registration: { open: boolean; first_account: boolean } = { open: true, first_account: false };

beforeEach(() => {
  fetchMock.mockReset();
  registration = { open: true, first_account: false };
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/api/auth/registration")) {
      return Promise.resolve(json(registration));
    }
    return fetchMock(input, init);
  });
});
```

and in the `describe`:

```tsx
  it("offers no account creation when registration is closed", async () => {
    registration = { open: false, first_account: false };
    renderPage();
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Créer un compte" })).not.toBeInTheDocument(),
    );
  });
```

`frontend/src/features/settings/InstancePanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InstancePanel } from "./InstancePanel";

const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("InstancePanel", () => {
  it("opens registration for the next household member", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ registration_open: false, source: "environment" }))
      .mockResolvedValueOnce(json({ registration_open: true, source: "instance" }));
    render(<InstancePanel />);

    const box = await screen.findByRole("checkbox", {
      name: "Autoriser la création d'autres comptes sur cette installation",
    });
    expect(box).not.toBeChecked();
    await userEvent.click(box);

    expect(await screen.findByRole("checkbox", {
      name: "Autoriser la création d'autres comptes sur cette installation",
    })).toBeChecked();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/admin/settings");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ registration_open: true });
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `cd frontend && npx vitest run src/features/auth src/features/settings/InstancePanel.test.tsx`
Expected: FAIL — no closed message, no `InstancePanel`.

- [ ] **Step 7: Implement the frontend**

`frontend/src/lib/types.ts` — add:

```ts
/** GET /auth/registration — public, asked before « Créer un compte » is offered. */
export interface RegistrationStatus {
  open: boolean;
  first_account: boolean;
}

/** GET/PATCH /admin/settings — the installation's own settings, admin only. */
export interface InstanceSettings {
  registration_open: boolean;
  /** "environment" until the administrator first decides. */
  source: "instance" | "environment";
}
```

`frontend/src/features/auth/registration.ts`:

```ts
import { useEffect, useState } from "react";

import { api } from "../../lib/api";
import type { RegistrationStatus } from "../../lib/types";

export type RegistrationState = "loading" | "open" | "closed" | "unknown";

/**
 * Whether this installation takes new accounts. "unknown" when the question
 * could not be asked: the screens then offer the form anyway, because the
 * server is the one that decides and says so in French if it refuses.
 */
export function useRegistrationStatus(): RegistrationState {
  const [state, setState] = useState<RegistrationState>("loading");
  useEffect(() => {
    let cancelled = false;
    api
      .get<RegistrationStatus>("/auth/registration")
      .then((status) => {
        if (!cancelled) setState(status.open ? "open" : "closed");
      })
      .catch(() => {
        if (!cancelled) setState("unknown");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
```

`RegisterPage.tsx` — `const registration = useRegistrationStatus();` and, inside
the card after the `<h1>`, render when `registration === "closed"`:

```tsx
            {registration === "closed" ? (
              <>
                <p className="yd-auth__notice">
                  Les inscriptions sont fermées : demandez à l'administrateur de cette installation
                  de les ouvrir.
                </p>
                <p className="yd-auth__footer">
                  Déjà un compte ? <Link to="/connexion">Se connecter</Link>
                </p>
              </>
            ) : (
              /* the existing notice, form and footer, unchanged */
            )}
```

(The notice sentence must match the test exactly, with the non-breaking space
before « : » written as `&nbsp;:` only if the test string uses one — keep the
two identical.)

`LoginPage.tsx` — `const registration = useRegistrationStatus();` and render
the « Pas encore de compte ? » footer only when `registration !== "closed"`.

`frontend/src/features/settings/InstancePanel.tsx`:

```tsx
import { useEffect, useState } from "react";

import { ApiError, api } from "../../lib/api";
import type { InstanceSettings } from "../../lib/types";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

/** Admin only: whether this installation takes new accounts. */
export function InstancePanel() {
  const [settings, setSettings] = useState<InstanceSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<InstanceSettings>("/admin/settings")
      .then((value) => {
        if (!cancelled) setSettings(value);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(open: boolean) {
    setError(null);
    setSaving(true);
    try {
      setSettings(await api.patch<InstanceSettings>("/admin/settings", { registration_open: open }));
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="yd-settings__instance">
      {settings !== null ? (
        <label className="yd-settings__check">
          <input
            type="checkbox"
            checked={settings.registration_open}
            disabled={saving}
            onChange={(event) => void toggle(event.target.checked)}
          />
          Autoriser la création d'autres comptes sur cette installation
        </label>
      ) : null}
      <p className="yd-settings__note">
        Fermé, seul le premier compte a pu être créé. Ouvrez le temps qu'un membre du foyer crée
        le sien, puis refermez&nbsp;: chaque compte a ses propres données, que les autres ne voient
        pas.
      </p>
      {error !== null ? <p role="alert" className="yd-account__error">{error}</p> : null}
    </div>
  );
}
```

`SettingsPage.tsx` — read `const role = useSession((state) => state.user?.role);`
and, when `role === "admin"`, add a half-width cell after « Mot de passe »:

```tsx
        {role === "admin" ? (
          <BentoCell as={motion.div} span={SPAN.half} className="yd-panel" {...entryProps(reduced)}>
            <PanelHead icon={AccountIcon}>Installation</PanelHead>
            <InstancePanel />
          </BentoCell>
        ) : null}
```

If `.yd-settings__check` does not exist in `SettingsPage.css`, add it: a
flex row, `gap: 8px`, `align-items: center`, `cursor: pointer`, text in
`var(--yd-text)` — tokens only, no hex.

`mockApi.ts` — add to the read table
`"/api/auth/registration": () => ({ open: true, first_account: false })` and
`"/api/admin/settings": () => instanceSettings` with a module-level
`let instanceSettings = { registration_open: false, source: "environment" };`
and to the write table:

```ts
  "PATCH /api/admin/settings": (body) => {
    instanceSettings = { registration_open: Boolean(body.registration_open), source: "instance" };
    return new Response(JSON.stringify(instanceSettings), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
```

- [ ] **Step 8: Run the frontend suite and build**

Run: `cd frontend && npm test && npm run build`
Expected: PASS, zero TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add backend frontend docker-compose.yml install.sh README.md
git commit -m "feat(security): registration closes after the first account; the admin reopens it"
```

---

### Task S11: Browser pass over the chantier

- [ ] **Step 1:** Start `yieldo-backend` and `yieldo-frontend` (preview tools),
  motion disabled (`localStorage["yieldo.motion-disabled"]="true"`).
- [ ] **Step 2:** At 1440×2500 then 390×2400, dark then light: Connexion (link
  hidden when closed), Inscription (closed message), Réglages (Installation cell
  for the admin, « Déconnecter les autres appareils », password note, email
  field asking for the password), every chart tooltip hovered once on Vue
  d'ensemble, Analyse, Dettes, Assistant.
- [ ] **Step 3:** Fix what the browser shows (each fix with its test), commit
  as `fix(security): what the browser showed of chantier S`.
- [ ] **Step 4:** Full suites: `cd backend && ./.venv/Scripts/pytest.exe -q` and
  `cd frontend && npm test && npm run build`. All green before chantier Q starts.
