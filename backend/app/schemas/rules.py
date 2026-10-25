from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.patching import not_nullable

Direction = Literal["any", "debit", "credit"]


def _clean_pattern(value: str) -> str:
    cleaned = " ".join(value.split()).lower()
    if not cleaned:
        raise ValueError("Le motif de la règle est vide")
    return cleaned


class RuleOut(BaseModel):
    id: int
    pattern: str
    category_id: int
    category_name: str
    origin: str
    direction: str
    priority: int
    hit_count: int


class RuleIn(BaseModel):
    # A fragment of the label, matched case-insensitively. Never a regex here:
    # an expression a household cannot read back is one it cannot correct.
    pattern: str = Field(max_length=200)
    category_id: int
    direction: Direction = "any"

    @field_validator("pattern")
    @classmethod
    def _pattern(cls, value: str) -> str:
        return _clean_pattern(value)


class RulePatch(BaseModel):
    pattern: str | None = Field(default=None, max_length=200)
    category_id: int | None = None
    direction: Direction | None = None

    _not_null = not_nullable("pattern", "category_id", "direction")

    @field_validator("pattern")
    @classmethod
    def _pattern(cls, value: str | None) -> str | None:
        return None if value is None else _clean_pattern(value)
