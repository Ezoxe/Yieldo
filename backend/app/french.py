"""French agreement helpers for the sentences the API writes.

French takes the singular for zero as well as for one — « 0 ligne », « 1
ligne », « 2 lignes » — so the switch is on ``count > 1``. Both forms are
written out because what changes is not reliably the last letter (« refusé
par le mandat » / « refusés par le mandat », « aucune » / « aucunes »).
"""


def plural(count: int, singular: str, plural_form: str) -> str:
    """The form that agrees with ``count``."""
    return plural_form if count > 1 else singular


def counted(count: int, singular: str, plural_form: str) -> str:
    """``count`` followed by the form that agrees with it: « 3 ordres »."""
    return f"{count} {plural(count, singular, plural_form)}"
