"""goal backed by an account

Revision ID: e4a7c1d9b2f6
Revises: d8f3b2c7e5a1
Create Date: 2026-09-13 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e4a7c1d9b2f6'
down_revision: Union[str, Sequence[str], None] = 'd8f3b2c7e5a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """One nullable column, no backfill: every existing goal stays declared,
    which is what it was. SQLite cannot add a foreign key or a unique
    constraint in place, so the table is rebuilt through batch mode, and
    the unique on `(user_id, account_id)` lets any number of NULLs through --
    SQL's own rule, which is exactly the one wanted here."""
    with op.batch_alter_table("goals") as batch:
        batch.add_column(sa.Column("account_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_goals_account_id_accounts", "accounts", ["account_id"], ["id"],
            ondelete="SET NULL",
        )
        batch.create_unique_constraint("uq_goal_user_account", ["user_id", "account_id"])


def downgrade() -> None:
    with op.batch_alter_table("goals") as batch:
        batch.drop_constraint("uq_goal_user_account", type_="unique")
        batch.drop_constraint("fk_goals_account_id_accounts", type_="foreignkey")
        batch.drop_column("account_id")
