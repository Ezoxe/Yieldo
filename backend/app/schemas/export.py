"""Wire shapes for /api/export. Design §8.2.

`ExportScopeIn` mirrors `engines.context_export.ExportScope` field for field,
with one deliberate difference: `account_ids` / `category_ids` travel as lists
because JSON has no set, and `None` still means "every one of them" while `[]`
means "none of them". The two are different scopes and the router keeps them
apart.
"""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field


class ExportScopeIn(BaseModel):
    date_from: date | None = None
    date_to: date | None = None
    account_ids: list[int] | None = None
    category_ids: list[int] | None = None
    granularity: Literal["annual", "monthly", "transaction"] = "monthly"
    modules: list[str] = Field(min_length=1)
    anonymise: bool = False
    # The window the document is measured against. `None` means no target was
    # named, and the answer then carries an estimate with no verdict -- never a
    # verdict against some default model the reader never chose.
    target_model: str | None = None


class ExportDownloadIn(ExportScopeIn):
    format: Literal["md", "txt", "json"]


class ExportDocumentOut(BaseModel):
    markdown: str
    estimated_tokens: int
    warning: str | None
    transaction_count: int
    excluded_transfer_count: int
    date_from: date
    date_to: date
    sections: list[str]


class ExportFileOut(BaseModel):
    filename: str
    content_type: str
    content: str


class ExportTemplateOut(BaseModel):
    key: str
    label: str
    summary: str
    question: str
    date_from: date
    date_to: date
    granularity: str
    modules: list[str]
    anonymise: bool


class ExportAccountOut(BaseModel):
    id: int
    name: str
    kind: str


class ExportCategoryOut(BaseModel):
    id: int
    name: str


class ExportModuleOut(BaseModel):
    key: str
    label: str


class ExportTargetModelOut(BaseModel):
    key: str
    label: str
    context_tokens: int


class ExportOptionsOut(BaseModel):
    """What the scope panel is allowed to offer. Every list is this user's own.

    `ledger_date_from` / `ledger_date_to` are `None` for a household that has
    imported nothing -- never a made-up span, and never today's date standing
    in for a ledger that does not exist.
    """

    accounts: list[ExportAccountOut]
    categories: list[ExportCategoryOut]
    modules: list[ExportModuleOut]
    target_models: list[ExportTargetModelOut]
    ledger_date_from: date | None
    ledger_date_to: date | None
