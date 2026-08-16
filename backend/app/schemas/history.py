from datetime import date

from pydantic import BaseModel


class HistoryOut(BaseModel):
    """The span of one user's whole ledger, whatever period is being asked about.

    Shared by `/analytics/summary` and `/transactions` because both screens have
    the same question to answer when they come back with nothing: is this user
    empty, or is the window simply pointed somewhere their data is not? `null`
    on the wire means the first.
    """

    date_from: date
    date_to: date
    transaction_count: int
