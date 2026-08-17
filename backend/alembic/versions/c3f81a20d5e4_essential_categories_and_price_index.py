"""essential categories and price index

Revision ID: c3f81a20d5e4
Revises: a7b67772495a
Create Date: 2026-08-16 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.categorization.seed import ESSENTIAL_SLUGS

revision: str = 'c3f81a20d5e4'
down_revision: Union[str, Sequence[str], None] = 'a7b67772495a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # server_default is required: SQLite cannot add a NOT NULL column without one,
    # and it stays in place afterwards because SQLite cannot drop a default either.
    # Harmless -- the ORM always supplies the value on insert.
    op.add_column(
        "categories",
        sa.Column("is_essential", sa.Boolean(), nullable=False,
                  server_default=sa.false()),
    )
    # An existing user's seeded tree gets the same defaults a new user's does.
    # A user who renamed or deleted a category simply has fewer rows matched;
    # nothing is created here.
    categories = sa.table("categories", sa.column("slug", sa.String),
                          sa.column("is_essential", sa.Boolean))
    op.execute(
        categories.update()
        .where(categories.c.slug.in_(sorted(ESSENTIAL_SLUGS)))
        .values(is_essential=True)
    )

    op.create_table(
        "price_index_points",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("value_hundredths", sa.Integer(), nullable=False),
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "month", name="uq_price_index_user_month"),
    )
    op.create_index(op.f("ix_price_index_points_user_id"), "price_index_points",
                    ["user_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_price_index_points_user_id"), table_name="price_index_points")
    op.drop_table("price_index_points")
    op.drop_column("categories", "is_essential")
