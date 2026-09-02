"""Request/response shapes for `/api/connections`.

**Reading never returns a key.** `ConnectionOut` has no field that could
ever carry `value`, encrypted or not -- not an omission at serialisation
time, but a shape that has nowhere to put one. `ApiKeyIn` is the only
schema in this module that ever carries a plaintext key, and it is a
REQUEST schema: it is never returned in a response body, so the key a user
just typed never comes back to them either.
"""

from datetime import datetime

from pydantic import BaseModel


class ApiKeyIn(BaseModel):
    api_key: str


class QuotaStateOut(BaseModel):
    used: int
    # None means unlimited (Frankfurter) -- see market.quota.QuotaSpec.
    limit: int | None
    ceiling: int | None
    remaining: int | None
    reset_at: datetime | None
    # Whether the pool would currently allow one more call.
    can_call: bool


class ConnectionOut(BaseModel):
    provider: str
    configured: bool
    requires_key: bool
    last_used_at: datetime | None
    quota: QuotaStateOut


class ConnectionValidationOut(ConnectionOut):
    """`POST /api/connections/{provider}`'s own response: the same state
    `ConnectionOut` reports, plus whether THIS validation attempt worked."""

    valid: bool
    # French. Set if and only if valid is False.
    reason: str | None
