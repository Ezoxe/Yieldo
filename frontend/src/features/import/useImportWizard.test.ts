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
