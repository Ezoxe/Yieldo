import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commitBlockedReason, commitCounts, ImportPage } from "./ImportPage";

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

// Three importable rows, two duplicates, one broken row -- the shape the
// action bar has to state before the user commits anything.
const mixedPreviewBody = {
  ...previewBody,
  rows: [
    ...[1, 2, 3].map((row_number) => ({
      row_number, date: "2025-03-01", amount_cents: -4732, label_raw: `LIGNE ${row_number}`,
      category_id: null, category_name: null, category_source: "uncategorized",
      is_duplicate: false, error: null,
    })),
    ...[4, 5].map((row_number) => ({
      row_number, date: "2025-03-02", amount_cents: -1000, label_raw: `DOUBLON ${row_number}`,
      category_id: null, category_name: null, category_source: "uncategorized",
      is_duplicate: true, error: null,
    })),
    {
      row_number: 6, date: null, amount_cents: null, label_raw: "",
      category_id: null, category_name: null, category_source: "uncategorized",
      is_duplicate: false, error: "Date illisible",
    },
  ],
  summary: {
    total: 6, importable: 3, duplicates: 2, failed: 1,
    date_from: "2025-03-01", date_to: "2025-03-02",
    inflow_cents: 0, outflow_cents: -16196, mapping_errors: [],
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
function setupFetch(
  overrides: { commit?: () => Response; cancel?: () => Response; analyze?: () => Response } = {},
) {
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const method = init?.method ?? "GET";

    if (url === "/api/accounts") return Promise.resolve(jsonResponse([account]));
    if (url === "/api/categories") return Promise.resolve(jsonResponse([]));
    if (url === "/api/imports/profiles" && method === "GET") return Promise.resolve(jsonResponse([]));
    if (url === "/api/imports" && method === "GET") return Promise.resolve(jsonResponse([committedBatch]));
    if (url === "/api/imports/analyze") {
      return Promise.resolve(overrides.analyze ? overrides.analyze() : jsonResponse(previewBody));
    }
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

// The bar is found from the control it carries rather than through a test-only
// attribute: what matters is that the commit button lives inside it.
function actionBarOf(control: HTMLElement): HTMLElement {
  const bar = control.closest(".yd-import__actionbar");
  if (!bar) throw new Error("The control is not inside an action bar");
  return bar as HTMLElement;
}

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

// Comments stripped, so a rule described in prose cannot satisfy an assertion
// about the declarations themselves. These assertions prove the rule is
// written, never that it survives the cascade on screen -- phase 1.5 has
// already been bitten by a CSS test staying green over a dead effect, which is
// why the browser pass, not this file, is the gate for the pinned bar.
const importCss = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./ImportPage.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

function ruleBody(selector: string): string {
  const start = importCss.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No rule for "${selector}" in ImportPage.css`);
  return importCss.slice(importCss.indexOf("{", start) + 1, importCss.indexOf("}", start));
}

describe("ImportPage.css — the pinned action bar", () => {
  it("sticks the bar to the bottom of the viewport", () => {
    const rule = ruleBody(".yd-import__actionbar");
    expect(rule).toMatch(/position:\s*sticky/);
    expect(rule).toMatch(/bottom:\s*0/);
  });

  it("paints it opaque, so the rows sliding under it never read through", () => {
    expect(ruleBody(".yd-import__actionbar")).toMatch(/background:\s*var\(--yd-surface-strong\)/);
  });

  it("keeps it above the preview table's own sticky header", () => {
    const zIndex = /z-index:\s*(\d+)/.exec(ruleBody(".yd-import__actionbar"))?.[1];
    expect(Number(zIndex)).toBeGreaterThan(5);
  });

  // An opaque bar across the bottom of the scrollport is also an opaque bar
  // across whatever the browser just scrolled a newly focused control to. The
  // preview table has no vertical scroll of its own, so the scrolling box is
  // the document and the reserve has to be declared on its root.
  it("reserves the bar's height on the scrolling root, so a focused control below the fold is not scrolled under it", () => {
    expect(ruleBody(":root:has(.yd-import__actionbar)")).toMatch(/scroll-padding-bottom:\s*\S/);
  });
});

describe("commitCounts", () => {
  const summary = { ...mixedPreviewBody.summary };

  it("reports what the commit will write, not what the file contained", () => {
    expect(commitCounts(summary, 0)).toEqual({ toImport: 3, duplicatesIgnored: 2, failed: 1 });
  });

  it("moves a kept duplicate from the ignored column to the imported one", () => {
    expect(commitCounts(summary, 2)).toEqual({ toImport: 5, duplicatesIgnored: 0, failed: 1 });
  });

  it("never reports a negative number of ignored duplicates", () => {
    // Not reachable through the wizard any more -- a fresh preview filters the
    // keep-list down to rows it still reads as duplicates. This holds the line
    // for any other caller of the exported function.
    expect(commitCounts(summary, 5).duplicatesIgnored).toBe(0);
  });
});

describe("commitBlockedReason", () => {
  const committable = { isPreviewStale: false, errors: [], total: 6, toImport: 3 };

  it("is silent when nothing blocks the commit", () => {
    expect(commitBlockedReason(committable)).toBeNull();
  });

  it("names the stale preview first, since that is the contract that matters", () => {
    const reason = commitBlockedReason({ ...committable, isPreviewStale: true, errors: ["x"] });
    expect(reason).toMatch(/relancez l'analyse/i);
  });

  it("points at the error already on screen rather than repeating it", () => {
    expect(commitBlockedReason({ ...committable, errors: ["Mapping invalide"] })).toMatch(
      /Corrigez l'erreur/i,
    );
  });

  it("distinguishes an empty file from a file of duplicates", () => {
    expect(commitBlockedReason({ ...committable, total: 0, toImport: 0 })).toMatch(/aucune ligne/i);
    expect(commitBlockedReason({ ...committable, toImport: 0 })).toMatch(/doublons ou en erreur/i);
  });

  // The bar's `disabled` must never disagree with the sentence under it: a
  // greyed button with no explanation is exactly the dead end this task fixes.
  it("returns a reason for every state the wizard refuses to commit, and only those", () => {
    for (const isPreviewStale of [false, true]) {
      for (const errors of [[], ["boom"]]) {
        for (const toImport of [0, 3]) {
          const canCommit = !isPreviewStale && errors.length === 0 && toImport > 0;
          const reason = commitBlockedReason({ isPreviewStale, errors, total: 6, toImport });
          expect(reason === null, `stale=${isPreviewStale} errors=${errors.length} rows=${toImport}`).toBe(
            canCommit,
          );
        }
      }
    }
  });
});

describe("ImportPage — creating a bank account", () => {
  // There is no way for a freshly registered user to reach the import wizard
  // without this: GET /accounts starts empty, and nothing else in the app
  // ever POSTs to /api/accounts.
  function setupEmptyAccountsFetch(overrides: { createAccount?: () => Response } = {}) {
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      const method = init?.method ?? "GET";

      if (url === "/api/accounts" && method === "GET") return Promise.resolve(jsonResponse([]));
      if (url === "/api/accounts" && method === "POST") {
        return Promise.resolve(
          overrides.createAccount ? overrides.createAccount() : jsonResponse(account, 201),
        );
      }
      if (url === "/api/categories") return Promise.resolve(jsonResponse([]));
      if (url === "/api/imports/profiles" && method === "GET") return Promise.resolve(jsonResponse([]));
      throw new Error(`Unhandled fetch in test: ${method} ${url}`);
    });
  }

  it("invites the user to create an account when none exist, instead of a bare disabled select", async () => {
    setupEmptyAccountsFetch();
    render(<ImportPage />);

    await screen.findByText(/pas encore de compte/i);
    expect(screen.queryByLabelText("Compte")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Nom du compte")).toBeInTheDocument();
    expect(screen.getByLabelText("Type de compte")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Créer" })).toBeInTheDocument();
  });

  it("submitting the form POSTs the expected payload and selects the created account", async () => {
    const user = userEvent.setup();
    const created = { ...account, id: 7, name: "Livret A", kind: "savings" };
    setupEmptyAccountsFetch({
      createAccount: () => {
        return jsonResponse(created, 201);
      },
    });
    render(<ImportPage />);

    await screen.findByText(/pas encore de compte/i);
    await user.type(screen.getByLabelText("Nom du compte"), "Livret A");
    await user.selectOptions(screen.getByLabelText("Type de compte"), "savings");
    await user.click(screen.getByRole("button", { name: "Créer" }));

    // The dropdown only exists once at least one account exists -- its
    // appearance, already selecting the new account, IS the assertion that
    // the wizard moved on instead of leaving the user stuck on an empty list.
    await expect(screen.findByLabelText("Compte")).resolves.toHaveValue(String(created.id));

    const postCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        (typeof input === "string" ? input : String(input)) === "/api/accounts" &&
        (init?.method ?? "GET") === "POST",
    );
    expect(postCall).toBeDefined();
    expect(JSON.parse(postCall![1]!.body as string)).toEqual({ name: "Livret A", kind: "savings" });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeDisabled();
  });

  it("shows the backend's French message when account creation fails, and keeps the form", async () => {
    const user = userEvent.setup();
    setupEmptyAccountsFetch({
      createAccount: () => jsonResponse({ detail: "Type de compte inconnu : savings" }, 422),
    });
    render(<ImportPage />);

    await screen.findByText(/pas encore de compte/i);
    await user.type(screen.getByLabelText("Nom du compte"), "Compte test");
    await user.click(screen.getByRole("button", { name: "Créer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Type de compte inconnu : savings");
    // Still on the empty state with the form intact -- a failed creation
    // must not silently reset what the user typed, nor pretend it worked.
    expect(screen.getByLabelText("Nom du compte")).toBeInTheDocument();
    expect(screen.queryByLabelText("Compte")).not.toBeInTheDocument();
  });
});

describe("ImportPage — past imports", () => {
  it("shows the import history on the landing step, where someone who has already imported will look", async () => {
    setupFetch();
    render(<ImportPage />);

    // The batch listed by GET /api/imports, on the first screen of the wizard.
    expect(await screen.findByText("b.csv")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Supprimer cet import/i })).toBeInTheDocument();
  });
});

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

  it("keeps the commit action reachable without scrolling past the preview table", async () => {
    setupFetch({ analyze: () => jsonResponse(mixedPreviewBody) });
    await driveToPreviewStep();

    const bar = actionBarOf(screen.getByRole("button", { name: "Valider l'import" }));

    // The defect this task exists to fix: the operator never saw that there
    // was anything left to do. The bar states what the click will write.
    expect(bar).toHaveTextContent("3 lignes à importer");
    expect(bar).toHaveTextContent("2 doublons ignorés");
    expect(bar).toHaveTextContent("1 ligne en erreur");
    // Both the way forward and the way back are in the bar, not below the table.
    expect(bar).toContainElement(screen.getByRole("button", { name: "Retour au tagging" }));
  });

  it("counts a duplicate the user chose to keep as a row that will be imported", async () => {
    const user = userEvent.setup();
    setupFetch({ analyze: () => jsonResponse(mixedPreviewBody) });
    await driveToPreviewStep();

    await user.click(screen.getAllByRole("checkbox", { name: "Importer quand même" })[0]);

    const bar = actionBarOf(screen.getByRole("button", { name: "Valider l'import" }));
    expect(bar).toHaveTextContent("4 lignes à importer");
    expect(bar).toHaveTextContent("1 doublon ignoré");
  });

  it("says in French why the commit is refused when every row is a duplicate", async () => {
    setupFetch({
      analyze: () =>
        jsonResponse({
          ...mixedPreviewBody,
          rows: mixedPreviewBody.rows.filter((row) => row.is_duplicate),
          summary: { ...mixedPreviewBody.summary, total: 2, importable: 0, duplicates: 2, failed: 0 },
        }),
    });
    await driveToPreviewStep();

    const commit = screen.getByRole("button", { name: "Valider l'import" });
    expect(commit).toBeDisabled();
    expect(actionBarOf(commit)).toHaveTextContent(
      "Aucune ligne à importer : toutes les lignes de ce fichier sont des doublons ou en erreur.",
    );
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
