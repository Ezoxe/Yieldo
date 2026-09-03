# SDD ledger — phase 3, patrimoine et marchés

Plan: docs/superpowers/plans/2026-09-01-yieldo-phase-3-patrimoine.md
Branch phase-2-analyse-decision. 16 tasks, all shipped.

Lot A `77d79b1` `a807855` `ca26623` · lot B `b5a078e` `c982962` `c2b0958`
`28db7e6` · lot C `f4eff50` `29b267d` `f0a01a9` `13856cc` `9faf8df` `a157207`
`11a7480` `f0c8381` · lot D `f7e230b` `8929384` `5386b0b` `90740d8` `dae8d25`
`5c8e101` `b5953b2`.

**Decisions worth carrying forward.**

- `Quantity` is a `Decimal` at 18 places carried as a string, in a local
  `Context(prec=100)` — never the ambient one, whose 28-digit default silently
  truncates a 33-digit product. `value_cents` rounds **once at the end**: 1 000
  lots of 0,005 units at 100 c give 500 c end-rounded and 1 000 c per-unit.
- **Positions are derived from lots, never stored as a total.** That is the
  only reason the per-lot French capital-gains computation exists at all.
- `api_keys` and `quota_windows` carry `user_id`; `instruments` and
  `price_points` deliberately do not — a ticker's identity and its closing
  price are facts about the world. The first version shipped all four global,
  which would have let one user spend another's quota.
- **A missing price and a stale price are different answers.** Missing is
  `None`, excluded from the total, with its cause named; stale is a real figure
  with `is_stale` and its `fetched_at`, counted, with its age shown. The total
  is bundled with `positions_missing_price` so it cannot be rendered without
  the completeness count beside it. Weights are ratios over what could be
  valued.
- Five French causes, five remedies: aucune clé, clé refusée, quota épuisé,
  service injoignable, symbole inconnu. Pre-emption at 80 % is proven by
  refusing at 48/60, which a 100 %-ceiling implementation could not pass.
- Monte Carlo's seed is a required input and part of the output. The lower
  percentile is never clamped — phase 2A shipped a band anchored at zero that
  erased the overdraft risk it existed to show.
- Every tax rate carries its CGI article. FIRE on a negative capacity returns
  no answer, not a large one.

**Defects found only in the browser**, with the suite green: a six-column table
that scrolled correctly while showing no figure below 1200 px; `text-transform`
making `innerText` report painted text; a 300 px stretched empty cell.

`seed_fixture.py` used to build a schema Alembic could not migrate; `app.db.
create_schema` now stamps the head (`a157207`).
