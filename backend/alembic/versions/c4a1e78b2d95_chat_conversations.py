"""chat_messages.conversation_id

Threads, so a household can start a new conversation and find the old ones
again instead of scrolling one endless list.

**Existing rows are backfilled to conversation 1, per user, and that is not a
default standing in for missing data.** Before this migration every question a
household had ever asked WAS one continuous thread — there was no other place
to put one — so numbering them 1 records what actually happened rather than
inventing a grouping nobody made. A household's numbering starts at 1 and is
scoped to that household: the ids it sees never reveal how many other accounts
exist.

The column is NOT NULL because every message belongs to a thread. There is no
`conversations` table: a conversation is exactly "the messages sharing this
number", and its title, start, end and length are all read from them — see
`models/chat_message.py` for why storing them would be a second copy free to
drift.

Revision ID: c4a1e78b2d95
Revises: b7d3f0a91c48
"""

import sqlalchemy as sa
from alembic import op

revision = "c4a1e78b2d95"
down_revision = "b7d3f0a91c48"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Added nullable, backfilled, then tightened: SQLite cannot add a NOT NULL
    # column without a default, and a server_default here would leave the
    # column carrying a default forever for rows that must always state their
    # own thread.
    op.add_column("chat_messages", sa.Column("conversation_id", sa.Integer(), nullable=True))
    op.execute("UPDATE chat_messages SET conversation_id = 1")
    with op.batch_alter_table("chat_messages") as batch:
        batch.alter_column("conversation_id", existing_type=sa.Integer(), nullable=False)
    op.create_index(
        "ix_chat_messages_conversation_id", "chat_messages", ["conversation_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_chat_messages_conversation_id", table_name="chat_messages")
    op.drop_column("chat_messages", "conversation_id")
