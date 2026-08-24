# Task 7 report: CSV dialect detection

**Commit:** `4293bb1896f1e9b396914aaeceb0d45da195387b` — `feat(importers): detect CSV encoding, delimiter, decimal and date formats`
**Branch:** `phase-1-socle`

## What was implemented

- `backend/app/importers/dialect.py` — new pure module (no `app.db` / `app.models` imports, no I/O beyond the `bytes` argument):
  - `CsvDialect` dataclass: `encoding`, `delimiter`, `decimal_separator`, `date_format`, `header_row`, `preamble_rows`, `quotechar`, `sample_headers` — every field is a plain JSON-compatible type (`str`, `int`, `list[str]`), per the brief's note that Task 12 round-trips this through JSON.
  - `detect_dialect(raw: bytes) -> CsvDialect` — decodes with `charset_normalizer.from_bytes(...).best()`, picks the delimiter among `;`, `,`, `\t`, `|` by column-count consistency, finds the header row as the first row whose width matches the table's dominant column count, then samples date-shaped and amount-shaped cells from the body to infer `date_format` and `decimal_separator`.
  - `read_rows(raw, dialect) -> (headers, rows)` — decodes with the dialect's own encoding/delimiter/quotechar and returns `(headers, data_rows)`, skipping blank rows.
  - `parse_date(text, date_format) -> date` — tries the given format first, then all of `DATE_FORMATS`; raises `ValueError("Date illisible : ...")` (French, matched by tests) if nothing parses.
  - `parse_amount(text, decimal_separator) -> int` — returns integer **cents**. Strips everything that isn't a digit/separator/sign/parenthesis (handles `€`, regular spaces, and non-breaking spaces used as thousands separators in one pass), detects `(...)` as negative, swaps the thousands/decimal separators based on the given `decimal_separator`, then parses with `decimal.Decimal` and rounds with `ROUND_HALF_UP` — never float arithmetic on money. Raises `ValueError("Montant illisible : ...")` (French) on empty or unparseable input.
  - `DATE_FORMATS = ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d", "%m/%d/%Y", "%d-%m-%Y", "%d.%m.%Y")` as specified.
- `backend/tests/fixtures/boursorama.csv` — UTF-8, `;`-delimited, French decimal comma, `%d/%m/%Y` dates, 2 lines of preamble text + 1 blank line before the header (3 preamble rows total), 4 data rows.
- `backend/tests/fixtures/generic_iso.csv` — UTF-8/ASCII, `,`-delimited, `.` decimal, ISO dates, no preamble.
- `backend/tests/fixtures/credit_agricole_latin1.csv` — written as genuine Latin-1 bytes (see verification below), `;`-delimited, separate debit/credit columns, no preamble.
- `backend/tests/test_dialect.py` — copied verbatim from the brief, with one care point applied: the second `"1 234,56"` case in `test_parse_amount_returns_cents` uses a U+00A0 NO-BREAK SPACE (not a plain space) between `1` and `234`, matching the byte content of the brief's own markdown source (confirmed by inspecting the brief file's raw bytes: line 120 is `"1\xa0234,56"`), so the test actually exercises the narrow/no-break-space thousands separator case the brief's careful-point #3 calls out, not a duplicate of the plain-space case.

## Latin-1 verification

The fixture was written with a small script using `Path(...).write_bytes(text.encode("latin-1"))`, then verified at the byte level before running any test:

```
size: 154
first line bytes: b'Date;Libell\xe9;D\xe9bit euros;Cr\xe9dit euros'
CONFIRMED: e-acute in "Libellé" is single byte 0xE9 (Latin-1)
P-Eacute-AGE bytes: b'P\xc9AG'
CONFIRMED: E-acute (uppercase) in "PÉAGE" is single byte 0xC9 (Latin-1)
CONFIRMED: raw bytes are NOT valid UTF-8: 'utf-8' codec can't decode byte 0xe9 in position 11: invalid continuation byte
```

This confirms the fixture is genuinely single-byte Latin-1 content (é = `0xE9`, É = `0xC9`) and could not accidentally pass the test by being valid UTF-8.

One observation for later tasks: `charset_normalizer.from_bytes(...).best().encoding` reports this specific short file as `cp1250` rather than `cp1252`/`iso-8859-1`. This is not a bug in the fixture or the implementation — `cp1250` and Latin-1/`cp1252` happen to share the same code points for `É`/`é` (`0xC9`/`0xE9`), so `raw.decode("cp1250")` reproduces the correct characters byte-for-byte on this file, and the test (which only checks the decoded text, not the encoding name) passes correctly. If a later task or a bigger real-world Latin-1 file needs to assert a specific encoding *name*, be aware `charset_normalizer`'s guess on short, mostly-ASCII files can land on a different-but-compatible Western/Central European code page rather than the "expected" one.

## Test commands and output

Step 3 — confirm failing before implementation:
```
cd backend && .venv/Scripts/pytest.exe tests/test_dialect.py -v
```
Result: collection error, exactly as the brief predicted —
```
ModuleNotFoundError: No module named 'app.importers.dialect'
```

Step 5 — after implementation:
```
cd backend && .venv/Scripts/pytest.exe tests/test_dialect.py -v
```
Result: **22 passed** (not 23 — see deviation note below), 0 failed, 0 skipped, 0.48s.

Full backend suite (regression check):
```
cd backend && .venv/Scripts/pytest.exe -v
```
Result: **72 passed**, 26 warnings (all pre-existing: Starlette/httpx deprecation notice and JWT HMAC-key-length warnings unrelated to this task), 0 failed.

Lint:
```
cd backend && .venv/Scripts/python.exe -m ruff check app/importers/dialect.py tests/test_dialect.py
```
Result: `All checks passed!`

`ruff format --check` was also run out of caution; it would reformat both new files (long `parametrize` calls, one long line in `read_rows`), but a repo-wide check showed **13 pre-existing files** already fail `ruff format --check` (e.g. `tests/test_models.py`), confirming `ruff format` is not an enforced gate in this repo — only `ruff check` (lint) is, and that passes cleanly. No action taken.

## Deviations from the brief

1. **Removed `_THOUSAND_SPACES` regex from `parse_amount`.** The brief's reference code applies `_AMOUNT_CLEANUP = re.compile(r"[^\d,.\-+()]")` first, which already strips every whitespace variant (regular space, non-breaking space U+00A0, narrow no-break space U+202F) because none of them are in the allowed character set. A second pass with `_THOUSAND_SPACES` is applied to the already-whitespace-free string and can never match anything — dead code. I removed the constant and the redundant `.sub()` call rather than ship functionally-inert code. Traced by hand and confirmed empirically: all amount test cases (including both `"1 234,56"` variants — plain space and U+00A0) still pass with the single-pass cleanup.
2. **Test count.** The brief's Step 5 says "Expected: 23 tests PASS"; the actual collected/passing count for `test_dialect.py` is **22** (4 parametrized date cases + 11 parametrized amount cases + 7 plain test functions = 22). This is a minor miscount in the brief text itself, not a missing test or implementation gap — every test in the brief's `test_dialect.py` listing is present and passing.
3. Everything else (file paths, dataclass shape, function signatures, `DATE_FORMATS` tuple, French error message substrings, fixture contents) matches the brief exactly.

## Notes for later tasks

- `app/importers/dialect.py` has zero dependencies on `app.db` or `app.models` — confirmed by inspection, it only imports `csv`, `io`, `re`, `collections.Counter`, `dataclasses`, `datetime`, `decimal`, and `charset_normalizer`. Safe to reuse from anywhere without pulling in DB session machinery.
- `CsvDialect` is a plain dataclass with only JSON-safe field types, ready for the JSON round-trip Task 12 needs.
- The three fixtures (`boursorama.csv`, `credit_agricole_latin1.csv`, `generic_iso.csv`) are stable and intended for reuse — `boursorama.csv` and `generic_iso.csv` per the task instructions, and `credit_agricole_latin1.csv` is also available as the canonical Latin-1/debit-credit-column example if a later task needs one.
- Be aware that `charset_normalizer`'s encoding *name* for `credit_agricole_latin1.csv` is `cp1250`, not `cp1252`/`latin-1`/`iso-8859-1` — functionally correct for this file's content but worth knowing if a future test asserts on the encoding string rather than the decoded text.
- `git config core.autocrlf` is `true` in this environment with no `.gitattributes`; on a future checkout the fixture files' `\n` line endings may be normalized to `\r\n` by git. This only affects line separators, not the encoded byte content (`é`/`É` stay `0xE9`/`0xC9`), and `csv.reader` / `str.splitlines()` both handle `\r\n` transparently, so this should not affect any test relying on these fixtures. Flagging it only so nobody is surprised if a fixture's line endings look different after a fresh clone.

---

## Fix round 1 of 5

**Commit:** `<filled in after commit, see below>`

Review found one Critical and one Important issue, both in `backend/app/importers/dialect.py`. The plan file itself was already corrected by the coordinator before this round started; no plan changes were made here.

### CRITICAL — silent mojibake from statistical encoding detection

My original report treated the `cp1250` guess for `credit_agricole_latin1.csv` as harmless because `cp1250` and `cp1252`/Latin-1 agree on `é`/`É`. The reviewer correctly pointed out I only checked one character pair. I verified the full claim directly:

```
0xC8: cp1250=U+010C cp1252=U+00C8 latin1=U+00C8 DIFFERS   (È)
0xE8: cp1250=U+010D cp1252=U+00E8 latin1=U+00E8 DIFFERS   (è)
0xC0: cp1250=U+0154 cp1252=U+00C0 latin1=U+00C0 DIFFERS   (À)
0xE0: cp1250=U+0155 cp1252=U+00E0 latin1=U+00E0 DIFFERS   (à)
0xCA: cp1250=U+0118 cp1252=U+00CA latin1=U+00CA DIFFERS   (Ê)
0xEA: cp1250=U+0119 cp1252=U+00EA latin1=U+00EA DIFFERS   (ê)
0xD9: cp1250=U+016E cp1252=U+00D9 latin1=U+00D9 DIFFERS   (Ù)
0xF9: cp1250=U+016F cp1252=U+00F9 latin1=U+00F9 DIFFERS   (ù)
0xDB: cp1250=U+0170 cp1252=U+00DB latin1=U+00DB DIFFERS   (Û)
0xFB: cp1250=U+0171 cp1252=U+00FB latin1=U+00FB DIFFERS   (û)
```

Both codepages map all 256 bytes, so `raw.decode(encoding)` never raises regardless of which one is picked — the corruption is silent, and it lands on exactly the string (`label_raw`) that `compute_dedup_hash` fingerprints and the user reads.

**Fix applied** (`backend/app/importers/dialect.py`):
- Removed `from charset_normalizer import from_bytes` entirely; added `import codecs`.
- Added `_CANDIDATE_ENCODINGS = ("utf-8-sig", "cp1252", "latin-1")`.
- Replaced `_decode` with the coordinator's exact version: checks for a UTF-16 BOM first (`codecs.BOM_UTF16_LE` / `_BE`), then tries `utf-8-sig`, `cp1252`, `latin-1` in strict order via `raw.decode(encoding)` (no `errors="replace"`), falling through on `UnicodeDecodeError`. `latin-1` maps every byte so the loop always returns before the final unreachable-in-practice fallback line.
- Confirmed `test_detects_boursorama_semicolon_comma_decimal_french_dates`'s `dialect.encoding.lower().startswith("utf")` assertion still holds: `boursorama.csv` is valid UTF-8 with no BOM, so `raw.decode("utf-8-sig")` succeeds on the first try and returns encoding `"utf-8-sig"`, whose `.lower()` starts with `"utf"`. Ran the test to confirm rather than assuming — it passes.
- Removed `charset-normalizer>=3.4` from `backend/pyproject.toml`'s `dependencies`. Checked first with `grep -rn "charset.normalizer" backend/ -i`: the only match left was the `pyproject.toml` line itself, so nothing else in the backend imports it. Did not uninstall it from the `.venv` (harmless leftover, not part of the dependency manifest anymore).

**Fixture change** (`backend/tests/fixtures/credit_agricole_latin1.csv`): appended two rows containing the exact byte classes the reviewer flagged, so the fixture now exercises them instead of coincidentally avoiding them:
```
05/03/2025;PRÉLÈVEMENT MUTUELLE;45,00;
06/03/2025;GOÛTER À LA FERME;18,20;
```
`PRÉLÈVEMENT` covers È/é (`0xC8`), `GOÛTER À LA FERME` covers Û (`0xDB`) and À (`0xC0`). The fixture now has 5 data rows instead of 3.

**Proof the new tests would have caught this against the old code** — simulated the old `_decode` (via `charset_normalizer.from_bytes(...).best()`, without touching source) against the *new* fixture content:
```
OLD guessed encoding: mac_latin2   (not cp1250 this time — a different fixture produces a different wrong guess, reinforcing that the statistical approach is fundamentally unreliable)
decoded line: 05/03/2025;PR…L»VEMENT MUTUELLE;45,00;      (should be PRÉLÈVEMENT)
decoded line: 06/03/2025;GOŘTER ŇLA FERME;18,20;           (should be GOÛTER À LA FERME)
```
Both the new `dialect.encoding == "cp1252"` assertion and the new `rows[3][1]` / `rows[4][1]` assertions would have failed under the old `_decode`. With the fix applied, all pass (see test run below).

### IMPORTANT — parse_date silently swaps day/month on a wrong format guess

**Fix applied** (`backend/app/importers/dialect.py`, `parse_date`): replaced the `for fmt in (date_format, *DATE_FORMATS)` fallback loop with a single strict `datetime.strptime(stripped, date_format)` call, using the coordinator's exact version (docstring included, explaining why fallback is unsafe and that a non-matching row belongs in the import preview's error list, not a silent reinterpretation).

Existing parametrized tests (`test_parse_date_accepts_supported_formats`) all pass an explicit matching format, so none of them relied on the fallback — confirmed still green.

**Behaviour asserted in the new test, and why:** per the coordinator's note, `parse_date("01/03/2025", "%m/%d/%Y")` is *not* a useful regression test under the strict version, because `01/03/2025` happens to be valid under `%m/%d/%Y` too (day=3, month=1) — the strict call would simply return `date(2025, 1, 3)` without any fallback ever being invoked, proving nothing about the removed fallback behaviour. Instead I asserted that `parse_date("25/03/2025", "%m/%d/%Y")` **raises** `ValueError` matching `"Date illisible"`, since `25/03/2025` is invalid under `%m/%d/%Y` (there is no 25th month) — under the old fallback code it would have silently matched `%d/%m/%Y` from `DATE_FORMATS` and returned `date(2025, 3, 25)` instead of raising.

**Proof against the old code** — simulated the old fallback loop (without touching source):
```
old_parse_date("25/03/2025", "%m/%d/%Y") -> 2025-03-25   (did NOT raise)
```
Confirming the new test `test_parse_date_does_not_fall_back_to_a_different_format` would have failed (no exception raised inside `pytest.raises`) against the old implementation. With the strict fix applied, it raises as expected.

### Covering tests added

- `test_read_rows_decodes_accented_letters_a_statistical_guess_would_corrupt` (`backend/tests/test_dialect.py`) — new test; asserts `len(rows) == 5` and the two new labels (`PRÉLÈVEMENT MUTUELLE`, `GOÛTER À LA FERME`) decode intact.
- `test_detects_latin1_encoding_without_mojibake` (existing test, strengthened) — added `assert dialect.encoding == "cp1252"`.
- `test_parse_date_does_not_fall_back_to_a_different_format` (`backend/tests/test_dialect.py`) — new test; asserts `parse_date("25/03/2025", "%m/%d/%Y")` raises `ValueError` matching `"Date illisible"`.

### Test command and output

```
cd backend && .venv/Scripts/pytest.exe tests/ -v
```

Result: **74 passed**, 26 warnings (all pre-existing: Starlette/httpx deprecation notice and JWT HMAC-key-length warnings, unrelated to this change), 0 failed, 2.85s. Includes all 25 tests in `test_dialect.py` (22 from Task 7 + 3 added in this fix round) plus all other backend suites (auth, db, dedup, health, models, security, seed_categories) unaffected.

Lint:
```
cd backend && .venv/Scripts/python.exe -m ruff check app/importers/dialect.py tests/test_dialect.py
```
Result: `All checks passed!`

### Files changed this round

- `backend/app/importers/dialect.py` — `_decode` replaced (explicit candidate list, no `charset_normalizer`); `parse_date` made strict.
- `backend/pyproject.toml` — removed `charset-normalizer>=3.4` from `dependencies`.
- `backend/tests/fixtures/credit_agricole_latin1.csv` — extended with two rows carrying the dangerous accented characters.
- `backend/tests/test_dialect.py` — added `test_read_rows_decodes_accented_letters_a_statistical_guess_would_corrupt`, strengthened `test_detects_latin1_encoding_without_mojibake`, added `test_parse_date_does_not_fall_back_to_a_different_format`.

Not staged/committed: `docs/superpowers/plans/2026-08-09-yieldo-phase-1-socle.md` — that edit belongs to the coordinator's plan correction, not to this fix round, per the staging-discipline instruction to stage only files changed in this task.
