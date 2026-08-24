# Task 22 report — install.sh lifecycle script

**Commit:** `d64fec4d4a646bea124b7580f1189b0766007f3e`
**Branch:** `phase-1-socle`

## What was implemented

- `install.sh` — subcommands `install`, `update`, `backup`, `restore <file>`,
  `start`, `stop`, `restart`, `logs`, `status`, `uninstall`, `help`, matching
  the brief's interface contract. French operator-facing output, English
  code/comments/commit.
- `tests/install/test_find_port.sh` — sources `install.sh` with
  `YIELDO_LIB_ONLY=1` and exercises `find_free_port`, `generate_secret`,
  `read_env_value` without Docker, per the brief.
- Followed all "careful points" from the task: `SECRET_KEY` generated once
  and never regenerated while `.env` exists; `ensure_env` reads every
  preserved value before the heredoc write (truncate-before-substitution
  problem avoided, unchanged from the brief); `backup` copies `.env`
  alongside the `.db`; `update` backs up → rebuilds → health-checks →
  restores automatically on failure; `restore`/`uninstall` both require
  typing `oui`; `data/` is never deleted anywhere, including `uninstall`;
  `install.sh` only does `mkdir -p "$DATA_DIR"` — no chown, per task 21's
  entrypoint owning that concern.

## Deviation from the brief, with rationale — `port_in_use`'s fallback

The brief's literal Python fallback (`command -v python3` gate, then a plain
`bind(("0.0.0.0", port))`) does not behave correctly on this dev machine,
and I changed it rather than ship it as-is. Two independent problems,
confirmed empirically, not just reasoned about:

1. **`command -v python3` is not enough on Windows.** This machine has a
   `python3` on `PATH` that is a WindowsApps store shim — `command -v
   python3` finds it, but running it (`python3 --version`) exits 49 with
   "Python est introuvable…" instead of executing anything. The real
   interpreter is `python`, not `python3`, here. Verbatim, the brief's gate
   would have picked the broken shim, made every `port_in_use` call fail to
   run any Python, hit the `&&`/`||` fallthrough to `return 0` (in use) for
   every port, and `find_free_port` would exhaust 200 attempts and abort —
   breaking even the trivial "free port" case.
   **Fix:** added `python_bin()`, which only accepts an interpreter after a
   working `--version` invocation, preferring `python3` (so Debian, where
   the real interpreter is at that name, is unaffected) and falling back to
   `python` only when `python3` is present-but-broken.

2. **A plain `bind()` under-reports occupied ports on Windows.** I
   reproduced the test's exact scenario by hand: held `127.0.0.1:49501`
   with a listening socket, confirmed with a `connect()` that it really was
   listening, then attempted `bind(("0.0.0.0", 49501))` from a second
   process — **it succeeded**, with and without `SO_REUSEADDR`. Windows
   does not reject a wildcard bind against an already-listening
   specific-address socket the way Linux does; the brief's `except
   OSError` branch would never fire, so an occupied port would be reported
   free. **Fix:** the fallback now tries `connect()` to the port first
   (catches the case a probing `bind()` misses on Windows, and is a no-op
   change on Linux where `bind()` already worked correctly) and only falls
   back to `bind()` if `connect()` is refused.

Both fixes were validated by hand (isolated Python snippets reproducing
holder/probe pairs) before being folded into `install.sh`, then confirmed
again through the actual sourced function via the test harness.

## Which branch actually ran here vs. on Debian

Checked directly on this machine:
- `ss`: **absent** (`command -v ss` → exit 1). Debian normally ships `ss`
  (iproute2), so production is expected to satisfy the `ss -tuln` branch
  directly for genuinely occupied ports and skip the rest.
- `netstat`: **present** (Windows' `netstat.exe`), but it does not
  understand the combined Unix-style `-tuln` flags — it printed the French
  usage/help text instead of a connection list. `grep -qE` never matches
  that output, so the pipeline is a no-op here and falls through
  unconditionally to the Python probe (the `if`/`elif` block does not
  `return` unless a match is found — this fallthrough is by design in the
  brief's own structure, not something I added).
- `python_bin()` resolves to **`python`** here (confirmed by sourcing
  `install.sh` and calling it directly), not `python3` — see deviation #1.
- So on this machine, `find_free_port`'s test assertions are proven
  correct via the **connect()+bind() Python fallback path**, run under
  `python`. On Debian, the same test would be expected to pass via the
  **`ss` fast path** instead (Debian's `python3` also works normally there,
  so even if it ever reached the fallback, it would use the `python3` name
  as literally specified in the brief).

## Tests

```
bash tests/install/test_find_port.sh
```
Before `install.sh` existed: **failed** —
`install.sh: No such file or directory` (confirmed first).
After implementation: **all 6 assertions passed** —
`All install.sh unit checks passed.`

Also smoke-tested the CLI dispatch directly (not part of the brief's
harness, but cheap and safe without Docker): `bash -n install.sh` (syntax
OK), `./install.sh help`, `./install.sh` (no args → usage, exit 0),
`./install.sh frobnicate` (usage, exit 1), `./install.sh restore` with no
argument (French usage error, exit 1), `./install.sh start` with no Docker
installed (`require_docker` fails loudly in French, exit 1, no traceback).
Confirmed via `xxd` that the ANSI color codes are real ESC bytes (`1b`),
not literal backslash text — the terminal capture in this tool just
doesn't render them. None of these touched `data/` or created `.env`
(verified before/after).

## What was NOT executed — no Docker on this machine

Same constraint as task 21: `docker`/`docker compose`/`docker-compose` are
absent from `PATH` on this Windows machine. **Not run and not claimed as
run:**
- `./install.sh install` — image build, `compose up -d`, health-wait loop,
  the "port already used by another service, hop to the next free one"
  branch inside `ensure_env` (its `port_in_use "$port" && ! compose ps
  ...` guard calls `compose`, i.e. `docker`).
- `./install.sh backup` / `update` / `restore` / `uninstall` end-to-end —
  the `sqlite3 .backup`, `compose exec`, and the update's
  backup→rebuild→health-check→auto-restore sequence.
- `./install.sh status` / `logs` / `start` / `stop` / `restart` beyond the
  no-Docker error path already exercised above.

These are exactly the commands the brief's own Step 5 asks to run "on a
machine with Docker" — that verification still needs to happen on a real
target host or CI runner before this is trusted end-to-end.

## What the operator must verify on first deploy

1. `./install.sh install` on a fresh Debian box actually reaches a running,
   healthy container and prints the `http://localhost:<port>` line — the
   full `require_docker` → `ensure_env` → `compose build` → `compose up -d`
   → `wait_for_health` chain has only been syntax-checked and
   partially unit-tested, never run against a real daemon.
2. That `ss` is present and its `-tuln` output format matches the
   `awk '{print $5}'` column assumption on the actual target Debian image —
   this repo's own dev box could not confirm the `ss` branch at all (`ss`
   absent here). If it silently mis-parses, the code still self-corrects
   via the Python fallback (same fallthrough structure that saved this
   machine), but that fallback path itself was only proven correct on
   Windows semantics, not re-verified against a real Linux bind/connect
   pair.
3. That a second `install.sh install` run on a machine where port 8080 is
   already taken by something unrelated actually lands on a free port and
   that `ensure_env`'s `elif port_in_use "$port" && ! compose ps ...`
   branch (the "port occupied by something else, not our own container"
   re-pick) behaves as intended — this specific branch needs Docker to
   evaluate `compose ps` and was not exercised at all.
4. That `.env` is created with `chmod 600` and survives a `git status`
   check as untracked (`.gitignore` already excludes it, confirmed by
   inspection, not by running `install`).
5. That `update`'s auto-restore-on-failed-health-check path actually
   restores a real `.db` file correctly when a bad build genuinely fails
   `wait_for_health` — this is the highest-stakes untested path in the
   script and was only read-reviewed, not run.

## Files

- `E:\Projet\Github\Yieldo\install.sh`
- `E:\Projet\Github\Yieldo\tests\install\test_find_port.sh`

---

## Fix round 1 of 5

**Commit:** `ff5ce40392abf5d21e0c4281f066098ee2314d75`

Review found one Critical and two Important issues, all reproduced (not
theorised) against the committed script. Fixed all three; extended the
test harness for what is testable without Docker.

### CRITICAL — recovery paths were not themselves failure-safe

`cmd_update`'s rollback ended in a bare sequence (`compose down`; `cp
"$archive" "$DB_FILE"`; `compose up -d`; `fail ...`) and `cmd_restore` was
the same shape. Under `set -e`, a failure in the middle `cp` — disk full,
permissions, the target directory gone — exits the script raw, mid-recovery:
`compose up -d` never runs (service stays down), and no `fail()`/`ok()`
message ever prints. I reproduced this directly rather than just reading
it: pointed `DB_FILE` at a path whose parent doesn't exist and ran the
old-shaped sequence by hand — confirmed the script died silently with the
container down and no explanation, exactly as described.

**Fix:**
- Extracted the copy step into `restore_db_from_backup()` (new function,
  `install.sh:244`), a pure filesystem helper — no `compose`/Docker call
  inside it — so it can be exercised, including its failure branch,
  without a daemon. It uses `if cp ...; then ok; return 0; fi; warn;
  return 1` (an explicit check, not a `&&`/`||` chain), and never prints to
  stdout, only status via `warn`/`ok` on stderr.
- `cmd_update` and `cmd_restore` now check every recovery step explicitly:
  `compose down || warn ...` (never aborts if the service was already down
  or compose itself is unreachable), then `restore_db_from_backup`, then
  `compose up -d` inside its own `if`/`else`. Each of the four resulting
  states gets its own French message so the operator always knows where
  their data is: restored + service back up; restored but service did NOT
  come back (told to run `start` then `logs`); service back up but restore
  failed (told the backup is still intact at `$archive` and to run
  `restore` manually); or both failed (told the backup's exact path and to
  intervene manually). `cmd_update`'s failure branch always ends in
  `fail()` (the update did not succeed, regardless of which sub-state);
  `cmd_restore`'s only fails when the copy itself failed — the DB was
  never touched, so "restauration annulée : la base actuelle est
  conservée telle quelle" is accurate.
- `cmd_uninstall`'s `compose down --rmi local` — flagged as "same shape,
  lower stakes" — now checks explicitly too: on failure it reports the
  container removal failed but data is intact in `$DATA_DIR`, instead of a
  raw abort with no message.

**Verified live** (no Docker, so this exercises real failure paths rather
than the success path): ran `printf 'oui\n' | ./install.sh restore
<fake-archive>` against this dev machine, which has no `docker`/
`docker-compose` binary at all. Observed exactly the intended sequence:
`compose down` raised a raw `docker-compose: command not found` (pre-existing,
unrelated leak — see Deferred below) caught by the new `|| warn`; the copy
succeeded and printed `✓ Base restaurée depuis <path>`; `compose up -d`
then failed the same way and the script correctly reported `✗ Base
restaurée depuis <path>, mais le service n'a PAS redémarré. Lancez
./install.sh start puis ./install.sh logs.` and exited 1 — not a raw crash.
This incidentally wrote a real `data/yieldo.db` and created `data/backups/`
in this repo's working tree as a side effect of the manual CLI test (not
of the automated harness); both were removed afterward (`rm data/yieldo.db`,
`rmdir data/backups`) — confirmed via `git status` that nothing untracked
remained beyond the two files this fix round changes.

### IMPORTANT — `./install.sh backup` printed nothing

`info`/`ok`/`warn` wrote to stdout; `backup) cmd_backup >/dev/null` in the
dispatch discarded everything, and `cmd_update`'s `archive="$(cmd_backup |
tail -n1)"` mixed status text into the same stream it was trying to parse.
**Fix:** all three now write to stderr (`install.sh:19-21`); `cmd_backup`'s
only stdout output is the bare archive path (`printf '%s' "$archive"` at
the end, unchanged). Simplified `archive="$(cmd_backup | tail -n1)"` to
`archive="$(cmd_backup)"` in `cmd_update` since stdout is now clean by
construction — the `tail -n1` was only ever needed to strip interleaved
status lines.

### IMPORTANT — raw English leak from the compose-exec backup fallback

`cmd_backup`'s no-sqlite3 fallback ran `compose exec -T yieldo sh -c
"sqlite3 ..." || cp "$DB_FILE" "$archive"` with no stderr handling; a
missing `docker`/`docker-compose` prints `docker-compose: command not
found` straight to the terminal. **Fix:** wrapped it in an explicit `if !
compose exec ... 2>/dev/null; then warn "Sauvegarde via sqlite3 dans le
conteneur impossible — copie brute du fichier."; cp ...; fi` — the raw
error is swallowed and replaced with a French one before falling back to
the plain copy.

### Harness extended — moved the `YIELDO_LIB_ONLY` guard

The guard used to sit right after `compose()`, before `require_docker`,
`ensure_env`, and every `cmd_*` function were even defined — so the test
harness could never reach `cmd_backup` or `restore_db_from_backup`.
**Fix:** moved the guard down to immediately before the `case` dispatch, at
the very end of the file (`install.sh:353-360`). Sourcing with
`YIELDO_LIB_ONLY=1` now defines every function in the file (including
`require_docker`, `ensure_env`, all `cmd_*`, `usage`) but still runs
nothing — function *definition* has no side effects in bash regardless of
what the function body does, so this is safe and doesn't require Docker or
touch the real environment just from being sourced.

Added to `tests/install/test_find_port.sh`:
- `cmd_backup` on a repo with no `data/yieldo.db` (true here — confirmed no
  `sqlite3` binary and no Docker either, so this really is the only
  `cmd_backup` branch reachable without one of those two): asserts stdout
  is empty and the French "no database to back up" message is on stderr.
- `restore_db_from_backup` against an unwritable target — `DB_FILE`
  reassigned in the test process to `$(mktemp -u)/no-such-subdir/yieldo.db`
  (parent directory deliberately never created, so `cp` fails the same way
  on Linux, macOS, or Windows — a chmod-444 directory was considered and
  rejected: I'd already confirmed in the original task that Windows
  permission semantics don't reliably mirror POSIX chmod, e.g. the
  SO_REUSEADDR socket surprise documented in the base report, so a missing
  parent is the more portable way to force a real failure). Asserts:
  non-zero return status, empty stdout, a French "ÉCHEC" message on
  stderr, and — the property that actually matters — the target file was
  never created (no half-written artifact).
- A contrast case with a genuinely writable target: asserts success (exit
  0) and that the copied file's content matches the source archive, so the
  failure assertions above are proven to test a real failure branch and
  not a function that always reports failure.
- **Not covered, and explicitly cannot be without a Docker daemon:** the
  `compose down`/`compose up -d` calls inside `cmd_update`'s and
  `cmd_restore`'s recovery — whether the service genuinely comes back, and
  therefore the "restored but service did not restart" branches. The
  manual CLI smoke test above exercised this once, live, showing the
  correct message and exit code, but that was a one-off hand run against
  this machine's absent Docker, not an automated, repeatable assertion —
  said plainly here rather than writing a test that would pass without
  actually exercising `compose`.

All 14 assertions pass:
```
bash tests/install/test_find_port.sh
```
→ `All install.sh unit checks passed.`

### Deferred, as instructed

Both Minor findings and everything else not explicitly listed in the
review were left untouched, including the pre-existing raw
`docker-compose: command not found` leak from every *other* `compose()`
call site (`cmd_install`, `cmd_update`'s build/up, `start`/`stop`/`restart`
dispatch, and the `compose down` calls inside the new recovery paths
themselves) — only the one call site the review named (`cmd_backup`'s
exec fallback) was wrapped. `port_in_use` still runs the Python probe on
every free-port check even when `ss` already answered — left as-is per
the review's explicit instruction.

### What changed for the operator checklist

Unchanged from the base report — the `ss` branch and the full
install/update/restore/uninstall cycle against a real Docker daemon are
still first-deploy verification items nobody has run yet. Additionally
now: confirm that a genuinely failed `compose up -d` during `update`'s
rollback (e.g. a port conflict on the old image) produces the "restored
but service did not come back" message and leaves `data/yieldo.db` as the
pre-update backup, not a partial/corrupt file — this fix round's logic was
verified by hand-reasoning and one live no-Docker run, not against a real
daemon completing a real rollback.
