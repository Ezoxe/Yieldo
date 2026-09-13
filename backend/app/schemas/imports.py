from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class DialectOut(BaseModel):
    encoding: str
    delimiter: str
    decimal_separator: str
    date_format: str
    header_row: int
    preamble_rows: int
    quotechar: str
    sample_headers: list[str] = Field(default_factory=list)


class PreviewRowOut(BaseModel):
    row_number: int
    date: date | None
    amount_cents: int | None
    label_raw: str
    category_id: int | None
    category_name: str | None
    category_source: str
    is_duplicate: bool
    error: str | None


class PreviewOut(BaseModel):
    upload_token: str
    original_filename: str
    dialect: DialectOut
    headers: list[str]
    sample_rows: list[list[str]]
    suggested_mapping: dict[str, str]
    rows: list[PreviewRowOut]
    summary: dict
    # True for a format that carries its own column roles (OFX, QIF): the
    # mapping is then a fact, not a proposal, and the wizard skips the step
    # that asks the household to confirm it. False for a CSV, always.
    mapping_fixed: bool = False


class CommitIn(BaseModel):
    upload_token: str
    account_id: int
    dialect: DialectOut
    mapping: dict[str, str]
    original_filename: str | None = None
    overrides: dict[str, int] = Field(default_factory=dict)
    keep_duplicates: list[int] = Field(default_factory=list)


class BatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    account_id: int
    filename: str
    rows_total: int
    rows_imported: int
    rows_duplicate: int
    rows_failed: int
    created_at: datetime


class ProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    dialect: dict
    mapping: dict[str, str]


class ProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    dialect: dict
    mapping: dict[str, str]
    created_at: datetime


class LastImportOut(BaseModel):
    """`GET /imports/last` -- the most recent batch, for « Dernier import il y a
    N jours » on the dashboard. 204 when there is none."""

    imported_at: datetime
    filename: str
    rows_imported: int
