import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ImportBatch } from "../../lib/types";
import { ImportSummary } from "./ImportSummary";

const batch = (counts: Partial<ImportBatch>): ImportBatch => ({
  id: 1,
  account_id: 1,
  filename: "releve.csv",
  rows_total: 400,
  rows_imported: 320,
  rows_duplicate: 60,
  rows_failed: 20,
  created_at: "2026-08-12T08:29:00Z",
  ...counts,
});

/** The sentence as read, with the non-breaking spaces flattened. */
function report(counts: Partial<ImportBatch> = {}): string {
  const { container } = render(
    <ImportSummary
      summary={null}
      batch={batch(counts)}
      isBusy={false}
      onCancelImport={() => {}}
    />,
  );
  return (container.querySelector(".yd-summary__report")?.textContent ?? "").replace(
    / /g,
    " ",
  );
}

// The last screen of the only path that writes user data, and the sentence it
// ends on. The plural must land on the noun, not on the end of the phrase.
describe("ImportSummary — the completion line", () => {
  it("agrees in the plural", () => {
    expect(report()).toBe(
      "320 lignes importées dans « releve.csv », 60 doublons ignorés, 20 lignes en erreur.",
    );
  });

  it("agrees in the singular", () => {
    expect(report({ rows_imported: 1, rows_duplicate: 1, rows_failed: 1 })).toBe(
      "1 ligne importée dans « releve.csv », 1 doublon ignoré, 1 ligne en erreur.",
    );
  });

  it("takes the singular for zero, as French does, and drops the empty counts", () => {
    expect(report({ rows_imported: 0, rows_duplicate: 0, rows_failed: 0 })).toBe(
      "0 ligne importée dans « releve.csv ».",
    );
  });
});
