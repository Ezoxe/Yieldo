from sqlalchemy.orm import Session

from app.categorization.engine import compile_rules
from app.models import Transaction
from app.models.rule import RULE_PRIORITIES, CategoryRule
from app.transfers import TransferResolver

# Words that appear on nearly every French bank line: on their own they identify
# nothing, so a rule built from them would mislabel unrelated transactions.
STOPWORDS = frozenset({
    "cb", "carte", "paiement", "achat", "vir", "virement", "prlv", "prelevement",
    "sepa", "retrait", "dab", "facture", "web", "internet", "france", "fr",
    "sarl", "sas", "eurl", "sa", "ste", "societe", "du", "de", "des", "le",
    "la", "les", "et", "au", "aux", "chez", "pour", "par", "sur", "com",
})

_MAX_PATTERN_WORDS = 4
_MIN_PATTERN_LENGTH = 3


def extract_pattern(label_clean: str) -> str | None:
    """Reduce a normalized label to a reusable merchant core.

    Stopwords are trimmed from the EDGES only, never from the middle. compile_rules
    matches a literal pattern with re.escape + search, so the pattern has to stay a
    contiguous substring of the label. Dropping an interior word would turn
    "restaurant de la gare" into "restaurant gare", which no longer matches the very
    transaction the rule was learned from — a rule that silently never fires.

    Returns None when nothing specific enough survives: a rule made of generic
    payment words would match unrelated transactions, so refusing is the right
    outcome, not a fallback.
    """
    words = (label_clean or "").split()
    start, end = 0, len(words)
    while start < end and (words[start] in STOPWORDS or words[start].isdigit()):
        start += 1
    while end > start and (words[end - 1] in STOPWORDS or words[end - 1].isdigit()):
        end -= 1

    core_words = words[start:end]
    if not core_words:
        return None
    # Taking a prefix keeps the result contiguous.
    core = " ".join(core_words[:_MAX_PATTERN_WORDS])
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
            priority=RULE_PRIORITIES["learned"], origin="learned", direction=direction,
            hit_count=1,
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

    A row whose category moves has its transfer flag re-decided, because that
    flag is READ OFF the category (`engines/transfer.is_internal_transfer`). A
    learned rule that files twelve past rows under "Épargne et investissement"
    and leaves all twelve counted as spending would defeat the whole rule by the
    back door -- and it is the one path that changes a category without going
    through `api/transactions.patch_transaction`. A row marked by hand is left
    alone here too: `TransferResolver.apply` returns without touching it.
    """
    compiled = compile_rules([rule])
    if not compiled:
        return 0

    # Read once for the whole backfill: the rule needs this user's category and
    # account tables, and a per-row lookup would query twice per matched line.
    transfers = TransferResolver(db, user_id)

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
            transfers.apply(transaction)
            updated += 1

    db.commit()
    return updated
