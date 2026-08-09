import logging
import re
from dataclasses import dataclass

from app.models.rule import CategoryRule

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CompiledRule:
    rule_id: int | None
    category_id: int
    origin: str
    priority: int
    direction: str
    matcher: re.Pattern[str]
    weight: int


@dataclass(frozen=True)
class RuleMatch:
    category_id: int
    source: str
    rule_id: int | None


def compile_rules(rules: list[CategoryRule]) -> list[CompiledRule]:
    """Compile rules once, ordered so the first match is the right one.

    Sort key: priority descending, then pattern length descending — a longer
    pattern is more specific, so "carrefour station" must be tried before
    "carrefour". An invalid regex is dropped with a warning rather than
    breaking every import that follows.
    """
    compiled: list[CompiledRule] = []
    for rule in rules:
        try:
            pattern = rule.pattern if rule.is_regex else re.escape(rule.pattern)
            matcher = re.compile(pattern, re.IGNORECASE)
        except re.error:
            logger.warning("Skipping rule %s: invalid regex %r", rule.id, rule.pattern)
            continue
        compiled.append(CompiledRule(
            rule_id=rule.id,
            category_id=rule.category_id,
            origin=rule.origin,
            priority=rule.priority,
            direction=rule.direction,
            matcher=matcher,
            weight=len(rule.pattern),
        ))
    compiled.sort(key=lambda r: (r.priority, r.weight), reverse=True)
    return compiled


def classify(
    label_clean: str, amount_cents: int, compiled: list[CompiledRule]
) -> RuleMatch | None:
    """First matching rule wins. Returns None when nothing matches."""
    for rule in compiled:
        if rule.direction == "credit" and amount_cents <= 0:
            continue
        if rule.direction == "debit" and amount_cents >= 0:
            continue
        if rule.matcher.search(label_clean):
            return RuleMatch(category_id=rule.category_id, source=rule.origin,
                             rule_id=rule.rule_id)
    return None
