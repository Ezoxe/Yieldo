"""Recurrence detection. Pure: no session, no network, no implicit clock."""

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class RecurringTx:
    """The minimal shape recurrence detection needs. Deliberately not an ORM object.

    `label_key` is the normalised grouping key, computed by the caller from
    `label_raw` -- never read from the stored `label_clean`, whose contents
    depend on which importer version wrote the row.
    """

    on: date
    amount_cents: int
    label_key: str
    label_raw: str
    category_id: int | None
