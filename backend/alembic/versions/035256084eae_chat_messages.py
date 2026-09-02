"""chat messages

Revision ID: 035256084eae
Revises: bf18816b285c
Create Date: 2026-09-03 09:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '035256084eae'
down_revision: Union[str, Sequence[str], None] = 'bf18816b285c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    One new table, no backfill: nothing in an existing database can be turned
    into a chat question. `text` holds the question only, never the computed
    answer -- see `models.ChatMessage`'s own docstring.
    """
    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_chat_messages_user_id"), "chat_messages", ["user_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_chat_messages_user_id"), table_name="chat_messages")
    op.drop_table("chat_messages")
