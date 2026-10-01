"""the built-in rules read brands as words, and file water, marketplaces and car policies where they belong

The built-in library matched its patterns as fragments of the label, so a
brand hidden in a common word filed that word: « décoration » as groceries
(cora), « espresso » as fuel (esso), « paiement » as a salary (paie), a
transfer from an Amélie as a health refund (ameli). It also put water under
Énergie, every Amazon parcel under Cadeaux, and a mutual's car policy under
the house's insurance, and it did not know the Freebox's own label.

New accounts get the corrected library from `categorization/seed.py`. Each
existing account holds its own copy, so this brings that copy to the same
place -- the brands become whole words, water moves to Charges, the
marketplaces to the Achats family, the car policies and the Freebox get rules
of their own -- and then re-files what the old rules decided and the new ones
decide differently. Only that: a line filed by hand, or by the household's own
rule, or whose filing no longer matches what the old rules said, stays where
it is.

Revision ID: e8a0c2d4f6b8
Revises: d7f9a1c3e5b7
Create Date: 2026-10-01 00:00:01.000000

"""
import re
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e8a0c2d4f6b8'
down_revision: Union[str, Sequence[str], None] = 'd7f9a1c3e5b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _word(brand: str) -> str:
    return rf"\b{brand}\b"


# (old pattern, old category slug, new pattern, new is_regex, new category slug)
REWRITES: tuple[tuple[str, str, str, bool, str], ...] = (
    ("cora", "alimentation-courses", _word("cora"), True, "alimentation-courses"),
    ("spar", "alimentation-courses", _word("spar"), True, "alimentation-courses"),
    ("netto", "alimentation-courses", _word("netto"), True, "alimentation-courses"),
    ("match", "alimentation-courses", _word("match"), True, "alimentation-courses"),
    ("esso", "transport-carburant", _word("esso"), True, "transport-carburant"),
    ("shell", "transport-carburant", _word("shell"), True, "transport-carburant"),
    ("avia", "transport-carburant", _word("avia"), True, "transport-carburant"),
    ("syndic", "logement-charges", _word("syndic"), True, "logement-charges"),
    ("orange", "logement-internet", _word("orange"), True, "logement-internet"),
    ("canal", "abonnements-streaming", _word("canal"), True, "abonnements-streaming"),
    ("on air", "abonnements-salle", _word("on air"), True, "abonnements-salle"),
    ("h m", "achats-vetements", _word("h m"), True, "achats-vetements"),
    ("paie", "revenus-salaire", _word("paie"), True, "revenus-salaire"),
    ("apl", "revenus-allocations", _word("apl"), True, "revenus-allocations"),
    ("ameli", "revenus-remboursements", _word("ameli"), True, "revenus-remboursements"),
    ("secu", "revenus-remboursements", _word("secu"), True, "revenus-remboursements"),
    ("veolia", "logement-energie", "veolia", False, "logement-charges"),
    ("suez", "logement-energie", "suez", False, "logement-charges"),
    ("saur", "logement-energie", _word("saur"), True, "logement-charges"),
    ("amazon", "achats-cadeaux", "amazon", False, "achats"),
    ("aliexpress", "achats-cadeaux", "aliexpress", False, "achats"),
    ("temu", "achats-cadeaux", "temu", False, "achats"),
)

# (pattern, category slug, direction) -- built-in rules the old library lacked.
ADDITIONS: tuple[tuple[str, str, str], ...] = (
    ("free telecom", "logement-internet", "debit"),
    ("eau de paris", "logement-charges", "debit"),
    ("macif auto", "transport-assurance", "debit"),
    ("maif auto", "transport-assurance", "debit"),
    ("matmut auto", "transport-assurance", "debit"),
    ("gmf auto", "transport-assurance", "debit"),
)


def _compile(rules: list[dict]) -> list[tuple[dict, re.Pattern[str]]]:
    """The engine's own reading, frozen here: priority first, then the longer
    pattern, the first match wins; an invalid regex is skipped."""
    compiled = []
    for rule in rules:
        source = rule["pattern"] if rule["is_regex"] else re.escape(rule["pattern"])
        try:
            compiled.append((rule, re.compile(source, re.IGNORECASE)))
        except re.error:
            continue
    compiled.sort(key=lambda item: (item[0]["priority"], len(item[0]["pattern"])), reverse=True)
    return compiled


def _classify(label: str, amount: int, compiled) -> tuple[int, str] | None:
    for rule, matcher in compiled:
        if rule["direction"] == "credit" and amount <= 0:
            continue
        if rule["direction"] == "debit" and amount >= 0:
            continue
        if matcher.search(label):
            return rule["category_id"], rule["origin"]
    return None


def _rules(bind, user_id: int) -> list[dict]:
    rows = bind.execute(sa.text(
        "SELECT pattern, is_regex, category_id, priority, origin, direction "
        "FROM category_rules WHERE user_id = :user_id ORDER BY id"), {"user_id": user_id})
    return [dict(row._mapping) for row in rows]


def _categories(bind, user_id: int) -> dict[str, int]:
    rows = bind.execute(sa.text("SELECT slug, id FROM categories WHERE user_id = :user_id"),
                        {"user_id": user_id})
    return {slug: category_id for slug, category_id in rows}


def _rewrite(bind, user_id: int, categories: dict[str, int], *, forward: bool) -> None:
    for old_pattern, old_slug, new_pattern, new_regex, new_slug in REWRITES:
        if old_slug not in categories or new_slug not in categories:
            continue
        frm = (old_pattern, False, categories[old_slug])
        to = (new_pattern, new_regex, categories[new_slug])
        if not forward:
            frm, to = to, frm
        bind.execute(sa.text(
            "UPDATE category_rules SET pattern = :to_pattern, is_regex = :to_regex, "
            "category_id = :to_category "
            "WHERE user_id = :user_id AND origin = 'builtin' AND pattern = :from_pattern "
            "AND is_regex = :from_regex AND category_id = :from_category "
            "AND NOT EXISTS (SELECT 1 FROM category_rules AS other "
            "WHERE other.user_id = :user_id AND other.pattern = :to_pattern "
            "AND other.category_id = :to_category)"),
            {"user_id": user_id,
             "from_pattern": frm[0], "from_regex": frm[1], "from_category": frm[2],
             "to_pattern": to[0], "to_regex": to[1], "to_category": to[2]})


def _add(bind, user_id: int, categories: dict[str, int]) -> None:
    for pattern, slug, direction in ADDITIONS:
        if slug not in categories:
            continue
        bind.execute(sa.text(
            "INSERT INTO category_rules (user_id, pattern, is_regex, category_id, priority, "
            "origin, direction, hit_count, created_at) "
            "SELECT :user_id, :pattern, 0, :category_id, 100, 'builtin', :direction, 0, "
            "CURRENT_TIMESTAMP "
            "WHERE NOT EXISTS (SELECT 1 FROM category_rules WHERE user_id = :user_id "
            "AND pattern = :pattern AND category_id = :category_id)"),
            {"user_id": user_id, "pattern": pattern, "category_id": categories[slug],
             "direction": direction})


def _remove(bind, user_id: int, categories: dict[str, int]) -> None:
    for pattern, slug, _direction in ADDITIONS:
        if slug not in categories:
            continue
        bind.execute(sa.text(
            "DELETE FROM category_rules WHERE user_id = :user_id AND pattern = :pattern "
            "AND category_id = :category_id AND origin = 'builtin' AND is_regex = 0"),
            {"user_id": user_id, "pattern": pattern, "category_id": categories[slug]})


def _refile(bind, user_id: int, before: list[dict], after: list[dict]) -> None:
    """Move every line the `before` rules decided -- filed by a built-in rule,
    or left unfiled -- to what the `after` rules decide, when that differs. A
    line whose filing no longer matches the `before` decision was decided by
    someone else since, and stays where it is."""
    old_rules, new_rules = _compile(before), _compile(after)
    rows = bind.execute(sa.text(
        "SELECT id, label_clean, amount_cents, category_id, category_source FROM transactions "
        "WHERE user_id = :user_id AND category_source IN ('builtin', 'uncategorized')"),
        {"user_id": user_id}).all()
    for row_id, label, amount, category_id, source in rows:
        old = _classify(label, amount, old_rules)
        new = _classify(label, amount, new_rules)
        if old == new:
            continue
        current = None if source == "uncategorized" else (category_id, source)
        if current != old:
            continue
        category, origin = (None, "uncategorized") if new is None else new
        bind.execute(sa.text(
            "UPDATE transactions SET category_id = :category_id, category_source = :source "
            "WHERE id = :id"),
            {"category_id": category, "source": origin, "id": row_id})


def _users(bind) -> list[int]:
    return [user_id for (user_id,) in bind.execute(sa.text("SELECT id FROM users"))]


def upgrade() -> None:
    bind = op.get_bind()
    for user_id in _users(bind):
        categories = _categories(bind, user_id)
        before = _rules(bind, user_id)
        _rewrite(bind, user_id, categories, forward=True)
        _add(bind, user_id, categories)
        _refile(bind, user_id, before, _rules(bind, user_id))


def downgrade() -> None:
    bind = op.get_bind()
    for user_id in _users(bind):
        categories = _categories(bind, user_id)
        before = _rules(bind, user_id)
        _rewrite(bind, user_id, categories, forward=False)
        _remove(bind, user_id, categories)
        _refile(bind, user_id, before, _rules(bind, user_id))
