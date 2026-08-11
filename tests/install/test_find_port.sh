#!/usr/bin/env bash
# Minimal harness for the port-selection logic: no Docker required.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
YIELDO_LIB_ONLY=1 source "$REPO_ROOT/install.sh"

failures=0
assert_eq() {
  if [ "$1" != "$2" ]; then
    echo "FAIL: expected '$2', got '$1' ($3)"
    failures=$((failures + 1))
  else
    echo "ok: $3"
  fi
}

# Pick a working Python interpreter to hold a port for the "occupied port"
# case below. Some Windows installs register a "python3" shim under
# WindowsApps that only launches the Microsoft Store and exits non-zero
# instead of running any code — command -v finds it on PATH, but invoking
# it does not actually run Python. Probe with --version rather than trusting
# PATH presence alone, exactly like install.sh's own python_bin() does for
# its port-probe fallback.
TEST_PY=""
if command -v python3 >/dev/null 2>&1 && python3 --version >/dev/null 2>&1; then
  TEST_PY="python3"
elif command -v python >/dev/null 2>&1 && python --version >/dev/null 2>&1; then
  TEST_PY="python"
else
  echo "FAIL: no working Python interpreter found to run this test harness."
  exit 1
fi

# A free port is returned as-is.
port="$(find_free_port 49500)"
assert_eq "$port" "49500" "returns the starting port when it is free"

# An occupied port is skipped.
"$TEST_PY" -c "
import socket, time
s = socket.socket(); s.bind(('127.0.0.1', 49501)); s.listen(1)
time.sleep(3)
" &
holder=$!
sleep 0.7
port="$(find_free_port 49501)"
assert_eq "$port" "49502" "skips a port that is already listening"
wait "$holder" 2>/dev/null || true

# generate_secret produces a long, non-repeating value.
first="$(generate_secret)"
second="$(generate_secret)"
assert_eq "$([ ${#first} -ge 48 ] && echo long || echo short)" "long" "secret is long enough"
assert_eq "$([ "$first" != "$second" ] && echo unique || echo repeated)" "unique" \
  "secret differs between calls"

# read_env_value reads a key from a .env file and tolerates a missing one.
tmp_env="$(mktemp)"
printf 'YIELDO_PORT=9123\nYIELDO_SECRET_KEY=abc\n' > "$tmp_env"
assert_eq "$(read_env_value "$tmp_env" YIELDO_PORT)" "9123" "reads an existing key"
assert_eq "$(read_env_value "$tmp_env" YIELDO_ABSENT)" "" "returns empty for a missing key"
rm -f "$tmp_env"

# cmd_backup routes its status chatter to stderr and leaves stdout for the
# returned archive path alone. This repo's data/ has no yieldo.db during
# tests (and neither sqlite3 nor Docker are assumed present), so this
# exercises cmd_backup's "nothing to back up yet" branch — the exact
# message that used to be silently discarded by the CLI dispatch's
# `>/dev/null` before info/ok/warn moved off stdout.
backup_stderr_file="$(mktemp)"
backup_stdout="$(cmd_backup 2>"$backup_stderr_file")"
backup_stderr="$(cat "$backup_stderr_file")"
rm -f "$backup_stderr_file"
assert_eq "$backup_stdout" "" "cmd_backup prints nothing to stdout when there is no database yet"
assert_eq "$(printf '%s' "$backup_stderr" | grep -qi "sauvegarder" && echo hasmsg || echo nomsg)" \
  "hasmsg" "cmd_backup still reports the no-database case, now on stderr"

# restore_db_from_backup — the helper cmd_update's rollback and cmd_restore
# both use to actually move a backup back into place — reports and does
# NOT abort when its copy target cannot be written, instead of relying on
# a bare `&&`/`||` chain that set -e could blow through mid-recovery. A
# missing parent directory forces cp to fail predictably on any platform;
# chmod-based read-only directories were avoided here because Windows
# permission semantics do not reliably map onto POSIX chmod (confirmed
# while building this harness — see the port-probe notes above for the
# same class of platform gap).
saved_db_file="$DB_FILE"
tmp_archive="$(mktemp)"
printf 'fake backup contents' > "$tmp_archive"

DB_FILE="$(mktemp -u)/no-such-subdir/yieldo.db"
restore_status=0
restore_stderr_file="$(mktemp)"
restore_stdout="$(restore_db_from_backup "$tmp_archive" 2>"$restore_stderr_file")" || restore_status=$?
restore_stderr="$(cat "$restore_stderr_file")"
rm -f "$restore_stderr_file"

assert_eq "$([ "$restore_status" -ne 0 ] && echo nonzero || echo zero)" "nonzero" \
  "restore_db_from_backup returns a distinguishable non-zero status when the copy target is unwritable"
assert_eq "$restore_stdout" "" "restore_db_from_backup prints nothing to stdout on failure"
assert_eq "$(printf '%s' "$restore_stderr" | grep -qi "ÉCHEC" && echo hasmsg || echo nomsg)" "hasmsg" \
  "restore_db_from_backup reports the failure in French on stderr instead of aborting silently"
assert_eq "$([ -e "$DB_FILE" ] && echo exists || echo absent)" "absent" \
  "the unwritable target was never created by the failed copy — nothing was half-written"

# Contrast case: a writable target succeeds, returns 0, and actually
# contains the backup's content — proving the failure case above exercises
# a real failure branch rather than always reporting failure regardless of
# input.
writable_dir="$(mktemp -d)"
DB_FILE="$writable_dir/yieldo.db"
restore_status=0
restore_db_from_backup "$tmp_archive" >/dev/null 2>/dev/null || restore_status=$?
assert_eq "$restore_status" "0" "restore_db_from_backup succeeds and returns 0 when the target is writable"
assert_eq "$(cat "$DB_FILE")" "fake backup contents" "the restored file actually contains the backup's content"

DB_FILE="$saved_db_file"
rm -f "$tmp_archive"
rm -rf "$writable_dir"

# NOT covered here, and cannot be without a Docker daemon: cmd_update's and
# cmd_restore's compose down / compose up -d steps around the recovery
# (whether the service actually comes back, and the "service did not
# restart" branches of their reporting) — both require a real `docker
# compose` to invoke. Read-reviewed only; see the report.

[ "$failures" -eq 0 ] && echo "All install.sh unit checks passed." || exit 1
