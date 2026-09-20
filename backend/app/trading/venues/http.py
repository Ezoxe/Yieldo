"""One HTTP call, one set of failure causes, no retry.

Every adapter goes through `request` so the mapping from a transport failure
or an HTTP status to one of `base.VenueFailureCause`'s five is written once.
An adapter that built its own French sentence for a 401 would be the first
step towards two spellings of "la clé a été refusée", which is the defect
`market/client.py` names as this project's most repeated.

**No retry, and the timeout is short.** See `base.py`: sending an order twice
costs a position. Ten seconds is long for a venue API and short enough that a
cycle cannot hang on one.
"""

import httpx

from app.trading.venues.base import VenueFailureCause, venue_error

TIMEOUT_SECONDS = 10.0


def request(
    method: str,
    url: str,
    *,
    label: str,
    headers: dict[str, str] | None = None,
    params: dict[str, str] | None = None,
    json_body: object | None = None,
    content: str | None = None,
) -> str:
    """The response body as text, or a `VenueError` naming one of five causes."""
    try:
        response = httpx.request(
            method, url, headers=headers, params=params, json=json_body, content=content,
            timeout=TIMEOUT_SECONDS,
        )
    except httpx.TimeoutException as exc:
        raise venue_error(
            VenueFailureCause.SERVICE_UNREACHABLE, label,
            f"délai de {TIMEOUT_SECONDS:.0f} s dépassé",
        ) from exc
    except httpx.HTTPError as exc:
        raise venue_error(
            VenueFailureCause.SERVICE_UNREACHABLE, label, str(exc)
        ) from exc

    if response.status_code in (401, 403):
        raise venue_error(
            VenueFailureCause.CREDENTIALS_REJECTED, label, f"HTTP {response.status_code}"
        )
    if response.status_code == 404:
        raise venue_error(
            VenueFailureCause.UNKNOWN_SYMBOL, label, f"HTTP {response.status_code}"
        )
    if 400 <= response.status_code < 500:
        # The venue understood and said no. Its own words are carried through:
        # "insufficient buying power" is the whole answer a household needs,
        # and paraphrasing it would lose it.
        raise venue_error(
            VenueFailureCause.REJECTED_BY_VENUE, label,
            f"HTTP {response.status_code} — {response.text[:200]}",
        )
    if response.status_code >= 500:
        raise venue_error(
            VenueFailureCause.SERVICE_UNREACHABLE, label, f"HTTP {response.status_code}"
        )
    return response.text
