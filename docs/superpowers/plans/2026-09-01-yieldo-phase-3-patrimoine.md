# Yieldo Phase 3 — Patrimoine et marchés : Implementation Plan

Design §12 phase 3: investment accounts and positions, the five market
integrations behind a persistent quota pool, valuation, allocation and
rebalancing, Monte Carlo, FIRE, retirement, French tax, stress tests.

*Critère de réussite : patrimoine complet valorisé et projeté.*

## Global constraints

Inherited whole from phases 2B and 2C, non-negotiable:

- Integer cents on every monetary field, at every layer. `Decimal` interior
  only, through `engines/amortization.cents`. Rates as integer basis points.
- **Quantities are not money.** A position holds a fractional number of units,
  which is a `Decimal` stored as a string, never a float and never cents.
- Pure engines: no session, no network, no implicit clock — `today` is a
  parameter. Everything touching HTTP lives in `app/market/`, never `engines/`.
- Every query on a business table filters `user_id` via `get_current_user`.
- No silent failures, no bare `except`, no fallback value standing in for real
  data. **A stale price is not a fallback — it is a different answer**, and it
  travels with the timestamp that makes it honest.
- French user-facing text; English code, identifiers, comments and commits.
- TDD, one commit per task, Conventional Commits.
- UI tasks are not done until opened in a browser at 375, 768 and 1440 px, in
  both themes, against the seeded fixture, with screenshots attached.

### The rule that governs every network call here

**The whole application works with no key at all.** Only live market functions
become unavailable, and every screen says which figure is missing and why —
never a zero, never a blank, never a silently stale number presented as fresh.

Keys are entered by the operator in Réglages → Connexions after installation.
**No key ships with the code, and no key is ever logged, echoed back in an API
response, or written to a report.** They are encrypted at rest with the
application secret.

### The defect classes this project keeps paying for

1. **A French sentence naming the wrong cause** — fixed in sixteen tasks.
   "Quota épuisé", "clé absente", "clé refusée", "service injoignable" and
   "symbole inconnu" are five different causes with five different remedies.
2. **An invariant that holds by construction proves nothing.**
3. **A test that passes for the wrong reason.** A fixture of identical values
   cannot tell a median from a mean; a portfolio of one position cannot tell a
   weighted return from an arithmetic one.
4. **`None` is never a fallback.**
5. **A screen only tested on a healthy fixture.** The operator's ledger has a
   negative savings capacity and a −2 209,63 € balance; the portfolio screen
   must read correctly with zero positions, which is what he has today.

## Scope

Sixteen tasks in five lots. **No key is required to run or test anything**:
every market call is exercised against a recorded fixture, and the live path is
proven by one opt-in test per provider that skips without a key.

## Task order

### Lot A — the substrate

- **Task 1: Quantities** — `engines/quantity.py`.
  `Quantity` — a `Decimal` at a fixed scale, parsed from and rendered to a
  string, never a float. Arithmetic a share count and a crypto amount both
  survive: 0,000000015 BTC and 12 actions are the same type.
  `value_cents(quantity, price_cents)` rounds once, `ROUND_HALF_UP`, at the end
  — never per-unit, which is how a large holding drifts by euros.

- **Task 2: The phase's schema** — `instruments`, `investment_accounts`,
  `positions`, `lots`, `price_points`, `api_keys`, `quota_windows`. One
  migration.
  A `lot` is an acquisition: quantity, unit cost in cents, date. **Positions
  are derived from lots, never stored as a total** — that is what makes the
  French tax computation in lot D possible at all.
  `api_keys.value` is encrypted at rest with the application secret; the column
  never leaves the server.
  Verified through `tests/test_migrations.py`'s `migration_db` harness, up and
  down. `*Patch` schemas use `schemas/patching.not_nullable`.

### Lot B — market data, offline first

- **Task 3: The quota pool** — `market/quota.py`, pure.
  Counters per service and per window, **pre-emptive limiting at 80 % of the
  published quota**, and the reset date. The windows differ per service:
  60/minute (Finnhub), 25/day (Alpha Vantage), 1 500/month (ExchangeRate-API),
  ~30/minute (CoinGecko), unlimited (Frankfurter). Refusing a call because the
  pool is spent is an answer with its own French sentence, not an error.

- **Task 4: The cache and the client contract** — `market/cache.py`,
  `market/client.py`.
  Time-to-live by data type: a quote is minutes, a daily close is a day, an FX
  rate is hours, an instrument's identity is permanent. **A cached value
  returned past its TTL is explicitly labelled stale, with the timestamp it was
  fetched at**; the caller decides what to do, the cache never pretends.
  `client.py` defines the provider interface, the five French failure causes,
  and the retry policy. No provider implementation yet.

- **Task 5: The five providers** — `market/providers/`.
  Finnhub, Alpha Vantage, CoinGecko, Frankfurter, ExchangeRate-API. Each maps
  its own error shapes onto the five French causes. Every one tested against
  recorded responses; one opt-in live test per provider, skipped without a key.

- **Task 6: `/api/connections`** — key entry, validation, quota state.
  Storing a key validates it with one real call and says plainly whether it
  worked. Reading never returns a key — only whether one is set, when it was
  last used, and the quota window's state. Deleting removes it.

### Lot C — the portfolio

- **Task 7: Valuation** — `engines/portfolio.py`.
  Positions from lots, market value, unrealised gain, weight per instrument,
  per asset class, per currency. **A position whose price could not be fetched
  is valued at `None`, never at cost and never at zero** — and the portfolio
  total states how many positions are missing a price rather than quietly
  summing the rest as though it were complete.

- **Task 8: Allocation and rebalancing** — `engines/allocation.py`.
  Target allocation per asset class, current drift, and the trades that would
  close it. Trades are whole units where the instrument is not fractionable.
  Refuses rather than proposing a trade it cannot size.

- **Task 9: `/api/portfolio`** — accounts, positions, lots, valuation.
  CRUD on accounts, positions and lots; valuation assembled through the
  quota-aware client, degrading per position to "prix indisponible" with the
  cause named.

- **Task 10: `/patrimoine`** — the screen.
  Holdings, allocation, drift, and what is missing a price. Reads correctly
  with **zero positions**, which is the operator's state today.

### Lot D — projection

- **Task 11: Monte Carlo** — `engines/montecarlo.py`.
  Trajectories from a seeded generator so a run is reproducible; percentile
  bands, never a single number. The seed is part of the output.

- **Task 12: French tax** — `engines/tax_fr.py`.
  PFU 30 % (12,8 % impôt sur le revenu + 17,2 % prélèvements sociaux), the
  barème option, PEA holding-period rules, assurance-vie's eight-year
  abatement, per-lot capital gains. Every rate is a documented constant with
  its legal source, never a tuned number, and every result names the regime it
  applied.

- **Task 13: FIRE and retirement** — `engines/fire.py`.
  Target capital from a withdrawal rate, years to independence from the
  measured savings capacity, and a retirement projection net of tax. The
  withdrawal rate is an assumption displayed beside every figure it produced.

- **Task 14: Stress tests** — `engines/stress.py`.
  Named historical shocks applied to the current allocation: 2008, 2020, 2022.
  Each carries its period and its source; none is a forecast, and the screen
  says so.

- **Task 15: `/api/projection`** and **Task 16: `/projection`** — the API and
  the screen for Monte Carlo, FIRE, tax and stress tests. Fan chart via ECharts
  with `stackStrategy: "all"`, the key in HTML above the canvas, never
  `legend`. Every assumption printed beside the result it produced (design §10).
