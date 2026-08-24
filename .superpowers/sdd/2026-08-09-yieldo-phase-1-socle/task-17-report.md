# Task 17 report — Client API typé, session, écrans de connexion

**Commit:** `39e1594b3b6239fdb7cfd5def4f89d39cfbe82ba` — `feat(frontend): add typed API client, session store, and auth screens`
(single commit, `frontend/` staged only; `docs/superpowers/plans/` untouched)

## What was implemented

- `frontend/src/lib/api.ts` — `ApiError`, `setAccessToken`, `onUnauthorized`, and
  `api.get/post/patch/delete/upload`, copied verbatim from the brief's Step 3.
  Bearer token attached when set, query params serialized with empty/undefined
  values dropped, French `detail` extracted from the backend body (string or
  the FastAPI validation-error list shape), one silent refresh-and-retry on a
  401 (skipped for `/auth/*` paths and on the retry itself), 204 handled as
  `undefined`.
- `frontend/src/lib/types.ts` — mirror interfaces for `User`, `Account`,
  `Category`, `Transaction`, `TransactionPage`, `CsvDialect`, `PreviewRow`,
  `ImportPreview`, `ImportBatch`, `ColumnProfile`, `SeriesBucket`,
  `CategoryBreakdown`, `PeriodTotals`, `Comparison`, `Summary`,
  `CalendarPoint`, plus `COLUMN_ROLES`/`ColumnRole`/`ROLE_LABELS` exactly as
  given in the brief. Field names and `_cents` suffixes match the backend
  Pydantic schemas (`backend/app/schemas/*.py`) verbatim — no implicit
  conversion.
- `frontend/src/features/auth/session.ts` — Zustand store: `user`,
  `accessToken`, `status` (`idle|loading|authenticated|anonymous`), and (see
  Deviations) `isAuthenticated`. Actions `login`, `register`, `logout`,
  `hydrate`. Every action that gets a token calls `setAccessToken` before
  updating state; `onUnauthorized` is registered once at module load and
  resets the store when the API client's own retry-then-give-up path fires.
  `logout()` swallows a failed `POST /auth/logout` (refresh cookie may already
  be gone) but always clears local state in a `finally`.
- `frontend/src/features/auth/LoginPage.tsx`, `RegisterPage.tsx` — centered
  `<GlassCard tone="raised">`, `fadeInUp` entrance via `motion.div` with
  `initial={reducedMotion ? false : "hidden"}` (skips the animation without a
  second code path), labeled fields (`htmlFor`/`id`), errors in `role="alert"`
  sourced from `ApiError.detail` (generic French fallback otherwise), submit
  button toggles text and `disabled` while in flight. RegisterPage adds
  `Nom` and a confirm-password field (client-side match check before hitting
  the API), a strength indicator (decorative bars `aria-hidden`, a real text
  label), and a static banner about the first account becoming administrator.
- `frontend/src/features/auth/RequireAuth.tsx` — shows a `role="status"`
  loading screen for `status === "idle" | "loading"`, redirects to
  `/connexion` only once `status === "anonymous"`, otherwise renders
  `<Outlet />`.
- `frontend/src/app/routes.tsx` — `createBrowserRouter`: public
  `/connexion`, `/inscription`; everything else behind `RequireAuth` →
  `AppShellRoute` (reads `user.name` from the store for `AppShell`'s required
  `userName` prop) → `/`, `/transactions`, `/categories`, `/import`,
  `/reglages`.
- `frontend/src/main.tsx` — now mounts `QueryClientProvider` →
  `ThemeProvider` → `RouterProvider`, and calls
  `void useSession.getState().hydrate()` before `createRoot(...).render(...)`.

## Test commands and output

Before writing any source (only the two test files existed):

```
$ cd frontend && npm test
...
 ❯ src/lib/api.test.ts (0 test)
 ❯ src/features/auth/LoginPage.test.tsx (0 test)
   Error: Failed to resolve import "./api" from "src/lib/api.test.ts"...
   Error: Failed to resolve import "./LoginPage" from "src/features/auth/LoginPage.test.tsx"...
 Test Files  2 failed | 5 passed (7)
      Tests  50 passed (50)
```
Confirmed failing as expected (missing modules) before implementation began.

After implementation:

```
$ cd frontend && npm test
 ✓ src/design/contrast.test.ts (21 tests)
 ✓ src/lib/api.test.ts (7 tests)
 ✓ src/design/theme.test.ts (11 tests)
 ✓ src/design/glass/GlassCard.test.tsx (6 tests)
 ✓ src/design/CountUp.test.tsx (2 tests)
 ✓ src/app/AppShell.test.tsx (10 tests)
 ✓ src/features/auth/LoginPage.test.tsx (3 tests)
 Test Files  7 passed (7)
      Tests  60 passed (60)
```

```
$ cd frontend && npm run build
> tsc -b && vite build
✓ 447 modules transformed.
✓ built in 1.80s
```

Both commands exit 0. Baseline before this task was 50 tests / 5 files, now 60
tests / 7 files (the brief's own "Expected: 30 tests PASS" in Step 8 predates
tasks 15–16 and does not reflect the actual suite size — the correct baseline
was given in this task's context as 50, confirmed by running it before
touching anything).

`npm run lint` was attempted but this checkout has no `eslint` installed
(`'eslint' n'est pas reconnu...`) — pre-existing, unrelated to this task, not
introduced or fixed here.

## Manual end-to-end verification (real backend, real browser)

Beyond the two required test files, I ran the full stack live (temporary
`uvicorn` on `:8000` against a scratch SQLite DB, `vite` dev server on
`:5173` proxying `/api`) and drove the actual UI via a real browser to
specifically exercise the reload/hydration path, which none of the required
unit tests cover:

1. Unauthenticated `/` → redirected to `/connexion`. ✓
2. Filled and submitted `/inscription` → `POST /api/auth/register` → `201` →
   navigated to `/` → `AppShell` rendered with the just-created user's name
   in the header. ✓
3. **Full browser reload** while authenticated → `POST /api/auth/refresh` →
   `200` → still on `/` with the session intact, no bounce to `/connexion`.
   This is the exact hazard called out in the brief's careful point 1. ✓
4. `/reglages` → "Se déconnecter" → `POST /api/auth/logout` → `204` →
   redirected to `/connexion`; a subsequent reload stayed on `/connexion`
   (refresh cookie cleared server-side, confirmed by `refresh` now returning
   `401`). ✓
5. Login with the wrong password → banner reading exactly `Identifiants
   invalides` (verbatim backend text, no UI paraphrasing). ✓
6. Login with the correct password → back on `/`. ✓

All temporary infrastructure from this verification was torn down: the
`uvicorn` process and Vite preview server were stopped, the scratch SQLite
file was deleted, and the throwaway `.claude/launch.json` used to drive the
Browser pane was removed before committing (it was never staged).

## How `hydrate` interacts with routing on a page reload

The access token lives in module-scope memory inside `api.ts`
(`setAccessToken`/the `accessToken` closure variable) — never `localStorage`
— so it is gone the instant the page reloads. `main.tsx` calls
`useSession.getState().hydrate()` (fire-and-forget, `void`-ed) *before*
`createRoot(...).render(...)`, which sets the store's `status` to `"loading"`
synchronously. `RequireAuth` treats both `"idle"` (the brief instant before
that call has even started, e.g. if a future change reorders things) and
`"loading"` identically: it renders a `role="status"` skeleton and does not
redirect. Only once `hydrate()` resolves — either `POST /api/auth/refresh`
succeeds (cookie valid → `status: "authenticated"`) or fails (`status:
"anonymous"`) — does `RequireAuth` make its one and only routing decision.
This ordering (call hydrate before render, and never redirect on anything
but a settled `"anonymous"`) is what prevents the reload-bounces-an-
authenticated-user bug described in the brief; it was verified live in
section "Manual end-to-end verification" step 3 above, not just by
inspection.

## Deviations from the brief, and why

1. **Added `isAuthenticated: boolean` to the session store.** The brief's own
   "Interfaces" section for this task lists `useSession()` →
   `{ user, accessToken, isAuthenticated, login, register, logout, hydrate }`,
   but Step 5's prose describes a `status` state machine instead and never
   mentions `isAuthenticated`. `RequireAuth`'s required behavior (skeleton
   during `"loading"`, no premature redirect) genuinely needs the 4-state
   machine, so I kept `status` as the source of truth and added
   `isAuthenticated` (`status === "authenticated"`) as a derived convenience
   field so both parts of the brief are satisfied and any later task that
   reads `isAuthenticated` directly (per the Interfaces line) will find it.
2. **`/reglages` is not a bare placeholder.** The plan document's execution
   notes (not part of this task's own Files/Steps, but visible in the same
   plan file around "Écran Réglages en phase 1") state the `/reglages` route
   "existe dès la tâche 17" and should eventually carry theme/density/
   animation toggles, logout, and an admin registration switch. No task in
   15–23 lists a dedicated `SettingsPage.tsx` file, so building the full
   screen here would be scope creep beyond this task's own Files list.
   However, with `RequireAuth` guarding every route and no other exposed way
   to sign out, an authenticated user would otherwise have no in-app path
   back to `/connexion`. I added the one item from that note that was both
   cheap and load-bearing for usability: a working "Se déconnecter" button
   inside the `/reglages` placeholder (calls `session.logout()`, then
   navigates to `/connexion`). Density, animation toggle, and the admin
   registration switch are left for whichever later task explicitly owns
   `SettingsPage.tsx` — they need real design work and, for the admin
   toggle, a backend endpoint that doesn't currently exist.
3. **Placeholder route elements live inline in `routes.tsx`**, not as
   separate page files, since Task 17's Files list only creates `routes.tsx`
   itself — `OverviewPage.tsx` (task 20), `TransactionsPage.tsx` (task 19),
   and `ImportPage.tsx` (task 18) are each explicitly owned by a later task's
   own Files list. These placeholders will be swapped for real imports when
   those tasks land; nothing here should conflict with their file paths.
4. **Created a throwaway `.claude/launch.json`** to drive the Browser pane
   for the manual verification above (`npm --prefix frontend run dev` on
   port 5173). Deleted before committing — never staged, not part of the
   deliverable. Left unmentioned here only for completeness; a future task
   wanting a `run`-skill dev-server config would need to recreate it.

No deviation touches `tokens.css`; `src/design/contrast.test.ts` is
unaffected and still green (21/21).

## Notes for later tasks

- `router` (`frontend/src/app/routes.tsx`) currently renders inline
  placeholder components for `/`, `/transactions`, `/categories`, `/import`,
  and `/reglages`. Tasks 18–20 should replace the corresponding placeholder's
  `element` with the real page component's import — the route tree/guard
  structure (`RequireAuth` → `AppShellRoute` → children) should not need to
  change.
- `AppShellRoute` (private, defined in `routes.tsx`) is the only place that
  reads `useSession` to satisfy `AppShell`'s required `userName` prop
  (`user?.name ?? ""`). If a future task moves `AppShell` invocation
  elsewhere, keep sourcing `userName` from the session store rather than
  threading it through route params.
- `api.ts`'s automatic-refresh behavior only special-cases paths starting
  with `/auth/` (skips the retry-on-401 to avoid recursion). Any future
  endpoint under a different prefix will get the retry-then-give-up behavior
  by default, which is almost certainly what's wanted — no action needed
  unless a new "never retry" case shows up.
- The real `/reglages` screen (theme/density/animation toggles, admin
  registration switch) is still unbuilt beyond the logout button described
  above in Deviation #2 — flagging this explicitly since I could not find it
  owned by any task in 15–23 of the current plan.
- `frontend/src/lib/types.ts`'s `ImportPreview.summary` and
  `ColumnProfile.dialect` are typed as `Record<string, unknown>` because the
  backend schemas (`PreviewOut.summary: dict`, `ProfileOut.dialect: dict`)
  don't declare a narrower shape either — task 18 will likely want to narrow
  these once it knows the actual keys it consumes.

---

# Fix round 1 of 5

**Commit:** `5b012755964e48a260ed16e710d641b1bfdd9708` — `fix(frontend): sync
silent refresh to session store and build Reglages` (single commit,
`frontend/` staged only)

Addressed all three items from the review: the two Important findings, and
the missing-scope Réglages screen the plan's "Notes d'exécution" assigns to
this task by name (correction already applied to the plan doc by the
coordinator; not touched here).

## Important 1 — `refreshSession` desynchronised the store

**Root cause confirmed as described.** `frontend/src/lib/api.ts`'s
`refreshSession()` wrote `accessToken = body.access_token` directly (a
module-scope variable local to `api.ts`) and never touched
`useSession`. `api.ts` cannot import `session.ts` (session.ts already imports
`api.ts` — that would be circular, and it would also be a layering
violation: `lib/` sits below `features/`).

**Fix:**
- `refreshSession()` now calls `setAccessToken(body.access_token)` — the same
  setter every other code path uses — instead of assigning the private
  variable directly.
- Added `onTokenRefreshed(handler)` to `api.ts` (same pattern as the
  existing `onUnauthorized`): a registration hook, called with the parsed
  `{ access_token, user }` body right after `setAccessToken`.
- `session.ts` was refactored so `applySession()` (previously a closure
  private to the Zustand store creator, used by `login`/`register`/`hydrate`)
  is now a module-level function, hoisted out of `create(...)`. The module
  registers `onTokenRefreshed(applySession)` once at load time. A silent
  refresh therefore updates `useSession` through the *exact same function*
  login and register use — not a second, parallel copy of the "apply a
  token" logic that could drift again later.
- `clearSession()` was hoisted the same way and reused for both
  `onUnauthorized` and `logout()`.

**Covering test:** `frontend/src/features/auth/session.test.ts` (new file) —
`"keeps useSession().accessToken in sync after a silent 401-triggered
refresh"`. Seeds the store as already-authenticated with a stale token, then
drives the same 401 → refresh → replay sequence as `api.test.ts`'s existing
retry test, and asserts `useSession.getState().accessToken === "fresh"` and
`status === "authenticated"` afterward.

## Important 2 — the `/auth/*` no-retry guard was untested

**Fix:** added a test to `frontend/src/lib/api.test.ts`:
`"never attempts a refresh for a 401 coming from an /auth/* endpoint
itself"`. It POSTs to `/auth/login`, asserts the rejection (status + French
detail, as before) *and*, separately, asserts on the recorded call list:
`fetchMock` was called exactly once, and no call's URL is
`/api/auth/refresh`.

**Verified it actually catches the regression the reviewer described**,
before trusting it: temporarily changed line 101 of `api.ts` from
`response.status === 401 && !isRetry && !path.startsWith("/auth/")` to
`response.status === 401 && !isRetry` (guard removed), ran
`npx vitest run src/lib/api.test.ts`:

```
❯ src/lib/api.test.ts (8 tests | 1 failed)
  × api client > never attempts a refresh for a 401 coming from an /auth/*
    endpoint itself
    → expected "spy" to be called 1 times, but got 2 times
```

Exactly the new test failed; the other 7 (including the existing
"does not loop when the refresh itself fails" test, which the reviewer
correctly noted stays green either way since it only asserts on the thrown
error) still passed. Restored the guard, re-ran — all 8 green again — before
proceeding.

## Missing scope — the Réglages screen

Built the four items specified, nothing else:

- **Thème** — `SettingsPage` now renders a labelled `<select>` wired
  directly to `useTheme()` (the same context `AppShell`'s header selector
  already used), options Système/Clair/Sombre.
- **Densité d'affichage** — new `frontend/src/app/DensityProvider.tsx`,
  structured identically to `ThemeProvider.tsx`: a `DensityPreference`
  (`"comfortable" | "compact"`) held in context, persisted via new
  `readStoredDensity`/`storeDensity` functions in `design/theme.ts`
  (`localStorage` key `yieldo.density`, same pattern as the theme key), and
  applied as `document.documentElement.dataset.density` both reactively (a
  `useEffect`, like `ThemeProvider`) and — to avoid a flash on load, mirroring
  how `main.tsx` already avoids one for the theme — synchronously in
  `main.tsx` before the first paint. Added spacing-only custom properties to
  `tokens.css`: `--yd-space-2xs` through `--yd-space-xl` in the base `:root`
  block (comfortable defaults) and a `:root[data-density="compact"]` block
  that tightens each step. No colour token was touched.
  `SettingsPage.css` consumes these tokens for its own layout, so the switch
  has a real, checkable effect immediately rather than sitting inert until
  some future screen opts in.
- **Animations** — new `frontend/src/design/motion/motionPreference.ts`: a
  small Zustand store (`useMotionPreference`) holding a `disabled: boolean`,
  persisted through new `readStoredMotionDisabled`/`storeMotionDisabled` in
  `design/theme.ts` (`localStorage` key `yieldo.motion-disabled`).
  `design/motion/useReducedMotion.ts` now returns
  `systemReduced || disabledByUser` instead of just `systemReduced` — every
  existing consumer (`AppShell`, `CountUp`, `LoginPage`, `RegisterPage`)
  picked this up with no code change, exactly as asked, since the hook's
  return type and meaning didn't change.
- **Se déconnecter** — moved as-is from the old inline placeholder into
  `SettingsPage`.

`frontend/src/app/routes.tsx`'s `/reglages` route now points at the real
`features/settings/SettingsPage.tsx`; the inline `SettingsPlaceholder` and
its now-unused `useNavigate` import were removed. The other four routes
(`/`, `/transactions`, `/categories`, `/import`) are untouched — still
placeholders owned by tasks 18–20, as before.

**Explicitly not built**, per the coordinator's instruction: the
registration open/close toggle. `registration_open`
(`backend/app/config.py`) is an environment variable read once at process
startup; there is no endpoint to change it at runtime, and adding one needs
a server-side settings table that belongs to phase 3 alongside API-key
management. `SettingsPage`'s doc comment states this explicitly so the gap
is visible in the code, not just in this report.

**Covering tests:** `frontend/src/features/settings/SettingsPage.test.tsx`
(new file), 4 tests:
1. `"labels every control"` — `getByLabelText` for Thème, Densité
   d'affichage, and Activer les animations, plus `getByRole("button", {name:
   "Se déconnecter"})`.
2. `"updates data-theme on the document element when the theme changes"` —
   selects "light" (jsdom has no `window.matchMedia`, so `ThemeProvider`'s
   "system" default already resolves to "dark" via its `?? true` fallback;
   switching to "light" is therefore a real, checked transition, not a
   no-op) and asserts `document.documentElement.dataset.theme === "light"`.
3. `"updates data-density on the document element when the density
   changes"` — asserts the "comfortable" default, then selects "compact" and
   asserts the attribute follows.
4. `"makes useReducedMotion() return true once the animation switch is
   turned off"` — renders a `ReducedMotionProbe` sibling component that
   calls the real `useReducedMotion()` hook (not a mock), asserts it starts
   `"false"`, clicks the switch, asserts it becomes `"true"` — proving the
   store is actually shared, not just read locally inside `SettingsPage`.

The Minor finding (concurrent 401s each firing their own refresh) was left
alone, as instructed.

## Test commands and output (fix round)

```
$ cd frontend && npm test
 ✓ src/lib/api.test.ts (8 tests)
 ✓ src/design/contrast.test.ts (21 tests)
 ✓ src/design/theme.test.ts (11 tests)
 ✓ src/features/auth/session.test.ts (1 test)
 ✓ src/design/glass/GlassCard.test.tsx (6 tests)
 ✓ src/design/CountUp.test.tsx (2 tests)
 ✓ src/features/settings/SettingsPage.test.tsx (4 tests)
 ✓ src/app/AppShell.test.tsx (10 tests)
 ✓ src/features/auth/LoginPage.test.tsx (3 tests)
 Test Files  9 passed (9)
      Tests  66 passed (66)
```

```
$ cd frontend && npm run build
> tsc -b && vite build
✓ 451 modules transformed.
✓ built in 1.40s
```

Both exit 0. Suite grew from 60 tests / 7 files (end of the original task-17
pass) to 66 tests / 9 files (+1 in `api.test.ts`, +1 new `session.test.ts`,
+4 new `SettingsPage.test.tsx`). `contrast.test.ts` (21/21) is unaffected by
the `tokens.css` spacing additions — confirmed both in isolation
(`npx vitest run src/design/contrast.test.ts`) right after editing
`tokens.css`, and again in the full run above.

`npm run lint` remains unavailable in this checkout (`eslint` is not
installed) — unchanged from the original task-17 pass, not introduced or
fixed here.

## Notes for later tasks (fix round)

- `api.ts` now exports `RefreshedSession` (`{ access_token: string; user:
  User }`) and `onTokenRefreshed`. Any future code that needs to react to a
  silent refresh (e.g. analytics, a "session extended" toast) should
  register through `onTokenRefreshed`, not poll `useSession`.
- `applySession`/`clearSession` in `session.ts` are module-level (not
  exported) specifically so both the store's own actions and api.ts's
  `onTokenRefreshed`/`onUnauthorized` callbacks funnel through one
  implementation. If a future task adds another way to acquire a session
  (e.g. an OAuth callback), route it through `applySession` too rather than
  writing a third copy.
- Density and motion preference are both plain `localStorage`-backed state
  outside of React Query/session — same tier as the theme preference. If a
  future task wants server-persisted user preferences, all three
  (`yieldo.theme`, `yieldo.density`, `yieldo.motion-disabled`) would need to
  move together.
- The new `--yd-space-*` tokens are only consumed by `SettingsPage.css` so
  far. Other screens (`AppShell.css`, `GlassCard.css`, `AuthPage.css`) still
  use hard-coded pixel gaps/padding and do not yet honour density — that is
  expected per the review's framing ("so later screens can honour it"), not
  an oversight here, but worth flagging so task 18–20 authors know the
  tokens exist and are the intended vocabulary for their own spacing.
