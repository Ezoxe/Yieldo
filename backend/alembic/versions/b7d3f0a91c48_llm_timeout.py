"""llm_settings.timeout_seconds

A per-household ceiling on how long the optional language model is given to
answer, replacing a value hardcoded at thirty seconds.

**Nullable, and no backfill.** NULL means "this household never chose", which
keeps following `config.settings.llm_timeout_seconds` when that default moves;
a number means a deliberate choice that must survive it. Writing today's
default into every existing row would erase that distinction on the day of the
deployment and freeze a value nobody typed.

The column that made this necessary was measured, not guessed: a small local
reasoning model on a LAN box returned a usable French commentary at 34,7 s
against a 30 s ceiling with no retry — a working model that degraded to "le
modèle a répondu trop tard" on every question, with no way to say otherwise
short of editing the source.

Revision ID: b7d3f0a91c48
Revises: e2c9a4d1f730
"""

import sqlalchemy as sa
from alembic import op

revision = "b7d3f0a91c48"
down_revision = "e2c9a4d1f730"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("llm_settings", sa.Column("timeout_seconds", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("llm_settings", "timeout_seconds")
