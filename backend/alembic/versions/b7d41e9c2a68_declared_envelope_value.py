"""A value the household declares for an envelope, beside its positions.

An assurance-vie holding a fonds euros, a PER, an unlisted contract: there is a
real amount in there and no quoted instrument to hang it on. Until now the only
way into `InvestmentAccount` was a `Position`, which needs an `Instrument`, so
the amount could not be declared at all.

Two columns rather than one. A declared figure is only as good as the day it was
read off a statement, and one without a date silently rots into a claim about
today. `declared_value_on` is what lets the screen say how old it is.

Revision ID: b7d41e9c2a68
Revises: a93be2c05f18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7d41e9c2a68"
down_revision: str | Sequence[str] | None = "a93be2c05f18"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "investment_accounts",
        sa.Column("declared_value_cents", sa.Integer(), nullable=True),
    )
    op.add_column(
        "investment_accounts",
        sa.Column("declared_value_on", sa.Date(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("investment_accounts", "declared_value_on")
    op.drop_column("investment_accounts", "declared_value_cents")
