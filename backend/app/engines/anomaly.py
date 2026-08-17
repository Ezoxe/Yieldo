"""Robust anomaly detection. Pure: no session, no network, no implicit clock."""

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class AnomalyTx:
    """One transaction, as the anomaly scorer needs it."""

    id: int
    on: date
    amount_cents: int
    label: str
    category_id: int | None
