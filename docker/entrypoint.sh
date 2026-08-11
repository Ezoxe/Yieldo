#!/bin/sh
# Runs as root (see Dockerfile: no USER directive). Fixes ownership of the
# data volume, then drops to the unprivileged yieldo user for everything
# that actually touches the app or the network.
set -eu

DATA_DIR=/app/data

# The ./data bind-mount source may not exist on the host yet. Docker then
# creates it as root before the container starts, which shadows the image's
# build-time "chown -R yieldo:yieldo /app" for that path — the container
# would otherwise run as uid 1000 against a root-owned directory and fail to
# create /app/data/yieldo.db. Fix it here instead of relying on the operator
# to chown it by hand. Only recurse when the top-level directory is actually
# wrong: a chown -R over a large uploads tree on every boot is wasteful once
# ownership is already correct from a previous run.
mkdir -p "$DATA_DIR"
current_owner=$(stat -c '%u:%g' "$DATA_DIR")
if [ "$current_owner" != "1000:1000" ]; then
  echo "[yieldo] fixing ownership of $DATA_DIR (was $current_owner)"
  chown -R yieldo:yieldo "$DATA_DIR"
fi

# Apply pending migrations before the app accepts traffic. A failed migration
# must stop the container rather than let it serve against a stale schema.
# Run as yieldo, not root, so yieldo.db is created with the same owner that
# will read and write it afterwards.
echo "[yieldo] applying database migrations…"
gosu yieldo alembic upgrade head

echo "[yieldo] starting application"
exec gosu yieldo "$@"
