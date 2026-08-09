import hashlib
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy.orm import Session

from app.categorization.engine import classify, compile_rules
from app.importers.dedup import compute_dedup_hash
from app.importers.dialect import CsvDialect, detect_dialect, read_rows
from app.importers.mapping import suggest_mapping, validate_mapping
from app.importers.parser import CandidateRow, parse_rows
from app.models import Category, ImportBatch, Transaction
from app.models.rule import CategoryRule


class MappingError(ValueError):
    """Raised when a column mapping cannot produce transactions."""


@dataclass
class PreviewRow:
    row_number: int
    date: date | None
    amount_cents: int | None
    label_raw: str
    category_id: int | None
    category_name: str | None
    category_source: str
    is_duplicate: bool
    error: str | None


@dataclass
class ImportPreview:
    dialect: CsvDialect
    headers: list[str]
    sample_rows: list[list[str]]
    suggested_mapping: dict[int, str]
    rows: list[PreviewRow] = field(default_factory=list)
    summary: dict = field(default_factory=dict)


def _load_categorizer(db: Session, user_id: int):
    rules = db.query(CategoryRule).filter(CategoryRule.user_id == user_id).all()
    compiled = compile_rules(rules)
    all_categories = db.query(Category).filter(Category.user_id == user_id).all()
    categories = {c.id: c for c in all_categories}
    # A category that has children is a grouping bucket (e.g. "Alimentation"),
    # never something a transaction should be filed under directly — the real
    # target is always one of its children (e.g. "Courses"). Excluding those
    # buckets from the CSV-hint lookup below keeps a bank's coarse category
    # column from outranking the rule library's much more precise picks.
    parent_ids = {c.parent_id for c in all_categories if c.parent_id is not None}
    by_name = {c.name.casefold(): c for c in all_categories if c.id not in parent_ids}
    return compiled, categories, by_name


def _resolve_category(
    candidate: CandidateRow, compiled, by_name: dict[str, Category]
) -> tuple[int | None, str]:
    """CSV category column first, then the rule library. Neither is a guess dressed up
    as fact: the source is recorded alongside the category."""
    if candidate.category_hint:
        matched = by_name.get(candidate.category_hint.strip().casefold())
        if matched is not None:
            return matched.id, "csv"
    match = classify(candidate.label_clean, candidate.amount_cents or 0, compiled)
    if match is not None:
        return match.category_id, match.source
    return None, "uncategorized"


def _existing_hashes(db: Session, user_id: int) -> set[str]:
    rows = db.query(Transaction.dedup_hash).filter(Transaction.user_id == user_id).all()
    return {row[0] for row in rows}


def build_preview(
    db: Session,
    user_id: int,
    account_id: int,
    raw: bytes,
    dialect: CsvDialect | None,
    mapping: dict[int, str] | None,
) -> ImportPreview:
    """Analyse a file and show what would happen. Writes nothing."""
    resolved_dialect = dialect or detect_dialect(raw)
    headers, rows = read_rows(raw, resolved_dialect)
    resolved_mapping = mapping or suggest_mapping(headers)

    preview = ImportPreview(
        dialect=resolved_dialect,
        headers=headers,
        sample_rows=rows[:20],
        suggested_mapping=resolved_mapping,
    )

    errors = validate_mapping(resolved_mapping, len(headers))
    if errors:
        preview.summary = {
            "total": len(rows), "importable": 0, "duplicates": 0, "failed": len(rows),
            "date_from": None, "date_to": None, "inflow_cents": 0, "outflow_cents": 0,
            "mapping_errors": errors,
        }
        return preview

    compiled, categories, by_name = _load_categorizer(db, user_id)
    seen = _existing_hashes(db, user_id)
    within_file: set[str] = set()

    dates: list[date] = []
    inflow = outflow = 0
    duplicates = failed = importable = 0

    for candidate in parse_rows(rows, resolved_mapping, resolved_dialect):
        if candidate.error is not None:
            failed += 1
            preview.rows.append(PreviewRow(
                row_number=candidate.row_number, date=None, amount_cents=None,
                label_raw=candidate.label_raw, category_id=None, category_name=None,
                category_source="uncategorized", is_duplicate=False, error=candidate.error,
            ))
            continue

        fingerprint = compute_dedup_hash(user_id, account_id, candidate.date,
                                         candidate.amount_cents, candidate.label_raw)
        is_duplicate = fingerprint in seen or fingerprint in within_file
        within_file.add(fingerprint)

        category_id, source = _resolve_category(candidate, compiled, by_name)
        category = categories.get(category_id) if category_id else None

        if is_duplicate:
            duplicates += 1
        else:
            importable += 1
            dates.append(candidate.date)
            if candidate.amount_cents >= 0:
                inflow += candidate.amount_cents
            else:
                outflow += candidate.amount_cents

        preview.rows.append(PreviewRow(
            row_number=candidate.row_number, date=candidate.date,
            amount_cents=candidate.amount_cents, label_raw=candidate.label_raw,
            category_id=category_id, category_name=category.name if category else None,
            category_source=source, is_duplicate=is_duplicate, error=None,
        ))

    preview.summary = {
        "total": len(rows), "importable": importable, "duplicates": duplicates,
        "failed": failed,
        "date_from": min(dates) if dates else None,
        "date_to": max(dates) if dates else None,
        "inflow_cents": inflow, "outflow_cents": outflow,
        "mapping_errors": [],
    }
    return preview


def commit_import(
    db: Session,
    user_id: int,
    account_id: int,
    raw: bytes,
    filename: str,
    dialect: CsvDialect,
    mapping: dict[int, str],
    overrides: dict[int, int],
    keep_duplicates: list[int],
) -> ImportBatch:
    """Write the import in a single transaction. Either all of it lands, or none."""
    headers, rows = read_rows(raw, dialect)

    errors = validate_mapping(mapping, len(headers))
    if errors:
        raise MappingError(" ".join(errors))

    compiled, _categories, by_name = _load_categorizer(db, user_id)
    seen = _existing_hashes(db, user_id)
    forced = set(keep_duplicates)

    batch = ImportBatch(
        user_id=user_id, account_id=account_id, filename=filename,
        file_sha256=hashlib.sha256(raw).hexdigest(),
        dialect_json=dialect.__dict__ | {"sample_headers": headers},
        mapping_json={str(k): v for k, v in mapping.items()},
        rows_total=len(rows),
    )
    db.add(batch)
    db.flush()

    imported = duplicate = failed = 0
    for candidate in parse_rows(rows, mapping, dialect):
        if candidate.error is not None:
            failed += 1
            continue

        fingerprint = compute_dedup_hash(user_id, account_id, candidate.date,
                                         candidate.amount_cents, candidate.label_raw)
        if fingerprint in seen and candidate.row_number not in forced:
            duplicate += 1
            continue
        if fingerprint in seen:
            # Forced through by the user: make the fingerprint unique so the
            # database constraint does not reject a deliberate duplicate. A
            # legitimate fingerprint is always a bare sha256 hex digest, which
            # never contains ':', so this suffixed value can never collide
            # with one computed later from real row data.
            fingerprint = f"{fingerprint}:{candidate.row_number}"

        override = overrides.get(candidate.row_number)
        if override is not None:
            category_id, source = override, "manual"
        else:
            category_id, source = _resolve_category(candidate, compiled, by_name)

        db.add(Transaction(
            user_id=user_id, account_id=account_id, date=candidate.date,
            value_date=candidate.value_date, amount_cents=candidate.amount_cents,
            label_raw=candidate.label_raw, label_clean=candidate.label_clean,
            category_id=category_id, category_source=source,
            import_batch_id=batch.id, dedup_hash=fingerprint,
            notes=candidate.notes, tags=[],
        ))
        seen.add(fingerprint)
        imported += 1

    batch.rows_imported = imported
    batch.rows_duplicate = duplicate
    batch.rows_failed = failed
    db.commit()
    db.refresh(batch)
    return batch


def rollback_import(db: Session, user_id: int, batch_id: int) -> int:
    """Undo an entire import. Refuses to touch another user's batch."""
    batch = db.get(ImportBatch, batch_id)
    if batch is None:
        raise LookupError("Lot d'import introuvable")
    if batch.user_id != user_id:
        raise PermissionError("Ce lot d'import appartient à un autre utilisateur")

    removed = (
        db.query(Transaction)
        .filter(Transaction.user_id == user_id, Transaction.import_batch_id == batch_id)
        .delete(synchronize_session=False)
    )
    db.delete(batch)
    db.commit()
    return removed
