"""the Boulanger rule stops filing bakeries as high-tech

The built-in library matched "boulanger" -- the electronics retailer -- as a
fragment of the label, so every « boulangerie » was booked under
« Équipement et high-tech ». New accounts get the corrected library from
`categorization/seed.py`; this brings the accounts that already exist to the
same place: the retailer's rule becomes a whole word, bakeries and pastry
shops get built-in rules of their own under Courses, and the bread the old
rule filed -- by the built-in rule, never by hand -- moves there.

Revision ID: d7f9a1c3e5b7
Revises: c5e7a9b1d3f5
Create Date: 2026-10-01 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd7f9a1c3e5b7'
down_revision: Union[str, Sequence[str], None] = 'c5e7a9b1d3f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD_PATTERN = "boulanger"
NEW_PATTERN = r"\bboulanger\b"
BAKERY_PATTERNS = ("boulangerie", "patisserie")
# What the old fragment caught that the whole word no longer does.
BREAD = "%boulangerie%"


def _category_ids(bind, slug: str) -> dict[int, int]:
    """Each household's own category for `slug`: user id -> category id."""
    rows = bind.execute(sa.text("SELECT user_id, id FROM categories WHERE slug = :slug"),
                        {"slug": slug})
    return {user_id: category_id for user_id, category_id in rows}


def _move_bread(bind, source_slug: str, target_slug: str) -> None:
    """Re-file the bread a built-in rule put in `source_slug`, household by household."""
    sources = _category_ids(bind, source_slug)
    targets = _category_ids(bind, target_slug)
    for user_id, source_id in sources.items():
        if user_id not in targets:
            continue
        bind.execute(sa.text(
            "UPDATE transactions SET category_id = :target "
            "WHERE user_id = :user_id AND category_id = :source "
            "AND category_source = 'builtin' AND label_clean LIKE :bread"),
            {"target": targets[user_id], "source": source_id, "user_id": user_id, "bread": BREAD})


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text(
        "UPDATE category_rules SET pattern = :new, is_regex = 1 "
        "WHERE origin = 'builtin' AND pattern = :old AND is_regex = 0 "
        "AND NOT EXISTS (SELECT 1 FROM category_rules AS other "
        "WHERE other.user_id = category_rules.user_id AND other.pattern = :new "
        "AND other.category_id = category_rules.category_id)"),
        {"new": NEW_PATTERN, "old": OLD_PATTERN})

    for user_id, category_id in _category_ids(bind, "alimentation-courses").items():
        for pattern in BAKERY_PATTERNS:
            bind.execute(sa.text(
                "INSERT INTO category_rules (user_id, pattern, is_regex, category_id, priority, "
                "origin, direction, hit_count, created_at) "
                "SELECT :user_id, :pattern, 0, :category_id, 100, 'builtin', 'debit', 0, "
                "CURRENT_TIMESTAMP "
                "WHERE NOT EXISTS (SELECT 1 FROM category_rules WHERE user_id = :user_id "
                "AND pattern = :pattern AND category_id = :category_id)"),
                {"user_id": user_id, "pattern": pattern, "category_id": category_id})

    _move_bread(bind, "achats-equipement", "alimentation-courses")


def downgrade() -> None:
    bind = op.get_bind()
    _move_bread(bind, "alimentation-courses", "achats-equipement")

    for user_id, category_id in _category_ids(bind, "alimentation-courses").items():
        for pattern in BAKERY_PATTERNS:
            bind.execute(sa.text(
                "DELETE FROM category_rules WHERE user_id = :user_id AND pattern = :pattern "
                "AND category_id = :category_id AND origin = 'builtin' AND is_regex = 0"),
                {"user_id": user_id, "pattern": pattern, "category_id": category_id})

    bind.execute(sa.text(
        "UPDATE category_rules SET pattern = :old, is_regex = 0 "
        "WHERE origin = 'builtin' AND pattern = :new AND is_regex = 1"),
        {"new": NEW_PATTERN, "old": OLD_PATTERN})
