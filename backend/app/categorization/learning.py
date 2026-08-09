from sqlalchemy.orm import Session

from app.categorization.engine import compile_rules
from app.models import Transaction
from app.models.rule import CategoryRule

# Words that appear on nearly every French bank line: on their own they identify
# nothing, so a rule built from them would mislabel unrelated transactions.
STOPWORDS = frozenset({
    "cb", "carte", "paiement", "achat", "vir", "virement", "prlv", "prelevement",
    "sepa", "retrait", "dab", "facture", "web", "internet", "france", "fr",
    "sarl", "sas", "eurl", "sa", "ste", "societe", "de", "des", "le",
    "la", "les", "et", "au", "aux", "chez", "pour", "par", "sur", "com",
})

_MAX_PATTERN_WORDS = 4
_MIN_PATTERN_LENGTH = 3
_LEARNED_PRIORITY = 200


def extract_pattern(label_clean: str) -> str | None:
    """Reduce a normalized label to a reusable merchant core.

    Returns None when nothing specific enough survives — a rule made of generic
    payment words would match unrelated transactions, so refusing is the right
    outcome, not a fallback.
    """
    words = [w for w in (label_clean or "").split() if w not in STOPWORDS and not w.isdigit()]
    if not words:
        return None
    core = " ".join(words[:_MAX_PATTERN_WORDS])
    if len(core) < _MIN_PATTERN_LENGTH:
        return None
    return core


def learn_from_correction(
    db: Session, user_id: int, transaction: Transaction, category_id: int
) -> CategoryRule | None:
    """Turn a manual recategorization into a rule that will apply to future imports."""
    pattern = extract_pattern(transaction.label_clean)
    if pattern is None:
        return None

    direction = "credit" if transaction.amount_cents > 0 else "debit"
    rule = (
        db.query(CategoryRule)
        .filter(
            CategoryRule.user_id == user_id,
            CategoryRule.pattern == pattern,
            CategoryRule.origin == "learned",
        )
        .first()
    )

    if rule is None:
        rule = CategoryRule(
            user_id=user_id, pattern=pattern, is_regex=False, category_id=category_id,
            priority=_LEARNED_PRIORITY, origin="learned", direction=direction, hit_count=1,
        )
        db.add(rule)
    else:
        rule.category_id = category_id
        rule.direction = direction
        rule.hit_count += 1

    db.commit()
    db.refresh(rule)
    return rule


def apply_learned_rule(
    db: Session, user_id: int, rule: CategoryRule, only_uncategorized: bool = True
) -> int:
    """Backfill existing transactions with a freshly learned rule.

    Manual assignments are never overwritten: the user's explicit choice outranks
    anything inferred.
    """
    compiled = compile_rules([rule])
    if not compiled:
        return 0

    query = db.query(Transaction).filter(Transaction.user_id == user_id)
    if only_uncategorized:
        query = query.filter(
            Transaction.category_source.in_(("uncategorized", "builtin", "rule", "csv"))
        )
    else:
        query = query.filter(Transaction.category_source != "manual")

    updated = 0
    for transaction in query.all():
        if transaction.category_id == rule.category_id:
            continue
        compiled_rule = compiled[0]
        if compiled_rule.direction == "credit" and transaction.amount_cents <= 0:
            continue
        if compiled_rule.direction == "debit" and transaction.amount_cents >= 0:
            continue
        if compiled_rule.matcher.search(transaction.label_clean):
            transaction.category_id = rule.category_id
            transaction.category_source = "learned"
            updated += 1

    db.commit()
    return updated
