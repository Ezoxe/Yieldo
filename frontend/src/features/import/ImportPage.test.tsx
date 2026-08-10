import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImportPage } from "./ImportPage";

const fetchMock = vi.fn();

const account = {
  id: 1,
  name: "Compte courant",
  kind: "checking",
  currency: "EUR",
  opening_balance_cents: 0,
  opened_on: null,
  include_in_net_worth: true,
  archived: false,
};

const previewBody = {
  upload_token: "tok.csv",
  original_filename: "b.csv",
  dialect: {
    encoding: "utf-8", delimiter: ";", decimal_separator: ",", date_format: "%d/%m/%Y",
    header_row: 0, preamble_rows: 0, quotechar: '"',
    sample_headers: ["dateOp", "label", "amount"],
  },
  headers: ["dateOp", "label", "amount"],
  sample_rows: [["01/03/2025", "CARREFOUR", "-47,32"]],
  suggested_mapping: { "0": "date", "1": "label", "2": "amount" },
  rows: [
    {
      row_number: 1, date: "2025-03-01", amount_cents: -4732, label_raw: "CARREFOUR",
      category_id: null, category_name: null, category_source: "uncategorized",
      is_duplicate: false, error: null,
    },
  ],
  summary: {
    total: 1, importable: 1, duplicates: 0, failed: 0,
    date_from: "2025-03-01", date_to: "2025-03-01",
    inflow_cents: 0, outflow_cents: -4732, mapping_errors: [],
  },
};

const committedBatch = {
  id: 7,
  account_id: 1,
  filename: "b.csv",
  rows_total: 1,
  rows_imported: 1,
  rows_duplicate: 0,
  rows_failed: 0,
  created_at: "2025-03-01T00:00:00Z",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Every ImportPage test dispatches on the request URL/method rather than call
// order: the mount effect fires GET /accounts, GET /categories and GET
// /imports/profiles essentially simultaneously, so asserting on
// fetchMock.mock.calls[n] the way the hook-level tests do would be fragile here.
function setupFetch(overrides: { commit?: () => Response; cancel?: () => Response } = {}) {
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const method = init?.method ?? "GET";

    if (url === "/api/accounts") return Promise.resolve(jsonResponse([account]));
    if (url === "/api/categories") return Promise.resolve(jsonResponse([]));
    if (url === "/api/imports/profiles" && method === "GET") return Promise.resolve(jsonResponse([]));
    if (url === "/api/imports/analyze") return Promise.resolve(jsonResponse(previewBody));
    if (url === "/api/imports/commit") {
      return Promise.resolve(overrides.commit ? overrides.commit() : jsonResponse(committedBatch, 201));
    }
    if (url === `/api/imports/${committedBatch.id}` && method === "DELETE") {
      return Promise.resolve(overrides.cancel ? overrides.cancel() : jsonResponse({ removed: 1 }));
    }
    throw new Error(`Unhandled fetch in test: ${method} ${url}`);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

async function driveToPreviewStep() {
  render(<ImportPage />);

  await userEvent.selectOptions(
    await screen.findByLabelText("Compte"),
    await screen.findByRole("option", { name: "Compte courant" }),
  );

  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  await userEvent.upload(fileInput, new File(["x"], "b.csv", { type: "text/csv" }));

  await screen.findByText("Taggez vos colonnes");
  await userEvent.click(screen.getByRole("button", { name: "Voir l'aperçu" }));

  await screen.findByText("Aperçu des lignes");
}

describe("ImportPage — surfacing commit/cancel failures", () => {
  it("shows the backend's message on the preview step when commit fails, and keeps the user there", async () => {
    setupFetch({ commit: () => jsonResponse({ detail: "Mapping de colonnes invalide" }, 422) });
    await driveToPreviewStep();

    await userEvent.click(screen.getByRole("button", { name: "Valider l'import" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Mapping de colonnes invalide");
    // Still on the preview step: its own controls are still there, not swapped
    // out for the done screen.
    expect(screen.getByRole("button", { name: "Valider l'import" })).toBeInTheDocument();
    expect(screen.queryByText("Import terminé")).not.toBeInTheDocument();
  });

  it("tells the user plainly that their upload expired when commit returns 410", async () => {
    setupFetch({
      commit: () => jsonResponse({ detail: "Le fichier téléversé a expiré. Recommencez l'import." }, 410),
    });
    await driveToPreviewStep();

    await userEvent.click(screen.getByRole("button", { name: "Valider l'import" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Le fichier téléversé a expiré. Recommencez l'import.");
    expect(alert.textContent).toMatch(/expiré/);
  });

  it("shows the backend's message on the done step when cancelImport fails", async () => {
    setupFetch({ cancel: () => jsonResponse({ detail: "Lot d'import introuvable" }, 404) });
    await driveToPreviewStep();

    await userEvent.click(screen.getByRole("button", { name: "Valider l'import" }));
    await screen.findByText("Import terminé");

    await userEvent.click(screen.getByRole("button", { name: "Annuler cet import" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Lot d'import introuvable");
    // Still on the done step -- a failed cancel must not silently reset the wizard.
    expect(screen.getByText("Import terminé")).toBeInTheDocument();
  });
});
