from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Transaction
from app.schemas.history import HistoryOut


def user_history(db: Session, user_id: int) -> HistoryOut | None:
    """The span and size of one user's whole ledger, or None when it is empty.

    Filtered on `user_id` like every other query on a business table: another
    user's older statement must never widen this user's default range.

    One aggregate row rather than a fetch: this runs on every analytics request
    and on every page of the transaction list.
    """
    earliest, latest, count = (
        db.query(
            func.min(Transaction.date),
            func.max(Transaction.date),
            func.count(Transaction.id),
        )
        .filter(Transaction.user_id == user_id)
        .one()
    )
    if earliest is None or latest is None or not count:
        return None
    return HistoryOut(date_from=earliest, date_to=latest, transaction_count=count)
