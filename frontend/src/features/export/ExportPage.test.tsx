import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import { ApiError, api } from "../../lib/api";
import type { ExportDocument, ExportScopeRequest } from "../../lib/types";
import { ExportPage } from "./ExportPage";
import { DOCUMENT, DOCUMENT_TOO_BIG, OPTIONS, TEMPLATES } from "./fixtures";

/** Every `POST /export` body this render sent, in order. */
let built: ExportScopeRequest[];
/** Every `POST /export/download` body. */
let downloaded: Array<ExportScopeRequest & { format: string }>;
let copied: string[];

function mockApi(document: ExportDocument | Error = DOCUMENT) {
  built = [];
  downloaded = [];
  vi.spyOn(api, "get").mockImplementation((path: string) => {
    if (path === "/export/options") return Promise.resolve(OPTIONS as never);
    if (path === "/export/templates") return Promise.resolve(TEMPLATES as never);
    throw new Error(`unexpected path ${path}`);
  });
  vi.spyOn(api, "post").mockImplementation((path: string, body?: unknown) => {
    if (path === "/export") {
      built.push(body as ExportScopeRequest);
      return document instanceof Error
        ? Promise.reject(document)
        : Promise.resolve(document as never);
    }
    if (path === "/export/download") {
      downloaded.push(body as ExportScopeRequest & { format: string });
      return Promise.resolve({
        filename: "yieldo-contexte-2025-01-01_2026-12-31.md",
        content_type: "text/markdown; charset=utf-8",
        content: DOCUMENT.markdown,
      } as never);
    }
    throw new Error(`unexpected path ${path}`);
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <ExportPage />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

const last = () => built[built.length - 1];

/**
 * `userEvent.setup()` installs its OWN `navigator.clipboard` stub, so a mock
 * defined in `beforeEach` is replaced the moment a test creates a user. The
 * clipboard therefore has to be (re)installed AFTER the setup call — this
 * cost two failing tests before it was understood.
 */
function setupUserWithClipboard(reject = false) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        if (reject) return Promise.reject(new Error("denied"));
        copied.push(text);
        return Promise.resolve();
      },
    },
  });
  return user;
}

beforeEach(() => {
  copied = [];
  vi.useFakeTimers({ shouldAdvanceTime: true });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        copied.push(text);
        return Promise.resolve();
      },
    },
  });
  // jsdom implements neither of these, and the download path uses both.
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:fake"),
    revokeObjectURL: vi.fn(),
  });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the scope panel", () => {
  it("offers this household's own accounts, categories and the ten modules", async () => {
    mockApi();
    renderPage();

    await screen.findByTestId("yd-export-scope");
    expect(screen.getByLabelText("Compte courant")).toBeInTheDocument();
    expect(screen.getByLabelText("Alimentation / Courses")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^yd-export-module-/)).toHaveLength(10);
  });

  it("starts on the ledger's own span rather than on an invented one", async () => {
    mockApi();
    renderPage();
    await screen.findByTestId("yd-export-scope");
    await waitFor(() => expect(built.length).toBeGreaterThan(0));
    expect(last().date_from).toBe("2025-01-24");
    expect(last().date_to).toBe("2026-01-09");
  });
});

describe("the live token estimate", () => {
  it("is on screen with the count the API measured", async () => {
    mockApi();
    renderPage();
    expect(await screen.findByTestId("yd-export-tokens")).toHaveTextContent("1 284");
  });

  it("re-asks the API when the scope changes, and shows what came back", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi();
    renderPage();
    await screen.findByTestId("yd-export-scope");
    await waitFor(() => expect(built.length).toBeGreaterThan(0));
    const before = built.length;

    await user.selectOptions(screen.getByLabelText(/Granularité/), "transaction");

    await waitFor(() => expect(built.length).toBeGreaterThan(before));
    expect(last().granularity).toBe("transaction");
  });

  it("sends the ticked module set, and never one the reader unticked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi();
    renderPage();
    await screen.findByTestId("yd-export-scope");
    await waitFor(() => expect(built.length).toBeGreaterThan(0));
    expect(last().modules).toContain("profil");

    await user.click(screen.getByLabelText("Profil"));

    await waitFor(() => expect(last().modules).not.toContain("profil"));
  });

  it("sends the anonymisation flag when it is switched on", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi();
    renderPage();
    await screen.findByTestId("yd-export-scope");
    await waitFor(() => expect(built.length).toBeGreaterThan(0));

    await user.click(screen.getByLabelText(/Anonymiser/));

    await waitFor(() => expect(last().anonymise).toBe(true));
  });
});

describe("the context-window warning", () => {
  it("is absent while the document fits", async () => {
    mockApi();
    renderPage();
    await screen.findByTestId("yd-export-tokens");
    expect(screen.queryByTestId("yd-export-warning")).toBeNull();
  });

  it("appears verbatim once it does not, and is not an alert", async () => {
    mockApi(DOCUMENT_TOO_BIG);
    renderPage();
    const warning = await screen.findByTestId("yd-export-warning");
    expect(warning).toHaveTextContent("Ce document est estimé à 91 740 tokens");
    expect(warning).toHaveTextContent("Réduisez la granularité");
    // A document too big for a window is a measurement, not a failure.
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the five templates", () => {
  it("are all offered, each with what it covers", async () => {
    mockApi();
    renderPage();
    const panel = await screen.findByTestId("yd-export-templates");
    expect(within(panel).getAllByTestId(/^yd-export-template-/)).toHaveLength(5);
    expect(panel).toHaveTextContent("Bilan annuel");
    expect(panel).toHaveTextContent("Diagnostic budgétaire");
  });

  it("applies its own scope when it is picked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi();
    renderPage();
    await screen.findByTestId("yd-export-templates");
    await waitFor(() => expect(built.length).toBeGreaterThan(0));

    await user.click(screen.getByRole("button", { name: /Revue de portefeuille/ }));

    await waitFor(() => expect(last().granularity).toBe("annual"));
    expect(last().modules).toEqual(["patrimoine", "positions", "projections", "fiscalite"]);
    expect(last().date_from).toBe("2025-09-01");
  });

  it("shows the question it carries, so it can be pasted with the document", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi();
    renderPage();
    await screen.findByTestId("yd-export-templates");

    await user.click(screen.getByRole("button", { name: /Optimisation fiscale/ }));

    expect(await screen.findByTestId("yd-export-question")).toHaveTextContent(
      "Tu n'es pas mon conseiller fiscal.",
    );
  });
});

describe("copying", () => {
  it("puts the document on the clipboard in one click", async () => {
    const user = setupUserWithClipboard();
    mockApi();
    renderPage();
    await screen.findByTestId("yd-export-tokens");

    await user.click(screen.getByRole("button", { name: /Copier le document/ }));

    await waitFor(() => expect(copied).toEqual([DOCUMENT.markdown]));
    expect(await screen.findByTestId("yd-export-copied")).toHaveTextContent("Copié");
  });

  it("says so in French when the clipboard refuses, rather than pretending it worked", async () => {
    const user = setupUserWithClipboard(true);
    mockApi();
    renderPage();
    await screen.findByTestId("yd-export-tokens");

    await user.click(screen.getByRole("button", { name: /Copier le document/ }));

    expect(await screen.findByTestId("yd-export-error")).toHaveTextContent(
      "Le presse-papiers a refusé la copie",
    );
  });

  it("copies the template's question on its own button", async () => {
    const user = setupUserWithClipboard();
    mockApi();
    renderPage();
    await screen.findByTestId("yd-export-templates");
    await user.click(screen.getByRole("button", { name: /Diagnostic budgétaire/ }));
    await screen.findByTestId("yd-export-question");

    await user.click(screen.getByRole("button", { name: /Copier la question/ }));

    await waitFor(() => expect(copied[0]).toContain("Analyse mon budget"));
  });
});

describe("downloading", () => {
  it("offers the three formats design §8.2 names, and asks for the one clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi();
    renderPage();
    await screen.findByTestId("yd-export-tokens");

    await user.click(screen.getByRole("button", { name: ".json" }));

    await waitFor(() => expect(downloaded).toHaveLength(1));
    expect(downloaded[0].format).toBe("json");
    // The scope travels with it: a file must cover what the screen showed.
    expect(downloaded[0].granularity).toBe(last().granularity);
  });

  it("has a button for each of .md, .txt and .json", async () => {
    mockApi();
    renderPage();
    await screen.findByTestId("yd-export-tokens");
    for (const format of [".md", ".txt", ".json"]) {
      expect(screen.getByRole("button", { name: format })).toBeInTheDocument();
    }
  });
});

describe("a refusal", () => {
  it("prints the engine's own sentence as content, never as an alert", async () => {
    mockApi(
      new ApiError(
        422,
        "L'anonymisation en valeurs relatives est impossible : aucune dépense n'a été observée sur ce périmètre, il n'existe donc aucune base de référence. Élargissez la période ou désactivez l'anonymisation.",
      ),
    );
    renderPage();

    const refusal = await screen.findByTestId("yd-export-refusal");
    expect(refusal).toHaveTextContent("il n'existe donc aucune base de référence");
    expect(screen.queryByRole("alert")).toBeNull();
    // And nothing pretends there is a document to copy.
    expect(screen.queryByRole("button", { name: /Copier le document/ })).toBeNull();
  });

  it("shows a genuine failure as an alert instead", async () => {
    mockApi(new ApiError(500, "Une erreur inattendue est survenue."));
    renderPage();
    const alert = await screen.findByTestId("yd-export-error");
    expect(alert).toHaveAttribute("role", "alert");
  });
});
