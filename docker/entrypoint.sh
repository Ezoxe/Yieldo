#!/bin/sh
# Apply pending migrations before the app accepts traffic. A failed migration
# must stop the container rather than let it serve against a stale schema.
set -eu

echo "[yieldo] applying database migrations…"
alembic upgrade head

echo "[yieldo] starting application"
exec "$@"
