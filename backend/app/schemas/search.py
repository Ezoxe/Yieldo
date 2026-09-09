from pydantic import BaseModel


class SearchHit(BaseModel):
    """One thing the household owns, named the way they named it.

    `amount_cents` and `date` are raw: the screen formats them. Nothing here is
    a sentence a component would have to parse back apart.
    """

    kind: str
    id: int
    label: str
    detail: str | None = None
    amount_cents: int | None = None
    date: str | None = None
    route: str


class SearchGroup(BaseModel):
    kind: str
    label: str
    items: list[SearchHit]


class SearchResults(BaseModel):
    """Every group, always.

    An absent group and an empty one read the same on screen, but only the
    empty one lets the screen say what it looked in.
    """

    query: str
    groups: list[SearchGroup]
