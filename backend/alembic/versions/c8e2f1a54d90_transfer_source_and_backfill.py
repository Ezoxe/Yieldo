"""Who decided `is_transfer`, and the one pass that finally decides it.

`transactions.is_transfer` has been in the schema since the first migration and
every flow engine already excludes it. Nothing ever posed it: not the importer,
not the categorisation, not the `epargne` category's own `kind = "transfer"`.
So a 300 EUR standing order to a livret has been counted as 300 EUR of spending
in every figure this application prints.

Two things happen here.

**A column.** `transfer_source`, `auto` | `manual`, on the model of
`category_source`. It is what lets an automatic rule run again next month
without stepping on a mark the user made by hand.

**A backfill, in three statements and that order.** First every row already
flagged becomes `manual`: at this point in the application's life the only way
a row could be flagged was a human doing it (`PATCH /transactions/{id}`) or the
agent doing it on their behalf, and that decision outranks anything computed
here. Then the two automatic rules, over what is left -- which is, by
construction, exactly the rows still at `is_transfer = 0`, so neither statement
ever has to unset anything.

`downgrade` drops the column and leaves `is_transfer` where the backfill put
it. Restoring the previous values is not possible -- the column being dropped
is the only record of which rows the backfill touched -- and inventing a
reversal that unflags a user's own manual marks would be worse than the honest
one-way door.

Revision ID: c8e2f1a54d90
Revises: b7d41e9c2a68
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.engines.transfer import SAVINGS_ACCOUNT_KINDS

revision: str = "c8e2f1a54d90"
down_revision: str | Sequence[str] | None = "b7d41e9c2a68"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "transactions",
        sa.Column(
            "transfer_source",
            sa.String(length=8),
            nullable=False,
            server_default=sa.text("'auto'"),
        ),
    )

    bind = op.get_bind()

    # 1. The user's own marks, and the agent's acting for them, are kept.
    bind.execute(
        sa.text(
            "UPDATE transactions SET transfer_source = 'manual' WHERE is_transfer = 1"
        )
    )

    # 2. The category rule. A category of kind `transfer` -- `Epargne et
    #    investissement`, `Virement interne`, and every child of either, which
    #    inherits the parent's kind -- settles it.
    bind.execute(
        sa.text(
            "UPDATE transactions SET is_transfer = 1 "
            "WHERE transfer_source = 'auto' AND category_id IS NOT NULL "
            "AND EXISTS (SELECT 1 FROM categories c "
            "WHERE c.id = transactions.category_id AND c.kind = 'transfer')"
        )
    )

    # 3. The account rule, and only where no category spoke. A row on a savings
    #    account that the user explicitly called income (the livret's interest)
    #    or an expense (a PEA's management fee) is a real flow and stays one.
    kinds = ", ".join(f"'{kind}'" for kind in sorted(SAVINGS_ACCOUNT_KINDS))
    bind.execute(
        sa.text(
            "UPDATE transactions SET is_transfer = 1 "
            "WHERE transfer_source = 'auto' AND category_id IS NULL "
            "AND EXISTS (SELECT 1 FROM accounts a "
            f"WHERE a.id = transactions.account_id AND a.kind IN ({kinds}))"
        )
    )


def downgrade() -> None:
    op.drop_column("transactions", "transfer_source")
