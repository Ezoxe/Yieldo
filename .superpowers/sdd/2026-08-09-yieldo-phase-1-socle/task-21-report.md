# Task 21 report — Docker image and SPA serving

**Commit:** `09db01579314b0379ae01e72f4a9764a59f2a236`
**Branch:** `phase-1-socle`

## What was implemented

- `backend/tests/test_spa.py` — 4 tests per the brief (API 404 not shadowed,
  SPA fallback when built, path traversal refused, French 503 when not built).
- `backend/app/main.py` — added `STATIC_DIR` and the `serve_spa` catch-all
  route, registered **after** `app.include_router(api)` as required.
- `docker/Dockerfile` — multi-stage build: `node:22-alpine` builds the SPA,
  `python:3.12-slim` runtime installs the backend, copies the built SPA to
  `/app/static`, runs as non-root `yieldo` (uid 1000), has a curl-based
  `HEALTHCHECK` on `/api/health`.
- `docker/entrypoint.sh` — runs `alembic upgrade head` before `exec "$@"`.
- `docker-compose.yml`, `.env.example` — as specified in the brief.
- `.dockerignore` — **changed from the brief's literal content**, see
  Deviations.
- `.gitattributes` — **new file, not in the brief's file list**, see
  Deviations.

## Docker verification: NOT PERFORMED — Docker is not installed on this machine

I checked three ways and found no Docker on this Windows machine:
- `docker --version` / `docker compose version` — command not found in both
  git-bash and PowerShell.
- No `docker` binary anywhere on `PATH` (`where docker` found nothing).
- No Docker Desktop installation (`C:\Program Files\Docker\Docker` and
  `C:\ProgramData\DockerDesktop` both absent).

So Step 7 of the brief (`docker compose --env-file .env.example build`, run
with a throwaway secret, `curl /api/health`) **was not run and I am not
claiming it was**. What I verified instead, as substitutes, each confirmed
working:
- The frontend build the Dockerfile's first stage depends on:
  `cd frontend && npm run build` succeeded (Node 24 installed locally, ≥22
  required), producing `frontend/dist/index.html` + hashed assets.
- The backend install pattern the Dockerfile's runtime stage depends on:
  reproduced `pip install .` with only `pyproject.toml` present (no `app/`
  source yet, matching the Dockerfile's layer-caching order) in a throwaway
  venv — succeeds (setuptools builds a dependencies-only wheel since no
  package is discoverable yet; the real `app/` package is added by the
  later `COPY backend/ ./` layer).
- The import-resolution assumption the entrypoint and CMD depend on: ran the
  actual `uvicorn.exe` console script (not `python -m uvicorn`) with
  `cwd=backend` and no `PYTHONPATH` set — it imported `app.main:app`
  successfully. Uvicorn inserts the cwd into `sys.path` when resolving an
  import-string app, and `alembic.ini` already sets `prepend_sys_path = .`,
  so `alembic upgrade head` run from `WORKDIR /app` will likewise import
  `app.config`/`app.db`/`app.models` correctly.
- Ruff: `ruff check app/main.py tests/test_spa.py` — clean.

These substitute checks give reasonable confidence the image will build and
run, but they are not the same as an actual `docker build`/`docker run`.
**Tasks 22/23 (or whoever has Docker available) should run Step 7 for real
before calling phase-1 done.**

## Tests

```
cd backend && .venv/Scripts/pytest.exe tests/test_spa.py -v
```
Before implementation: 1 passed (API 404, trivially — no catch-all existed
yet), 3 failed (`AttributeError: module 'app.main' has no attribute
'STATIC_DIR'`).

After implementation: **4 passed**.

Full suite: `cd backend && .venv/Scripts/pytest.exe -q` → **209 passed**
(205 pre-existing + 4 new; the brief's "206 tests" figure was an
approximation). Ruff clean.

## Deviations from the brief, with rationale

1. **`serve_spa` now rejects `/api` and `/api/*` with a 404 before the
   static-dir check.** The brief's literal `serve_spa` implementation had
   no such guard. Since the catch-all is a `GET /{full_path:path}` route
   registered on `app` (not the `api` router), it structurally matches
   *any* unmatched GET request, including `/api/inconnu` — FastAPI tries
   the `api` router first, finds no match, and falls through to the
   catch-all. Without the guard, `test_api_404_stays_a_json_404_...` failed
   with **503** instead of 404 (the catch-all's "frontend not built" branch
   fired instead, since `STATIC_DIR` defaults to `/app/static`, absent in
   dev). This is exactly the "SPA route must not swallow /api 404s"
   concern flagged going in; fixed with an early
   `if full_path == "api" or full_path.startswith("api/"): raise
   HTTPException(404)`.

2. **`test_path_traversal_is_refused` now requests
   `/..%2f..%2fetc/passwd` instead of the brief's literal
   `/../../etc/passwd`.** Root cause, confirmed empirically: `httpx`
   (which `starlette.testclient.TestClient` uses) normalizes literal `..`
   dot-segments in the URL *client-side*, per RFC 3986, before the request
   is ever sent — `httpx.URL('http://x/../../etc/passwd').path` is already
   `/etc/passwd`. I verified this by printing `response.request.url` and by
   inspecting the ASGI `scope["path"]`/`scope["raw_path"]` the app actually
   receives — both show `/etc/passwd`, never the literal dots. Since
   `/etc/passwd` resolved against the static root is a normal, *contained*
   path — and the brief's own "Produces" contract says "tout le reste
   renvoie index.html" (everything else, contained, returns index.html) —
   the literal test's request legitimately falls through to the SPA
   fallback and returns 200, **not a security bug**: the guard is
   `Path.is_relative_to`, and I separately confirmed on this Windows
   machine that it correctly returns `False` (triggering a 403) for a
   candidate built from literal (un-normalized) `../../etc/passwd`
   segments. The percent-encoded slash (`%2f`) survives httpx's
   normalization pass (it only recognizes literal `/../` patterns, not
   `..%2f..`) and decodes to literal dots server-side — the same way a raw
   proxy or non-normalizing client would deliver it in production — so it
   actually exercises the guard, confirmed returning 403. I added a
   comment in the test explaining this. This is the "verify
   `Path.is_relative_to` behaves correctly on this platform" concern
   flagged going in — the guard itself is correct; the test transport was
   the actual issue.

3. **`.dockerignore` uses `**/data/`, `**/node_modules/`, `**/.venv/`,
   `**/docs/` instead of the brief's bare `data/`, `node_modules/`,
   `.venv/`, `docs/`.** Confirmed via Docker's own documentation (fetched
   during this task) that, unlike `.gitignore`, a bare `.dockerignore`
   pattern with no `**/` prefix only matches at the **build-context root**
   — the brief's own file already used `**/__pycache__/` and
   `**/.pytest_cache/` for exactly this reason, but left the other four
   bare. In this repo, `.venv` lives at `backend/.venv` (126 MB) and
   `node_modules` at `frontend/node_modules` (218 MB) — one level down, not
   at root — so the literal `.dockerignore` would send ~344 MB of an
   irrelevant Windows venv and pre-existing `npm` deps into the build
   context on every build, and `COPY backend/ ./` would bake
   `backend/data/yieldo.db*` (a real local dev SQLite database with
   WAL/SHM files) into an image layer. Root-level `data/` and `docs/` are
   unaffected either way since they already sit at the context root, but
   the `**/` form is strictly more correct and costs nothing.

4. **Added `.gitattributes`** (`*.sh text eol=lf`), not in the brief's file
   list. `docker/entrypoint.sh` is written with LF now, but this machine
   has `core.autocrlf=true` globally — without pinning, a future checkout
   on Windows (this machine or another contributor's) would silently
   rewrite it to CRLF, and `#!/bin/sh` with a CRLF line ending fails inside
   the Linux container (`exec format error` / "bad interpreter"). Verified
   the current working-tree file has pure LF bytes (`xxd` — no `0x0d`)
   before adding the rule.

## Notes for tasks 22/23

- **Run the actual Docker build.** This report only verified the pieces
  Docker itself would exercise (frontend build, backend install-without-app-source
  ordering, uvicorn's app-import path resolution); the real
  `docker compose --env-file .env.example build` /
  `docker compose up -d` / `curl http://localhost:8080/api/health` /
  `docker compose down` sequence from the brief's Step 7 has not been run
  by anyone yet.
- `install.sh` is referenced by both the 503 message
  ("Lancez ./install.sh install.") and by `docker-compose.yml`'s
  `YIELDO_SECRET_KEY:?SECRET_KEY manquant — lancez ./install.sh install`
  but does not exist in the repo yet — presumably a later task's
  responsibility.
- The uploads directory contract (`data/uploads/pending/<user_id>/` and
  `data/uploads/archive/<user_id>/`) is preserved automatically: the
  compose volume mounts the whole `./data` host directory over
  `/app/data`, and `Settings.uploads_dir`/`get_settings()` already
  `mkdir(parents=True, exist_ok=True)` on startup — no Docker-specific
  change was needed there.
- The frontend production build currently emits one ~1.5 MB JS chunk with
  a Vite "chunks larger than 500 kB" warning. Not a Task 21 concern (no
  functional impact), but worth a follow-up if startup/load time on the
  target host matters.

---

## Fix round 1 of 5

**Commit:** `72ddc96253c264413c517712bc56c9177dfc0f78`

### Important — data volume unwritable on first boot

**Root cause, confirmed by reasoning through the ownership chain (not by
running it — Docker still unavailable, see Verification section below):**
`docker-compose.yml`'s `./data:/app/data` bind mount has no host-side
directory to point at on a first install. Docker creates a missing bind
source as `root:root` before starting the container, and a bind mount
*replaces* the mount-point directory entirely — it does not inherit or
merge with whatever the image had chowned at that path during build. So the
image's `RUN ... chown -R yieldo:yieldo /app` (which does chown
`/app/data`) becomes irrelevant the moment the volume is mounted: the
container sees `/app/data` as `root:root`, but the process was going to run
as uid 1000 (`USER yieldo`), which cannot write `/app/data/yieldo.db`.
`alembic upgrade head` fails in the entrypoint, before the app ever starts.
This is exactly what the brief's "the volume belongs to the runtime user"
claim assumed away.

**Fix — moved privilege-dropping into the entrypoint instead of the image:**

1. `docker/Dockerfile`:
   - Added `gosu` to the same `apt-get install` layer as `curl`. Confirmed
     via web search that `gosu` is packaged in Debian bookworm's official
     repos (`packages.debian.org/bookworm/gosu`, and
     `tracker.debian.org/pkg/gosu`) — `python:3.12-slim` is bookworm-based,
     so `apt-get install gosu` needs no extra repository or manual binary
     download.
   - Removed the `USER yieldo` instruction. The image now stays root at
     container start; added a comment explaining why, pointing at
     `entrypoint.sh`. Grepped both Docker files and `docker-compose.yml`
     for any other `USER`/`whoami`/`$(id ...)` reference — none exists, so
     nothing else depended on the build-time directive.
   - Left the existing build-time `mkdir -p /app/data && chown -R
     yieldo:yieldo /app` step in place: it still correctly sets ownership
     for everything else under `/app` (code, static assets), and is
     harmless-but-superseded for `/app/data` specifically once the bind
     mount takes over that path at runtime.

2. `docker/entrypoint.sh` — now, running as root:
   - `mkdir -p /app/data` (idempotent; handles both "Docker already created
     it as root" and, defensively, "somehow still missing").
   - Checks current ownership with `stat -c '%u:%g' /app/data` and only
     runs `chown -R yieldo:yieldo /app/data` when it is not already
     `1000:1000`. This keeps the fix cheap on every subsequent boot after
     the first (per the brief's "don't recurse over a large uploads tree
     every time" instruction) — once ownership is corrected once, later
     boots skip the recursive chown entirely.
   - Runs migrations via `gosu yieldo alembic upgrade head`, **not** as
     root. This was a deliberate addition beyond the literal fix
     instructions: if migrations ran as root, `yieldo.db` would be
     *created* by root even after the directory chown, and the app
     (running as yieldo afterward) would then fail to write to its own
     database file — reintroducing the exact class of bug being fixed, one
     level down. Running the migration step itself through `gosu yieldo`
     ensures the SQLite file inherits the same owner as the process that
     reads and writes it afterward.
   - Finally `exec gosu yieldo "$@"` — `gosu` uses `execve` internally, so
     `uvicorn` replaces `gosu`'s process image and keeps PID 1, receiving
     `docker stop`'s `SIGTERM` directly rather than through a supervisor
     layer.

**Healthcheck impact — reasoned, not run:** `HEALTHCHECK ... CMD curl -fsS
http://127.0.0.1:8000/api/health` has no dependency on the process UID —
it's a plain loopback HTTP GET. Before this fix it ran in a context with no
explicit `USER` at healthcheck-exec time only because `USER yieldo` was the
image's last such instruction; after this fix there still is no `USER`
instruction, so the healthcheck's exec context is unchanged in kind (root
by default either way for `HEALTHCHECK`, independent of what the
entrypoint does internally with `gosu`). No change in behavior expected.

**Alternative approaches considered and rejected:**
- *Named volume instead of a bind mount* — sidesteps the root-ownership
  problem (Docker manages named-volume ownership differently, and typically
  initializes it from the image's directory content/ownership on first
  use), but changes the deployment model the brief specified (`./data`
  as a host-visible, backupable directory) and doesn't match "the volume
  must survive rebuilds" in a host-inspectable way the operator can `ls`,
  `tar`, or point a backup job at directly. Rejected — the brief's own
  interfaces section is explicit about a host bind mount.
- *`user:` in `docker-compose.yml` pinned to `1000:1000`* — doesn't fix
  anything; the container would still start as uid 1000 against a
  root-owned directory and fail identically. Rejected, doesn't address the
  root cause.
- *Init container that chowns and exits before the app container starts* —
  correct in spirit but heavier than necessary for a single-service compose
  file with no orchestrator-level init-container primitive (plain `docker
  compose` has no native "init container, then main container" ordering
  without a second service + `depends_on` + a health/completion signal).
  The root-then-gosu entrypoint pattern achieves the same effect in one
  container, is the standard idiom for exactly this problem (this is
  literally how `postgres`'s and `mysql`'s official images handle
  volume ownership), and is what the coordinator's message specified.
  Implemented as directed.

**Note for Task 22 (`install.sh`):** `install.sh` should still create
`./data` before the first `docker compose up`, but its ownership does not
need to match `1000:1000` — **plain `mkdir -p ./data` with the default
ownership of whoever runs `install.sh` is sufficient.** The entrypoint now
corrects ownership on every boot where it's wrong (including a first boot
where `install.sh` created it, since that will virtually never already be
`1000:1000` on the host) and skips the recursive chown once it's already
correct. The two mechanisms agree by design: `install.sh` only needs to
guarantee the directory *exists* so Docker doesn't have to auto-create it
(cosmetic — either way it'd end up owned by whoever created it, root or
otherwise, and get fixed by the entrypoint); the entrypoint is the single
source of truth for *ownership*. `install.sh` must not `chown` the
directory to some other uid itself — that would just cause the entrypoint
to redo the same recursive chown on the next boot for no benefit.

### Minor — unhandled `ValueError` on a null-byte path

**Root cause, confirmed by reproducing it directly against the real app
(not just reasoned):** a request path containing a `%00`-encoded byte
decodes to a literal null character in `full_path`. `Path.resolve()` calls
`os.stat()` internally, which raises `ValueError: stat: embedded null
character in path` (message confirmed on this Windows machine; Linux's
`os.stat` raises the same `ValueError` type for an embedded null byte,
message text may differ slightly — "embedded null byte" — but the
exception class and the fact that it's unhandled is platform-independent).
This propagated out of `serve_spa` uncaught, past FastAPI's endpoint
wrapper, and would render as an unhandled-exception 500 in production
(Starlette's `ServerErrorMiddleware` catches it and returns a generic
response when `debug=False`).

**Fix:** wrapped the `(root / full_path).resolve()` call in
`backend/app/main.py` in `try/except ValueError`, raising the same
`HTTPException(status_code=403, detail="Chemin non autorisé")` the
traversal guard already raises a few lines below — one consistent "this
path is not allowed" response for both cases, French detail per the
project's global constraint. Used `raise ... from None` to suppress
exception chaining noise (the `ValueError` isn't useful context for an
API client).

**Test added:** `test_embedded_null_byte_is_refused_not_a_server_error` in
`backend/tests/test_spa.py` — requests `/foo%00bar` against a built static
dir and asserts `403` with a French "non autorisé" detail. Confirmed it
reproduces the original 500 (full traceback ending in `ValueError: stat:
embedded null character in path` at the `resolve()` call) against the
pre-fix code, and passes after the fix.

### Coverage note — the volume-ownership fix has no automated test

The Docker/entrypoint fix is shell-script and container-runtime behavior;
there is no pytest-level (or any other in-repo) harness that exercises
`docker/entrypoint.sh` or container UID/ownership semantics, and adding one
would mean standing up an actual container runtime this task doesn't have
access to. I did not fabricate a test for it. What I did instead, all
short of running it:
- Reproduced the `pip install .`-without-`app/`-source pattern and the
  `uvicorn` cwd-import behavior in task 21's original verification (still
  valid, unchanged by this fix).
- Syntax-checked `entrypoint.sh` with `sh -n` (git-bash's POSIX `sh`) —
  passes.
- Confirmed `entrypoint.sh` is still pure LF bytes (`xxd`, no `0x0d`), so
  the `.gitattributes` protection from task 21 still applies and the
  shebang won't break on a Windows checkout.
- Traced the ownership logic by hand against both first-boot (dir missing
  → Docker/root creates it → entrypoint mkdir is a no-op → stat shows
  `0:0` → recursive chown fires) and steady-state (dir already `1000:1000`
  from a prior boot → chown skipped) cases.

### What the operator must confirm on first deploy

Since Docker is still unavailable on this development machine, none of the
following has been executed — only reasoned through:
1. `docker compose --env-file .env.example build` completes without error
   (in particular, that `apt-get install -y --no-install-recommends curl
   gosu` resolves and installs cleanly on whatever Debian snapshot
   `python:3.12-slim` currently resolves to).
2. On a machine where `./data` does **not** yet exist:
   `YIELDO_SECRET_KEY=test-only docker compose --env-file .env.example up
   -d`, then check `docker compose logs` shows `[yieldo] fixing ownership
   of /app/data (was 0:0)` (or whatever uid Docker actually assigned — may
   not be exactly `0:0` depending on the host's Docker configuration/user
   namespace remapping) followed by successful `alembic upgrade head`
   output, not a permission error.
3. `ls -ln ./data` on the host after that first boot shows the directory
   owned by uid/gid `1000` (or the remapped equivalent if the Docker
   daemon uses `userns-remap`).
4. `curl -fsS http://localhost:8080/api/health` returns
   `{"status":"ok","version":"0.1.0"}`.
5. `docker compose restart` (second boot, directory already correctly
   owned) does **not** print the "fixing ownership" line — confirming the
   cheap-path skip actually skips.
6. `docker inspect --format='{{json .State.Health}}' <container>` shows
   `healthy` once `--start-period` elapses.
