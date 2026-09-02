"""French intent parsing for the deterministic chat. Design §8.1.

`parse_intent` turns one line of French into a `ParsedQuery` -- an intent name
plus whatever period, entity, amount and horizon the sentence actually
carried -- or an `UnrecognisedQuery` naming the formulations it does
understand. **An unrecognised intent is a first-class answer, never a guess.**
A parser that maps "combien j'ai dépensé chez Darty" onto "total par
catégorie" -- the nearest thing it knows -- is worse than one that refuses,
because the household reading the answer has no way to tell it apart from a
real one.

Every trigger set below is written to be MUTUALLY EXCLUSIVE by construction --
`total_by_category` explicitly excludes a `chez` clause, so "combien j'ai
dépensé chez Darty" resolves to `transaction_search`, not to a category total
it never asked for. `_match_intent` additionally refuses to guess when more
than one gate fires on the same sentence, as a second line of defence against
a wording nobody anticipated.

**Accents, elisions and French date forms are the input, not an edge case.**
`_normalize` lower-cases and strips diacritics (`été` and `ete` parse
identically) before any pattern is tried, and every regex below tolerates a
missing apostrophe (`l'an dernier` and `lan dernier` both match). The date
forms explicitly required are covered by named parsers: `l'an dernier`,
`en mars`, `en mars 2025`, `depuis janvier`, `le mois dernier`,
`sur les trois derniers mois`, `en 2025`, plus `cette année` and `ce mois`.

Pure: no session, no network, no implicit clock -- `today` is a parameter.
"""

import re
import unicodedata
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from app.engines.aggregate import bucket_bounds, bucket_key
from app.engines.period import month_end

Intent = Literal[
    "total_by_category",
    "period_comparison",
    "recurrence_evolution",
    "subscription_cost",
    "feasibility",
    "savings_simulation",
    "goal_status",
    "transaction_search",
    "patrimoine_projection",
]

INTENTS: tuple[Intent, ...] = (
    "total_by_category", "period_comparison", "recurrence_evolution",
    "subscription_cost", "feasibility", "savings_simulation", "goal_status",
    "transaction_search", "patrimoine_projection",
)

MONTH_NAMES_FR: dict[int, str] = {
    1: "janvier", 2: "février", 3: "mars", 4: "avril", 5: "mai", 6: "juin",
    7: "juillet", 8: "août", 9: "septembre", 10: "octobre", 11: "novembre",
    12: "décembre",
}

# Accent-stripped, matching what `_normalize` produces -- never typed against
# the accented display names above, which is what `_normalize` exists to
# avoid needing twice.
MONTHS: dict[str, int] = {
    "janvier": 1, "fevrier": 2, "mars": 3, "avril": 4, "mai": 5, "juin": 6,
    "juillet": 7, "aout": 8, "septembre": 9, "octobre": 10, "novembre": 11,
    "decembre": 12,
}

NUMBER_WORDS: dict[str, int] = {
    "un": 1, "une": 1, "deux": 2, "trois": 3, "quatre": 4, "cinq": 5,
    "six": 6, "sept": 7, "huit": 8, "neuf": 9, "dix": 10, "onze": 11,
    "douze": 12,
}

# One example phrasing per supported intent, spelled correctly in French, so
# an unrecognised question comes back with something the reader can actually
# try next -- the whole point of refusing rather than guessing.
SUPPORTED_FORMULATIONS: tuple[str, ...] = (
    "Combien j'ai dépensé en restaurant en mars ?",
    "Quelle est ma moyenne mensuelle de dépenses depuis janvier ?",
    "Ai-je dépensé plus ce mois-ci que le mois dernier ?",
    "Est-ce que mon abonnement Netflix a augmenté ?",
    "Combien me coûtent mes abonnements ?",
    "Puis-je m'acheter une voiture à 20 000 € dans 12 mois ?",
    "Si j'épargne 200 € par mois pendant 24 mois, combien aurai-je ?",
    "Où en est mon objectif Vacances ?",
    "Montre-moi mes achats chez Darty en mars.",
    "Quelle sera la valeur de mon patrimoine dans 5 ans ?",
)


@dataclass(frozen=True)
class ParsedPeriod:
    start: date
    end: date
    # Short French description of what was understood, e.g. "mars 2025",
    # "le mois dernier (août 2026)", "l'année 2024". Never the raw phrase
    # the user typed -- this is what the answer actually rests on, and it
    # must be checkable on its own, per design §8.1.
    label: str


@dataclass(frozen=True)
class ParsedQuery:
    intent: Intent
    raw_text: str
    period: ParsedPeriod | None = None
    # Set only for `period_comparison`: the second period being weighed
    # against `period`.
    compare_period: ParsedPeriod | None = None
    # `total_by_category`: the category name as typed (accent-stripped,
    # capitalised). None means "every category".
    category_hint: str | None = None
    # `recurrence_evolution`, `goal_status`, `transaction_search`: a merchant,
    # subscription or goal name. None means "no filter" / "every goal".
    entity: str | None = None
    # `total_by_category`: "total" or "average". Never None on that intent.
    mode: str | None = None
    # `feasibility`: target price. `savings_simulation`: monthly contribution.
    amount_cents: int | None = None
    # Whole months, only when the sentence stated one explicitly. Never
    # defaulted here -- defaulting is `engines/answer.py`'s job, so it can be
    # named as an assumption rather than silently baked into the parse.
    horizon_months: int | None = None
    # `feasibility` only: "vehicle", "property" or "other".
    nature: str | None = None


@dataclass(frozen=True)
class UnrecognisedQuery:
    raw_text: str
    message: str
    supported_formulations: tuple[str, ...] = SUPPORTED_FORMULATIONS


def _normalize(text: str) -> str:
    text = text.replace("’", "'").replace("‘", "'")
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", stripped.lower()).strip()


def _capitalize(text: str) -> str:
    text = text.strip()
    return text[:1].upper() + text[1:] if text else text


# --------------------------------------------------------------------------
# Amounts and horizons.
# --------------------------------------------------------------------------

_AMOUNT_RE = re.compile(
    r"(\d[\d  ]*(?:,\d{1,2})?)\s*(?:€|eur\b|euros?\b)"
)

_HORIZON_RE = re.compile(
    r"\b(?:dans|sur|d'?ici|pendant|en)\s+(\d+)\s*(mois|ans?|annees?)\b"
)


def _parse_amount(text: str) -> int | None:
    match = _AMOUNT_RE.search(text)
    if match is None:
        return None
    cleaned = match.group(1).replace(" ", "").replace(" ", "").replace(",", ".")
    value = Decimal(cleaned)
    return int((value * 100).to_integral_value(rounding=ROUND_HALF_UP))


def _parse_horizon_months(text: str) -> int | None:
    match = _HORIZON_RE.search(text)
    if match is None:
        return None
    count = int(match.group(1))
    unit = match.group(2)
    return count if unit.startswith("mois") else count * 12


# --------------------------------------------------------------------------
# Periods.
# --------------------------------------------------------------------------


def _month_bounds(year: int, month: int) -> tuple[date, date]:
    return bucket_bounds(f"{year}-{month:02d}", "month")


def _year_bounds(year: int) -> tuple[date, date]:
    return bucket_bounds(str(year), "year")


def _offset_month_bounds(anchor: date, offset: int) -> tuple[date, date]:
    """The full calendar month `offset` months from `anchor`'s -- the same
    `month_end` + `bucket_key`/`bucket_bounds` idiom `api/engagement.py`'s
    `_month_bounds_around` already uses, so a month edge is never bucketed
    differently in two places."""
    end = month_end(anchor, offset)
    return bucket_bounds(bucket_key(end, "month"), "month")


_MONTH_NAME_RE = "|".join(sorted(MONTHS, key=len, reverse=True))

# Ordered most-specific first: a month-with-year phrase must be tried before
# the bare-month one, or the year would be left dangling as unmatched text.
_PERIOD_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("month_year", re.compile(rf"\ben ({_MONTH_NAME_RE}) (\d{{4}})\b")),
    ("since_month_year", re.compile(rf"\bdepuis ({_MONTH_NAME_RE}) (\d{{4}})\b")),
    ("since_month", re.compile(rf"\bdepuis ({_MONTH_NAME_RE})\b")),
    ("last_n_months_word", re.compile(
        r"\bsur les (" + "|".join(NUMBER_WORDS) + r") derniers? mois\b")),
    ("last_n_months_digit", re.compile(r"\bsur les (\d+) derniers? mois\b")),
    ("last_month", re.compile(r"\b(?:le )?mois derni(?:er|ers)\b")),
    ("last_year", re.compile(r"\bl'?(?:an|annee) derni(?:ere|eres|er)\b")),
    ("month", re.compile(rf"\ben ({_MONTH_NAME_RE})\b")),
    ("year", re.compile(r"\ben (\d{4})\b")),
    ("this_year", re.compile(r"\bcette ann(?:ee)\b")),
    ("this_month", re.compile(r"\bce mois(?:-ci|ci)?\b")),
    # No "en"/"depuis" preposition -- for a bare "mars et avril 2025" inside a
    # comparison sentence. Lowest priority: an "en"/"depuis" form at the same
    # position is always tried first (see `_PERIOD_PATTERNS` ordering above),
    # since both start earlier in the sentence.
    ("bare_month_year", re.compile(rf"\b({_MONTH_NAME_RE}) (\d{{4}})\b")),
    ("bare_month", re.compile(rf"\b({_MONTH_NAME_RE})\b")),
]


def _find_period(
    text: str, today: date, *, start_at: int = 0
) -> tuple[ParsedPeriod, int, int] | None:
    """The first period phrase found in `text` from `start_at` onward, as
    `(period, span_start, span_end)`, or None. Tried in `_PERIOD_PATTERNS`
    order, but positioned by where each pattern actually matches in the
    text, so a second call with `start_at` past a first match's span finds a
    genuinely later phrase rather than re-finding the same one."""
    best: tuple[int, ParsedPeriod, int, int] | None = None
    for kind, pattern in _PERIOD_PATTERNS:
        match = pattern.search(text, start_at)
        if match is None:
            continue
        if best is not None and match.start() >= best[0]:
            continue
        period = _build_period(kind, match, today)
        best = (match.start(), period, match.start(), match.end())
    if best is None:
        return None
    _, period, span_start, span_end = best
    return period, span_start, span_end


def _build_period(kind: str, match: re.Match, today: date) -> ParsedPeriod:
    if kind == "month_year":
        month, year = MONTHS[match.group(1)], int(match.group(2))
        start, end = _month_bounds(year, month)
        return ParsedPeriod(start, end, f"{MONTH_NAMES_FR[month]} {year}")
    if kind in ("since_month_year", "since_month"):
        month = MONTHS[match.group(1)]
        year = int(match.group(2)) if kind == "since_month_year" else today.year
        start, _ = _month_bounds(year, month)
        return ParsedPeriod(
            start, today, f"depuis {MONTH_NAMES_FR[month]} {year} (jusqu'à aujourd'hui)"
        )
    if kind in ("last_n_months_word", "last_n_months_digit"):
        raw = match.group(1)
        count = NUMBER_WORDS[raw] if kind == "last_n_months_word" else int(raw)
        if count < 1:
            count = 1
        start, _ = _offset_month_bounds(today, -(count - 1))
        return ParsedPeriod(
            start, today, f"les {count} derniers mois (jusqu'à aujourd'hui)"
        )
    if kind == "last_month":
        start, end = _offset_month_bounds(today, -1)
        label = f"le mois dernier ({MONTH_NAMES_FR[start.month]} {start.year})"
        return ParsedPeriod(start, end, label)
    if kind == "last_year":
        year = today.year - 1
        start, end = _year_bounds(year)
        return ParsedPeriod(start, end, f"l'année dernière ({year})")
    if kind in ("month", "bare_month"):
        month = MONTHS[match.group(1)]
        start, end = _month_bounds(today.year, month)
        return ParsedPeriod(start, end, f"{MONTH_NAMES_FR[month]} {today.year}")
    if kind == "bare_month_year":
        month, year = MONTHS[match.group(1)], int(match.group(2))
        start, end = _month_bounds(year, month)
        return ParsedPeriod(start, end, f"{MONTH_NAMES_FR[month]} {year}")
    if kind == "year":
        year = int(match.group(1))
        start, end = _year_bounds(year)
        return ParsedPeriod(start, end, f"l'année {year}")
    if kind == "this_year":
        start, end = _year_bounds(today.year)
        return ParsedPeriod(start, end, f"cette année ({today.year})")
    if kind == "this_month":
        start, end = _month_bounds(today.year, today.month)
        return ParsedPeriod(
            start, end, f"ce mois-ci ({MONTH_NAMES_FR[today.month]} {today.year})"
        )
    raise AssertionError(f"Type de période inconnu : {kind}")  # pragma: no cover


def _blank(text: str, span_start: int, span_end: int) -> str:
    """`text` with `[span_start:span_end)` replaced by spaces, so a matched
    period phrase is never re-read as an entity or a second period."""
    return text[:span_start] + " " * (span_end - span_start) + text[span_end:]


# --------------------------------------------------------------------------
# Entities.
# --------------------------------------------------------------------------

_ENTITY_STOP = (
    r"a-t-il|a-t-elle|a t il|a t elle|a augmente|augmente|a change|change|"
    r"a evolue|evolue|coute|coutent|est|a$"
)

_ENTITY_PATTERNS: tuple[re.Pattern, ...] = (
    re.compile(r"\bchez ([a-z0-9][\w\-]*(?:\s+[a-z0-9][\w\-]*)?)"),
    re.compile(r"\babonnement (?:a |à )?([a-z0-9][\w\-]*(?:\s+[a-z0-9][\w\-]*)?)"),
    re.compile(r"\bobjectif ([a-z0-9][\w\-]*(?:\s+[a-z0-9][\w\-]*)?)"),
    # Tried before the generic "de X" below: "en restaurant" is the category,
    # while "de dépenses" is filler that a generic "de X" match would swallow
    # instead -- see `test_total_by_category_average_mode`.
    re.compile(r"\ben ([a-z][\w\-]*(?:\s+[a-z][\w\-]*)?)"),
    re.compile(r"\bpour ([a-z0-9][\w\-]*(?:\s+[a-z0-9][\w\-]*)?)"),
    re.compile(r"\bde (?:mon |ma |mes )?([a-z0-9][\w\-]*(?:\s+[a-z0-9][\w\-]*)?)"),
)


def _clean_capture(raw: str) -> str | None:
    words = raw.split()
    cleaned: list[str] = []
    for word in words:
        if re.fullmatch(_ENTITY_STOP, word):
            break
        cleaned.append(word)
    return _capitalize(" ".join(cleaned)) if cleaned else None


def _extract_entity(text: str) -> str | None:
    for pattern in _ENTITY_PATTERNS:
        match = pattern.search(text)
        if match is None:
            continue
        cleaned = _clean_capture(match.group(1))
        if cleaned is not None:
            return cleaned
    return None


# Goal names are extracted with their OWN pattern, never the cascading one
# above: "objectifs" (plural, no name) must answer "every goal" (None), and
# falling through to the generic "en X" pattern here would read the "en" of
# "où EN sont mes objectifs" as a category -- a real bug caught by
# `test_goal_status_with_no_name_means_every_goal`.
_GOAL_ENTITY_RE = re.compile(r"\bobjectif ([a-z0-9][\w\-]*(?:\s+[a-z0-9][\w\-]*)?)")


def _extract_goal_entity(text: str) -> str | None:
    match = _GOAL_ENTITY_RE.search(text)
    return None if match is None else _clean_capture(match.group(1))


# --------------------------------------------------------------------------
# Intent gates. Each predicate runs on the normalized, un-blanked text.
# --------------------------------------------------------------------------

_COMPARISON_REGEXES = (
    re.compile(r"\bplus\b.{0,30}\bque\b"),
    re.compile(r"\bmoins\b.{0,30}\bque\b"),
)
_COMPARISON_MARKERS = ("par rapport a", "compare", "comparaison", " vs ", "versus")
_RECURRENCE_MARKERS = ("augmente", "augmentation", "evolue", "evolution",
                       "change de prix", "prix a change", "hausse de prix",
                       "coute plus cher")
_FEASIBILITY_MARKERS = ("puis-je", "puis je", "ai-je les moyens",
                        "ai je les moyens", "je peux m'acheter",
                        "je peux macheter", "je peux m'offrir",
                        "je peux moffrir", "est-ce possible d'acheter",
                        "est ce possible d'acheter")
_SAVINGS_MARKERS = ("si j'epargne", "si j epargne", "si je mets de cote",
                    "si j'economise", "si j economise", "si je place")
_TRANSACTION_MARKERS = ("chez ", "montre-moi", "montre moi", "liste mes",
                        "mes achats", "mes transactions",
                        "quelles sont mes transactions",
                        "quelles sont mes operations")
_TOTAL_MARKERS = ("depense", "depenser", "coute", "coutent", "cout")


def _has_any(text: str, markers: tuple[str, ...]) -> bool:
    return any(marker in text for marker in markers)


def _gate_period_comparison(text: str) -> bool:
    return (_has_any(text, _COMPARISON_MARKERS)
            or any(pattern.search(text) for pattern in _COMPARISON_REGEXES))


def _gate_recurrence_evolution(text: str) -> bool:
    return _has_any(text, _RECURRENCE_MARKERS)


def _gate_subscription_cost(text: str) -> bool:
    return ("abonnement" in text and not _has_any(text, _RECURRENCE_MARKERS)
            and ("combien" in text or "cout" in text or "coute" in text
                 or "coutent" in text or "total" in text))


def _gate_feasibility(text: str) -> bool:
    return _has_any(text, _FEASIBILITY_MARKERS)


def _gate_savings_simulation(text: str) -> bool:
    return _has_any(text, _SAVINGS_MARKERS)


def _gate_goal_status(text: str) -> bool:
    return "objectif" in text and _has_any(
        text, ("ou en est", "ou en sont", "etat", "avancement", "combien",
               "reste", "atteint", "quand", "progression"))


def _gate_patrimoine_projection(text: str) -> bool:
    return "patrimoine" in text and _has_any(
        text, ("combien", "projection", "dans", "evolution", "vaudra",
               "vaut", "aurai", "sera"))


def _gate_transaction_search(text: str) -> bool:
    # A merchant paired with a price-change word ("chez Free a augmenté")
    # is asking about that price, not listing transactions -- recurrence
    # evolution wins the ambiguity, not this gate.
    return _has_any(text, _TRANSACTION_MARKERS) and not _has_any(text, _RECURRENCE_MARKERS)


def _gate_total_by_category(text: str) -> bool:
    if (_gate_transaction_search(text) or _gate_feasibility(text)
            or _gate_savings_simulation(text) or _gate_period_comparison(text)
            or _gate_recurrence_evolution(text)
            or "abonnement" in text or "objectif" in text
            or "patrimoine" in text):
        return False
    has_marker = _has_any(text, _TOTAL_MARKERS) or "moyenne" in text
    has_question = "combien" in text or "moyenne" in text
    return has_marker and has_question


# Order matters only for readability -- gates are written to be mutually
# exclusive, and `_match_intent` refuses on any genuine overlap regardless of
# order (see the module docstring).
_GATES: tuple[tuple[Intent, "callable"], ...] = (
    ("period_comparison", _gate_period_comparison),
    ("recurrence_evolution", _gate_recurrence_evolution),
    ("subscription_cost", _gate_subscription_cost),
    ("feasibility", _gate_feasibility),
    ("savings_simulation", _gate_savings_simulation),
    ("goal_status", _gate_goal_status),
    ("patrimoine_projection", _gate_patrimoine_projection),
    ("transaction_search", _gate_transaction_search),
    ("total_by_category", _gate_total_by_category),
)


def _match_intent(text: str) -> Intent | None:
    matches = [intent for intent, gate in _GATES if gate(text)]
    if len(matches) != 1:
        return None
    return matches[0]


# --------------------------------------------------------------------------
# Per-intent builders. Each returns a `ParsedQuery`, or None when a slot the
# intent cannot answer without is missing -- which `parse_intent` treats
# exactly like no gate having matched at all: a guessed amount or a guessed
# entity is the fabricated answer this module exists to refuse.
# --------------------------------------------------------------------------

_NATURE_MARKERS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("vehicle", ("voiture", "vehicule", "moto", "camion")),
    ("property", ("maison", "appartement", "bien immobilier", "immobilier")),
)


def _detect_nature(text: str) -> str:
    for nature, markers in _NATURE_MARKERS:
        if _has_any(text, markers):
            return nature
    return "other"


def _build_total_by_category(raw_text: str, normalized: str, today: date) -> ParsedQuery | None:
    period = None
    blanked = normalized
    found = _find_period(blanked, today)
    if found is not None:
        period, span_start, span_end = found
        blanked = _blank(blanked, span_start, span_end)
    mode = "average" if "moyenne" in normalized else "total"
    return ParsedQuery(
        intent="total_by_category", raw_text=raw_text, period=period,
        category_hint=_extract_entity(blanked), mode=mode,
    )


def _build_period_comparison(raw_text: str, normalized: str, today: date) -> ParsedQuery | None:
    found_1 = _find_period(normalized, today)
    if found_1 is not None:
        period_a, s1, e1 = found_1
        remainder = _blank(normalized, s1, e1)
        found_2 = _find_period(remainder, today)
        if found_2 is not None:
            period_b, _, _ = found_2
            return ParsedQuery(intent="period_comparison", raw_text=raw_text,
                               period=period_a, compare_period=period_b)
        # Exactly one explicit period: read it as the comparison baseline,
        # and default the primary side to its current equivalent -- "plus
        # que le mois dernier" is asking about THIS month, even though only
        # last month was ever named.
        if "mois" in period_a.label:
            primary_start, primary_end = _month_bounds(today.year, today.month)
            primary = ParsedPeriod(
                primary_start, primary_end,
                f"ce mois-ci ({MONTH_NAMES_FR[today.month]} {today.year})")
        else:
            primary_start, primary_end = _year_bounds(today.year)
            primary = ParsedPeriod(primary_start, primary_end, f"cette année ({today.year})")
        return ParsedQuery(intent="period_comparison", raw_text=raw_text,
                           period=primary, compare_period=period_a)
    return None


def _build_recurrence_evolution(raw_text: str, normalized: str, today: date) -> ParsedQuery | None:
    blanked = normalized
    found = _find_period(blanked, today)
    if found is not None:
        _, s, e = found
        blanked = _blank(blanked, s, e)
    entity = _extract_entity(blanked)
    if entity is None:
        return None
    return ParsedQuery(intent="recurrence_evolution", raw_text=raw_text, entity=entity)


def _build_feasibility(raw_text: str, normalized: str, today: date) -> ParsedQuery | None:
    amount = _parse_amount(normalized)
    if amount is None or amount <= 0:
        return None
    return ParsedQuery(
        intent="feasibility", raw_text=raw_text, amount_cents=amount,
        horizon_months=_parse_horizon_months(normalized), nature=_detect_nature(normalized),
    )


def _build_savings_simulation(raw_text: str, normalized: str, today: date) -> ParsedQuery | None:
    amount = _parse_amount(normalized)
    if amount is None or amount <= 0:
        return None
    return ParsedQuery(
        intent="savings_simulation", raw_text=raw_text, amount_cents=amount,
        horizon_months=_parse_horizon_months(normalized),
    )


def _build_goal_status(raw_text: str, normalized: str, today: date) -> ParsedQuery | None:
    return ParsedQuery(intent="goal_status", raw_text=raw_text,
                       entity=_extract_goal_entity(normalized))


def _build_transaction_search(raw_text: str, normalized: str, today: date) -> ParsedQuery | None:
    blanked = normalized
    period = None
    found = _find_period(blanked, today)
    if found is not None:
        period, s, e = found
        blanked = _blank(blanked, s, e)
    return ParsedQuery(
        intent="transaction_search", raw_text=raw_text, period=period,
        entity=_extract_entity(blanked),
    )


def _build_patrimoine_projection(raw_text: str, normalized: str, today: date) -> ParsedQuery | None:
    return ParsedQuery(
        intent="patrimoine_projection", raw_text=raw_text,
        horizon_months=_parse_horizon_months(normalized),
    )


def _build_subscription_cost(raw_text: str, normalized: str, today: date) -> ParsedQuery | None:
    return ParsedQuery(intent="subscription_cost", raw_text=raw_text)


_BUILDERS: dict[Intent, "callable"] = {
    "total_by_category": _build_total_by_category,
    "period_comparison": _build_period_comparison,
    "recurrence_evolution": _build_recurrence_evolution,
    "subscription_cost": _build_subscription_cost,
    "feasibility": _build_feasibility,
    "savings_simulation": _build_savings_simulation,
    "goal_status": _build_goal_status,
    "transaction_search": _build_transaction_search,
    "patrimoine_projection": _build_patrimoine_projection,
}


def _unrecognised(raw_text: str) -> UnrecognisedQuery:
    return UnrecognisedQuery(
        raw_text=raw_text,
        message=(
            "Je n'ai pas compris cette question. Voici des formulations que "
            "je sais traiter :"
        ),
    )


def parse_intent(text: str, today: date) -> ParsedQuery | UnrecognisedQuery:
    """One line of French to a structured query, or a first-class refusal.

    `today` anchors every relative date form ("le mois dernier", "cette
    année", "sur les trois derniers mois"); it is never read from the clock
    here. `raw_text` on the result is always the caller's exact original
    string -- every pattern below runs against a lower-cased, accent-stripped
    copy instead, so the "requête exécutée" trail can still show the question
    exactly as it was typed.
    """
    if not text or not text.strip():
        return _unrecognised(text)
    normalized = _normalize(text)
    intent = _match_intent(normalized)
    if intent is None:
        return _unrecognised(text)
    query = _BUILDERS[intent](text, normalized, today)
    if query is None:
        return _unrecognised(text)
    return query
