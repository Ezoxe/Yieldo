import calendar
from datetime import date


def resolve_range(
    date_from: date | None,
    date_to: date | None,
    earliest: date | None,
    latest: date | None,
    today: date,
) -> tuple[date, date]:
    """Turn a half-specified request into the range the answer actually covers.

    An absent bound means "as far as there is data", never "this calendar year":
    the "Tout" preset sends no bounds at all, and reading that as 1 January
    hid every statement older than the current year from the dashboard's own
    default. `earliest` / `latest` are the span of the caller's own transactions
    (`None` when they have none yet).

    An absent end resolves to `latest` rather than to `today`, so the range is
    exactly the span that holds data: the covered-range line and the "show
    everything" control then name the same two dates, and a transaction dated in
    the future is inside the range by construction rather than by a special
    case. `today` is what a user with no history at all falls back to -- an empty
    single-day range, which is honest, instead of a crash or an invented span.

    Pure: the clock is a parameter, never read here.

    Bounds the caller stated are returned untouched. The two clamps only ever
    move a bound this function itself defaulted, and only to keep the range from
    coming back inverted.
    """
    if date_to is not None:
        end = date_to
    elif latest is not None:
        # Never before an explicit start: defaulting one end must not produce a
        # range that runs backwards.
        end = max(latest, date_from) if date_from is not None else latest
    else:
        end = max(today, date_from) if date_from is not None else today

    if date_from is not None:
        start = date_from
    elif earliest is not None:
        start = min(earliest, end)
    else:
        start = end

    return start, end


def month_end(anchor: date, offset: int) -> date:
    """The last day of the month `offset` calendar months after `anchor`'s.

    Four engines in this phase need the same arithmetic -- a debt cleared "in
    3 months", a goal reached "in 10", a purchase horizon, a property's rent
    comparison -- and money lands at month end. From an August anchor, offset 3
    is 30 November.

    Plain integer arithmetic on a zero-based month count, exactly like
    `api/analysis._shift_months`, so there is no "31 February does not exist"
    case to special-case at every step. A negative offset walks backwards.

    Pure: the clock is the caller's `anchor`, never read here.
    """
    total = anchor.year * 12 + (anchor.month - 1) + offset
    year, month = divmod(total, 12)
    return date(year, month + 1, calendar.monthrange(year, month + 1)[1])
