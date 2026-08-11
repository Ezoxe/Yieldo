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

[ "$failures" -eq 0 ] && echo "All install.sh unit checks passed." || exit 1
