"""a session version on every user

Revision ID: a3c5e7f9b1d2
Revises: e9f0a1b2c3d4
Create Date: 2026-09-26 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a3c5e7f9b1d2'
down_revision: Union[str, Sequence[str], None] = 'e9f0a1b2c3d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Zero for every existing user: the tokens already in their browsers
    carry no version and read as zero, so nobody is signed out by the upgrade.

    A plain `ALTER TABLE ... ADD COLUMN`, NEVER `batch_alter_table`: batch mode
    rebuilds the table, and dropping the old `users` with foreign keys enforced
    (`app/db.py` turns them on for every connection, this one included)
    cascades into every table that belongs to a user -- the whole ledger.
    SQLite adds a NOT NULL column in place as long as it has a constant default.
    """
    op.add_column("users", sa.Column(
        "session_version", sa.Integer(), server_default=sa.text("0"), nullable=False))


def downgrade() -> None:
    # Native DROP COLUMN (SQLite 3.35+), for the same reason: no table rebuild.
    op.drop_column("users", "session_version")
