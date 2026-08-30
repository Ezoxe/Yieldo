"""The one guard every PATCH schema needs.

A `*Patch` schema types its fields `X | None` so that omitting one means "leave
this alone". Pydantic reads an explicit JSON `null` as a value that WAS
provided, so `{"name": null}` validated, reached `setattr(row, "name", None)`
in the router, and surfaced as a raw `IntegrityError` from `db.commit()` -- a
500 with an English traceback, on endpoints that answer every other malformed
payload with a French 422.

Applied field by field, never to the whole model: `term_months` and
`opened_on` are nullable columns, and clearing them is a legitimate edit.
"""

from typing import Any

from pydantic import field_validator
from pydantic_core import PydanticCustomError


def _reject_null(_cls: Any, value: Any) -> Any:
    if value is None:
        # A custom type rather than a plain ValueError: `api.errors` rewrites a
        # pydantic message by its `type`, so a bare ValueError would come back
        # as the vague "n'est pas valide" instead of naming what went wrong.
        raise PydanticCustomError("null_not_allowed", "null is not allowed")
    return value


def not_nullable(*fields: str) -> classmethod:
    """Refuse an explicit `null` on fields whose column is NOT NULL.

    `mode="before"` so the refusal happens ahead of type coercion, and because
    pydantic does not validate defaults, an OMITTED field never reaches it --
    which is the whole point: omitting still means "leave this alone".
    """
    return field_validator(*fields, mode="before")(classmethod(_reject_null))
