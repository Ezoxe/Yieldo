import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useImportWizard } from "./useImportWizard";

const fetchMock = vi.fn();

const previewBody = {
  upload_token: "tok.csv",
  dialect: {
    encoding: "utf-8", delimiter: ";", decimal_separator: ",", date_format: "%d/%m/%Y",
    header_row: 3, preamble_rows: 3, quotechar: '"',
    sample_headers: ["dateOp", "label", "amount"],
  },
  headers: ["dateOp", "label", "amount"],
  sample_rows: [["01/03/2025", "CARREFOUR", "-47,32"]],
  suggested_mapping: { "0": "date", "1": "label", "2": "amount" },
  rows: [
    {
      row_number: 1, date: "2025-03-01", amount_cents: -4732, label_raw: "CARREFOUR",
      category_id: 3, category_name: "Courses", category_source: "builtin",
      is_duplicate: false, error: null,
    },
  ],
  summary: {
    total: 1, importable: 1, duplicates: 0, failed: 0,
    date_from: "2025-03-01", date_to: "2025-03-01",
    inflow_cents: 0, outflow_cents: -4732, mapping_errors: [],
  },
};

const row = (row_number: number, is_duplicate: boolean, error: string | null = null) => ({
  row_number,
  date: "2025-03-01",
  amount_cents: -4732,
  label_raw: `LIGNE ${row_number}`,
  category_id: null,
  category_name: null,
  category_source: "uncategorized",
  is_duplicate,
  error,
});

/** Row 2 is a duplicate of something already in the ledger; row 1 is not. */
const withDuplicateBody = {
  ...previewBody,
  rows: [row(1, false), row(2, true)],
  summary: {
    ...previewBody.summary,
    total: 2, importable: 1, duplicates: 1, failed: 0,
  },
};

/** The same file retagged: row 2 is no longer read as a duplicate. */
const retaggedBody = {
  ...previewBody,
  rows: [row(1, false), row(2, false)],
  summary: {
    ...previewBody.summary,
    total: 2, importable: 2, duplicates: 0, failed: 0,
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("useImportWizard", () => {
  it("starts on the file step", () => {
    const { result } = renderHook(() => useImportWizard());
    expect(result.current.step).toBe("file");
  });

  it("moves to the mapping step once the file is analyzed", async () => {
    fetchMock.mockResolvedValue(jsonResponse(previewBody));
    const { result } = renderHook(() => useImportWizard());

    act(() => result.current.actions.selectAccount(1));
    await act(async () => {
      await result.current.actions.selectFile(new File(["x"], "b.csv", { type: "text/csv" }));
    });

    await waitFor(() => expect(result.current.step).toBe("mapping"));
    expect(result.current.mapping).toEqual({ 0: "date", 1: "label", 2: "amount" });
    expect(result.current.preview?.summary.importable).toBe(1);
  });

  it("retagging a column marks the preview stale until re-analysis", async () => {
    fetchMock.mockResolvedValue(jsonResponse(previewBody));
    const { result } = renderHook(() => useImportWizard());
    act(() => result.current.actions.selectAccount(1));
    await act(async () => {
      await result.current.actions.selectFile(new File(["x"], "b.csv", { type: "text/csv" }));
    });

    act(() => result.current.actions.setRole(2, "debit"));
    expect(result.current.mapping[2]).toBe("debit");
    expect(result.current.isPreviewStale).toBe(true);
  });

  it("refuses to commit a stale preview even when commit() is called directly", async () => {
    fetchMock.mockResolvedValue(jsonResponse(previewBody));
    const { result } = renderHook(() => useImportWizard());
    act(() => result.current.actions.selectAccount(1));
    await act(async () => {
      await result.current.actions.selectFile(new File(["x"], "b.csv", { type: "text/csv" }));
    });

    // Retagging leaves the mapping valid (still has date/label/debit) but stale:
    // the fetched preview above was computed under the old mapping. canCommit
    // already reflects this via the disabled button; commit() itself must also
    // refuse, since the button being disabled is markup, not enforcement.
    act(() => result.current.actions.setRole(2, "debit"));
    expect(result.current.isPreviewStale).toBe(true);
    expect(result.current.errors).toEqual([]);

    const callsBeforeCommit = fetchMock.mock.calls.length;
    await act(async () => {
      await result.current.actions.commit();
    });

    expect(fetchMock.mock.calls.length).toBe(callsBeforeCommit);
    expect(result.current.step).not.toBe("done");
    expect(result.current.errors.length).toBeGreaterThan(0);
  });

  it("blocks the commit while the mapping is invalid", async () => {
    fetchMock.mockResolvedValue(jsonResponse(previewBody));
    const { result } = renderHook(() => useImportWizard());
    act(() => result.current.actions.selectAccount(1));
    await act(async () => {
      await result.current.actions.selectFile(new File(["x"], "b.csv", { type: "text/csv" }));
    });

    act(() => result.current.actions.setRole(0, "ignore"));
    expect(result.current.canCommit).toBe(false);
    expect(result.current.errors.some((e) => e.includes("Date"))).toBe(true);
  });

  it("surfaces a rejected file without leaving the file step", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "Format non pris en charge : déposez un fichier CSV." }, 400),
    );
    const { result } = renderHook(() => useImportWizard());
    act(() => result.current.actions.selectAccount(1));
    await act(async () => {
      await result.current.actions.selectFile(new File(["x"], "photo.png"));
    });

    await waitFor(() => expect(result.current.errors[0]).toContain("Format non pris en charge"));
    expect(result.current.step).toBe("file");
  });

  // Retour au tagging -> retag -> Voir l'aperçu recomputes the whole preview.
  // A keep-list entry naming a row the fresh analysis no longer reads as a
  // duplicate is counted twice -- once inside summary.importable, once again as
  // a kept duplicate -- so the action bar promises more rows than the commit
  // will write, and canCommit can enable a commit of nothing at all.
  async function startWith(body: unknown) {
    fetchMock.mockResolvedValueOnce(jsonResponse(body));
    const { result } = renderHook(() => useImportWizard());
    act(() => result.current.actions.selectAccount(1));
    await act(async () => {
      await result.current.actions.selectFile(new File(["x"], "b.csv", { type: "text/csv" }));
    });
    return result;
  }

  it("drops keep-list entries the re-analysis no longer reads as duplicates", async () => {
    const result = await startWith(withDuplicateBody);
    act(() => result.current.actions.toggleKeepDuplicate(2));
    expect(result.current.keepDuplicates).toEqual([2]);

    fetchMock.mockResolvedValueOnce(jsonResponse(retaggedBody));
    await act(async () => {
      await result.current.actions.reanalyze();
    });

    // Row 2 is inside importable now. Counting it again as a kept duplicate
    // would make the bar read "3 lignes à importer" for a commit writing 2.
    expect(result.current.keepDuplicates).toEqual([]);
    expect(result.current.preview?.summary.importable).toBe(2);
  });

  it("drops them on a dialect change too", async () => {
    const result = await startWith(withDuplicateBody);
    act(() => result.current.actions.toggleKeepDuplicate(2));

    fetchMock.mockResolvedValueOnce(jsonResponse(retaggedBody));
    await act(async () => {
      await result.current.actions.setDialectField("delimiter", ",");
    });

    expect(result.current.keepDuplicates).toEqual([]);
  });

  it("keeps the entries that are still duplicates after the re-analysis", async () => {
    const result = await startWith(withDuplicateBody);
    act(() => result.current.actions.toggleKeepDuplicate(2));

    fetchMock.mockResolvedValueOnce(jsonResponse(withDuplicateBody));
    await act(async () => {
      await result.current.actions.reanalyze();
    });

    expect(result.current.keepDuplicates).toEqual([2]);
  });

  it("refuses the commit when the fresh preview has nothing importable left", async () => {
    const allDuplicates = {
      ...previewBody,
      rows: [row(1, true)],
      summary: { ...previewBody.summary, total: 1, importable: 0, duplicates: 1, failed: 0 },
    };
    const allFailed = {
      ...previewBody,
      rows: [row(1, false, "Date absente")],
      summary: { ...previewBody.summary, total: 1, importable: 0, duplicates: 0, failed: 1 },
    };

    const result = await startWith(allDuplicates);
    act(() => result.current.actions.toggleKeepDuplicate(1));
    expect(result.current.canCommit).toBe(true);

    fetchMock.mockResolvedValueOnce(jsonResponse(allFailed));
    await act(async () => {
      await result.current.actions.reanalyze();
    });

    // Nothing to write: the stale keep-list must not enable the button.
    expect(result.current.canCommit).toBe(false);
    expect(result.current.keepDuplicates).toEqual([]);
  });

  // `row_number` is a 1-based index into the file's *data* rows (see
  // backend/app/importers/parser.py), so moving the header or the preamble
  // renumbers every row. An override surviving that lands on a different
  // transaction than the one the user corrected.
  it("forgets the row-keyed choices when the dialect re-indexes the rows", async () => {
    const result = await startWith(withDuplicateBody);
    act(() => {
      result.current.actions.overrideCategory(2, 42);
      result.current.actions.toggleKeepDuplicate(2);
    });
    expect(result.current.overrides).toEqual({ 2: 42 });

    fetchMock.mockResolvedValueOnce(jsonResponse(withDuplicateBody));
    await act(async () => {
      await result.current.actions.setDialectField("preamble_rows", 5);
    });

    expect(result.current.overrides).toEqual({});
    expect(result.current.keepDuplicates).toEqual([]);
  });

  // Discarding the choices is right; discarding them without a word is the
  // silent failure this repository's contract forbids. The wizard hands the
  // screen a sentence naming what it threw away.
  it("says what the re-indexing change threw away, counting each kind", async () => {
    const result = await startWith(withDuplicateBody);
    act(() => {
      result.current.actions.overrideCategory(2, 42);
      result.current.actions.toggleKeepDuplicate(2);
    });

    fetchMock.mockResolvedValueOnce(jsonResponse(withDuplicateBody));
    await act(async () => {
      await result.current.actions.setDialectField("preamble_rows", 5);
    });

    expect(result.current.discardNotice).toContain("préambule");
    expect(result.current.discardNotice).toContain("1 catégorie corrigée");
    expect(result.current.discardNotice).toContain("1 doublon conservé");
  });

  // The spinner behind this fires onChange on every keystroke: typing "12"
  // reaches setDialectField twice, and the second pass has nothing left to
  // discard. It must neither raise a second notice nor wipe the first.
  it("stays silent when the re-indexing change had nothing to discard", async () => {
    const result = await startWith(withDuplicateBody);

    fetchMock.mockResolvedValueOnce(jsonResponse(withDuplicateBody));
    await act(async () => {
      await result.current.actions.setDialectField("preamble_rows", 1);
    });
    expect(result.current.discardNotice).toBeNull();

    act(() => result.current.actions.overrideCategory(2, 42));
    fetchMock.mockResolvedValueOnce(jsonResponse(withDuplicateBody));
    await act(async () => {
      await result.current.actions.setDialectField("preamble_rows", 1);
    });
    const raised = result.current.discardNotice;
    expect(raised).toContain("1 catégorie corrigée");

    fetchMock.mockResolvedValueOnce(jsonResponse(withDuplicateBody));
    await act(async () => {
      await result.current.actions.setDialectField("preamble_rows", 12);
    });
    expect(result.current.discardNotice).toBe(raised);
  });

  it("drops the notice once the user has relaunched the analysis", async () => {
    const result = await startWith(withDuplicateBody);
    act(() => result.current.actions.overrideCategory(2, 42));

    fetchMock.mockResolvedValueOnce(jsonResponse(withDuplicateBody));
    await act(async () => {
      await result.current.actions.setDialectField("preamble_rows", 5);
    });
    expect(result.current.discardNotice).not.toBeNull();

    fetchMock.mockResolvedValueOnce(jsonResponse(withDuplicateBody));
    await act(async () => {
      await result.current.actions.reanalyze();
    });
    expect(result.current.discardNotice).toBeNull();
  });

  // The dialect on the wizard is already the re-indexing one before the request
  // leaves. If the analyze then fails, choices left behind would be applied
  // under the new numbering by the next "Voir l'aperçu", which never clears them.
  it("forgets the row-keyed choices even when the re-analysis fails", async () => {
    const result = await startWith(withDuplicateBody);
    act(() => {
      result.current.actions.overrideCategory(2, 42);
      result.current.actions.toggleKeepDuplicate(2);
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "Erreur serveur inattendue." }, 500));
    await act(async () => {
      await result.current.actions.setDialectField("preamble_rows", 5);
    });

    expect(result.current.errors[0]).toContain("Erreur serveur inattendue.");
    expect(result.current.overrides).toEqual({});
    expect(result.current.keepDuplicates).toEqual([]);
    expect(result.current.discardNotice).not.toBeNull();
  });

  it("keeps them when the dialect change leaves the row numbering alone", async () => {
    const result = await startWith(withDuplicateBody);
    act(() => result.current.actions.overrideCategory(2, 42));

    fetchMock.mockResolvedValueOnce(jsonResponse(withDuplicateBody));
    await act(async () => {
      await result.current.actions.setDialectField("decimal_separator", ".");
    });

    expect(result.current.overrides).toEqual({ 2: 42 });
  });

  it("sends overrides and forced duplicates on commit", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(previewBody))
      .mockResolvedValueOnce(jsonResponse({ id: 1, rows_imported: 1 }, 201));
    const { result } = renderHook(() => useImportWizard());
    act(() => result.current.actions.selectAccount(1));
    await act(async () => {
      await result.current.actions.selectFile(new File(["x"], "b.csv", { type: "text/csv" }));
    });

    act(() => {
      result.current.actions.overrideCategory(1, 42);
      result.current.actions.toggleKeepDuplicate(1);
    });
    await act(async () => {
      await result.current.actions.commit();
    });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.overrides).toEqual({ "1": 42 });
    expect(body.keep_duplicates).toEqual([1]);
    expect(result.current.step).toBe("done");
  });
});
