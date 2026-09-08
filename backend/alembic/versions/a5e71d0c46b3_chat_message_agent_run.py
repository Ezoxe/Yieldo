"""Le lien entre une question du chat et le run du modèle qui y a répondu.

Ajoute `chat_messages.agent_run_id`, nullable et `ON DELETE SET NULL` : une
question posée avant cette version n'a pas de run, et une question dont le run
serait supprimé reste une question. Voir `models/chat_message.py` pour la
raison pour laquelle c'est la seule chose qui n'est pas recalculée à la
lecture.

Revision ID: a5e71d0c46b3
Revises: d3f5a71c9b40
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a5e71d0c46b3"
down_revision: str | Sequence[str] | None = "d3f5a71c9b40"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # `batch_alter_table` : SQLite ne sait pas ajouter une contrainte de clé
    # étrangère à une table existante, et c'est le moteur de développement de
    # cette application autant que PostgreSQL est celui du déploiement.
    with op.batch_alter_table("chat_messages") as batch:
        batch.add_column(sa.Column("agent_run_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_chat_messages_agent_run_id",
            "agent_runs",
            ["agent_run_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index(
        "ix_chat_messages_agent_run_id", "chat_messages", ["agent_run_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_chat_messages_agent_run_id", table_name="chat_messages")
    with op.batch_alter_table("chat_messages") as batch:
        batch.drop_constraint("fk_chat_messages_agent_run_id", type_="foreignkey")
        batch.drop_column("agent_run_id")
